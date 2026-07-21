//! llama.cpp runtime — binary discovery, verification, and OS detection.
//!
//! This module centralises everything related to locating and verifying the
//! bundled `llama-server` executable. It is the single source of truth for
//! "which binary do we spawn?" — never hardcode a Windows path, never assume
//! the sidecar mechanism worked.
//!
//! ## Lookup order
//!
//! 1. **Bundled resource**: `<resource_dir>/binaries/<subfolder>/llama-server`
//!    where `<subfolder>` is `windows`, `linux`, `macos-x64`, or
//!    `macos-arm64` depending on the host OS/arch. This is the path that
//!    works in production builds — Tauri bundles everything under
//!    `binaries/**` as a resource.
//! 2. **Dev-mode path**: `src-tauri/binaries/<subfolder>/llama-server`. This
//!    is the path that works during `npm run tauri dev` (the resource_dir
//!    in dev points into `target/`, so we fall back to the source tree).
//! 3. **PATH lookup**: `which::which("llama-server")`. Power users who have
//!    installed llama.cpp themselves can use that.
//! 4. **Hard error** with a detailed, actionable message.
//!
//! ## Verification
//!
//! Before spawning, we verify the binary:
//!   - File exists
//!   - File is executable (Unix: executable bit; Windows: .exe extension)
//!   - `--version` runs successfully (binary isn't corrupt / wrong arch)
//!
//! The result is a `RuntimeVerification` struct that the frontend can show
//! to the user — including the actual stdout/stderr/exit_code of the
//! `--version` check.
//!
//! ## Why we no longer use Tauri's `externalBin`
//!
//! Tauri's sidecar mechanism (`externalBin` + `app.shell().sidecar(...)`)
//! requires a flat `binaries/llama-server-<target-triple>` layout, which
//! doesn't support bundling the Windows DLLs / Linux .so / macOS .dylib
//! files alongside the executable. We switched to `resources` (with a
//! subfolder layout) and spawn via `tokio::process::Command` so we can
//! ship the full runtime, not just the bare executable.

use std::path::PathBuf;
use std::time::Duration;

use serde::Serialize;
use sysinfo::System;
use tauri::{AppHandle, Manager};

use crate::default_models_dir;
use crate::gguf;
use crate::system_info;

// ---------------------------------------------------------------------------
// OS / arch detection
// ---------------------------------------------------------------------------

/// Pick the subfolder name that matches the host platform.
///
/// This is the single source of truth for "which subfolder of `binaries/`
/// contains the right `llama-server` for this machine". Never hardcode
/// Windows paths — the same code path works on every platform.
pub fn pick_runtime_subdir() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "linux") {
        // Linux ARM64 (e.g. Raspberry Pi 5, Grace) — future-proofing. The
        // CI workflow doesn't build this yet, but if a user drops a binary
        // in `binaries/linux-arm64/` it will be picked up.
        if cfg!(target_arch = "aarch64") {
            "linux-arm64"
        } else {
            "linux"
        }
    } else if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            "macos-arm64"
        } else {
            "macos-x64"
        }
    } else {
        // BSD / other Unix — best-effort fallback to the Linux binary,
        // which usually works on FreeBSD with Linux compatibility enabled.
        "linux"
    }
}

/// The executable name on the current platform (with .exe on Windows).
pub fn executable_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "llama-server.exe"
    } else {
        "llama-server"
    }
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/// Result of a binary lookup — tells the caller exactly where we found the
/// binary (or where we looked and failed), so error messages are actionable.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BinaryLookup {
    /// Where we ultimately found the binary (or `None` if not found).
    pub path: Option<String>,
    /// Where we looked, in order, with the reason each candidate was rejected.
    /// Always non-empty — useful for the "why did this fail?" UI.
    pub candidates: Vec<BinaryCandidate>,
    /// `"bundled"`, `"dev"`, `"path"`, or `"not-found"`.
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BinaryCandidate {
    pub path: String,
    pub kind: String, // "bundled" | "dev" | "path"
    pub exists: bool,
    pub executable: bool,
    /// Why this candidate was rejected — `None` if it was accepted.
    pub rejection_reason: Option<String>,
}

