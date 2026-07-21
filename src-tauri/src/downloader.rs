//! Real download manager with progress events, pause/resume, and cancel.
//!
//! ## Event names
//!
//! Uses the FIXED event name `download-progress` for all state changes
//! (downloading / paused / completed / cancelled / failed). The download
//! `id` is part of the JSON payload, NOT part of the event name — Tauri 2's
//! `listen()` rejects event names containing anything other than
//! `A–Z a–z 0–9 - _ / :`, so previous versions that used
//! `xirea://download/progress/<id>` failed when `id` contained URL-encoded
//! characters.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;
use tokio::sync::oneshot;

use crate::commands::{EVENT_DOWNLOAD_COMPLETE, EVENT_DOWNLOAD_PROGRESS};

/// Fixed event-name constant for download progress. Re-exported here so
/// tests in this module don't need to reach across to `commands`.
// (already imported above)

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub id: String,
    pub received_bytes: u64,
    pub total_bytes: Option<u64>,
    pub speed_bps: Option<f64>,
    pub eta_seconds: Option<f64>,
    pub state: String, // "downloading" | "paused" | "completed" | "failed" | "cancelled"
    pub error: Option<String>,
}

/// Marker state container. Currently empty — kept around so the
/// `tauri::Builder::manage(DownloaderState::default())` call in `lib.rs`
/// doesn't have to change if we add state later (e.g. a global download
/// queue).
#[derive(Default)]
pub struct DownloaderState {}

