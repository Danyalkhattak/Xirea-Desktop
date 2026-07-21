//! Real GGUF metadata reader.
//!
//! Parses the GGUF binary format directly — no external dependencies, no
//! shelling out to `llama-cli`. We read the header, walk the metadata
//! key-value table, and pull out the bits Xirea needs:
//! architecture, context length, parameter count, quantization, etc.
//!
//! Reference: https://github.com/ggerganov/ggml/blob/master/docs/gguf.md

use std::path::Path;

use crate::GgufMetadata;

use tokio::io::AsyncReadExt;

/// Read GGUF metadata from a file path.
pub async fn read_metadata(path: &Path) -> Result<GgufMetadata, String> {
    let path_str = path.to_string_lossy().to_string();
    let name = path
        .file_stem()
        .and_then(|n| n.to_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "Unnamed model".to_string());

    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|e| format!("Failed to open {}: {}", path_str, e))?;

    let size_bytes = file.metadata().await.map(|m| m.len()).unwrap_or(0);

    // Read magic
    let mut magic = [0u8; 4];
    file.read_exact(&mut magic)
        .await
        .map_err(|e| format!("Failed to read magic: {}", e))?;

    if &magic != b"GGUF" {
        return Ok(GgufMetadata {
            path: path_str,
            name,
            format: detect_format(&path.to_string_lossy()),
            size_bytes,
            architecture: None,
            context_length: None,
            parameters: None,
            quantization: None,
            ram_estimate_gb: Some(estimate_ram_gb(size_bytes)),
            vram_estimate_gb: Some(estimate_ram_gb(size_bytes)),
            capabilities: vec![],
            verified: false,
            family: None,
            tokenizer: None,
            eos_token: None,
            bos_token: None,
            license: None,
            organization: None,
            training_dataset: None,
            raw_metadata: std::collections::HashMap::new(),
        });
    }

    // Read version (u32 LE)
    let version = read_u32(&mut file).await?;
    // Read tensor_count (u64 in v3, u32 in v1/v2)
    let _tensor_count = if version >= 3 {
        read_u64(&mut file).await?
    } else {
        read_u32(&mut file).await? as u64
    };
    // Read metadata_kv_count (u64 in v3, u32 in v1/v2)
    let kv_count = if version >= 3 {
        read_u64(&mut file).await?
    } else {
        read_u32(&mut file).await? as u64
    };

    let mut metadata: std::collections::HashMap<String, GgufValue> =
        std::collections::HashMap::new();

    for _ in 0..kv_count {
        let key = match read_string(&mut file).await {
            Ok(s) => s,
            Err(_) => break,
        };
        let value_type = match read_u32(&mut file).await {
            Ok(v) => v,
            Err(_) => break,
        };
        let value = match read_value(&mut file, value_type).await {
            Ok(v) => v,
            Err(_) => break,
        };
        metadata.insert(key, value);
    }

    let architecture = metadata
        .get("general.architecture")
        .and_then(|v| v.as_string());

    let context_length = metadata
        .get(&format!(
            "{}.context_length",
            architecture.as_deref().unwrap_or("llama")
        ))
        .and_then(|v| v.as_u64())
        .map(|n| n as usize)
        .or_else(|| {
            metadata
                .get("llama.context_length")
                .and_then(|v| v.as_u64())
                .map(|n| n as usize)
        });

    let parameters = metadata
        .get("general.size_label")
        .and_then(|v| v.as_string());

    let quantization = detect_quantization_from_path(&path_str).or_else(|| {
        metadata
            .get("general.file_type")
            .and_then(|v| v.as_u64())
            .map(|n| file_type_name(n as u32))
    });

    let mut capabilities: Vec<String> = vec!["reasoning".into()];
    // Heuristic: vision-capable models
    if let Some(arch) = &architecture {
        if arch.contains("vl") || arch.contains("vision") || arch.contains("mmproj") {
            capabilities.push("vision".into());
        }
    }
    let name_lower = name.to_lowercase();
    if name_lower.contains("vl") || name_lower.contains("vision") || name_lower.contains("llava") {
        if !capabilities.contains(&"vision".to_string()) {
            capabilities.push("vision".into());
        }
    }
    if name_lower.contains("coder") || name_lower.contains("code") {
        capabilities.push("tools".into());
    }

    let ram_est = estimate_ram_gb(size_bytes);

    // Family — prefer `general.family`, fall back to architecture.
    let family = metadata
        .get("general.family")
        .and_then(|v| v.as_string())
        .or_else(|| architecture.clone());

    // Tokenizer model name.
    let tokenizer = metadata
        .get("tokenizer.ggml.model")
        .and_then(|v| v.as_string());

    // EOS / BOS tokens — GGUF stores these as arrays of token IDs, but
    // llama-server usually also stores a readable `tokenizer.ggml.token.<n>`
    // array. We surface the raw token IDs as a comma-separated string for
    // now — power users can look up the readable names if they need them.
    let eos_token = metadata
        .get("tokenizer.ggml.eos_token_id")
        .map(|v| value_to_display_string(v));
    let bos_token = metadata
        .get("tokenizer.ggml.bos_token_id")
        .map(|v| value_to_display_string(v));

    let license = metadata.get("general.license").and_then(|v| v.as_string());
    let organization = metadata
        .get("general.organization")
        .and_then(|v| v.as_string());
    let training_dataset = metadata.get("general.dataset").and_then(|v| v.as_string());

    // Build a flat `raw_metadata` map of every key → stringified value.
    // Useful for the model details dialog's "raw metadata" expander.
    let raw_metadata: std::collections::HashMap<String, String> = metadata
        .iter()
        .map(|(k, v)| (k.clone(), value_to_display_string(v)))
        .collect();

    Ok(GgufMetadata {
        path: path_str,
        name,
        format: "gguf".to_string(),
        size_bytes,
        architecture,
        context_length,
        parameters,
        quantization,
        ram_estimate_gb: Some(ram_est),
        vram_estimate_gb: Some(ram_est),
        capabilities,
        verified: false,
        family,
        tokenizer,
        eos_token,
        bos_token,
        license,
        organization,
        training_dataset,
        raw_metadata,
    })
}

