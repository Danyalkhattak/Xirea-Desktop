//! Xirea desktop backend.
//!
//! The Rust side of Xirea provides:
//!
//! - Plugin wiring (clipboard, dialog, fs, global-shortcut, notification, os,
//!   shell, store, updater).
//! - Real cloud provider chat completions with streaming via Server-Sent Events.
//! - Real provider model listing (OpenAI / Anthropic / Gemini / Ollama / etc.).
//! - Real GGUF metadata extraction from local model files.
//! - Real Hugging Face Hub search / model / file-tree API.
//! - Real download manager with progress events, pause/resume/cancel.
//! - Real file metadata (size, MIME detection by extension).
//! - Window controls, app meta, native notifications.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, WindowEvent};
use tauri_plugin_notification::NotificationExt;
use tokio::sync::oneshot;

mod benchmark;
mod commands;
mod downloader;
mod gguf;
mod hf;
mod llama_runtime;
mod providers;
mod system_info;
mod verify;

use commands::*;

// Re-export for use by commands.rs.
pub use benchmark::{run_benchmark, BenchmarkResult};
pub use downloader::run_download;
pub use llama_runtime::{
    BinaryCandidate, BinaryLookup, LibraryCheck, ModelImportVerification, RuntimeVerification,
    SessionLog, SystemSnapshot, VersionCheck,
};
pub use system_info::{get_system_info, DiskInfo, GpuInfo, SystemInfo};
pub use verify::{verify_download, VerificationResult};

