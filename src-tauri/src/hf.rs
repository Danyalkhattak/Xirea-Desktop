//! Real Hugging Face Hub API client.
//!
//! Uses the public Hub HTTP API:
//!   - List models with filters:    https://huggingface.co/api/models
//!   - Get a single model:          https://huggingface.co/api/models/{id}
//!   - List files in a model repo:  https://huggingface.co/api/models/{id}/tree/main
//!
//! No API key required for public models — the user can browse and download
//! without authentication. Authenticated downloads (gated models) are out of
//! scope for now; the request will fail with a clear error message.

use std::time::Duration;

use serde::Deserialize;

use crate::{HfFileDto, HfModelDto};

const HF_BASE: &str = "https://huggingface.co/api";

/// Search models. If `query` is None, returns the trending / sort list.
///
/// The `sort` parameter accepts friendly names ("trending", "newest",
/// "downloads", "verified") which are mapped to the actual HF API sort
/// values ("trendingScore", "lastModified", "downloads", "likes").
/// "verified" is treated as "likes" here — the frontend filters the
/// results client-side by the `verified` flag.
///
/// After fetching the list, we ALSO fetch each model's file tree (in
/// parallel, with a concurrency limit) so that file sizes are available
/// on the search-result cards immediately. This is what makes the
/// "Size: 4.2 GB" tile work without the user having to open the detail
/// drawer first.
pub async fn search(
    query: Option<String>,
    sort: Option<String>,
    direction: Option<String>,
    limit: Option<u32>,
    tags: Option<Vec<String>>,
) -> Result<Vec<HfModelDto>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;

    let mut url = format!("{}/models", HF_BASE);
    let mut params: Vec<String> = Vec::new();
    if let Some(q) = &query {
        if !q.is_empty() {
            params.push(format!("search={}", urlencode(q)));
        }
    }
    // Map friendly sort names to the actual HF API sort values.
    let api_sort = match sort.as_deref() {
        Some("trending") => "trendingScore",
        Some("newest") => "lastModified",
        Some("downloads") => "downloads",
        Some("likes") => "likes",
        Some("verified") => "likes", // verified is a client-side filter; sort by likes server-side.
        Some(other) => other,        // already a valid API sort
        None => "trendingScore",
    };
    params.push(format!("sort={}", urlencode(api_sort)));
    // HF API uses "-1" for descending and "1" for ascending. Default to descending.
    let dir_str = direction.unwrap_or_else(|| "-1".to_string());
    params.push(format!("direction={}", dir_str));
    params.push(format!("limit={}", limit.unwrap_or(50)));
    // Add filter by tags (pipeline_tag, library, etc.)
    if let Some(tags) = &tags {
        for t in tags {
            params.push(format!("filter={}", urlencode(t)));
        }
    }
    if !params.is_empty() {
        url.push('?');
        url.push_str(&params.join("&"));
    }

    let response = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("HTTP {}: {}", status, truncate_str(&text, 500)));
    }
    let raw: Vec<HfApiModel> = response.json().await.map_err(|e| e.to_string())?;
    let mut dtos: Vec<HfModelDto> = raw.into_iter().map(|m| convert_model(m)).collect();

    // Enrich each model with its real file tree (sizes + URLs) in parallel.
    // We use a bounded concurrency to avoid hammering the HF API.
    enrich_with_files(&client, &mut dtos).await;

    Ok(dtos)
}

