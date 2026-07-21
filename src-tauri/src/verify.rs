//! Download verification — file size + checksum (SHA-256).
//!
//! After a download completes, the frontend calls `verify_download` with the
//! expected size and (optionally) the expected SHA-256. We compute the
//! actual values from the file on disk and return a structured result. No
//! mock values, no shortcuts.

use serde::Serialize;
use std::path::Path;
use tokio::io::AsyncReadExt;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationResult {
    /// Path of the file we verified.
    pub path: String,
    /// Actual file size on disk, in bytes.
    pub actual_size_bytes: u64,
    /// Expected size, if the caller supplied one.
    pub expected_size_bytes: Option<u64>,
    pub size_matches: bool,
    /// Actual SHA-256 hex digest (lowercase). Always computed.
    pub actual_sha256: String,
    /// Expected SHA-256 hex digest, if the caller supplied one.
    pub expected_sha256: Option<String>,
    pub sha256_matches: bool,
    pub ok: bool,
    pub error: Option<String>,
}

/// Verify a downloaded file. Computes SHA-256 by streaming the file in 1 MiB
/// chunks — works for multi-GB GGUF files without loading them into RAM.
///
/// `expected_sha256` is matched case-insensitively (Hugging Face uses
/// lowercase, but the user may have copied an uppercase digest).
pub async fn verify_download(
    path: &Path,
    expected_size_bytes: Option<u64>,
    expected_sha256: Option<String>,
) -> Result<VerificationResult, String> {
    let path_str = path.to_string_lossy().to_string();

    let meta = match tokio::fs::metadata(path).await {
        Ok(m) => m,
        Err(e) => {
            return Ok(VerificationResult {
                path: path_str,
                actual_size_bytes: 0,
                expected_size_bytes,
                size_matches: false,
                actual_sha256: String::new(),
                expected_sha256,
                sha256_matches: false,
                ok: false,
                error: Some(format!("File not found: {}", e)),
            });
        }
    };
    let actual_size = meta.len();
    let size_matches = match expected_size_bytes {
        Some(expected) => actual_size == expected,
        None => true, // No expectation supplied — can't fail.
    };

    // Compute SHA-256 by streaming.
    let mut file = match tokio::fs::File::open(path).await {
        Ok(f) => f,
        Err(e) => {
            return Ok(VerificationResult {
                path: path_str,
                actual_size_bytes: actual_size,
                expected_size_bytes,
                size_matches,
                actual_sha256: String::new(),
                expected_sha256,
                sha256_matches: false,
                ok: false,
                error: Some(format!("Failed to open file: {}", e)),
            });
        }
    };

    // Use the `sha2` crate — already a transitive dependency via reqwest's
    // rustls-tls feature, but we declare it explicitly in Cargo.toml.
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1024 * 1024]; // 1 MiB buffer
    loop {
        let n = file.read(&mut buf).await.map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let digest = hasher.finalize();
    let actual_sha256 = format!("{:x}", digest);

    let sha256_matches = match &expected_sha256 {
        Some(expected) => actual_sha256.eq_ignore_ascii_case(expected.trim()),
        None => true,
    };

    let ok = size_matches && sha256_matches;

    Ok(VerificationResult {
        path: path_str,
        actual_size_bytes: actual_size,
        expected_size_bytes,
        size_matches,
        actual_sha256,
        expected_sha256,
        sha256_matches,
        ok,
        error: if ok {
            None
        } else if !size_matches {
            Some(format!(
                "Size mismatch: expected {} bytes, got {} bytes",
                expected_size_bytes.unwrap_or(0),
                actual_size
            ))
        } else {
            Some("SHA-256 mismatch: the file may be corrupted or tampered with.".to_string())
        },
    })
}