/// Resolve the `llama-server` binary path on the host.
///
/// Lookup order:
/// 1. Bundled resource (`<resource_dir>/binaries/<subfolder>/llama-server`)
/// 2. Dev path (`src-tauri/binaries/<subfolder>/llama-server`)
/// 3. PATH (`which::which("llama-server")`)
///
/// Returns a `BinaryLookup` with the full diagnostic trail — even when we
/// find a binary, the caller can inspect `candidates` to see what else was
/// tried. This makes "why didn't you use my PATH binary?" questions easy to
/// answer in the UI.
pub fn resolve_llama_binary(app: &AppHandle) -> BinaryLookup {
    let subdir = pick_runtime_subdir();
    let exe_name = executable_name();
    let mut candidates: Vec<BinaryCandidate> = Vec::new();

    // 1. Bundled resource path.
    let bundled_path = app
        .path()
        .resource_dir()
        .ok()
        .map(|rd| rd.join("binaries").join(subdir).join(exe_name));
    if let Some(ref p) = bundled_path {
        let candidate = check_candidate(p, "bundled");
        // FIXED: candidate.path is a String, not Option; check rejection_reason.
        if candidate.rejection_reason.is_none() {
            let path = candidate.path.clone();
            candidates.push(candidate);
            return BinaryLookup {
                path: Some(path),
                candidates,
                source: "bundled".to_string(),
            };
        }
        candidates.push(candidate);
    }

    // 2. Dev-mode path — relative to the current working directory. In
    //    `npm run tauri dev`, the working directory is `src-tauri/`, so
    //    `binaries/<subdir>/<exe>` resolves to the source-tree copy.
    let dev_path = std::env::current_dir()
        .ok()
        .map(|cwd| cwd.join("binaries").join(subdir).join(exe_name));
    if let Some(ref p) = dev_path {
        let candidate = check_candidate(p, "dev");
        if candidate.rejection_reason.is_none() {
            let path = candidate.path.clone();
            candidates.push(candidate);
            return BinaryLookup {
                path: Some(path),
                candidates,
                source: "dev".to_string(),
            };
        }
        candidates.push(candidate);
    }

    // 3. PATH lookup.
    let path_exe = if cfg!(target_os = "windows") {
        "llama-server.exe"
    } else {
        "llama-server"
    };
    match which::which(path_exe) {
        Ok(p) => {
            let candidate = check_candidate(&p, "path");
            if candidate.rejection_reason.is_none() {
                let path = candidate.path.clone();
                candidates.push(candidate);
                return BinaryLookup {
                    path: Some(path),
                    candidates,
                    source: "path".to_string(),
                };
            }
            candidates.push(candidate);
        }
        Err(_) => {
            candidates.push(BinaryCandidate {
                path: path_exe.to_string(),
                kind: "path".to_string(),
                exists: false,
                executable: false,
                rejection_reason: Some("not on PATH".to_string()),
            });
        }
    }

    BinaryLookup {
        path: None,
        candidates,
        source: "not-found".to_string(),
    }
}

/// Check a single candidate path. Returns a `BinaryCandidate` describing
/// whether the file exists, is executable, and (if not) why.
fn check_candidate(path: &std::path::Path, kind: &str) -> BinaryCandidate {
    let path_str = path.to_string_lossy().to_string();
    if !path.exists() {
        return BinaryCandidate {
            path: path_str,
            kind: kind.to_string(),
            exists: false,
            executable: false,
            rejection_reason: Some("file does not exist".to_string()),
        };
    }
    let is_executable = is_executable(path);
    if !is_executable {
        let reason = if cfg!(target_os = "windows") {
            "file is not a valid Windows executable".to_string()
        } else {
            "file is not marked executable (run: chmod +x)".to_string()
        };
        return BinaryCandidate {
            path: path_str,
            kind: kind.to_string(),
            exists: true,
            executable: false,
            rejection_reason: Some(reason),
        };
    }
    BinaryCandidate {
        path: path_str,
        kind: kind.to_string(),
        exists: true,
        executable: true,
        rejection_reason: None,
    }
}