/// Fetch the file tree for every model in `dtos` in parallel (max 8 at a
/// time). Mutates each model in place — replaces `files` with the real tree
/// (which includes sizes), and recomputes `quantizations` from the file list.
async fn enrich_with_files(client: &reqwest::Client, dtos: &mut [HfModelDto]) {
    use futures_util::stream::{FuturesUnordered, StreamExt};
    use parking_lot::Mutex as PMutex;
    use std::sync::Arc;

    // Collect (index, model_id) pairs we want to enrich.
    let tasks: Vec<(usize, String)> = dtos
        .iter()
        .enumerate()
        .map(|(i, m)| (i, m.id.clone()))
        .collect();

    // Results: Option<Vec<HfFileDto>> — None if fetch failed.
    let results: Arc<PMutex<Vec<Option<Vec<HfFileDto>>>>> =
        Arc::new(PMutex::new(vec![None; tasks.len()]));

    let mut futures = FuturesUnordered::new();
    for (idx, model_id) in tasks {
        let client = client.clone();
        let results = results.clone();
        futures.push(tokio::spawn(async move {
            match files_with_client(&client, &model_id).await {
                Ok(files) => {
                    results.lock()[idx] = Some(files);
                }
                Err(_) => {
                    results.lock()[idx] = None;
                }
            }
        }));
    }
    // Wait for all (with a hard 10s timeout so we never hang the search).
    let _ = tokio::time::timeout(Duration::from_secs(10), async {
        while futures.next().await.is_some() {}
    })
    .await;

    // Apply the results.
    let results = results.lock();
    for (i, opt) in results.iter().enumerate() {
        if let Some(files) = opt {
            dtos[i].files = files.clone();
            // Recompute quantizations from the real file list.
            let mut quants: Vec<String> = Vec::new();
            for f in &dtos[i].files {
                if let Some(q) = detect_quant_from_filename(&f.rfilename) {
                    if !quants.contains(&q) {
                        quants.push(q);
                    }
                }
            }
            if !quants.is_empty() {
                dtos[i].quantizations = quants;
            }
        }
    }
}

/// Fetch a single model's full metadata.
pub async fn model(model_id: &str) -> Result<HfModelDto, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    // Use encode_model_id_path (preserves `/`) — HF rejects `%2F` in repo names.
    let url = format!("{}/models/{}", HF_BASE, encode_model_id_path(model_id));
    let response = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("HTTP {}: {}", status, truncate_str(&text, 500)));
    }
    let raw: HfApiModel = response.json().await.map_err(|e| e.to_string())?;
    let mut dto = convert_model(raw);
    // Enrich with file list.
    if let Ok(files) = files(model_id).await {
        dto.files = files;
        // Auto-detect quantizations from file names.
        let mut quants: Vec<String> = Vec::new();
        for f in &dto.files {
            if let Some(q) = detect_quant_from_filename(&f.rfilename) {
                if !quants.contains(&q) {
                    quants.push(q);
                }
            }
        }
        if !quants.is_empty() {
            dto.quantizations = quants;
        }
    }
    Ok(dto)
}

/// List files in a model's main branch.
pub async fn files(model_id: &str) -> Result<Vec<HfFileDto>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    files_with_client(&client, model_id).await
}

/// Same as `files` but takes an existing reqwest client (so the search
/// enricher can reuse a single client across many parallel fetches).
async fn files_with_client(
    client: &reqwest::Client,
    model_id: &str,
) -> Result<Vec<HfFileDto>, String> {
    // The HF tree endpoint returns the file list with sizes (and recursively
    // if asked). We try /tree/main first, then fall back to /tree/master for
    // legacy repos that still use the master branch. If both fail, we use the
    // siblings from the model metadata (no sizes, but at least the file list).
    // encode_model_id_path preserves the `/` in `org/name` — HF rejects %2F.
    let encoded = encode_model_id_path(model_id);
    let url = format!("{}/models/{}/tree/main", HF_BASE, encoded);
    let response = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    if !status.is_success() {
        // Try "master" branch as fallback.
        let url2 = format!("{}/models/{}/tree/master", HF_BASE, encoded);
        let resp2 = client.get(&url2).send().await.map_err(|e| e.to_string())?;
        if !resp2.status().is_success() {
            // Final fallback: use the siblings endpoint which always works
            // for public models (returns just the filenames, no sizes).
            let url3 = format!("{}/models/{}", HF_BASE, encoded);
            let resp3 = client.get(&url3).send().await.map_err(|e| e.to_string())?;
            if !resp3.status().is_success() {
                let text = resp3.text().await.unwrap_or_default();
                return Err(format!("HTTP {}: {}", status, truncate_str(&text, 500)));
            }
            let v: serde_json::Value = resp3.json().await.map_err(|e| e.to_string())?;
            let siblings = v["siblings"]
                .as_array()
                .ok_or_else(|| "Missing 'siblings' array".to_string())?;
            return Ok(siblings
                .iter()
                .filter_map(|s| {
                    let rfilename = s["rfilename"].as_str()?.to_string();
                    Some(convert_file(
                        HfApiFile {
                            rfilename: Some(rfilename),
                            path: None,
                            size: None,
                            url: None,
                        },
                        model_id,
                    ))
                })
                .collect());
        }
        let raw: Vec<HfApiFile> = resp2.json().await.map_err(|e| e.to_string())?;
        return Ok(raw.into_iter().map(|f| convert_file(f, model_id)).collect());
    }
    let raw: Vec<HfApiFile> = response.json().await.map_err(|e| e.to_string())?;
    Ok(raw.into_iter().map(|f| convert_file(f, model_id)).collect())
}

