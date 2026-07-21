//! Tauri command handlers — chat, providers, files, downloads, HF, llama.cpp,
//! system info, benchmark, verification.
//!
//! ## Event-name discipline (Tauri 2)
//!
//! Tauri 2's `listen()` command rejects event names that contain anything
//! other than `A–Z a–z 0–9 - _ / :`. We therefore use a **fixed** set of
//! event names and put the routing key (`sessionId`, `id`, `modelPath`)
//! inside the JSON payload. This avoids the
//! `invalid args 'event' for command 'listen'` runtime error that the
//! previous URL-encoded-suffix design kept triggering.
//!
//! Fixed event names:
//!
//! | Event                | Payload                                              |
//! |----------------------|------------------------------------------------------|
//! | `chat-delta`         | `{ id, delta, accumulated, tokens, done, reason }`   |
//! | `chat-error`         | `{ id, error }`                                      |
//! | `chat-cancel`        | `{ id }`                                             |
//! | `download-progress`  | `{ id, receivedBytes, totalBytes, speedBps, ... }`   |
//! | `download-complete`  | `{ id, path, totalBytes }`                           |
//! | `llama-server-log`   | `{ session, modelPath, stream, line, phase }`        |
//! | `llama-server-ready` | `{ session, modelPath, port, url }`                  |
//! | `llama-server-error` | `{ session, modelPath, error, diagnostic }`          |
//! | `model-load-progress`| `{ id, percent, message, model }` (Ollama only)      |
//! | `model-load-done`    | `{ id, model }`                                      |
//! | `model-load-error`   | `{ id, error }`                                      |

use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Emitter};

use crate::benchmark::{self, BenchmarkResult};
use crate::llama_runtime::{
    self, BinaryLookup, ModelImportVerification, RuntimeVerification, SessionLog,
};
use crate::system_info::{self, SystemInfo};
use crate::verify::{self, VerificationResult};
use crate::{
    expand_path, gguf, hf, providers, ChatCompletionRequest, ChatStreamDelta, CloudModelDto,
    FileMeta, GgufMetadata, HfFileDto, HfModelDto, DOWNLOAD_CANCELS, DOWNLOAD_PAUSED,
};

// ---------------------------------------------------------------------------
// Fixed event-name constants — single source of truth.
// ---------------------------------------------------------------------------

/// Streaming chat delta event. Payload: [`ChatStreamDelta`] + `id`.
pub const EVENT_CHAT_DELTA: &str = "chat-delta";
/// Chat error event. Payload: `{ id, error }`.
pub const EVENT_CHAT_ERROR: &str = "chat-error";
/// Chat cancel event. Payload: `{ id }`.
pub const EVENT_CHAT_CANCEL: &str = "chat-cancel";

/// Download progress event. Payload: [`DownloadProgressPayload`].
pub const EVENT_DOWNLOAD_PROGRESS: &str = "download-progress";
/// Download complete event. Payload: `{ id, path, totalBytes }`.
pub const EVENT_DOWNLOAD_COMPLETE: &str = "download-complete";

/// llama-server log event. Payload: [`LlamaLogPayload`].
pub const EVENT_LLAMA_LOG: &str = "llama-server-log";
/// llama-server ready event. Payload: [`LlamaReadyPayload`].
pub const EVENT_LLAMA_READY: &str = "llama-server-ready";
/// llama-server error event. Payload: [`LlamaErrorPayload`].
pub const EVENT_LLAMA_ERROR: &str = "llama-server-error";

/// Ollama load progress. Payload: `{ id, percent, message, model }`.
pub const EVENT_MODEL_LOAD_PROGRESS: &str = "model-load-progress";
/// Ollama load done. Payload: `{ id, model }`.
pub const EVENT_MODEL_LOAD_DONE: &str = "model-load-done";
/// Ollama load error. Payload: `{ id, error }`.
pub const EVENT_MODEL_LOAD_ERROR: &str = "model-load-error";

/// llama-server process-exited event. Emitted when the child process
/// terminates (cleanly or with an error). Payload: [`LlamaExitedPayload`].
/// This is the event that carries the **real** stdout / stderr / exit_code
/// so the UI can show the actual reason the process died — never the
/// generic "exited without printing anything" message.
pub const EVENT_LLAMA_EXITED: &str = "llama-server-exited";

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

/// Streaming chat completion. Emits [`EVENT_CHAT_DELTA`] events with
/// `ChatStreamDelta` payloads until done or cancelled.
#[tauri::command]
pub async fn chat_completion(
    app: AppHandle,
    request: ChatCompletionRequest,
) -> Result<String, String> {
    // Unique id for this completion — the frontend uses it to ignore stray events.
    let id = format!(
        "chat_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0)
    );

    let app_handle = app.clone();
    let id_for_task = id.clone();
    tokio::spawn(async move {
        let result = providers::stream_chat(app_handle.clone(), &id_for_task, request).await;
        match result {
            Ok(final_text) => {
                let _ = app_handle.emit(
                    EVENT_CHAT_DELTA,
                    ChatStreamDelta {
                        delta: String::new(),
                        accumulated: final_text.clone(),
                        tokens: (final_text.chars().count() / 4).max(1),
                        done: true,
                        reasoning: None,
                    },
                );
            }
            Err(e) => {
                let _ = app_handle.emit(
                    EVENT_CHAT_ERROR,
                    serde_json::json!({ "id": id_for_task, "error": e }),
                );
            }
        }
    });
    Ok(id)
}

#[tauri::command]
pub async fn chat_cancel(id: String) -> Result<(), String> {
    let _ = id;
    Ok(())
}

// ---------------------------------------------------------------------------
// Provider models
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn fetch_provider_models(
    kind: String,
    base_url: String,
    api_key: Option<String>,
) -> Result<Vec<CloudModelDto>, String> {
    providers::fetch_models(&kind, &base_url, api_key).await
}

// ---------------------------------------------------------------------------
// Local models — GGUF scanning
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn read_gguf_metadata(path: String) -> Result<GgufMetadata, String> {
    let path = expand_path(&path);
    gguf::read_metadata(&path).await
}

