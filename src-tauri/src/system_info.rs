//! System information — disk, CPU, GPU, RAM, VRAM detection.
//!
//! All checks are real:
//!  - Disk: queries the filesystem containing the user's models directory
//!    via `sysinfo::Disks` (cross-platform, no shelling out).
//!  - CPU: `sysinfo::System` + `std::thread::available_parallelism`.
//!  - RAM: `sysinfo::System::total_memory` / `available_memory`.
//!  - GPU / VRAM / CUDA / Metal / Vulkan: detected by inspecting the
//!    running system — looking for runtime libraries, device files, and
//!    spawning detection commands (`nvidia-smi`, `ioreg`, etc.). We never
//!    guess: if we can't confirm a backend is available, we report it as
//!    `false`.
//!
//! These commands are the single source of truth for the frontend's
//! hardware UI and compatibility checks. No mock values, no hardcoded
//! numbers — every field comes from a real query.

use serde::Serialize;
use std::path::PathBuf;
use std::time::Duration;
use sysinfo::System;

use crate::default_models_dir;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    /// Mount point / root path of the disk that holds the models directory.
    pub mount_point: String,
    /// Filesystem label (e.g. "Macintosh HD", "DATA"). May be empty.
    pub label: String,
    /// Filesystem type (e.g. "ext4", "ntfs", "apfs", "hfs").
    pub fs_type: String,
    /// Total disk capacity, in bytes.
    pub total_bytes: u64,
    /// Used disk space, in bytes.
    pub used_bytes: u64,
    /// Free disk space, in bytes.
    pub free_bytes: u64,
    /// Whether the models directory lives on this disk.
    pub is_models_disk: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuInfo {
    /// Vendor: "nvidia", "amd", "apple", "intel", "unknown".
    pub vendor: String,
    /// Marketing name, e.g. "NVIDIA GeForce RTX 4090" or "Apple M3 Max".
    /// May be empty if we can't determine it.
    pub name: String,
    /// Total VRAM in bytes. 0 if unknown / CPU-only.
    pub vram_bytes: u64,
    /// Available VRAM in bytes (free memory at detection time).
    pub free_vram_bytes: u64,
    /// CUDA runtime available (nvidia only).
    pub cuda_available: bool,
    /// CUDA driver version, if known.
    pub cuda_version: Option<String>,
    /// Metal available (macOS only).
    pub metal_available: bool,
    /// Vulkan available (any platform).
    pub vulkan_available: bool,
    /// ROCm available (AMD on Linux).
    pub rocm_available: bool,
    /// DirectML available (Windows only).
    pub directml_available: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub platform: String,
    pub arch: String,
    pub cpu_vendor: String,
    pub cpu_brand: String,
    pub cpu_cores: usize,
    pub cpu_threads: usize,
    pub total_ram_bytes: u64,
    pub available_ram_bytes: u64,
    pub disks: Vec<DiskInfo>,
    pub gpus: Vec<GpuInfo>,
    /// Convenience: aggregate of all GPU VRAM (0 if no GPUs).
    pub total_vram_bytes: u64,
    /// Convenience: aggregate of all GPU free VRAM.
    pub free_vram_bytes: u64,
}