// ---------------------------------------------------------------------------
// HF API response shapes
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct HfApiModel {
    #[serde(rename = "_id", default)]
    id_field: Option<String>,
    id: Option<String>,
    #[serde(default)]
    author: Option<String>,
    #[serde(default)]
    sha: Option<String>,
    #[serde(default, rename = "lastModified")]
    last_modified: Option<String>,
    #[serde(default, rename = "library_name")]
    library_name: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default, rename = "pipeline_tag")]
    pipeline_tag: Option<String>,
    #[serde(default)]
    downloads: u64,
    #[serde(default)]
    likes: u64,
    /// The HF list endpoint does not return a `trending` boolean — it returns
    /// a numeric `trendingScore`. We derive `trending` from that.
    #[serde(default, rename = "trendingScore")]
    trending_score: Option<f64>,
    #[serde(default, rename = "cardData")]
    card_data: Option<HfCardData>,
    #[serde(default)]
    siblings: Vec<HfApiFile>,
    #[serde(default)]
    config: Option<serde_json::Value>,
    #[serde(default)]
    private: bool,
    #[serde(default)]
    gated: Option<serde_json::Value>,
}

#[derive(Debug, Default, Deserialize)]
#[allow(dead_code)]
struct HfCardData {
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    model_type: Option<String>,
    #[serde(default)]
    context_length: Option<u64>,
    #[serde(default)]
    max_position_embeddings: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct HfApiFile {
    rfilename: Option<String>,
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    size: Option<u64>,
    #[serde(default)]
    url: Option<String>,
}

fn convert_model(m: HfApiModel) -> HfModelDto {
    let id = m.id.unwrap_or_else(|| m.id_field.unwrap_or_default());
    let author = m.author.unwrap_or_else(|| {
        id.split('/')
            .next()
            .map(|s| s.to_string())
            .unwrap_or_default()
    });
    let last_modified = m.last_modified.unwrap_or_default();
    let card = m.card_data.unwrap_or_default();
    let description = card.description.or_else(|| {
        m.config
            .as_ref()
            .and_then(|c| c.get("description"))
            .and_then(|d| d.as_str())
            .map(|s| s.to_string())
    });
    let context_length = card
        .context_length
        .or(card.max_position_embeddings)
        .or_else(|| {
            // The single-model API also exposes a `config` object with
            // `max_position_embeddings` (the actual context window size).
            m.config
                .as_ref()
                .and_then(|c| c.get("max_position_embeddings"))
                .and_then(|v| v.as_u64())
        })
        .or_else(|| {
            // Some models put it under config.text_config.max_position_embeddings.
            m.config
                .as_ref()
                .and_then(|c| c.get("text_config"))
                .and_then(|tc| tc.get("max_position_embeddings"))
                .and_then(|v| v.as_u64())
        })
        .map(|n| n as usize);
    // Pass the model id into convert_file so the URL is built correctly.
    let model_id_for_files = id.clone();
    let files: Vec<HfFileDto> = m
        .siblings
        .into_iter()
        .map(|f| convert_file(f, &model_id_for_files))
        .collect();

    // Detect quantizations from sibling file names.
    let mut quants: Vec<String> = Vec::new();
    for f in &files {
        if let Some(q) = detect_quant_from_filename(&f.rfilename) {
            if !quants.contains(&q) {
                quants.push(q);
            }
        }
    }

    let verified = id
        .split('/')
        .next()
        .map(|a| is_verified_author(a))
        .unwrap_or(false);

    // Derive a `trending` boolean from the numeric trendingScore (threshold: > 0).
    let trending = m.trending_score.map(|s| s > 0.0).unwrap_or(false);

    HfModelDto {
        id,
        author,
        sha: m.sha,
        last_modified,
        library: m.library_name,
        tags: m.tags,
        pipeline_tag: m.pipeline_tag,
        downloads: m.downloads,
        likes: m.likes,
        trending,
        verified,
        description,
        context_length,
        quantizations: quants,
        files,
    }
}

fn convert_file(f: HfApiFile, model_id: &str) -> HfFileDto {
    let rfilename = f.rfilename.unwrap_or_else(|| f.path.unwrap_or_default());
    let url = f.url.unwrap_or_else(|| {
        format!(
            "https://huggingface.co/{}/resolve/main/{}",
            model_id, rfilename
        )
    });
    HfFileDto {
        rfilename: rfilename.clone(),
        size_bytes: f.size,
        url: Some(url),
    }
}

fn detect_quant_from_filename(name: &str) -> Option<String> {
    let lower = name.to_lowercase();
    if !lower.ends_with(".gguf") {
        return None;
    }
    let quants = [
        "q2_k", "q3_k_m", "q3_k_s", "q3_k_l", "q4_k_m", "q4_k_s", "q5_k_m", "q5_k_s", "q6_k",
        "q8_0", "f16", "f32", "bf16", "q4_0", "q4_1", "q5_0", "q5_1", "iq2_xx", "iq3_xx", "iq3_s",
        "iq3_m", "iq4_xs", "iq4_nl",
    ];
    for q in &quants {
        if lower.contains(q) {
            return Some(q.to_uppercase());
        }
    }
    None
}

fn is_verified_author(author: &str) -> bool {
    matches!(
        author,
        "meta-llama"
            | "mistralai"
            | "google"
            | "microsoft"
            | "Qwen"
            | "nomic-ai"
            | "deepseek-ai"
            | "allenai"
            | "tiiuae"
            | "bigcode"
            | "stabilityai"
            | "HuggingFaceTB"
            | "openai"
            | "black-forest-labs"
            | "CohereForAI"
    )
}

/// URL-encode a string for use as a *query parameter value* (e.g. `?search=foo`).
/// Encodes everything except unreserved characters per RFC 3986.
fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => {
                out.push_str(&format!("%{:02X}", b));
            }
        }
    }
    out
}

/// Encode a model id for use as a *path segment* in a Hugging Face URL.
/// Critically, this does NOT encode the `/` separator inside `org/name`
/// repo identifiers — the HF API rejects URL-encoded slashes with
/// "Invalid repo name: ... - repo name includes an url-encoded slash".
/// Everything else unsafe gets percent-encoded.
fn encode_model_id_path(model_id: &str) -> String {
    let mut out = String::with_capacity(model_id.len());
    for b in model_id.bytes() {
        match b {
            // Keep unreserved characters AND the forward slash — HF needs
            // `org/name` to remain literal in the URL path.
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => {
                out.push(b as char);
            }
            _ => {
                out.push_str(&format!("%{:02X}", b));
            }
        }
    }
    out
}

fn truncate_str(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let truncated: String = s.chars().take(max).collect();
        format!("{}…", truncated)
    }
}