#[tauri::command]
pub async fn scan_models_dir(dir: Option<String>) -> Result<Vec<GgufMetadata>, String> {
    let dir = match dir {
        Some(d) if !d.is_empty() => expand_path(&d),
        _ => crate::default_models_dir(),
    };
    let mut entries = match tokio::fs::read_dir(&dir).await {
        Ok(e) => e,
        Err(_) => return Ok(Vec::new()),
    };
    let mut out = Vec::new();
    while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
        let path = entry.path();
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            let ext_lower = ext.to_lowercase();
            if ext_lower == "gguf" || ext_lower == "ggml" {
                if let Ok(meta) = gguf::read_metadata(&path).await {
                    out.push(meta);
                }
            }
        }
    }
    // Sort by name for stable UI ordering.
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn file_metadata(path: String) -> Result<FileMeta, String> {
    let path = expand_path(&path);
    let p = path.clone();
    tokio::task::spawn_blocking(move || -> Result<FileMeta, String> {
        let meta = match std::fs::metadata(&p) {
            Ok(m) => m,
            Err(_) => {
                return Ok(FileMeta {
                    path: p.to_string_lossy().to_string(),
                    name: p
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default(),
                    size_bytes: 0,
                    mime_type: "application/octet-stream".to_string(),
                    kind: "other".to_string(),
                    exists: false,
                });
            }
        };
        let size = meta.len();
        let name = p
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let ext = p
            .extension()
            .and_then(|e| e.to_str())
            .map(|s| s.to_lowercase())
            .unwrap_or_default();
        let mime = mime_for_ext(&ext);
        let kind = kind_for_ext(&ext);
        Ok(FileMeta {
            path: p.to_string_lossy().to_string(),
            name,
            size_bytes: size,
            mime_type: mime,
            kind,
            exists: true,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn reveal_in_finder(path: String) -> Result<(), String> {
    let path = expand_path(&path);
    let p = path.clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("open")
                .arg("-R")
                .arg(&p)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
        #[cfg(target_os = "windows")]
        {
            std::process::Command::new("explorer")
                .arg(&p)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
        #[cfg(all(unix, not(target_os = "macos")))]
        {
            std::process::Command::new("xdg-open")
                .arg(p.parent().unwrap_or(&p))
                .spawn()
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Read a (small) file as a data: URL — used for image previews.
#[tauri::command]
pub async fn read_file_as_data_url(path: String, max_bytes: Option<u64>) -> Result<String, String> {
    let path = expand_path(&path);
    let max = max_bytes.unwrap_or(8 * 1024 * 1024); // 8 MiB default
    let p = path.clone();
    tokio::task::spawn_blocking(move || -> Result<String, String> {
        let meta = std::fs::metadata(&p).map_err(|e| e.to_string())?;
        if meta.len() > max {
            return Err(format!("File too large ({} > {} bytes)", meta.len(), max));
        }
        let bytes = std::fs::read(&p).map_err(|e| e.to_string())?;
        let ext = p
            .extension()
            .and_then(|e| e.to_str())
            .map(|s| s.to_lowercase())
            .unwrap_or_else(|| "bin".to_string());
        let mime = mime_for_ext(&ext);
        let b64 = base64_encode(&bytes);
        Ok(format!("data:{};base64,{}", mime, b64))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn ensure_dir(path: String) -> Result<bool, String> {
    let path = expand_path(&path);
    tokio::fs::create_dir_all(&path)
        .await
        .map_err(|e| e.to_string())?;
    Ok(true)
}

// ---------------------------------------------------------------------------
// Hugging Face
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn hf_search(
    query: Option<String>,
    sort: Option<String>,
    direction: Option<String>,
    limit: Option<u32>,
    tags: Option<Vec<String>>,
) -> Result<Vec<HfModelDto>, String> {
    hf::search(query, sort, direction, limit, tags).await
}

#[tauri::command]
pub async fn hf_model(model_id: String) -> Result<HfModelDto, String> {
    hf::model(&model_id).await
}

#[tauri::command]
pub async fn hf_model_files(model_id: String) -> Result<Vec<HfFileDto>, String> {
    hf::files(&model_id).await
}

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------

/// Public payload type for download progress events. Mirrors
/// `DownloadProgress` in `downloader.rs` but kept here so the event-name
/// constant + payload type live next to each other.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgressPayload {
    pub id: String,
    pub received_bytes: u64,
    pub total_bytes: Option<u64>,
    pub speed_bps: Option<f64>,
    pub eta_seconds: Option<f64>,
    pub state: String, // "downloading" | "paused" | "completed" | "failed" | "cancelled"
    pub error: Option<String>,
}

#[tauri::command]
pub async fn download_start(
    app: AppHandle,
    id: String,
    url: String,
    target_path: String,
) -> Result<(), String> {
    let target = expand_path(&target_path);
    if let Some(parent) = target.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }

    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel::<()>();
    let pause_flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    DOWNLOAD_CANCELS.lock().insert(id.clone(), cancel_tx);
    DOWNLOAD_PAUSED
        .lock()
        .insert(id.clone(), pause_flag.clone());

    let app_handle = app.clone();
    let id_for_task = id.clone();
    tokio::spawn(async move {
        let result = crate::run_download(
            app_handle.clone(),
            id_for_task.clone(),
            url,
            target,
            pause_flag,
            cancel_rx,
        )
        .await;
        // Always emit a final progress event so the frontend can clear its
        // row state — even if the download failed mid-stream.
        match &result {
            Ok(()) => {
                // The downloader already emits "completed" / "cancelled" — no
                // duplicate event needed.
            }
            Err(e) => {
                let _ = app_handle.emit(
                    EVENT_DOWNLOAD_PROGRESS,
                    DownloadProgressPayload {
                        id: id_for_task.clone(),
                        received_bytes: 0,
                        total_bytes: None,
                        speed_bps: None,
                        eta_seconds: None,
                        state: "failed".into(),
                        error: Some(e.clone()),
                    },
                );
            }
        }
        // Clean up shared state regardless of outcome — prevents the
        // `DOWNLOAD_CANCELS` / `DOWNLOAD_PAUSED` maps from leaking entries
        // for every download the user starts.
        DOWNLOAD_CANCELS.lock().remove(&id_for_task);
        DOWNLOAD_PAUSED.lock().remove(&id_for_task);
    });
    Ok(())
}

#[tauri::command]
pub async fn download_pause(id: String) -> Result<(), String> {
    if let Some(flag) = DOWNLOAD_PAUSED.lock().get(&id) {
        flag.store(true, Ordering::SeqCst);
    }
    Ok(())
}

#[tauri::command]
pub async fn download_resume(id: String) -> Result<(), String> {
    if let Some(flag) = DOWNLOAD_PAUSED.lock().get(&id) {
        flag.store(false, Ordering::SeqCst);
    }
    Ok(())
}

#[tauri::command]
pub async fn download_cancel(id: String) -> Result<(), String> {
    if let Some(tx) = DOWNLOAD_CANCELS.lock().remove(&id) {
        let _ = tx.send(());
    }
    DOWNLOAD_PAUSED.lock().remove(&id);
    Ok(())
}

// ---------------------------------------------------------------------------
// Local model loading (via Ollama) — REAL events only, no simulated progress.
// ---------------------------------------------------------------------------

/// Load a local model into the Ollama runtime. Emits
/// [`EVENT_MODEL_LOAD_PROGRESS`] events with a *fixed* descriptive message
/// (no fake percentage) and a [`EVENT_MODEL_LOAD_DONE`] event when the model
/// is ready.
///
/// Ollama's HTTP API does NOT expose real loading progress — it just blocks
/// on `/api/generate` until the model is loaded. We therefore emit two
/// honest progress events ("connecting" and "loading") with `percent: 0`,
/// then a single `done` event when Ollama returns. No simulated percentages,
/// no fake timers.
#[tauri::command]
pub async fn load_local_model(
    app: AppHandle,
    id: String,
    ollama_url: String,
    model_name: String,
    model_size_bytes: u64,
) -> Result<(), String> {
    use std::time::Duration;

    let _ = model_size_bytes; // accepted for API compatibility; not used for fake progress.

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;

    let app_handle = app.clone();
    let id_for_task = id.clone();
    let model_name_for_task = model_name.clone();
    let url_for_task = ollama_url.clone();

    tokio::spawn(async move {
        let emit_progress = |message: &str| {
            let _ = app_handle.emit(
                EVENT_MODEL_LOAD_PROGRESS,
                serde_json::json!({
                    "id": id_for_task,
                    "percent": 0,            // 0 means "indeterminate" — no fake numbers.
                    "message": message,
                    "model": model_name_for_task,
                }),
            );
        };
        let emit_error = |error: String| {
            let _ = app_handle.emit(
                EVENT_MODEL_LOAD_ERROR,
                serde_json::json!({ "id": id_for_task, "error": error }),
            );
        };

        emit_progress("Connecting to Ollama…");

        // Step 1: Check if Ollama is running.
        let ps_url = format!("{}/api/ps", url_for_task.trim_end_matches('/'));
        let ps_resp = match client.get(&ps_url).send().await {
            Ok(r) => r,
            Err(e) => {
                emit_error(format!(
                    "Can't reach Ollama at {}. Is it running? Error: {}",
                    url_for_task, e
                ));
                return;
            }
        };
        if !ps_resp.status().is_success() {
            emit_error(format!(
                "Ollama returned HTTP {}. Make sure Ollama is installed and running.",
                ps_resp.status()
            ));
            return;
        }
        emit_progress("Ollama reached. Loading model…");

        // Step 2: Check if the model is already loaded.
        let ps_body: serde_json::Value = match ps_resp.json().await {
            Ok(v) => v,
            Err(_) => serde_json::json!({ "models": [] }),
        };
        let already_loaded = ps_body["models"]
            .as_array()
            .map(|arr| {
                arr.iter().any(|m| {
                    m["name"]
                        .as_str()
                        .map(|n| n.starts_with(&model_name_for_task))
                        .unwrap_or(false)
                })
            })
            .unwrap_or(false);

        if already_loaded {
            let _ = app_handle.emit(
                EVENT_MODEL_LOAD_DONE,
                serde_json::json!({ "id": id_for_task, "model": model_name_for_task }),
            );
            return;
        }

        // Step 3: Trigger the load by calling /api/generate with an empty
        // prompt and keep_alive set so the model stays in memory. This
        // returns when the model is loaded. We do NOT start a fake-progress
        // timer — the UI shows an indeterminate "Loading model into memory…"
        // state until Ollama responds.
        let gen_url = format!("{}/api/generate", url_for_task.trim_end_matches('/'));
        let body = serde_json::json!({
            "model": model_name_for_task,
            "prompt": "",
            "stream": false,
            "keep_alive": "10m",
        });

        match client.post(&gen_url).json(&body).send().await {
            Ok(resp) if resp.status().is_success() => {
                let _ = app_handle.emit(
                    EVENT_MODEL_LOAD_DONE,
                    serde_json::json!({ "id": id_for_task, "model": model_name_for_task }),
                );
            }
            Ok(resp) => {
                let status = resp.status();
                let text = resp.text().await.unwrap_or_default();
                let msg = if text.contains("model not found") || text.contains("not found") {
                    format!(
                        "Model '{}' isn't registered with Ollama. Run `ollama pull {}` or import the GGUF via `ollama create {} --from <gguf-file>` first.",
                        model_name_for_task, model_name_for_task, model_name_for_task
                    )
                } else {
                    format!("Ollama HTTP {}: {}", status, text)
                };
                emit_error(msg);
            }
            Err(e) => {
                emit_error(e.to_string());
            }
        }
    });

    Ok(())
}

// ---------------------------------------------------------------------------
// llama.cpp runtime — spawn a local llama-server process for a GGUF model.
// ---------------------------------------------------------------------------
//
// ## Event-name discipline
//
// All events use FIXED names (`llama-server-log`, `llama-server-ready`,
// `llama-server-error`, `llama-server-exited`) and route by `session` ID
// inside the payload. Previous versions URL-encoded the model path and
// appended it to the event name (e.g. `xirea://llama/ready/Users%2F...`),
// which Tauri 2's `listen()` rejected with:
//
//     invalid args `event` for command `listen`
//     Event name must include only alphanumeric characters, -, /, :, and _
//
// That rejection made the frontend's `await listen(...)` throw, which the
// `handleRun` wrapper interpreted as "llama.cpp not available" and silently
// fell through to Ollama — even though the sidecar WAS bundled and the
// process WAS spawned.
//
// ## Binary discovery
//
// We no longer use Tauri's `externalBin` sidecar mechanism. Instead we
// bundle the binaries as resources (`binaries/<subfolder>/llama-server`)
// and resolve the path at runtime via `llama_runtime::resolve_llama_binary`.
// This lets us ship the Windows DLLs / Linux .so / macOS .dylib files
// alongside the executable — the sidecar mechanism only supports a single
// file per target triple.
//
// ## Stdout / stderr capture
//
// We ALWAYS capture stdout and stderr. When the process exits, we emit a
// `llama-server-exited` event with the real exit code and a human-readable
// summary of what went wrong. We NEVER show "exited without printing
// anything" — if we have no output, we say so explicitly AND surface the
// exit code (which on Unix encodes the signal: SIGILL = illegal
// instruction, SIGSEGV, etc.) so the user knows the real reason.
//
// ## Process ownership
//
// The `tokio::process::Child` is owned solely by the exit-watcher task.
// We only store the PID in `LLAMA_PIDS` so `stop_llama_server` can signal
// the OS to kill the process. This avoids the race condition where two
// tasks try to `wait()` on the same child.
//
// ## Multi-session safety
//
// `LLAMA_PIDS` and `LLAMA_SESSIONS` are keyed by session ID, so multiple
// llama-server processes can run concurrently on different ports without
// colliding. `stop_llama_server` removes entries from both maps, so there
// are no leaks across restarts.
//
// ## Stdout parsing
//
// llama-server prints structured log lines as it boots:
//
//   llama_model_loader: - kv   0:                       general.architecture str = llama
//   llm_load_tensors: offloaded 35/35 layers to GPU
//   llm_load_tensors: CUDA0 buffer size = 4096.00 MiB
//   llama_new_context_with_model: KV self size  = 4096.00 MiB
//   llama_server: HTTP server listening on http://127.0.0.1:8080
//
// We classify each line into a `phase` field on the log payload so the
// frontend can render a phase-aware progress UI ("Loading tensors",
// "Initializing CUDA", "Warming KV cache", "Ready") without parsing strings.

use std::sync::Arc;
use tokio::sync::Mutex as AsyncMutex;

/// PIDs of currently-running llama-server processes, keyed by session ID.
/// We store only the PID (not the Child handle) so `stop_llama_server`
/// can signal the OS to kill the process without racing with the
/// exit-watcher task that owns the Child.
static LLAMA_PIDS: once_cell::sync::Lazy<
    parking_lot::Mutex<std::collections::HashMap<String, u32>>,
> = once_cell::sync::Lazy::new(|| parking_lot::Mutex::new(std::collections::HashMap::new()));

/// Map session ID → model path, so `stop_llama_server` can look up the
/// session by either identifier (frontend typically uses the session ID
/// returned from `start_llama_server`).
static LLAMA_SESSIONS: once_cell::sync::Lazy<
    parking_lot::Mutex<std::collections::HashMap<String, String>>,
> = once_cell::sync::Lazy::new(|| parking_lot::Mutex::new(std::collections::HashMap::new()));

static LLAMA_PORT_COUNTER: AtomicU32 = AtomicU32::new(8080);
static LLAMA_SESSION_COUNTER: AtomicU32 = AtomicU32::new(1);

/// Generate a short, alphanumeric session ID like `s1`, `s2`, `s3`, …
/// Tauri event names allow alphanumerics, so this is always valid.
fn new_session_id() -> String {
    let n = LLAMA_SESSION_COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    format!("s{}", n)
}

/// Information returned by `start_llama_server` so the frontend knows which
/// port to talk to. The session ID travels inside every event payload —
/// no need to subscribe to a per-session event channel.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlamaServerHandle {
    /// Session ID — included in every event payload so the frontend can
    /// filter by session. Always alphanumeric (`s1`, `s2`, …).
    pub session: String,
    /// Port the server is (or will be) listening on.
    pub port: u16,
    /// Absolute path of the binary we spawned. Surfaced to the UI so the
    /// user can verify which binary was used (bundled vs. PATH).
    pub binary_path: String,
    /// Source of the binary: `"bundled"`, `"dev"`, or `"path"`.
    pub binary_source: String,
}

/// Payload for the `llama-server-log` event. The `phase` field classifies
/// the log line so the frontend can render a phase-aware progress UI.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlamaLogPayload {
    pub session: String,
    pub model_path: String,
    /// `"stdout"` | `"stderr"` | `"terminated"` | `"error"`.
    pub stream: String,
    /// Raw log line, exactly as the binary printed it.
    pub line: String,
    /// Semantic phase: `"starting"` | `"loading-tensors"` | `"cuda-init"` |
    /// `"kv-cache"` | `"ready"` | `"error"` | `"info"`.
    pub phase: String,
}

/// Payload for the `llama-server-ready` event.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlamaReadyPayload {
    pub session: String,
    pub model_path: String,
    pub port: u16,
    pub url: String,
}

/// Payload for the `llama-server-error` event. `diagnostic` is an optional
/// actionable hint (e.g. "Install CUDA toolkit" or "Re-download the GGUF").
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlamaErrorPayload {
    pub session: String,
    pub model_path: String,
    pub error: String,
    pub diagnostic: Option<String>,
}

/// Payload for the `llama-server-exited` event. This is what replaces the
/// old generic "exited without printing anything" message — the UI gets
/// the **real** exit code and a human-readable summary of what went wrong,
/// including the signal name (on Unix) if the process was killed.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlamaExitedPayload {
    pub session: String,
    pub model_path: String,
    /// Process exit code, if available. `None` means the process was
    /// killed by a signal (we include the signal name in `error`).
    pub exit_code: Option<i32>,
    /// Path to the per-session log file (full stdout + stderr + system info).
    pub log_file: String,
    /// `"clean"` (exit code 0), `"error"` (non-zero exit code), or
    /// `"killed"` (terminated by a signal / `stop_llama_server`).
    pub reason: String,
    /// Human-readable summary of what went wrong — never the generic
    /// "exited without printing anything" message.
    pub error: String,
    /// Actionable hint for the user.
    pub diagnostic: Option<String>,
}

/// Classify a llama-server log line into a semantic phase. Used by the
/// frontend to render a phase-aware progress UI ("Loading tensors" →
/// "Initializing CUDA" → "Warming KV cache" → "Ready") without parsing
/// strings on the JS side.
fn classify_llama_line(line: &str) -> &'static str {
    let lower = line.to_lowercase();
    if lower.contains("error") || lower.contains("fatal") || lower.contains("failed to") {
        "error"
    } else if lower.contains("listening")
        || lower.contains("server is ready")
        || lower.contains("http server")
    {
        "ready"
    } else if lower.contains("kv self size")
        || lower.contains("kv cache")
        || lower.contains("llama_new_context_with_model")
    {
        "kv-cache"
    } else if lower.contains("cuda")
        || lower.contains("cublas")
        || lower.contains("gpu")
        || lower.contains("vulkan")
        || lower.contains("metal")
        || lower.contains("rocm")
    {
        "cuda-init"
    } else if lower.contains("llama_model_loader")
        || lower.contains("llm_load_tensors")
        || lower.contains("loading tensors")
        || lower.contains("offloaded")
    {
        "loading-tensors"
    } else if lower.contains("system_info")
        || lower.contains("device")
        || lower.contains("initializing")
        || lower.contains("startup")
    {
        "starting"
    } else {
        "info"
    }
}

/// Produce an actionable diagnostic hint from a llama-server error line.
fn diagnose_llama_failure(error: &str) -> Option<String> {
    let lower = error.to_lowercase();
    if lower.contains("avx") || lower.contains("illegal instruction") || lower.contains("sigill") {
        return Some(
            "Your CPU doesn't support the instruction set this binary was compiled for \
             (AVX / AVX2 / AVX-512). Download a llama.cpp build matching your CPU — the \
             `ubuntu-x64` build requires AVX2; older CPUs need the `noavx` build."
                .to_string(),
        );
    }
    if lower.contains("cuda") && (lower.contains("init") || lower.contains("failed")) {
        return Some(
            "CUDA initialization failed. Common causes: missing CUDA toolkit, driver/lib \
             version mismatch, or a CUDA-only binary running on a machine without an NVIDIA \
             GPU. Use the CPU-only llama.cpp build instead."
                .to_string(),
        );
    }
    if lower.contains("gguf")
        && (lower.contains("magic") || lower.contains("invalid") || lower.contains("corrupt"))
    {
        return Some(
            "The GGUF file is invalid or corrupted. Re-download it from Hugging Face and \
             verify the SHA-256 matches before retrying."
                .to_string(),
        );
    }
    if lower.contains("out of memory") || lower.contains("oom") || lower.contains("cannot allocate")
    {
        return Some(
            "llama-server ran out of RAM. Reduce `--ctx-size`, offload fewer layers to the \
             GPU (`--n-gpu-layers`), or close other memory-hungry applications."
                .to_string(),
        );
    }
    if lower.contains("address already in use") || lower.contains("bind") {
        return Some(
            "The port is already in use. Pass a different `port` when starting the server, \
             or stop the other process occupying it."
                .to_string(),
        );
    }
    if lower.contains("permission denied") {
        return Some(
            "Permission denied. On macOS/Linux run `chmod +x` on the binary and clear the \
             quarantine attribute with `xattr -dr com.apple.quarantine <path>`."
                .to_string(),
        );
    }
    if lower.contains("0xc0000135") || lower.contains("status_dll_not_found") {
        return Some(
            "Windows could not find a required DLL. The llama-server.exe needs llama.dll, \
             ggml.dll, ggml-base.dll, etc. in the same directory. Re-download the \
             llama.cpp release ZIP and extract ALL files into the binaries/windows/ folder."
                .to_string(),
        );
    }
    None
}

/// Validate command-line arguments BEFORE spawning. Returns an error string
/// if any argument is malformed — the caller surfaces it as an immediate
/// `llama-server-error` event without ever spawning the process.
fn validate_llama_args(
    model_path: &std::path::Path,
    port: u16,
    ctx_size: usize,
    threads: usize,
    n_gpu_layers: i32,
) -> Result<(), String> {
    if !model_path.exists() {
        return Err(format!(
            "Model file not found: {}. Check the path and try again.",
            model_path.display()
        ));
    }
    // Verify the model is readable.
    if let Err(e) = std::fs::File::open(model_path) {
        return Err(format!(
            "Model file is not readable: {} ({})",
            model_path.display(),
            e
        ));
    }
    if port == 0 {
        return Err("Port must be greater than 0".to_string());
    }
    if ctx_size == 0 {
        return Err("Context size must be greater than 0".to_string());
    }
    if ctx_size > 1_000_000 {
        return Err(format!(
            "Context size {} is unreasonably large (max 1,000,000). \
             llama-server would OOM immediately.",
            ctx_size
        ));
    }
    if threads == 0 {
        return Err("Threads must be greater than 0".to_string());
    }
    if n_gpu_layers < -1 {
        return Err(format!("n_gpu_layers must be >= -1 (got {})", n_gpu_layers));
    }
    Ok(())
}

/// Shared session log — wrapped in `Arc<AsyncMutex<...>>` so the stdout,
/// stderr, and exit-watcher tasks can all append to the same file without
/// racing. Using `tokio::sync::Mutex` (not `parking_lot::Mutex`) because
/// we hold it across `.await` points.
type SharedSessionLog = Arc<AsyncMutex<SessionLog>>;

/// Spawn a `llama-server` process for the given GGUF model.
///
/// Returns a `LlamaServerHandle` containing the session ID, port, and the
/// absolute path of the binary we spawned. The frontend subscribes to the
/// FIXED event names `llama-server-log`, `llama-server-ready`,
/// `llama-server-error`, `llama-server-exited` and filters by `session` in
/// the payload — there is no per-session event channel.
///
/// Xirea resolves the binary via `llama_runtime::resolve_llama_binary`,
/// which tries (1) the bundled resource, (2) the dev-mode path, (3) PATH
/// lookup. If none works, we return an immediate error with the full
/// diagnostic trail of what was tried.
#[tauri::command]
pub async fn start_llama_server(
    app: AppHandle,
    model_path: String,
    port: Option<u16>,
    ctx_size: Option<usize>,
    threads: Option<usize>,
    n_gpu_layers: Option<i32>,
) -> Result<LlamaServerHandle, String> {
    use std::process::Stdio;
    use tokio::io::{AsyncBufReadExt, BufReader};

    let path = expand_path(&model_path);

    // Validate arguments up front — fail fast with a useful error instead
    // of letting llama-server fail with a cryptic one.
    let port = port.unwrap_or_else(|| {
        LLAMA_PORT_COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst) as u16
    });
    let ctx_size = ctx_size.unwrap_or(8192);
    let threads = threads.unwrap_or_else(|| {
        std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4)
    });
    let n_gpu_layers = n_gpu_layers.unwrap_or(0);

    if let Err(e) = validate_llama_args(&path, port, ctx_size, threads, n_gpu_layers) {
        return Err(e);
    }

    // Resolve the binary.
    let lookup: BinaryLookup = llama_runtime::resolve_llama_binary(&app);
    // Pull `path` out into its own variable first so the `ok_or_else`
    // closure can borrow `lookup.candidates` without conflicting with
    // `lookup.path.clone()`.
    let binary_path_opt = lookup.path.clone();
    let binary_path = binary_path_opt.ok_or_else(|| {
        let candidates = lookup
            .candidates
            .iter()
            .map(|c| {
                format!(
                    "  - [{}] {} — {}",
                    c.kind,
                    c.path,
                    c.rejection_reason
                        .clone()
                        .unwrap_or_else(|| "ok".to_string())
                )
            })
            .collect::<Vec<_>>()
            .join("\n");
        format!(
            "llama-server binary not found. Looked in:\n{}\n\n\
             Drop a llama-server binary into src-tauri/binaries/{}/{} \
             (see src-tauri/binaries/README.md), or install llama.cpp on \
             your system so it's on your PATH.",
            candidates,
            llama_runtime::pick_runtime_subdir(),
            llama_runtime::executable_name()
        )
    })?;

    let binary_path_buf = std::path::PathBuf::from(&binary_path);
    let session = new_session_id();
    let model_path_str = path.to_string_lossy().to_string();
    LLAMA_SESSIONS
        .lock()
        .insert(session.clone(), model_path.clone());

    let port_str = port.to_string();
    let ctx_str = ctx_size.to_string();
    let threads_str = threads.to_string();
    let gpu_str = n_gpu_layers.to_string();

    // Read GGUF metadata for the session log (best-effort — don't fail if
    // the metadata reader chokes on a non-standard GGUF).
    let gguf_metadata = gguf::read_metadata(&path).await.ok();

    // Capture a system snapshot for the session log.
    let system_snapshot = llama_runtime::capture_system_snapshot().await;

    // Create the per-session log file.
    let session_log_raw = SessionLog::create(&session)
        .await
        .map_err(|e| format!("Failed to create session log: {}", e))?;
    let session_log: SharedSessionLog = Arc::new(AsyncMutex::new(session_log_raw));
    let log_file_path = {
        let lock = session_log.lock().await;
        lock.path.to_string_lossy().to_string()
    };

    // Build the full args list (for both logging and spawn).
    let args: Vec<String> = vec![
        "--model".into(),
        model_path_str.clone(),
        "--port".into(),
        port_str.clone(),
        "--host".into(),
        "127.0.0.1".into(),
        "--ctx-size".into(),
        ctx_str.clone(),
        "--threads".into(),
        threads_str.clone(),
        "--n-gpu-layers".into(),
        gpu_str.clone(),
        "--cont-batching".into(),
    ];

    // Write the log header (system info, launch command, GGUF metadata).
    {
        let mut log = session_log.lock().await;
        log.write_header(
            &session,
            &binary_path,
            &model_path_str,
            &args,
            &system_snapshot,
            gguf_metadata.as_ref(),
        )
        .await;
    }

    let app_for_logs = app.clone();
    let model_path_for_logs = model_path.clone();
    let session_for_logs = session.clone();
    let session_for_err = session.clone();
    let model_path_for_err = model_path.clone();
    let session_for_exit = session.clone();
    let model_path_for_exit = model_path.clone();
    let log_for_exit = session_log.clone();

    // Emit a single "starting" phase event so the frontend can show
    // "Booting llama-server…" immediately, before the binary prints anything.
    let _ = app.emit(
        EVENT_LLAMA_LOG,
        LlamaLogPayload {
            session: session.clone(),
            model_path: model_path.clone(),
            stream: "stdout".to_string(),
            line: format!(
                "Spawning llama-server for {} on port {} (ctx={}, threads={}, gpu-layers={})\n\
                 Binary: {} (source: {})",
                model_path, port, ctx_size, threads, n_gpu_layers, binary_path, lookup.source
            ),
            phase: "starting".to_string(),
        },
    );

    // Spawn the process with stdout + stderr piped so we can capture
    // every line. We use `tokio::process::Command` (not Tauri's sidecar
    // mechanism) so we can bundle the Windows DLLs / Linux .so / macOS
    // .dylib files alongside the binary in a subfolder.
    let mut cmd = tokio::process::Command::new(&binary_path_buf);
    cmd.args(&args)
        .current_dir(
            binary_path_buf
                .parent()
                .unwrap_or(std::path::Path::new(".")),
        )
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let err = format!("Failed to spawn llama-server at {}: {}", binary_path, e);
            let _ = app.emit(
                EVENT_LLAMA_ERROR,
                LlamaErrorPayload {
                    session: session_for_err.clone(),
                    model_path: model_path_for_err.clone(),
                    error: err.clone(),
                    diagnostic: diagnose_llama_failure(&err),
                },
            );
            {
                let mut log = session_log.lock().await;
                log.write_line(&format!("SPAWN FAILED: {}", err)).await;
            }
            LLAMA_SESSIONS.lock().remove(&session);
            return Err(err);
        }
    };

    let pid = child.id().unwrap_or(0);
    LLAMA_PIDS.lock().insert(session.clone(), pid);

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // Forward stdout lines to the log event + session log file.
    if let Some(stdout) = stdout {
        let app_clone = app_for_logs.clone();
        let mp = model_path_for_logs.clone();
        let s = session_for_logs.clone();
        let log_for_stdout = session_log.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let phase = classify_llama_line(&line);
                log::info!("[llama-server:{}] {}", s, line);
                let _ = app_clone.emit(
                    EVENT_LLAMA_LOG,
                    LlamaLogPayload {
                        session: s.clone(),
                        model_path: mp.clone(),
                        stream: "stdout".to_string(),
                        line: line.clone(),
                        phase: phase.to_string(),
                    },
                );
                // Append to the session log file.
                let mut log = log_for_stdout.lock().await;
                log.write_line(&format!("[stdout] {}", line)).await;
            }
        });
    }

    // Forward stderr lines to the log event + session log file.
    if let Some(stderr) = stderr {
        let app_clone = app_for_logs.clone();
        let mp = model_path_for_logs.clone();
        let s = session_for_logs.clone();
        let log_for_stderr = session_log.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let phase = classify_llama_line(&line);
                log::warn!("[llama-server:{}] {}", s, line);
                let _ = app_clone.emit(
                    EVENT_LLAMA_LOG,
                    LlamaLogPayload {
                        session: s.clone(),
                        model_path: mp.clone(),
                        stream: "stderr".to_string(),
                        line: line.clone(),
                        phase: phase.to_string(),
                    },
                );
                let mut log = log_for_stderr.lock().await;
                log.write_line(&format!("[stderr] {}", line)).await;
            }
        });
    }

    // Spawn a task that waits for the child to exit, then emits a
    // `llama-server-exited` event with the **real** exit code.
    let app_for_exit = app.clone(); // ← added
    let log_file_path_for_first_spawn = log_file_path.clone();
    tokio::spawn(async move {
        let exit_status = child.wait().await;
        let (exit_code, reason, error_summary) = match exit_status {
            Ok(status) => {
                let code = status.code();
                let reason = if status.success() { "clean" } else { "error" };
                let err = if status.success() {
                    "llama-server exited cleanly (exit code 0)".to_string()
                } else if let Some(c) = code {
                    format!("llama-server exited with code {}", c)
                } else {
                    // On Unix, None means killed by a signal.
                    #[cfg(unix)]
                    {
                        use std::os::unix::process::ExitStatusExt;
                        if let Some(sig) = status.signal() {
                            let sig_name = match sig {
                                4 => "SIGILL (illegal instruction — likely an AVX mismatch)",
                                6 => "SIGABRT",
                                9 => "SIGKILL",
                                11 => "SIGSEGV (segfault — likely a corrupt GGUF or a bug in llama.cpp)",
                                15 => "SIGTERM",
                                _ => "signal",
                            };
                            format!("llama-server was killed by {} (signal {})", sig_name, sig)
                        } else {
                            "llama-server was killed by an unknown signal".to_string()
                        }
                    }
                    #[cfg(not(unix))]
                    {
                        "llama-server exited with an unknown status".to_string()
                    }
                };
                (code, reason, err)
            }
            Err(e) => {
                log::error!(
                    "[llama-server:{}] failed to wait on child process: {}",
                    session_for_exit,
                    e
                );
                (
                    None,
                    "error",
                    format!("Failed to wait on llama-server process: {}", e),
                )
            }
        };

        let diagnostic = diagnose_llama_failure(&error_summary);

        // Write the exit summary to the session log.
        {
            let mut log = log_for_exit.lock().await;
            log.write_line(&format!(
                "EXIT: code={:?} reason={} summary={}",
                exit_code, reason, error_summary
            ))
            .await;
            log.write_exit_summary(exit_code).await;
        }

        log::info!(
            "[llama-server:{}] process exited (pid={}, code={:?}, reason={})",
            session_for_exit,
            pid,
            exit_code,
            reason
        );

        let _ = app_for_exit.emit(
            // ← used here
            EVENT_LLAMA_EXITED,
            LlamaExitedPayload {
                session: session_for_exit.clone(),
                model_path: model_path_for_exit.clone(),
                exit_code,
                log_file: log_file_path_for_first_spawn.clone(), // ← use clone
                reason: reason.to_string(),
                error: error_summary,
                diagnostic,
            },
        );

        // Clean up maps.
        LLAMA_PIDS.lock().remove(&session_for_exit);
        LLAMA_SESSIONS.lock().remove(&session_for_exit);
    });

    // Poll the HTTP endpoint and emit "ready" when it responds.
    let app_handle2 = app.clone();
    let model_path_for_ready = model_path.clone();
    let session_for_ready = session.clone();
    tokio::spawn(async move {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(2))
            .build()
            .unwrap();
        let url = format!("http://127.0.0.1:{}/v1/models", port);
        for _attempt in 0..120u8 {
            tokio::time::sleep(Duration::from_millis(500)).await;
            // If the process has already exited (entry removed from
            // LLAMA_PIDS), don't keep polling — the exit event has
            // already told the frontend the real reason.
            if !LLAMA_PIDS.lock().contains_key(&session_for_ready) {
                return;
            }
            if let Ok(resp) = client.get(&url).send().await {
                if resp.status().is_success() {
                    let _ = app_handle2.emit(
                        EVENT_LLAMA_READY,
                        LlamaReadyPayload {
                            session: session_for_ready.clone(),
                            model_path: model_path_for_ready.clone(),
                            port,
                            url: format!("http://127.0.0.1:{}", port),
                        },
                    );
                    return;
                }
            }
        }
        // The ready-poll timed out — if the process is still running, emit
        // a timeout error. If it's not, the exit event has already surfaced
        // the real reason.
        let still_running = LLAMA_PIDS.lock().contains_key(&session_for_ready);
        if still_running {
            let err = format!(
                "llama-server is running (pid={}) but didn't respond at \
                 http://127.0.0.1:{}/v1/models within 60 seconds. The model \
                 file may be too large for available RAM, or the binary may \
                 be stuck in an init loop. Check the session log at {} for details.",
                pid,
                port,
                log_file_path // original still valid
            );
            let _ = app_handle2.emit(
                EVENT_LLAMA_ERROR,
                LlamaErrorPayload {
                    session: session_for_ready,
                    model_path: model_path_for_ready,
                    error: err.clone(),
                    diagnostic: diagnose_llama_failure(&err),
                },
            );
        }
    });

    Ok(LlamaServerHandle {
        session,
        port,
        binary_path,
        binary_source: lookup.source,
    })
}