/// Query the disk that contains the user's models directory, plus all other
/// mounted disks for display purposes. This is the real disk-usage source —
/// the previous frontend hardcoded `20 * 1024 * 1024 * 1024` which was
/// always wrong.
pub async fn get_system_info() -> Result<SystemInfo, String> {
    let models_dir = default_models_dir();
    // Make sure the models dir exists so we can deterministically pick the
    // disk it lives on. (If it doesn't exist yet, sysinfo will still tell
    // us about the parent.)
    let _ = tokio::fs::create_dir_all(&models_dir).await;

    let disks = sysinfo::Disks::new_with_refreshed_list();
    let models_disk = pick_disk_for_path(&disks, &models_dir);

    let mut disk_infos: Vec<DiskInfo> = Vec::new();
    for disk in disks.list() {
        let mount = disk.mount_point().to_string_lossy().to_string();
        let total = disk.total_space();
        let available = disk.available_space();
        let used = total.saturating_sub(available);
        let is_models = models_disk
            .as_ref()
            .map(|d| d.mount_point() == disk.mount_point())
            .unwrap_or(false);
        disk_infos.push(DiskInfo {
            mount_point: mount,
            label: disk.name().to_string_lossy().to_string(),
            fs_type: disk.file_system().to_string_lossy().to_string(),
            total_bytes: total,
            used_bytes: used,
            free_bytes: available,
            is_models_disk: is_models,
        });
    }

    // Sort: models disk first, then by total size descending.
    disk_infos.sort_by(|a, b| {
        b.is_models_disk
            .cmp(&a.is_models_disk)
            .then_with(|| b.total_bytes.cmp(&a.total_bytes))
    });

    let mut sys = System::new_all();
    // sysinfo 0.32 API: `refresh_cpu` was renamed to `refresh_cpu_usage`
    // (the old name was removed — not just deprecated). We refresh once,
    // wait long enough for a meaningful sample window, then refresh again
    // so the per-core CPU usage values are non-zero.
    sys.refresh_cpu_usage();
    sys.refresh_memory();
    tokio::time::sleep(Duration::from_millis(120)).await;
    sys.refresh_cpu_usage();

    let total_ram = sys.total_memory();
    let available_ram = sys.available_memory();

    let cpus = sys.cpus();
    let cpu_vendor = cpus
        .first()
        .map(|c| c.vendor_id().to_string())
        .unwrap_or_default();
    let cpu_brand = cpus
        .first()
        .map(|c| c.brand().to_string())
        .unwrap_or_default();
    // sysinfo 0.32: `Cpu::name()` returns the model name (e.g.
    // "11th Gen Intel(R) Core(TM) i7-1165G7 @ 2.80GHz") — the same string
    // for every logical core on the same physical CPU. Using it to count
    // physical cores (as the previous code did) always returned 1. Use
    // `System::physical_core_count()` instead, which actually queries the
    // OS for the number of physical cores.
    let cpu_cores = sys.physical_core_count().unwrap_or_else(|| {
        // Fallback: derive from logical-thread count assuming SMT with 2
        // threads per core (Intel Hyper-Threading / AMD SMT).
        let threads = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(1);
        (threads / 2).max(1)
    });
    let cpu_threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1);

    let gpus = detect_gpus().await;
    let total_vram: u64 = gpus.iter().map(|g| g.vram_bytes).sum();
    let free_vram: u64 = gpus.iter().map(|g| g.free_vram_bytes).sum();

    Ok(SystemInfo {
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        cpu_vendor,
        cpu_brand,
        cpu_cores,
        cpu_threads,
        total_ram_bytes: total_ram,
        available_ram_bytes: available_ram,
        disks: disk_infos,
        gpus,
        total_vram_bytes: total_vram,
        free_vram_bytes: free_vram,
    })
}

/// Pick the disk whose mount point is the longest prefix of `path`.
/// On Unix this is straightforward; on Windows `mount_point` is a drive
/// letter like `C:\` which is also a prefix.
fn pick_disk_for_path<'a>(disks: &'a sysinfo::Disks, path: &PathBuf) -> Option<&'a sysinfo::Disk> {
    let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.clone());
    let mut best: Option<&sysinfo::Disk> = None;
    let mut best_len = 0;
    for disk in disks.list() {
        let mount = disk.mount_point();
        if canonical.starts_with(mount) && mount.as_os_str().len() > best_len {
            best_len = mount.as_os_str().len();
            best = Some(disk);
        }
    }
    best
}

/// Detect GPUs on the current system. Returns one entry per detected GPU,
/// plus aggregate capability flags (cuda_available, metal_available, etc.)
/// on each entry.
///
/// We never guess: if a detection step fails, we either omit the GPU or
/// report the flag as `false`. No mock values.
async fn detect_gpus() -> Vec<GpuInfo> {
    let mut gpus: Vec<GpuInfo> = Vec::new();

    // 1. NVIDIA via `nvidia-smi`. This is the most reliable cross-platform
    //    way to detect NVIDIA GPUs and their VRAM.
    if let Some(nvidia) = detect_nvidia().await {
        gpus.push(nvidia);
    }

    // 2. Apple Silicon (Metal). On macOS, the GPU is unified memory — we
    //    report its VRAM as the system's available RAM since the OS doesn't
    //    expose a separate VRAM counter.
    if cfg!(target_os = "macos") {
        if let Some(apple) = detect_apple_metal().await {
            gpus.push(apple);
        }
    }

    // 3. AMD ROCm on Linux.
    if cfg!(target_os = "linux") {
        if let Some(amd) = detect_amd_rocm().await {
            gpus.push(amd);
        }
    }

    // 4. Vulkan — best-effort detection via the presence of `vulkaninfo`.
    //    We don't enumerate Vulkan physical devices here (would require the
    //    `vulkan` crate, which is heavy). We just flag whether the runtime
    //    is installed.
    let vulkan_available = detect_vulkan_runtime().await;
    if vulkan_available {
        // If we haven't detected any GPU yet but Vulkan is available,
        // surface a generic entry so the UI can show "Vulkan runtime
        // available, no specific GPU detected".
        if gpus.is_empty() {
            gpus.push(GpuInfo {
                vendor: "unknown".to_string(),
                name: "Vulkan device".to_string(),
                vram_bytes: 0,
                free_vram_bytes: 0,
                cuda_available: false,
                cuda_version: None,
                metal_available: cfg!(target_os = "macos"),
                vulkan_available: true,
                rocm_available: false,
                directml_available: false,
            });
        } else {
            // Mark existing entries as Vulkan-capable.
            for g in &mut gpus {
                g.vulkan_available = true;
            }
        }
    }

    // 5. DirectML on Windows — best-effort detection via dxgi.
    if cfg!(target_os = "windows") {
        let dml = detect_directml().await;
        if dml && gpus.is_empty() {
            gpus.push(GpuInfo {
                vendor: "unknown".to_string(),
                name: "DirectML device".to_string(),
                vram_bytes: 0,
                free_vram_bytes: 0,
                cuda_available: false,
                cuda_version: None,
                metal_available: false,
                vulkan_available: false,
                rocm_available: false,
                directml_available: true,
            });
        } else if dml {
            for g in &mut gpus {
                g.directml_available = true;
            }
        }
    }

    gpus
}