/// Run a single download. Emits `download-progress` events with the
/// download `id` in the payload (NOT in the event name).
///
/// Resume is implemented via HTTP `Range: bytes=<received>-` headers. If
/// the server returns `206 Partial Content`, we append to the existing
/// file. If it returns `200 OK` (ignoring the Range header), we restart
/// from byte 0 — never silently lying to the user that we resumed.
pub async fn run_download(
    app: AppHandle,
    id: String,
    url: String,
    target: PathBuf,
    pause_flag: Arc<AtomicBool>,
    cancel_rx: oneshot::Receiver<()>,
) -> Result<(), String> {
    use futures_util::StreamExt;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;

    // Check for an existing partial file and resume from there if the server
    // advertises range support.
    let mut resume_from: u64 = 0;
    if target.exists() {
        resume_from = tokio::fs::metadata(&target)
            .await
            .map(|m| m.len())
            .unwrap_or(0);
    }

    let mut req = client.get(&url);
    if resume_from > 0 {
        req = req.header("Range", format!("bytes={}-", resume_from));
    }
    let response = req.send().await.map_err(|e| e.to_string())?;

    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        let err = format!("HTTP {}: {}", status, truncate_str(&text, 500));
        let _ = app.emit(
            EVENT_DOWNLOAD_PROGRESS,
            DownloadProgress {
                id: id.clone(),
                received_bytes: 0,
                total_bytes: None,
                speed_bps: None,
                eta_seconds: None,
                state: "failed".into(),
                error: Some(err.clone()),
            },
        );
        return Err(err);
    }

    let total_bytes = response.content_length();
    // If we resumed, the content-length is the remaining bytes — adjust.
    let total = if status == reqwest::StatusCode::PARTIAL_CONTENT {
        total_bytes.map(|n| n + resume_from)
    } else {
        // Server ignored the Range header — start over.
        resume_from = 0;
        total_bytes
    };

    let mut file = if resume_from > 0 && status == reqwest::StatusCode::PARTIAL_CONTENT {
        tokio::fs::OpenOptions::new()
            .append(true)
            .create(false)
            .open(&target)
            .await
            .map_err(|e| e.to_string())?
    } else {
        if target.exists() {
            let _ = tokio::fs::remove_file(&target).await;
        }
        if let Some(parent) = target.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| e.to_string())?;
        }
        tokio::fs::File::create(&target)
            .await
            .map_err(|e| e.to_string())?
    };

    let mut received = resume_from;
    let mut last_emit = Instant::now();
    let mut last_bytes = received;
    let mut last_speed: Option<f64> = None;
    let mut stream = response.bytes_stream();

    // Initial state event.
    emit_progress(&app, &id, received, total, None, "downloading", None);

    // Use a select to honor cancellation.
    tokio::pin!(cancel_rx);
    loop {
        // Check pause flag — park for 100ms if paused.
        if pause_flag.load(Ordering::SeqCst) {
            emit_progress(&app, &id, received, total, None, "paused", None);
            while pause_flag.load(Ordering::SeqCst) {
                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_millis(100)) => {},
                    _ = &mut cancel_rx => {
                        emit_progress(&app, &id, received, total, None, "cancelled", None);
                        let _ = tokio::fs::remove_file(&target).await;
                        return Ok(());
                    }
                }
            }
            emit_progress(&app, &id, received, total, None, "downloading", None);
            last_emit = Instant::now();
            last_bytes = received;
        }

        tokio::select! {
            chunk = stream.next() => {
                match chunk {
                    Some(Ok(bytes)) => {
                        file.write_all(&bytes).await.map_err(|e| e.to_string())?;
                        received += bytes.len() as u64;

                        // Throttle progress events to 10 per second.
                        let now = Instant::now();
                        let elapsed = now.duration_since(last_emit).as_secs_f64();
                        if elapsed >= 0.1 || (total.is_some() && received == total.unwrap()) {
                            let delta = received - last_bytes;
                            let speed = if elapsed > 0.0 {
                                let s = delta as f64 / elapsed;
                                // Exponential moving average for smoother display.
                                last_speed = Some(match last_speed {
                                    Some(prev) => prev * 0.6 + s * 0.4,
                                    None => s,
                                });
                                last_speed
                            } else {
                                last_speed
                            };
                            emit_progress(&app, &id, received, total, speed, "downloading", None);
                            last_emit = now;
                            last_bytes = received;
                        }
                    }
                    Some(Err(e)) => {
                        let err = e.to_string();
                        emit_progress(&app, &id, received, total, None, "failed", Some(err.clone()));
                        return Err(err);
                    }
                    None => {
                        // Stream ended.
                        file.flush().await.map_err(|e| e.to_string())?;
                        let final_total = total.unwrap_or(received);
                        emit_progress(&app, &id, final_total, Some(final_total), None, "completed", None);
                        // Separate `download-complete` event so the UI can
                        // show a toast / trigger post-download verification
                        // without parsing the `state` field of every
                        // progress event.
                        let _ = app.emit(
                            EVENT_DOWNLOAD_COMPLETE,
                            serde_json::json!({
                                "id": id,
                                "path": target.to_string_lossy(),
                                "totalBytes": final_total,
                            }),
                        );
                        return Ok(());
                    }
                }
            }
            _ = &mut cancel_rx => {
                emit_progress(&app, &id, received, total, None, "cancelled", None);
                let _ = tokio::fs::remove_file(&target).await;
                return Ok(());
            }
        }
    }
}

/// Emit a `download-progress` event with the given state. Centralised so
/// we never typo the event name or forget the `id` field.
fn emit_progress(
    app: &AppHandle,
    id: &str,
    received: u64,
    total: Option<u64>,
    speed: Option<f64>,
    state: &str,
    error: Option<String>,
) {
    let eta = match (total, speed) {
        (Some(t), Some(s)) if s > 0.0 && t > received => Some((t - received) as f64 / s),
        _ => None,
    };
    let _ = app.emit(
        EVENT_DOWNLOAD_PROGRESS,
        DownloadProgress {
            id: id.to_string(),
            received_bytes: received,
            total_bytes: total,
            speed_bps: speed,
            eta_seconds: eta,
            state: state.to_string(),
            error,
        },
    );
}

fn truncate_str(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let truncated: String = s.chars().take(max).collect();
        format!("{}…", truncated)
    }
}