/// Cross-platform "is this file executable" check.
fn is_executable(path: &std::path::Path) -> bool {
    if cfg!(target_os = "windows") {
        // On Windows, .exe files are executable by convention. The actual
        // filesystem permission bits don't matter.
        path.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("exe"))
            .unwrap_or(false)
    } else {
        // On Unix, check the executable bit.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::metadata(path)
                .ok()
                .map(|m| m.permissions().mode() & 0o111 != 0)
                .unwrap_or(false)
        }
        #[cfg(not(unix))]
        {
            // Non‑Unix, non‑Windows fallback (e.g. WASM – never really used).
            false
        }
    }
}

// ---------------------------------------------------------------------------
// Runtime verification
// ---------------------------------------------------------------------------

/// Result of a runtime verification check. Surfaced to the frontend so the
/// user can see EXACTLY what was checked, what passed, and what failed —
/// never just "it didn't work".
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeVerification {
    /// Did the runtime pass all checks?
    pub ok: bool,
    /// Path to the binary we verified (or the first candidate if none passed).
    pub binary_path: Option<String>,
    /// Source of the binary: `"bundled"`, `"dev"`, `"path"`, or `"not-found"`.
    pub source: String,
    /// All candidates we considered, with rejection reasons.
    pub candidates: Vec<BinaryCandidate>,
    /// Result of the `--version` invocation.
    pub version_check: Option<VersionCheck>,
    /// Result of the runtime-library check (Windows DLLs, Linux .so, macOS .dylib).
    pub library_check: Option<LibraryCheck>,
    /// Human-readable error message if `ok` is false.
    pub error: Option<String>,
    /// Actionable hint for the user (e.g. "Run chmod +x on the binary").
    pub diagnostic: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionCheck {
    pub ok: bool,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    /// Duration of the `--version` invocation, in milliseconds.
    pub duration_ms: u64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryCheck {
    pub ok: bool,
    /// Directory we scanned for libraries.
    pub directory: String,
    /// Libraries we expected to find (based on platform).
    pub expected: Vec<String>,
    /// Libraries we found.
    pub found: Vec<String>,
    /// Libraries we couldn't find.
    pub missing: Vec<String>,
}

/// Verify the `llama-server` runtime: locate the binary, check it's
/// executable, run `--version`, and (on Windows) check that the required
/// DLLs are present in the same directory.
///
/// This is what the frontend calls *before* showing the "Run" button on a
/// local model — if the runtime isn't usable, we tell the user exactly why
/// up front, instead of letting them click Run and getting a cryptic error
/// half a second later.
pub async fn verify_llama_runtime(app: &AppHandle) -> RuntimeVerification {
    let lookup = resolve_llama_binary(app);

    let Some(binary_path) = lookup.path.clone() else {
        let error = format!(
            "llama-server binary not found. Looked in:\n{}",
            lookup
                .candidates
                .iter()
                .map(|c| format!(
                    "  - [{}] {} — {}",
                    c.kind,
                    c.path,
                    c.rejection_reason
                        .clone()
                        .unwrap_or_else(|| "unknown".to_string())
                ))
                .collect::<Vec<_>>()
                .join("\n")
        );
        return RuntimeVerification {
            ok: false,
            binary_path: None,
            source: lookup.source,
            candidates: lookup.candidates,
            version_check: None,
            library_check: None,
            error: Some(error),
            diagnostic: Some(format!(
                "Drop a llama-server binary into src-tauri/binaries/{}/{} \
                 (see src-tauri/binaries/README.md), or install llama.cpp on \
                 your system so it's on your PATH.",
                pick_runtime_subdir(),
                executable_name()
            )),
        };
    };

    let path = std::path::PathBuf::from(&binary_path);

    // Run `--version` to confirm the binary launches.
    let version_check = run_version_check(&path).await;

    // Check runtime libraries (Windows DLLs primarily).
    let library_check = check_runtime_libraries(&path);

    let ok = version_check.as_ref().map(|v| v.ok).unwrap_or(false)
        && library_check.as_ref().map(|l| l.ok).unwrap_or(true);

    let error = if ok {
        None
    } else {
        let mut reasons = Vec::new();
        if let Some(ref vc) = version_check {
            if !vc.ok {
                reasons.push(format!(
                    "version check failed (exit code {:?}): {}",
                    vc.exit_code,
                    if vc.stderr.is_empty() {
                        vc.stdout.as_str()
                    } else {
                        vc.stderr.as_str()
                    }
                ));
            }
        }
        if let Some(ref lc) = library_check {
            if !lc.ok {
                reasons.push(format!(
                    "missing runtime libraries: {}",
                    lc.missing.join(", ")
                ));
            }
        }
        Some(reasons.join("; "))
    };

    let diagnostic = if ok {
        None
    } else {
        Some(diagnose_verification_failure(
            &version_check,
            &library_check,
            &path,
        ))
    };

    RuntimeVerification {
        ok,
        binary_path: Some(binary_path),
        source: lookup.source,
        candidates: lookup.candidates,
        version_check,
        library_check,
        error,
        diagnostic,
    }
}

/// Run `llama-server --version` and capture stdout/stderr/exit_code.
///
/// We use `tokio::process::Command` with stdout and stderr piped so we can
/// capture the actual output — never just "it failed". If the binary
/// segfaults on startup (wrong arch, missing CPU instructions), the exit
/// code will be non-zero and stderr will be empty, which we surface as
/// "the binary launched but exited with code X — this usually means the
/// CPU architecture doesn't match".
async fn run_version_check(binary: &std::path::Path) -> Option<VersionCheck> {
    let start = std::time::Instant::now();
    let output = tokio::time::timeout(
        Duration::from_secs(10),
        tokio::process::Command::new(binary)
            .arg("--version")
            .output(),
    )
    .await;

    let duration_ms = start.elapsed().as_millis() as u64;

    match output {
        Ok(Ok(out)) => Some(VersionCheck {
            ok: out.status.success(),
            exit_code: out.status.code(),
            stdout: String::from_utf8_lossy(&out.stdout).to_string(),
            stderr: String::from_utf8_lossy(&out.stderr).to_string(),
            duration_ms,
            error: None,
        }),
        Ok(Err(e)) => Some(VersionCheck {
            ok: false,
            exit_code: None,
            stdout: String::new(),
            stderr: String::new(),
            duration_ms,
            error: Some(format!("Failed to spawn `--version`: {}", e)),
        }),
        Err(_) => Some(VersionCheck {
            ok: false,
            exit_code: None,
            stdout: String::new(),
            stderr: String::new(),
            duration_ms,
            error: Some("`--version` did not complete within 10 seconds — the binary may be hung or incompatible with this CPU architecture".to_string()),
        }),
    }
}

/// Check that the runtime libraries the binary needs are present.
///
/// On Windows, the llama-server.exe in the official releases is dynamically
/// linked against `llama.dll`, `ggml.dll`, etc. — if any of those are
/// missing, spawn will succeed but the process will immediately exit with
/// a misleading "code 0xc0000135" (STATUS_DLL_NOT_FOUND).
///
/// On Linux/macOS, the official releases are statically linked, so this
/// check is a no-op (we just verify the directory is readable).
fn check_runtime_libraries(binary: &std::path::Path) -> Option<LibraryCheck> {
    let dir = binary.parent()?.to_path_buf();
    let dir_str = dir.to_string_lossy().to_string();

    let expected = expected_libraries();
    if expected.is_empty() {
        // Statically linked platform — nothing to check.
        return Some(LibraryCheck {
            ok: true,
            directory: dir_str,
            expected: Vec::new(),
            found: Vec::new(),
            missing: Vec::new(),
        });
    }

    let mut found: Vec<String> = Vec::new();
    let mut missing: Vec<String> = Vec::new();
    for lib in &expected {
        let lib_path = dir.join(lib);
        if lib_path.exists() {
            found.push(lib.clone());
        } else {
            missing.push(lib.clone());
        }
    }

    Some(LibraryCheck {
        ok: missing.is_empty(),
        directory: dir_str,
        expected,
        found,
        missing,
    })
}

/// Return the list of runtime libraries we expect to find alongside the
/// `llama-server` binary, by platform.
///
/// On Linux and macOS, official llama.cpp release builds are statically
/// linked — we return an empty list (no library check needed). On Windows,
/// the release builds ship as a `.exe` + multiple `.dll` files, and we
/// expect at minimum the core ones.
fn expected_libraries() -> Vec<String> {
    if cfg!(target_os = "windows") {
        // The minimum set required by llama-server.exe in official releases.
        // If any of these are missing, the binary won't start.
        vec![
            "llama.dll".to_string(),
            "llama-common.dll".to_string(),
            "llama-server-impl.dll".to_string(),
            "ggml-base.dll".to_string(),
            "ggml.dll".to_string(),
        ]
    } else {
        // Linux and macOS official builds are statically linked.
        Vec::new()
    }
}

/// Produce an actionable diagnostic hint based on what failed.
fn diagnose_verification_failure(
    version_check: &Option<VersionCheck>,
    library_check: &Option<LibraryCheck>,
    binary: &std::path::Path,
) -> String {
    if let Some(ref lc) = library_check {
        if !lc.ok && !lc.missing.is_empty() {
            return format!(
                "Missing runtime libraries in {}: {}. Re-download the \
                 llama.cpp release ZIP and extract ALL files into the same \
                 directory as llama-server ({}).",
                lc.directory,
                lc.missing.join(", "),
                binary.display()
            );
        }
    }
    if let Some(ref vc) = version_check {
        if !vc.ok {
            if let Some(ref err) = vc.error {
                if err.contains("did not complete within") {
                    return format!(
                        "The binary launched but didn't respond to \
                         `--version` within 10 seconds. This usually means \
                         the binary was compiled for a different CPU \
                         architecture (e.g. AVX2 binary on an AVX-only CPU). \
                         Try a different llama.cpp release variant — the \
                         `noavx` build works on every x86_64 CPU."
                    );
                }
                return format!(
                    "Failed to launch `--version`: {}. Check that the file \
                     is a valid executable for your platform and (on \
                     macOS/Linux) that it's marked executable: `chmod +x {}`",
                    err,
                    binary.display()
                );
            }
            if let Some(code) = vc.exit_code {
                if code == 127 || code == -6 || code == -11 {
                    return format!(
                        "The binary exited with code {} — this usually \
                         means a missing shared library or a CPU instruction \
                         set mismatch (e.g. AVX2 binary on an AVX-only CPU). \
                         Try the `noavx` build, or install the missing \
                         shared library.",
                        code
                    );
                }
                if code == -4 {
                    return format!(
                        "The binary exited with SIGILL (illegal instruction) \
                         — it was compiled for a CPU instruction set your \
                         CPU doesn't support. Try the `noavx` build instead."
                    );
                }
                if !vc.stderr.is_empty() {
                    return format!(
                        "The binary exited with code {} and printed:\n{}\n\
                         Common fixes: re-download the binary, verify the \
                         SHA-256, or use a different build variant (CUDA / \
                         CPU-only / noavx).",
                        code, vc.stderr
                    );
                }
                return format!(
                    "The binary exited with code {} and printed nothing. \
                     This usually indicates a CPU architecture mismatch \
                     (try the `noavx` build) or a missing shared library.",
                    code
                );
            }
        }
    }
    "Runtime verification failed for an unknown reason. Check the Xirea \
     logs (View → Show Developer Tools) for more details."
        .to_string()
}

// ---------------------------------------------------------------------------
// System info for logging
// ---------------------------------------------------------------------------

/// Snapshot of system info that's useful for debugging llama-server issues.
/// Serialized into the per-session log file so a bug report has everything
/// we need to diagnose the problem.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemSnapshot {
    pub os: String,
    pub arch: String,
    pub cpu_brand: String,
    pub cpu_cores: usize,
    pub cpu_threads: usize,
    pub total_ram_bytes: u64,
    pub available_ram_bytes: u64,
    pub gpu_summary: Vec<String>,
    pub models_dir: String,
    pub models_dir_disk_free_bytes: u64,
}

/// Capture a system snapshot for logging. This is best-effort — if a field
/// can't be determined, we use a sensible default rather than failing.
pub async fn capture_system_snapshot() -> SystemSnapshot {
    let mut sys = System::new_all();
    sys.refresh_memory();
    sys.refresh_cpu_usage();

    let cpu_brand = sys
        .cpus()
        .first()
        .map(|c| c.brand().to_string())
        .unwrap_or_else(|| "unknown".to_string());
    let cpu_cores = sys.physical_core_count().unwrap_or_else(|| {
        std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(1)
    });
    let cpu_threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1);
    let total_ram = sys.total_memory();
    let available_ram = sys.available_memory();

    // GPU summary — best-effort, don't fail if detection fails.
    let gpu_summary = match system_info::get_system_info().await {
        Ok(info) => info
            .gpus
            .iter()
            .map(|g| {
                format!(
                    "{} {} (VRAM: {:.1} GB, CUDA: {}, Metal: {}, Vulkan: {})",
                    g.vendor,
                    g.name,
                    g.vram_bytes as f64 / 1024.0 / 1024.0 / 1024.0,
                    g.cuda_available,
                    g.metal_available,
                    g.vulkan_available
                )
            })
            .collect(),
        Err(_) => vec!["GPU detection failed".to_string()],
    };

    let models_dir = default_models_dir();
    let models_dir_str = models_dir.to_string_lossy().to_string();
    let models_dir_disk_free = disk_free_for_path(&models_dir);

    SystemSnapshot {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        cpu_brand,
        cpu_cores,
        cpu_threads,
        total_ram_bytes: total_ram,
        available_ram_bytes: available_ram,
        gpu_summary,
        models_dir: models_dir_str,
        models_dir_disk_free_bytes: models_dir_disk_free,
    }
}