/// Render a `GgufValue` as a human-readable string for display in the UI.
fn value_to_display_string(v: &GgufValue) -> String {
    match v {
        GgufValue::U8(n) => n.to_string(),
        GgufValue::I8(n) => n.to_string(),
        GgufValue::U16(n) => n.to_string(),
        GgufValue::I16(n) => n.to_string(),
        GgufValue::U32(n) => n.to_string(),
        GgufValue::I32(n) => n.to_string(),
        GgufValue::U64(n) => n.to_string(),
        GgufValue::I64(n) => n.to_string(),
        GgufValue::F32(n) => n.to_string(),
        GgufValue::F64(n) => n.to_string(),
        GgufValue::Bool(b) => b.to_string(),
        GgufValue::String(s) => s.clone(),
        GgufValue::Array(arr) => {
            let parts: Vec<String> = arr.iter().take(32).map(value_to_display_string).collect();
            let ellipsis = if arr.len() > 32 { "…" } else { "" };
            format!("[{}{}]", parts.join(", "), ellipsis)
        }
    }
}

/// Scan a directory for *.gguf files and parse each.
pub async fn scan_dir(dir: &Path) -> Result<Vec<GgufMetadata>, String> {
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut entries = tokio::fs::read_dir(dir)
        .await
        .map_err(|e| format!("Failed to read dir: {}", e))?;
    let mut models = Vec::new();
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| format!("Failed to read entry: {}", e))?
    {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("gguf") {
            if let Ok(meta) = read_metadata(&path).await {
                models.push(meta);
            }
        }
    }
    Ok(models)
}