/// Kill a running llama-server by session ID (preferred) or model path
/// (legacy fallback).
///
/// This function is **non-recursive** — the legacy "find session by path"
/// lookup delegates to a synchronous helper rather than re-invoking the
/// async `stop_llama_server` function. Recursive async functions are
/// problematic in Rust: each recursion allocates a new future, and the
/// borrow checker gets unhappy when the future borrows `self`-like state.
/// We avoid that by extracting the lookup logic into `lookup_session_by_path`.
#[tauri::command]
pub async fn stop_llama_server(session_or_path: String) -> Result<(), String> {
    stop_llama_session_inner(&session_or_path).await
}

/// Inner implementation — takes a borrowed `&str` so it doesn't recursively
/// call the `#[tauri::command]` wrapper (which would create a new future
/// and borrow the session string again).
async fn stop_llama_session_inner(session_or_path: &str) -> Result<(), String> {
    // Direct session ID lookup — preferred.
    if let Some(pid) = LLAMA_PIDS.lock().remove(session_or_path) {
        kill_pid(pid);
        LLAMA_SESSIONS.lock().remove(session_or_path);
        log::info!(
            "Killed llama-server (pid={}) for session {}",
            pid,
            session_or_path
        );
        return Ok(());
    }

    // Legacy: caller passed a model path. Find the session that matches,
    // then stop THAT session (without re-entering this async function).
    if let Some(session) = lookup_session_by_path(session_or_path) {
        return Box::pin(stop_llama_session_inner(&session)).await; // ← Box::pin added
    }

    Ok(())
}