/// Best-effort: return the free disk space (in bytes) for the filesystem
/// containing `path`. Returns 0 on any error.
fn disk_free_for_path(path: &std::path::Path) -> u64 {
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let mut best: Option<&sysinfo::Disk> = None;
    let mut best_len = 0;
    for disk in disks.list() {
        let mount = disk.mount_point();
        if canonical.starts_with(mount) && mount.as_os_str().len() > best_len {
            best_len = mount.as_os_str().len();
            best = Some(disk);
        }
    }
    best.map(|d| d.available_space()).unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Model import verification
// ---------------------------------------------------------------------------

/// Comprehensive verification of a model file before importing it into
/// Xirea. Rejects invalid / corrupted / unreadable files up front, with
/// actionable error messages.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelImportVerification {
    pub ok: bool,
    pub path: String,
    /// `"gguf"` | `"ggml"` | `"unknown"`.
    pub format: String,
    pub size_bytes: u64,
    pub readable: bool,
    pub valid_magic: bool,
    /// Parsed GGUF metadata (None if not a valid GGUF).
    pub metadata: Option<crate::GgufMetadata>,
    /// SHA-256 of the file (computed only if `compute_sha256` was true).
    pub sha256: Option<String>,
    pub error: Option<String>,
    pub diagnostic: Option<String>,
}