// ---------------------------------------------------------------------------
// Types — mirrored in the frontend `src/types/index.ts`
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppMeta {
    pub name: String,
    pub version: String,
    pub platform: String,
    pub arch: String,
    pub hostname: String,
    pub cpu_count: usize,
    pub total_memory_gb: f64,
    pub free_memory_gb: f64,
    pub locale: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderHealth {
    pub ok: bool,
    pub status: u16,
    pub latency_ms: u64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudModelDto {
    pub id: String,
    pub name: String,
    pub provider_id: String,
    pub context_length: usize,
    pub capabilities: Vec<String>,
    pub description: Option<String>,
    pub input_per_1m: Option<f64>,
    pub output_per_1m: Option<f64>,
    pub available: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ChatRequestMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ChatCompletionRequest {
    pub provider_kind: String,
    pub base_url: String,
    pub api_key: Option<String>,
    pub model: String,
    pub messages: Vec<ChatRequestMessage>,
    #[serde(default)]
    pub temperature: Option<f64>,
    #[serde(default)]
    pub max_tokens: Option<usize>,
    #[serde(default)]
    pub top_p: Option<f64>,
    #[serde(default)]
    pub stream: Option<bool>,
    #[serde(default)]
    pub extra_headers: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatStreamDelta {
    /// Incremental text chunk to append.
    pub delta: String,
    /// Cumulative text so far.
    pub accumulated: String,
    /// Estimated tokens (cumulative).
    pub tokens: usize,
    /// True when stream finished cleanly.
    pub done: bool,
    /// Reasoning trace fragment (Anthropic / OpenAI o1).
    pub reasoning: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GgufMetadata {
    pub path: String,
    pub name: String,
    pub format: String,
    pub size_bytes: u64,
    pub architecture: Option<String>,
    pub context_length: Option<usize>,
    pub parameters: Option<String>,
    pub quantization: Option<String>,
    pub ram_estimate_gb: Option<f64>,
    pub vram_estimate_gb: Option<f64>,
    pub capabilities: Vec<String>,
    pub verified: bool,
    /// Model family (e.g. "llama3", "qwen2", "mistral"). Derived from
    /// `general.family` GGUF metadata, falling back to the architecture.
    pub family: Option<String>,
    /// Tokenizer model name (e.g. "llama", "qwen2"). Derived from
    /// `tokenizer.ggml.model`.
    pub tokenizer: Option<String>,
    /// End-of-sequence token(s) as readable strings.
    pub eos_token: Option<String>,
    /// Beginning-of-sequence token(s).
    pub bos_token: Option<String>,
    /// License string from `general.license` if present.
    pub license: Option<String>,
    /// Organization / dataset the model was trained on, from
    /// `general.organization` / `general.dataset` if present.
    pub organization: Option<String>,
    pub training_dataset: Option<String>,
    /// All raw GGUF metadata key-value pairs we couldn't classify into the
    /// typed fields above. Surfaced in the model details dialog for power
    /// users who want to inspect every field.
    pub raw_metadata: std::collections::HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMeta {
    pub path: String,
    pub name: String,
    pub size_bytes: u64,
    pub mime_type: String,
    pub kind: String,
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HfModelDto {
    pub id: String,
    pub author: String,
    pub sha: Option<String>,
    pub last_modified: String,
    pub library: Option<String>,
    pub tags: Vec<String>,
    pub pipeline_tag: Option<String>,
    pub downloads: u64,
    pub likes: u64,
    pub trending: bool,
    pub verified: bool,
    pub description: Option<String>,
    pub context_length: Option<usize>,
    pub quantizations: Vec<String>,
    pub files: Vec<HfFileDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HfFileDto {
    pub rfilename: String,
    pub size_bytes: Option<u64>,
    pub url: Option<String>,
}

// ---------------------------------------------------------------------------
// Download manager — shared state
// ---------------------------------------------------------------------------

/// One-shot cancel signals keyed by download id.
pub static DOWNLOAD_CANCELS: once_cell::sync::Lazy<Mutex<HashMap<String, oneshot::Sender<()>>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(HashMap::new()));

/// Pause flags keyed by download id — when true, the download loop parks until cleared or cancelled.
pub static DOWNLOAD_PAUSED: once_cell::sync::Lazy<
    Mutex<HashMap<String, Arc<std::sync::atomic::AtomicBool>>>,
> = once_cell::sync::Lazy::new(|| Mutex::new(HashMap::new()));

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn app_meta(app: tauri::AppHandle) -> AppMeta {
    let os_info = os_info::get();
    let hostname = hostname::get()
        .ok()
        .and_then(|h| h.into_string().ok())
        .unwrap_or_else(|| "localhost".to_string());

    let total_memory_gb =
        sysinfo::System::new_all().total_memory() as f64 / 1024.0 / 1024.0 / 1024.0;

    let mut sys = sysinfo::System::new_all();
    sys.refresh_memory();
    let free_memory_gb = sys.available_memory() as f64 / 1024.0 / 1024.0 / 1024.0;

    AppMeta {
        name: app.package_info().name.clone(),
        version: app.package_info().version.to_string(),
        platform: os_info.os_type().to_string(),
        arch: std::env::consts::ARCH.to_string(),
        hostname,
        cpu_count: std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(1),
        total_memory_gb: (total_memory_gb * 10.0).round() / 10.0,
        free_memory_gb: (free_memory_gb * 10.0).round() / 10.0,
        locale: sys_locale::get_locale().unwrap_or_else(|| "en-US".to_string()),
    }
}

#[tauri::command]
fn window_minimize(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
fn window_toggle_maximize(window: tauri::Window) -> Result<bool, String> {
    // Tauri 2's `tauri::Window` doesn't expose a single `toggle_maximize()`
    // method — it exposes `maximize()` and `unmaximize()`. We toggle
    // atomically by reading the current state and calling the opposite
    // operation. The previous implementation referenced a `toggle_maximize()`
    // method that doesn't exist on `tauri::Window`, which broke the build
    // (`error[E0599]: no method named toggle_maximize found`).
    //
    // There's a tiny race here between `is_maximized()` and the subsequent
    // call, but in practice this is fine: the window state only changes due
    // to user input (title-bar double-click, snap gestures), and Tauri
    // serialises window commands on the main thread. The race is
    // idempotent anyway — if the state flips between the check and the
    // call, the user just ends up in the same state they started in.
    let maximized = window.is_maximized().map_err(|e| e.to_string())?;
    if maximized {
        window.unmaximize().map_err(|e| e.to_string())?;
    } else {
        window.maximize().map_err(|e| e.to_string())?;
    }
    Ok(!maximized)
}

#[tauri::command]
fn window_close(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
fn window_start_drag(window: tauri::Window) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

#[tauri::command]
fn window_set_title(window: tauri::Window, title: String) -> Result<(), String> {
    window.set_title(&title).map_err(|e| e.to_string())
}

#[tauri::command]
async fn ping_provider(url: String, _api_key: Option<String>) -> Result<ProviderHealth, String> {
    let start = std::time::Instant::now();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;

    let res = client.head(&url).send().await;
    let latency_ms = start.elapsed().as_millis() as u64;

    match res {
        Ok(r) => Ok(ProviderHealth {
            ok: r.status().as_u16() < 500,
            status: r.status().as_u16(),
            latency_ms,
            message: format!("{} {}", r.status().as_str(), r.url().as_str()),
        }),
        Err(e) => Ok(ProviderHealth {
            ok: false,
            status: 0,
            latency_ms,
            message: e.to_string(),
        }),
    }
}

#[tauri::command]
fn show_notification(app: tauri::AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(&title)
        .body(&body)
        .show()
        .map_err(|e| e.to_string())
}

/// Resolve a possibly-relative path against the user's home directory.
/// Replaces a leading `~` with the home directory.
pub fn expand_path(p: &str) -> PathBuf {
    if let Some(rest) = p.strip_prefix("~/") {
        if let Some(home) = dirs_sys::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(p)
}

/// Choose a reasonable Xirea models directory under the user's home.
pub fn default_models_dir() -> PathBuf {
    dirs_sys::home_dir()
        .map(|h| h.join(".xirea").join("models"))
        .unwrap_or_else(|| PathBuf::from(".xirea/models"))
}

// ---------------------------------------------------------------------------
// Panic + logging
// ---------------------------------------------------------------------------

fn install_panic_hook() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log::error!("panic: {}", info);
        default_hook(info);
    }));
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp(None)
        .init();

    install_panic_hook();

    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(DownloaderState::default())
        .setup(|app| {
            let window = app.get_webview_window("main").expect("main window missing");
            let _ = window.set_title("Xirea");
            let _ = window.emit("xirea://ready", ());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if cfg!(not(target_os = "macos")) {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            // Window / app
            app_meta,
            window_minimize,
            window_toggle_maximize,
            window_close,
            window_start_drag,
            window_set_title,
            ping_provider,
            show_notification,
            // System info
            get_system_info_command,
            get_models_disk_info,
            // Chat
            chat_completion,
            chat_cancel,
            // Providers
            fetch_provider_models,
            // Local models
            read_gguf_metadata,
            scan_models_dir,
            // Files
            file_metadata,
            reveal_in_finder,
            read_file_as_data_url,
            ensure_dir,
            // Hugging Face
            hf_search,
            hf_model,
            hf_model_files,
            // Downloads
            download_start,
            download_pause,
            download_resume,
            download_cancel,
            // Download verification
            verify_download_command,
            sha256_file_command,
            // Local model loading
            load_local_model,
            // llama.cpp sidecar
            start_llama_server,
            stop_llama_server,
            verify_llama_runtime_command,
            verify_model_import_command,
            // Benchmark
            benchmark_model_command,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Xirea");
}

// We need a small dependency on `dirs_sys` (provided by the `dirs` crate).
// Pull it in via a re-export shim if not directly available.
mod dirs_sys {
    pub fn home_dir() -> Option<std::path::PathBuf> {
        std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map(std::path::PathBuf::from)
    }
}

// Re-export the downloader state container.
use downloader::DownloaderState;