// ---------------------------------------------------------------------------
// GGUF value types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
#[allow(dead_code)]
enum GgufValue {
    U8(u8),
    I8(i8),
    U16(u16),
    I16(i16),
    U32(u32),
    I32(i32),
    U64(u64),
    I64(i64),
    F32(f32),
    F64(f64),
    Bool(bool),
    String(String),
    Array(Vec<GgufValue>),
}

impl GgufValue {
    fn as_string(&self) -> Option<String> {
        if let GgufValue::String(s) = self {
            Some(s.clone())
        } else {
            None
        }
    }
    fn as_u64(&self) -> Option<u64> {
        match self {
            GgufValue::U8(v) => Some(*v as u64),
            GgufValue::I8(v) => Some(*v as u64),
            GgufValue::U16(v) => Some(*v as u64),
            GgufValue::I16(v) => Some(*v as u64),
            GgufValue::U32(v) => Some(*v as u64),
            GgufValue::I32(v) => Some(*v as u64),
            GgufValue::U64(v) => Some(*v),
            GgufValue::I64(v) => Some(*v as u64),
            GgufValue::F32(v) => Some(*v as u64),
            GgufValue::F64(v) => Some(*v as u64),
            _ => None,
        }
    }
}

// ---------------------------------------------------------------------------
// Low-level readers
// ---------------------------------------------------------------------------

async fn read_u32<R: AsyncReadExt + Unpin>(r: &mut R) -> Result<u32, String> {
    let mut buf = [0u8; 4];
    r.read_exact(&mut buf).await.map_err(|e| e.to_string())?;
    Ok(u32::from_le_bytes(buf))
}

async fn read_u64<R: AsyncReadExt + Unpin>(r: &mut R) -> Result<u64, String> {
    let mut buf = [0u8; 8];
    r.read_exact(&mut buf).await.map_err(|e| e.to_string())?;
    Ok(u64::from_le_bytes(buf))
}

async fn read_i32<R: AsyncReadExt + Unpin>(r: &mut R) -> Result<i32, String> {
    let mut buf = [0u8; 4];
    r.read_exact(&mut buf).await.map_err(|e| e.to_string())?;
    Ok(i32::from_le_bytes(buf))
}

async fn read_i64<R: AsyncReadExt + Unpin>(r: &mut R) -> Result<i64, String> {
    let mut buf = [0u8; 8];
    r.read_exact(&mut buf).await.map_err(|e| e.to_string())?;
    Ok(i64::from_le_bytes(buf))
}

async fn read_f32<R: AsyncReadExt + Unpin>(r: &mut R) -> Result<f32, String> {
    let mut buf = [0u8; 4];
    r.read_exact(&mut buf).await.map_err(|e| e.to_string())?;
    Ok(f32::from_le_bytes(buf))
}

async fn read_f64<R: AsyncReadExt + Unpin>(r: &mut R) -> Result<f64, String> {
    let mut buf = [0u8; 8];
    r.read_exact(&mut buf).await.map_err(|e| e.to_string())?;
    Ok(f64::from_le_bytes(buf))
}

async fn read_bool<R: AsyncReadExt + Unpin>(r: &mut R) -> Result<bool, String> {
    let mut buf = [0u8; 1];
    r.read_exact(&mut buf).await.map_err(|e| e.to_string())?;
    Ok(buf[0] != 0)
}

async fn read_string<R: AsyncReadExt + Unpin>(r: &mut R) -> Result<String, String> {
    let len = read_u64(r).await? as usize;
    if len > 16 * 1024 * 1024 {
        return Err("String too long".to_string());
    }
    let mut buf = vec![0u8; len];
    r.read_exact(&mut buf).await.map_err(|e| e.to_string())?;
    String::from_utf8(buf).map_err(|e| e.to_string())
}