/// Verify a model file before importing. If `compute_sha256` is true, also
/// compute the SHA-256 (slow for multi-GB files — only do this if the user
/// explicitly asked).
pub async fn verify_model_import(
    path: &std::path::Path,
    compute_sha256: bool,
) -> ModelImportVerification {
    let path_str = path.to_string_lossy().to_string();

    // 1. File exists.
    if !path.exists() {
        return ModelImportVerification {
            ok: false,
            path: path_str,
            format: "unknown".to_string(),
            size_bytes: 0,
            readable: false,
            valid_magic: false,
            metadata: None,
            sha256: None,
            error: Some("File does not exist".to_string()),
            diagnostic: Some("Check the file path and try again.".to_string()),
        };
    }

    // 2. File is readable + get size.
    let meta = match tokio::fs::metadata(path).await {
        Ok(m) => m,
        Err(e) => {
            return ModelImportVerification {
                ok: false,
                path: path_str,
                format: "unknown".to_string(),
                size_bytes: 0,
                readable: false,
                valid_magic: false,
                metadata: None,
                sha256: None,
                error: Some(format!("Cannot read file metadata: {}", e)),
                diagnostic: Some("Check the file permissions.".to_string()),
            };
        }
    };
    let size_bytes = meta.len();

    // 3. Detect format from extension.
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default();
    let format = if ext == "gguf" {
        "gguf"
    } else if ext == "ggml" {
        "ggml"
    } else {
        "unknown"
    };

    // 4. Read GGUF metadata (this also validates the magic).
    let metadata = match gguf::read_metadata(path).await {
        Ok(m) => Some(m),
        Err(e) => {
            return ModelImportVerification {
                ok: false,
                path: path_str,
                format: format.to_string(),
                size_bytes,
                readable: true,
                valid_magic: false,
                metadata: None,
                sha256: None,
                error: Some(format!("Failed to read GGUF metadata: {}", e)),
                diagnostic: Some(
                    "The file may be corrupted or not a valid GGUF. \
                     Re-download it from Hugging Face and verify the SHA-256."
                        .to_string(),
                ),
            };
        }
    };

    let valid_magic = metadata
        .as_ref()
        .map(|m| m.format == "gguf" || m.format == "ggml")
        .unwrap_or(false);

    // 5. Compute SHA-256 if requested.
    let sha256 = if compute_sha256 {
        match compute_sha256_of_file(path).await {
            Ok(h) => Some(h),
            Err(e) => {
                return ModelImportVerification {
                    ok: false,
                    path: path_str,
                    format: format.to_string(),
                    size_bytes,
                    readable: true,
                    valid_magic,
                    metadata,
                    sha256: None,
                    error: Some(format!("Failed to compute SHA-256: {}", e)),
                    diagnostic: Some("Check the file is readable.".to_string()),
                };
            }
        }
    } else {
        None
    };

    let ok = valid_magic && size_bytes > 0;

    ModelImportVerification {
        ok,
        path: path_str,
        format: format.to_string(),
        size_bytes,
        readable: true,
        valid_magic,
        metadata,
        sha256,
        error: if ok {
            None
        } else {
            Some("Model file is not a valid GGUF".to_string())
        },
        diagnostic: if ok {
            None
        } else {
            Some(
                "Re-download the model from Hugging Face and verify the \
                 SHA-256 matches before importing."
                    .to_string(),
            )
        },
    }
}