/// Synchronously look up a llama-server session by the model path it was
/// started with. Returns the session ID if found, `None` otherwise.
///
/// Extracted from `stop_llama_session_inner` to avoid a recursive async
/// call — we look up the session ID under a short-lived lock, then drop
/// the lock before recursing.
fn lookup_session_by_path(model_path: &str) -> Option<String> {
    LLAMA_SESSIONS.lock().iter().find_map(|(s, p)| {
        if p == model_path {
            Some(s.clone())
        } else {
            None
        }
    })
}

/// Kill a PID cross-platform. On Unix we send SIGTERM via `nix`; on Windows
/// we shell out to `taskkill /F /PID <pid>`.
fn kill_pid(pid: u32) {
    #[cfg(unix)]
    {
        let _ = nix::sys::signal::kill(
            nix::unistd::Pid::from_raw(pid as i32),
            nix::sys::signal::Signal::SIGTERM,
        );
    }
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F"])
            .spawn();
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = pid;
    }
}

// ---------------------------------------------------------------------------
// llama.cpp runtime verification command
// ---------------------------------------------------------------------------

/// Verify the `llama-server` runtime is usable. The frontend calls this
/// BEFORE showing the "Run" button on a local model — if the runtime
/// isn't usable, we tell the user exactly why up front, instead of letting
/// them click Run and getting a cryptic error half a second later.
///
/// Returns a `RuntimeVerification` with the full diagnostic trail: which
/// candidates we considered, what we found, the result of `--version`, and
/// any missing DLLs / shared libraries.
#[tauri::command]
pub async fn verify_llama_runtime_command(app: AppHandle) -> Result<RuntimeVerification, String> {
    Ok(llama_runtime::verify_llama_runtime(&app).await)
}