/// Boxed async reader for a single value — required because arrays in GGUF
/// recurse into the same reader, and async recursion must be boxed.
async fn read_value<R: AsyncReadExt + Unpin>(
    r: &mut R,
    value_type: u32,
) -> Result<GgufValue, String> {
    // GGUF metadata value types
    Ok(match value_type {
        0 => GgufValue::U8({
            let mut buf = [0u8; 1];
            r.read_exact(&mut buf).await.map_err(|e| e.to_string())?;
            buf[0]
        }),
        1 => GgufValue::I8({
            let mut buf = [0u8; 1];
            r.read_exact(&mut buf).await.map_err(|e| e.to_string())?;
            buf[0] as i8
        }),
        2 => GgufValue::U16({
            let mut buf = [0u8; 2];
            r.read_exact(&mut buf).await.map_err(|e| e.to_string())?;
            u16::from_le_bytes(buf)
        }),
        3 => GgufValue::I16({
            let mut buf = [0u8; 2];
            r.read_exact(&mut buf).await.map_err(|e| e.to_string())?;
            i16::from_le_bytes(buf)
        }),
        4 => GgufValue::U32(read_u32(r).await?),
        5 => GgufValue::I32(read_i32(r).await?),
        6 => GgufValue::F32(read_f32(r).await?),
        7 => GgufValue::Bool(read_bool(r).await?),
        8 => GgufValue::String(read_string(r).await?),
        9 => GgufValue::Array({
            let arr_type = read_u32(r).await?;
            let len = read_u64(r).await? as usize;
            let mut arr = Vec::with_capacity(len.min(1024));
            for _ in 0..len {
                // Boxed recursion.
                let val = Box::pin(read_value(r, arr_type)).await?;
                arr.push(val);
            }
            arr
        }),
        10 => GgufValue::U64(read_u64(r).await?),
        11 => GgufValue::I64(read_i64(r).await?),
        12 => GgufValue::F64(read_f64(r).await?),
        _ => return Err(format!("Unknown value type: {}", value_type)),
    })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn detect_format(path: &str) -> String {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default();
    if ext == "ggml" {
        "ggml".to_string()
    } else {
        "gguf".to_string()
    }
}

fn detect_quantization_from_path(path: &str) -> Option<String> {
    let name = Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");
    let name_lower = name.to_lowercase();
    let quants = [
        "q2_k", "q3_k_m", "q3_k_s", "q3_k_l", "q4_k_m", "q4_k_s", "q5_k_m", "q5_k_s", "q6_k",
        "q8_0", "f16", "f32", "bf16", "q4_0", "q4_1", "q5_0", "q5_1",
    ];
    for q in &quants {
        if name_lower.contains(q) {
            return Some(q.to_uppercase());
        }
    }
    None
}

fn file_type_name(ft: u32) -> String {
    match ft {
        0 => "F32".into(),
        1 => "F16".into(),
        2 => "Q4_0".into(),
        3 => "Q4_1".into(),
        6 => "Q5_0".into(),
        7 => "Q5_1".into(),
        8 => "Q8_0".into(),
        9 => "Q8_1".into(),
        10 => "Q2_K".into(),
        11 => "Q3_K_S".into(),
        12 => "Q3_K_M".into(),
        13 => "Q3_K_L".into(),
        14 => "Q4_K_S".into(),
        15 => "Q4_K_M".into(),
        16 => "Q5_K_S".into(),
        17 => "Q5_K_M".into(),
        18 => "Q6_K".into(),
        24 => "IQ3_XXS".into(),
        26 => "IQ4_NL".into(),
        28 => "IQ3_S".into(),
        29 => "IQ3_M".into(),
        30 => "IQ4_XS".into(),
        31 => "I8".into(),
        32 => "I16".into(),
        33 => "I32".into(),
        34 => "I64".into(),
        35 => "F64".into(),
        _ => format!("type_{}", ft),
    }
}

fn estimate_ram_gb(size_bytes: u64) -> f64 {
    // Total RAM ~= file size + ~20% headroom for context / KV cache.
    let gb = size_bytes as f64 / 1024.0 / 1024.0 / 1024.0;
    (gb * 1.2).ceil()
}