/// Compute the SHA-256 of a file by streaming it in 1 MiB chunks.
async fn compute_sha256_of_file(path: &std::path::Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use tokio::io::AsyncReadExt;

    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|e| e.to_string())?;
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
// Per-session logging
// ---------------------------------------------------------------------------

/// A per-session log file for a single `llama-server` invocation. Written
/// to `~/.xirea/logs/llama-<session>-<timestamp>.log` and surfaced to the
/// user via the Developer Tools console.
pub struct SessionLog {
    pub path: PathBuf,
    pub file: tokio::fs::File,
}

impl SessionLog {
    /// Create a new session log file. The filename includes the session ID
    /// and a timestamp so multiple sessions don't collide.
    pub async fn create(session: &str) -> Result<Self, String> {
        let log_dir = default_models_dir()
            .parent()
            .map(|p| p.join("logs"))
            .unwrap_or_else(|| PathBuf::from(".xirea/logs"));
        tokio::fs::create_dir_all(&log_dir)
            .await
            .map_err(|e| e.to_string())?;

        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let filename = format!("llama-{}-{}.log", session, timestamp);
        let path = log_dir.join(filename);

        let file = tokio::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&path)
            .await
            .map_err(|e| e.to_string())?;

        Ok(SessionLog { path, file })
    }

    /// Append a line to the log file. Best-effort — errors are logged to the
    /// Rust logger but don't propagate (we never want logging to break the
    /// actual functionality).
    pub async fn write_line(&mut self, line: &str) {
        use tokio::io::AsyncWriteExt;
        let line_with_newline = format!("{}\n", line);
        let _ = self.file.write_all(line_with_newline.as_bytes()).await;
        // Also log to the Rust logger so it shows up in the dev console.
        log::info!("[llama-session] {}", line);
    }

    /// Write a header with the system snapshot, launch command, and all
    /// arguments. Called once at session start.
    pub async fn write_header(
        &mut self,
        session: &str,
        binary_path: &str,
        model_path: &str,
        args: &[String],
        system_snapshot: &SystemSnapshot,
        gguf_metadata: Option<&crate::GgufMetadata>,
    ) {
        use tokio::io::AsyncWriteExt;
        let mut header = String::new();
        header.push_str(&format!("=== Xirea llama-server session {} ===\n", session));
        header.push_str(&format!("Timestamp: {}\n", chrono_like_utc_string()));
        header.push_str(&format!("Binary path: {}\n", binary_path));
        header.push_str(&format!("Model path: {}\n", model_path));
        header.push_str(&format!("Arguments: {}\n", args.join(" ")));
        header.push_str(&format!(
            "Working directory: {}\n",
            std::env::current_dir()
                .map(|d| d.display().to_string())
                .unwrap_or_else(|_| "unknown".to_string())
        ));
        header.push_str("\n--- System info ---\n");
        header.push_str(&format!("OS: {}\n", system_snapshot.os));
        header.push_str(&format!("Architecture: {}\n", system_snapshot.arch));
        header.push_str(&format!(
            "CPU: {} ({} cores, {} threads)\n",
            system_snapshot.cpu_brand, system_snapshot.cpu_cores, system_snapshot.cpu_threads
        ));
        header.push_str(&format!(
            "RAM: {} total, {} available\n",
            format_bytes(system_snapshot.total_ram_bytes),
            format_bytes(system_snapshot.available_ram_bytes)
        ));
        for (i, gpu) in system_snapshot.gpu_summary.iter().enumerate() {
            header.push_str(&format!("GPU {}: {}\n", i, gpu));
        }
        header.push_str(&format!(
            "Models directory: {} ({} free)\n",
            system_snapshot.models_dir,
            format_bytes(system_snapshot.models_dir_disk_free_bytes)
        ));
        if let Some(meta) = gguf_metadata {
            header.push_str("\n--- GGUF metadata ---\n");
            header.push_str(&format!("Name: {}\n", meta.name));
            header.push_str(&format!("Architecture: {:?}\n", meta.architecture));
            header.push_str(&format!("Context length: {:?}\n", meta.context_length));
            header.push_str(&format!("Parameters: {:?}\n", meta.parameters));
            header.push_str(&format!("Quantization: {:?}\n", meta.quantization));
            header.push_str(&format!("Family: {:?}\n", meta.family));
            header.push_str(&format!("Tokenizer: {:?}\n", meta.tokenizer));
            header.push_str(&format!("Size: {} bytes\n", meta.size_bytes));
        }
        header.push_str("\n--- llama-server output ---\n");
        let _ = self.file.write_all(header.as_bytes()).await;
        log::info!("[llama-session] === session {} starting ===", session);
    }

    /// Write the final exit summary.
    pub async fn write_exit_summary(&mut self, exit_code: Option<i32>) {
        use tokio::io::AsyncWriteExt;
        let summary = format!(
            "\n--- exit summary ---\nExit code: {}\n",
            exit_code
                .map(|c| c.to_string())
                .unwrap_or_else(|| "unknown (process killed)".to_string())
        );
        let _ = self.file.write_all(summary.as_bytes()).await;
        let _ = self.file.flush().await;
    }
}

/// Format a byte count as a human-readable string (e.g. "16.5 GiB").
fn format_bytes(bytes: u64) -> String {
    const UNITS: &[&str] = &["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
    let mut size = bytes as f64;
    let mut unit_idx = 0;
    while size >= 1024.0 && unit_idx < UNITS.len() - 1 {
        size /= 1024.0;
        unit_idx += 1;
    }
    format!("{:.2} {}", size, UNITS[unit_idx])
}

/// Format the current UTC time as `YYYY-MM-DD HH:MM:SS` without pulling in
/// the `chrono` crate.
fn chrono_like_utc_string() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Compute date/time fields from the Unix timestamp. This is a minimal
    // civil-from-days implementation — good enough for log headers.
    let secs_per_day = 86400u64;
    let days = now / secs_per_day;
    let secs_of_day = now % secs_per_day;
    let hour = secs_of_day / 3600;
    let min = (secs_of_day % 3600) / 60;
    let sec = secs_of_day % 60;

    // Civil-from-days (Howard Hinnant's algorithm).
    let z = days as i64 + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };

    format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02} UTC",
        year, m, d, hour, min, sec
    )
}