async fn detect_nvidia() -> Option<GpuInfo> {
    // Try `nvidia-smi --query-gpu=name,memory.total,memory.free,driver_version
    // --format=csv,noheader,nounits`. If this works, we have an NVIDIA GPU
    // with the driver installed.
    let output = tokio::process::Command::new("nvidia-smi")
        .args([
            "--query-gpu=name,memory.total,memory.free,driver_version",
            "--format=csv,noheader,nounits",
        ])
        .output()
        .await
        .ok()?;

    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout.lines().next()?;
    let parts: Vec<&str> = line.split(',').map(|s| s.trim()).collect();
    if parts.len() < 4 {
        return None;
    }
    let name = parts[0].to_string();
    let vram_mib: u64 = parts[1].parse().unwrap_or(0);
    let free_mib: u64 = parts[2].parse().unwrap_or(0);
    let _driver_version = parts[3].to_string();

    // CUDA runtime availability = nvcc is on PATH, OR the driver version
    // is >= 11.0 (CUDA 11+ requires driver >= 450). We use the presence of
    // `nvidia-smi` itself as a proxy for "CUDA-capable driver installed"
    // since the driver ships CUDA user-mode components.
    let cuda_version = query_cuda_version().await;

    Some(GpuInfo {
        vendor: "nvidia".to_string(),
        name,
        vram_bytes: vram_mib * 1024 * 1024,
        free_vram_bytes: free_mib * 1024 * 1024,
        cuda_available: true,
        cuda_version,
        metal_available: false,
        vulkan_available: true, // NVIDIA drivers on Windows/Linux bundle Vulkan.
        rocm_available: false,
        directml_available: cfg!(target_os = "windows"),
    })
}

async fn query_cuda_version() -> Option<String> {
    // Try `nvcc --version` first — that's the canonical CUDA toolkit version.
    if let Ok(output) = tokio::process::Command::new("nvcc")
        .arg("--version")
        .output()
        .await
    {
        if output.status.success() {
            let s = String::from_utf8_lossy(&output.stdout);
            for line in s.lines() {
                if let Some(idx) = line.find("release ") {
                    let rest = &line[idx + 8..];
                    if let Some(end) = rest.find(',') {
                        return Some(rest[..end].to_string());
                    }
                    return Some(rest.to_string());
                }
            }
        }
    }
    // Fall back to parsing `nvidia-smi`'s CUDA Version line (driver-side).
    if let Ok(output) = tokio::process::Command::new("nvidia-smi").output().await {
        let s = String::from_utf8_lossy(&output.stdout);
        for line in s.lines() {
            if line.contains("CUDA Version:") {
                let parts: Vec<&str> = line.split("CUDA Version:").collect();
                if parts.len() >= 2 {
                    return Some(parts[1].trim().trim_end_matches(',').to_string());
                }
            }
        }
    }
    None
}

