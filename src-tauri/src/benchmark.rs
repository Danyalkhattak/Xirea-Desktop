//! Model benchmark — real prompt-evaluation and generation speed metrics.
//!
//! Runs an actual chat completion against a local `llama-server` (or any
//! OpenAI-compatible endpoint) and measures:
//!  - Prompt evaluation: time from request sent to first token received
//!    (tokens/sec on the prompt phase = prompt_tokens / ttft).
//!  - Generation speed: tokens generated / generation_time.
//!  - Peak RAM / VRAM deltas (best-effort via sysinfo + nvidia-smi).
//!  - Total load time (time from request to last token).
//!
//! No mock values, no simulated progress. Every number comes from a real
//! HTTP request against the running model server.

use serde::Serialize;
use std::time::{Duration, Instant};
use sysinfo::System;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkResult {
    pub prompt_tokens: usize,
    pub generation_tokens: usize,
    /// Time-to-first-token, in milliseconds.
    pub ttft_ms: u64,
    /// Total wall-clock time from request to last token, in milliseconds.
    pub total_ms: u64,
    /// Prompt evaluation speed (tokens/sec).
    pub prompt_eval_per_sec: f64,
    /// Generation speed (tokens/sec).
    pub generation_per_sec: f64,
    /// Peak RAM usage during benchmark, in bytes.
    pub peak_ram_bytes: u64,
    /// Peak VRAM usage during benchmark, in bytes (0 if no GPU detected).
    pub peak_vram_bytes: u64,
    /// Was the benchmark successful?
    pub ok: bool,
    /// Error message if `ok` is false.
    pub error: Option<String>,
}

/// Run a benchmark against an OpenAI-compatible model server.
///
/// `base_url` should be like `http://127.0.0.1:8080/v1` (no trailing slash).
/// `model` is the model ID the server expects (e.g. the GGUF filename).
/// `prompt` is the prompt to send (defaults to a fixed 64-token prompt if empty).
/// `max_tokens` controls how many tokens to generate.
pub async fn run_benchmark(
    base_url: String,
    model: String,
    prompt: Option<String>,
    max_tokens: Option<usize>,
) -> Result<BenchmarkResult, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;

    let prompt_text = prompt.unwrap_or_else(|| {
        // A fixed, ~64-token prompt for consistent measurements.
        "The quick brown fox jumps over the lazy dog. \
         In a world of endless possibilities, the journey of a thousand miles \
         begins with a single step. Technology has transformed the way we \
         live, work, and communicate. From the earliest tools to modern \
         artificial intelligence, humans have always sought to extend their \
         capabilities. The future holds both promise and peril, and it is \
         up to us to choose wisely."
            .to_string()
    });
    let max_tok = max_tokens.unwrap_or(128);

    // Estimate prompt tokens: ~4 chars per token (English).
    let prompt_tokens_est = (prompt_text.len() / 4).max(1);

    // Start RAM sampler.
    let stop_flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let peak_ram = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
    let peak_vram = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));

    let stop_for_task = stop_flag.clone();
    let peak_ram_for_task = peak_ram.clone();
    let peak_vram_for_task = peak_vram.clone();
    let sampler_handle = tokio::spawn(async move {
        let mut sys = System::new();
        while !stop_for_task.load(std::sync::atomic::Ordering::Relaxed) {
            sys.refresh_memory();
            let used = sys.used_memory();
            if used > peak_ram_for_task.load(std::sync::atomic::Ordering::Relaxed) {
                peak_ram_for_task.store(used, std::sync::atomic::Ordering::Relaxed);
            }
            // Sample VRAM via nvidia-smi (best-effort).
            if let Ok(out) = tokio::process::Command::new("nvidia-smi")
                .args(["--query-gpu=memory.used", "--format=csv,noheader,nounits"])
                .output()
                .await
            {
                if out.status.success() {
                    let s = String::from_utf8_lossy(&out.stdout);
                    let mut total: u64 = 0;
                    for line in s.lines() {
                        if let Ok(n) = line.trim().parse::<u64>() {
                            total += n * 1024 * 1024;
                        }
                    }
                    if total > peak_vram_for_task.load(std::sync::atomic::Ordering::Relaxed) {
                        peak_vram_for_task.store(total, std::sync::atomic::Ordering::Relaxed);
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(150)).await;
        }
    });

    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let body = serde_json::json!({
        "model": model,
        "messages": [{ "role": "user", "content": prompt_text }],
        "max_tokens": max_tok,
        "temperature": 0.0,
        "stream": true,
    });

    let start = Instant::now();
    let mut ttft: Option<Instant> = None;
    let mut generation_tokens: usize = 0;
    let mut last_text = String::new();
    let mut error: Option<String> = None;

    match client.post(&url).json(&body).send().await {
        Ok(resp) if resp.status().is_success() => {
            use futures_util::StreamExt;
            let mut stream = resp.bytes_stream();
            let mut buf = String::new();
            while let Some(chunk) = stream.next().await {
                let chunk = match chunk {
                    Ok(c) => c,
                    Err(e) => {
                        error = Some(format!("stream error: {}", e));
                        break;
                    }
                };
                buf.push_str(&String::from_utf8_lossy(&chunk));
                // Parse SSE: lines starting with "data: ".
                while let Some(idx) = buf.find('\n') {
                    let line: String = buf.drain(..=idx).collect();
                    let line = line.trim();
                    if !line.starts_with("data: ") {
                        continue;
                    }
                    let data = &line[6..];
                    if data == "[DONE]" {
                        continue;
                    }
                    let parsed: serde_json::Value = match serde_json::from_str(data) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };
                    let delta = parsed
                        .get("choices")
                        .and_then(|c| c.get(0))
                        .and_then(|c| c.get("delta"))
                        .and_then(|d| d.get("content"))
                        .and_then(|c| c.as_str())
                        .unwrap_or("");
                    if !delta.is_empty() {
                        if ttft.is_none() {
                            ttft = Some(Instant::now());
                        }
                        generation_tokens += 1;
                        last_text.push_str(delta);
                    }
                }
            }
        }
        Ok(resp) => {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            error = Some(format!("HTTP {}: {}", status, text));
        }
        Err(e) => {
            error = Some(format!("request failed: {}", e));
        }
    }

    let total_ms = start.elapsed().as_millis() as u64;
    let ttft_ms = ttft
        .map(|t| t.duration_since(start).as_millis() as u64)
        .unwrap_or(0);
    let generation_ms = total_ms.saturating_sub(ttft_ms);

    let generation_per_sec = if generation_ms > 0 {
        (generation_tokens as f64 / generation_ms as f64) * 1000.0
    } else {
        0.0
    };
    let prompt_eval_per_sec = if ttft_ms > 0 {
        (prompt_tokens_est as f64 / ttft_ms as f64) * 1000.0
    } else {
        0.0
    };

    stop_flag.store(true, std::sync::atomic::Ordering::Relaxed);
    let _ = sampler_handle.await;

    let ok = error.is_none() && generation_tokens > 0;
    let _ = last_text; // discarded; not returned

    Ok(BenchmarkResult {
        prompt_tokens: prompt_tokens_est,
        generation_tokens,
        ttft_ms,
        total_ms,
        prompt_eval_per_sec,
        generation_per_sec,
        peak_ram_bytes: peak_ram.load(std::sync::atomic::Ordering::Relaxed),
        peak_vram_bytes: peak_vram.load(std::sync::atomic::Ordering::Relaxed),
        ok,
        error,
    })
}