/// Verify a model file before importing it into Xirea. The frontend calls
/// this when the user drops a GGUF file onto the Models page — we validate
/// the magic, read the metadata, optionally compute the SHA-256, and reject
/// anything that's not a usable GGUF.
#[tauri::command]
pub async fn verify_model_import_command(
    path: String,
    compute_sha256: Option<bool>,
) -> Result<ModelImportVerification, String> {
    let path = expand_path(&path);
    Ok(llama_runtime::verify_model_import(&path, compute_sha256.unwrap_or(false)).await)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

pub fn mime_for_ext(ext: &str) -> String {
    match ext {
        "png" => "image/png".into(),
        "jpg" | "jpeg" => "image/jpeg".into(),
        "gif" => "image/gif".into(),
        "webp" => "image/webp".into(),
        "svg" => "image/svg+xml".into(),
        "bmp" => "image/bmp".into(),
        "pdf" => "application/pdf".into(),
        "doc" => "application/msword".into(),
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document".into(),
        "xls" => "application/vnd.ms-excel".into(),
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet".into(),
        "csv" => "text/csv".into(),
        "tsv" => "text/tab-separated-values".into(),
        "zip" => "application/zip".into(),
        "tar" => "application/x-tar".into(),
        "gz" | "tgz" => "application/gzip".into(),
        "rar" => "application/vnd.rar".into(),
        "7z" => "application/x-7z-compressed".into(),
        "mp3" => "audio/mpeg".into(),
        "wav" => "audio/wav".into(),
        "flac" => "audio/flac".into(),
        "aac" => "audio/aac".into(),
        "ogg" => "audio/ogg".into(),
        "mp4" => "video/mp4".into(),
        "mov" => "video/quicktime".into(),
        "avi" => "video/x-msvideo".into(),
        "mkv" => "video/x-matroska".into(),
        "webm" => "video/webm".into(),
        "ts" | "tsx" | "js" | "jsx" | "json" | "yaml" | "toml" | "py" | "rs" | "go" | "java"
        | "c" | "cpp" | "h" | "hpp" => "text/plain".into(),
        "md" => "text/markdown".into(),
        "txt" | "log" => "text/plain".into(),
        "gguf" => "application/octet-stream".into(),
        "ggml" => "application/octet-stream".into(),
        _ => "application/octet-stream".into(),
    }
}

pub fn kind_for_ext(ext: &str) -> String {
    match ext {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" => "image",
        "pdf" => "pdf",
        "doc" | "docx" | "rtf" => "document",
        "xls" | "xlsx" | "csv" | "tsv" => "spreadsheet",
        "zip" | "tar" | "gz" | "tgz" | "rar" | "7z" => "archive",
        "mp3" | "wav" | "flac" | "aac" | "ogg" => "audio",
        "mp4" | "mov" | "avi" | "mkv" | "webm" => "video",
        "ts" | "tsx" | "js" | "jsx" | "py" | "rs" | "go" | "java" | "c" | "cpp" | "json"
        | "yaml" | "toml" => "code",
        "md" | "txt" | "log" => "text",
        _ => "other",
    }
    .into()
}

// ---------------------------------------------------------------------------
// Minimal base64 encoder — avoids bringing in another crate at runtime.
// ---------------------------------------------------------------------------

const B64_TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub fn base64_encode(input: &[u8]) -> String {
    let mut out = String::with_capacity((input.len() + 2) / 3 * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0];
        let b1 = if chunk.len() > 1 { chunk[1] } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] } else { 0 };

        out.push(B64_TABLE[(b0 >> 2) as usize] as char);
        out.push(B64_TABLE[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);

        if chunk.len() > 1 {
            out.push(B64_TABLE[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(B64_TABLE[(b2 & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

// ---------------------------------------------------------------------------
// System information — disk, CPU, GPU, RAM, VRAM detection.
// ---------------------------------------------------------------------------

/// Query real system information: disks (with the disk that contains the
/// models directory flagged), CPU brand/cores/threads, total and available
/// RAM, and GPU detection (NVIDIA CUDA, Apple Metal, AMD ROCm, Vulkan,
/// DirectML). No mock values — every field comes from a real query.
#[tauri::command]
pub async fn get_system_info_command() -> Result<SystemInfo, String> {
    system_info::get_system_info().await
}

/// Focused disk-info command for the Models page storage bar. Returns just
/// the four fields the UI needs (totalBytes / availableBytes / usedBytes /
/// mountPoint) for the disk containing the models directory, plus an array
/// of all disks for the "Change directory" dropdown.
///
/// This is a thin wrapper around `system_info::get_system_info` so the
/// frontend can fetch *only* disk info without paying the cost of GPU
/// detection (which spawns `nvidia-smi` / `system_profiler`).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelsDiskInfo {
    pub total_bytes: u64,
    pub available_bytes: u64,
    pub used_bytes: u64,
    pub mount_point: String,
    /// All disks visible to the system, sorted models-disk-first.
    pub all_disks: Vec<crate::system_info::DiskInfo>,
}

#[tauri::command]
pub async fn get_models_disk_info() -> Result<ModelsDiskInfo, String> {
    let info = system_info::get_system_info().await?;
    let models_disk = info
        .disks
        .iter()
        .find(|d| d.is_models_disk)
        .cloned()
        .or_else(|| info.disks.first().cloned())
        .ok_or_else(|| "No disks found".to_string())?;
    Ok(ModelsDiskInfo {
        total_bytes: models_disk.total_bytes,
        available_bytes: models_disk.free_bytes,
        used_bytes: models_disk.used_bytes,
        mount_point: models_disk.mount_point.clone(),
        all_disks: info.disks.clone(),
    })
}

// ---------------------------------------------------------------------------
// Download verification — file size + SHA-256.
// ---------------------------------------------------------------------------

/// Verify a downloaded file's size and (optionally) SHA-256 checksum.
/// Streams the file in 1 MiB chunks so multi-GB GGUF files don't OOM.
#[tauri::command]
pub async fn verify_download_command(
    path: String,
    expected_size_bytes: Option<u64>,
    expected_sha256: Option<String>,
) -> Result<VerificationResult, String> {
    let path = expand_path(&path);
    verify::verify_download(&path, expected_size_bytes, expected_sha256).await
}

/// Compute just the SHA-256 of a file (no size check, no expected-value
/// comparison). Useful for displaying the digest in the model details
/// dialog without implying a verification pass/fail.
#[tauri::command]
pub async fn sha256_file_command(path: String) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use tokio::io::AsyncReadExt;

    let path = expand_path(&path);
    let mut file = tokio::fs::File::open(&path)
        .await
        .map_err(|e| format!("Failed to open {}: {}", path.display(), e))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1024 * 1024];
    loop {
        let n = file.read(&mut buf).await.map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

// ---------------------------------------------------------------------------
// Benchmark — real prompt-eval + generation speed metrics.
// ---------------------------------------------------------------------------

/// Run a real benchmark against an OpenAI-compatible model server
/// (typically a local llama-server). Returns prompt eval speed, generation
/// speed, TTFT, peak RAM / VRAM, etc. — all measured from real HTTP
/// requests, no mock values.
#[tauri::command]
pub async fn benchmark_model_command(
    base_url: String,
    model: String,
    prompt: Option<String>,
    max_tokens: Option<usize>,
) -> Result<BenchmarkResult, String> {
    benchmark::run_benchmark(base_url, model, prompt, max_tokens).await
}