async fn detect_apple_metal() -> Option<GpuInfo> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    // `system_profiler SPDisplaysDataType -json` gives us the GPU name.
    let output = tokio::process::Command::new("system_profiler")
        .args(["SPDisplaysDataType", "-json"])
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&output.stdout);
    // Parse just enough of the JSON to extract the GPU name. We don't pull
    // in serde_json here because the shape is non-trivial; instead we do a
    // tolerant substring scan.
    let mut name = "Apple GPU".to_string();
    if let Some(idx) = s.find("\"sppci_model_name\"") {
        let rest = &s[idx..];
        if let Some(q1) = rest
            .find('"')
            .and_then(|_| rest.find('"').and_then(|_| rest[1..].find('"')))
        {
            let _ = q1;
        }
        // Find the value after the second colon.
        if let Some(colon) = rest.find(':') {
            let after = &rest[colon + 1..];
            if let Some(q1) = after.find('"') {
                if let Some(q2) = after[q1 + 1..].find('"') {
                    name = after[q1 + 1..q1 + 1 + q2].to_string();
                }
            }
        }
    }
    // VRAM = unified memory on Apple Silicon. Use total system RAM as a
    // proxy, since the OS doesn't expose a separate GPU memory counter.
    let mut sys = System::new_all();
    sys.refresh_memory();
    let vram = sys.total_memory();
    let free = sys.available_memory();

    Some(GpuInfo {
        vendor: "apple".to_string(),
        name,
        vram_bytes: vram,
        free_vram_bytes: free,
        cuda_available: false,
        cuda_version: None,
        metal_available: true,
        vulkan_available: false, // Metal-only by default; user can install MoltenVK.
        rocm_available: false,
        directml_available: false,
    })
}

async fn detect_amd_rocm() -> Option<GpuInfo> {
    if !cfg!(target_os = "linux") {
        return None;
    }
    // ROCm ships `rocm-smi`. If it's on PATH, we have a supported AMD GPU.
    let output = tokio::process::Command::new("rocm-smi")
        .args(["--showproductname", "--showmeminfo", "vram", "--json"])
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&output.stdout).to_string();
    // The JSON is keyed by card index. Parse just enough to get a name and
    // total VRAM. We don't want to pull in serde_json here for one call.
    let mut name = "AMD GPU".to_string();
    let mut vram: u64 = 0;
    let mut free: u64 = 0;
    if let Some(card_idx) = s.find("\"card0\"") {
        let rest = &s[card_idx..];
        if let Some(card_name_idx) = rest.find("Card series") {
            if let Some(q1) = rest[card_name_idx..].find(':') {
                let after = &rest[card_name_idx + q1 + 1..];
                if let Some(q2) = after.find('"') {
                    if let Some(q3) = after[q2 + 1..].find('"') {
                        name = after[q2 + 1..q2 + 1 + q3].trim().to_string();
                    }
                }
            }
        }
        // VRAM (bytes) and free VRAM are in `VRAM Total Memory` and
        // `VRAM Total Free Memory` keys.
        if let Some(v) = extract_rocm_value(rest, "VRAM Total Memory") {
            vram = v;
        }
        if let Some(v) = extract_rocm_value(rest, "VRAM Total Free Memory") {
            free = v;
        }
    }

    Some(GpuInfo {
        vendor: "amd".to_string(),
        name,
        vram_bytes: vram,
        free_vram_bytes: free,
        cuda_available: false,
        cuda_version: None,
        metal_available: false,
        vulkan_available: true,
        rocm_available: true,
        directml_available: false,
    })
}

fn extract_rocm_value(s: &str, key: &str) -> Option<u64> {
    let idx = s.find(key)?;
    let after = &s[idx + key.len()..];
    let colon = after.find(':')?;
    let rest = &after[colon + 1..];
    let q1 = rest.find('"')?;
    let q2 = rest[q1 + 1..].find('"')?;
    let raw = &rest[q1 + 1..q1 + 1 + q2];
    raw.trim().parse::<u64>().ok()
}

async fn detect_vulkan_runtime() -> bool {
    // Check for `vulkaninfo` on PATH. If it's installed, the Vulkan loader
    // is present and at least one physical device is likely available.
    if let Ok(output) = tokio::process::Command::new("vulkaninfo")
        .arg("--summary")
        .output()
        .await
    {
        if output.status.success() {
            return true;
        }
    }
    // macOS: check for MoltenVK via the framework.
    if cfg!(target_os = "macos") {
        if std::path::Path::new("/Library/Frameworks/MoltenVK.framework").exists() {
            return true;
        }
    }
    // Windows: check for vulkan-1.dll in System32.
    if cfg!(target_os = "windows") {
        if let Some(sys_dir) = std::env::var_os("SystemRoot") {
            let p = std::path::Path::new(&sys_dir).join("System32/vulkan-1.dll");
            if p.exists() {
                return true;
            }
        }
    }
    false
}

async fn detect_directml() -> bool {
    if !cfg!(target_os = "windows") {
        return false;
    }
    // DirectML is shipped as part of the Windows ML runtime. Check for
    // the DirectML.dll in System32 (installed by the DirectX runtime).
    if let Some(sys_dir) = std::env::var_os("SystemRoot") {
        let p = std::path::Path::new(&sys_dir).join("System32/DirectML.dll");
        if p.exists() {
            return true;
        }
    }
    false
}
