//! Real cloud-provider chat completions with streaming.
//!
//! Supports:
//!   - OpenAI-compatible: OpenAI, Groq, Mistral, OpenRouter, LM Studio,
//!     Azure OpenAI, Ollama (with /v1/chat/completions shim), and any custom
//!     OpenAI-compatible endpoint.
//!   - Anthropic-native (Claude 3.5 Sonnet / Haiku / opus / etc.).
//!   - Google Gemini native (generativelanguage.googleapis.com).

use std::time::Duration;

use tauri::{AppHandle, Emitter};

use crate::commands::EVENT_CHAT_DELTA;
use crate::{ChatCompletionRequest, ChatStreamDelta, CloudModelDto};

/// Emit a chat-delta event on the FIXED `chat-delta` channel, with the chat
/// `id` included in the payload so the frontend can filter by id when
/// listening. Tauri 2's `listen()` rejects event names containing anything
/// other than `A-Z a-z 0-9 - _ / :`, so we MUST NOT embed the id in the
/// event name.
fn emit_chat_delta(app: &AppHandle, id: &str, delta: ChatStreamDelta) {
    let _ = app.emit(
        EVENT_CHAT_DELTA,
        serde_json::json!({
            "id": id,
            "delta": delta.delta,
            "accumulated": delta.accumulated,
            "tokens": delta.tokens,
            "done": delta.done,
            "reasoning": delta.reasoning,
        }),
    );
}

const STREAM_TIMEOUT: Duration = Duration::from_secs(300);

/// Stream a chat completion. Emits `chat-delta` events (FIXED event name)
/// as chunks arrive. The chat `id` travels inside the payload so the
/// frontend can filter by id. Returns the final accumulated text on success.
pub async fn stream_chat(
    app: AppHandle,
    id: &str,
    request: ChatCompletionRequest,
) -> Result<String, String> {
    match request.provider_kind.as_str() {
        "anthropic" => stream_anthropic(app, id, request).await,
        "gemini" => stream_gemini(app, id, request).await,
        // Everything else speaks the OpenAI Chat Completions API.
        _ => stream_openai_compatible(app, id, request).await,
    }
}

/// Fetch the model list from a provider's /models endpoint.
pub async fn fetch_models(
    kind: &str,
    base_url: &str,
    api_key: Option<String>,
) -> Result<Vec<CloudModelDto>, String> {
    match kind {
        "anthropic" => fetch_anthropic_models(base_url, api_key).await,
        "gemini" => fetch_gemini_models(base_url, api_key).await,
        // Ollama's /api/tags gives a different shape, but it ALSO exposes
        // /v1/models (OpenAI-compatible) since 0.1.x.
        _ => fetch_openai_models(kind, base_url, api_key).await,
    }
}

// ---------------------------------------------------------------------------
// OpenAI-compatible streaming
// ---------------------------------------------------------------------------

async fn stream_openai_compatible(
    app: AppHandle,
    id: &str,
    request: ChatCompletionRequest,
) -> Result<String, String> {
    let url = format!(
        "{}/chat/completions",
        request.base_url.trim_end_matches('/')
    );
    let client = reqwest::Client::builder()
        .timeout(STREAM_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;

    let mut body = serde_json::json!({
        "model": request.model,
        "messages": request.messages.iter().map(|m| {
            serde_json::json!({ "role": m.role, "content": m.content })
        }).collect::<Vec<_>>(),
        "stream": request.stream.unwrap_or(true),
    });
    if let Some(t) = request.temperature {
        body["temperature"] = serde_json::json!(t);
    }
    if let Some(mt) = request.max_tokens {
        body["max_tokens"] = serde_json::json!(mt);
    }
    if let Some(p) = request.top_p {
        body["top_p"] = serde_json::json!(p);
    }

    let mut req = client.post(&url).json(&body);
    if let Some(key) = &request.api_key {
        if !key.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", key));
        }
    }
    // OpenRouter requires these for attribution.
    if request.provider_kind == "openrouter" {
        req = req
            .header("HTTP-Referer", "https://xirea.app")
            .header("X-Title", "Xirea Desktop");
    }
    if let Some(extra) = &request.extra_headers {
        for (k, v) in extra {
            req = req.header(k, v);
        }
    }

    let response = req.send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("HTTP {}: {}", status, truncate_str(&text, 500)));
    }

    // If streaming disabled, parse as a single JSON blob.
    if !request.stream.unwrap_or(true) {
        let v: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
        let content = v["choices"][0]["message"]["content"]
            .as_str()
            .ok_or_else(|| "Malformed non-streaming response".to_string())?
            .to_string();
        let delta = ChatStreamDelta {
            delta: content.clone(),
            accumulated: content.clone(),
            tokens: (content.chars().count() / 4).max(1),
            done: true,
            reasoning: None,
        };
        emit_chat_delta(&app, id, delta);
        return Ok(content);
    }

    // Stream SSE chunks.
    let mut stream = response.bytes_stream();
    use futures_util::StreamExt;
    let mut accumulated = String::new();
    let mut buf = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        buf.push_str(&String::from_utf8_lossy(&chunk));

        // Process complete SSE lines (terminated by \n\n).
        while let Some(idx) = buf.find("\n\n") {
            let raw_event = buf[..idx].to_string();
            buf.drain(..idx + 2);

            for line in raw_event.lines() {
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                if let Some(data) = line.strip_prefix("data: ") {
                    let data = data.trim();
                    if data == "[DONE]" {
                        let delta = ChatStreamDelta {
                            delta: String::new(),
                            accumulated: accumulated.clone(),
                            tokens: (accumulated.chars().count() / 4).max(1),
                            done: true,
                            reasoning: None,
                        };
                        emit_chat_delta(&app, id, delta);
                        return Ok(accumulated);
                    }
                    // Parse the JSON delta.
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
                        // Check for error.
                        if let Some(err) = v.get("error") {
                            let msg = err["message"]
                                .as_str()
                                .unwrap_or("Unknown provider error")
                                .to_string();
                            return Err(msg);
                        }
                        let delta_text = v["choices"][0]["delta"]["content"].as_str().unwrap_or("");
                        if !delta_text.is_empty() {
                            accumulated.push_str(delta_text);
                            let delta = ChatStreamDelta {
                                delta: delta_text.to_string(),
                                accumulated: accumulated.clone(),
                                tokens: (accumulated.chars().count() / 4).max(1),
                                done: false,
                                reasoning: None,
                            };
                            emit_chat_delta(&app, id, delta);
                        }
                        // Reasoning content (OpenAI o1 / o3).
                        if let Some(r) = v["choices"][0]["delta"]["reasoning_content"].as_str() {
                            if !r.is_empty() {
                                let delta = ChatStreamDelta {
                                    delta: String::new(),
                                    accumulated: accumulated.clone(),
                                    tokens: 0,
                                    done: false,
                                    reasoning: Some(r.to_string()),
                                };
                                emit_chat_delta(&app, id, delta);
                            }
                        }
                    }
                }
            }
        }
    }

    // Stream ended without [DONE] — flush a final done event.
    let delta = ChatStreamDelta {
        delta: String::new(),
        accumulated: accumulated.clone(),
        tokens: (accumulated.chars().count() / 4).max(1),
        done: true,
        reasoning: None,
    };
    emit_chat_delta(&app, id, delta);
    Ok(accumulated)
}

async fn fetch_openai_models(
    kind: &str,
    base_url: &str,
    api_key: Option<String>,
) -> Result<Vec<CloudModelDto>, String> {
    let url = format!("{}/models", base_url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = client.get(&url);
    if let Some(key) = &api_key {
        if !key.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", key));
        }
    }
    if kind == "openrouter" {
        req = req
            .header("HTTP-Referer", "https://xirea.app")
            .header("X-Title", "Xirea Desktop");
    }
    let response = req.send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("HTTP {}: {}", status, truncate_str(&text, 500)));
    }
    let v: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    let arr = v["data"]
        .as_array()
        .ok_or_else(|| "Missing 'data' array in response".to_string())?;
    let models = arr
        .iter()
        .filter_map(|m| {
            let id = m["id"].as_str()?.to_string();
            if id.is_empty() {
                return None;
            }
            let name = prettify_model_name(&id);
            Some(CloudModelDto {
                id: id.clone(),
                name,
                provider_id: kind.to_string(),
                context_length: m["context_length"]
                    .as_u64()
                    .map(|n| n as usize)
                    .unwrap_or_else(|| guess_context(&id)),
                capabilities: guess_capabilities(&id, kind),
                description: m["description"].as_str().map(|s| s.to_string()),
                input_per_1m: m["pricing"]["prompt"]
                    .as_str()
                    .and_then(|s| s.parse::<f64>().ok()),
                output_per_1m: m["pricing"]["completion"]
                    .as_str()
                    .and_then(|s| s.parse::<f64>().ok()),
                available: true,
            })
        })
        .collect();
    Ok(models)
}

// ---------------------------------------------------------------------------
// Anthropic-native
// ---------------------------------------------------------------------------

async fn stream_anthropic(
    app: AppHandle,
    id: &str,
    request: ChatCompletionRequest,
) -> Result<String, String> {
    let url = format!("{}/messages", request.base_url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(STREAM_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;

    // Anthropic expects a system prompt as a top-level field, not in messages.
    let mut system_prompt: Option<String> = None;
    let mut messages: Vec<serde_json::Value> = Vec::new();
    for m in &request.messages {
        if m.role == "system" {
            system_prompt = Some(m.content.clone());
        } else {
            messages.push(serde_json::json!({ "role": m.role, "content": m.content }));
        }
    }

    let mut body = serde_json::json!({
        "model": request.model,
        "messages": messages,
        "stream": request.stream.unwrap_or(true),
        "max_tokens": request.max_tokens.unwrap_or(2048),
    });
    if let Some(s) = system_prompt {
        body["system"] = serde_json::json!(s);
    }
    if let Some(t) = request.temperature {
        body["temperature"] = serde_json::json!(t);
    }
    if let Some(p) = request.top_p {
        body["top_p"] = serde_json::json!(p);
    }

    let req = client
        .post(&url)
        .header("x-api-key", request.api_key.as_deref().unwrap_or(""))
        .header("anthropic-version", "2023-06-01")
        .header("anthropic-dangerous-direct-browser-access", "true")
        .json(&body);

    let response = req.send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("HTTP {}: {}", status, truncate_str(&text, 500)));
    }

    if !request.stream.unwrap_or(true) {
        let v: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
        let content = v["content"][0]["text"]
            .as_str()
            .ok_or_else(|| "Malformed Anthropic response".to_string())?
            .to_string();
        let delta = ChatStreamDelta {
            delta: content.clone(),
            accumulated: content.clone(),
            tokens: (content.chars().count() / 4).max(1),
            done: true,
            reasoning: None,
        };
        emit_chat_delta(&app, id, delta);
        return Ok(content);
    }

    let mut stream = response.bytes_stream();
    use futures_util::StreamExt;
    let mut accumulated = String::new();
    let mut reasoning_acc = String::new();
    let mut buf = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        buf.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(idx) = buf.find("\n\n") {
            let raw_event = buf[..idx].to_string();
            buf.drain(..idx + 2);

            let mut event_type = String::new();
            let mut data_str = String::new();
            for line in raw_event.lines() {
                let line = line.trim();
                if let Some(t) = line.strip_prefix("event: ") {
                    event_type = t.trim().to_string();
                } else if let Some(d) = line.strip_prefix("data: ") {
                    data_str.push_str(d.trim());
                }
            }

            if data_str.is_empty() {
                continue;
            }
            let v: serde_json::Value = match serde_json::from_str(&data_str) {
                Ok(v) => v,
                Err(_) => continue,
            };

            match event_type.as_str() {
                "content_block_delta" => {
                    if let Some(delta_obj) = v.get("delta") {
                        let delta_type = delta_obj["type"].as_str().unwrap_or("");
                        if delta_type == "text_delta" {
                            if let Some(text) = delta_obj["text"].as_str() {
                                accumulated.push_str(text);
                                let delta = ChatStreamDelta {
                                    delta: text.to_string(),
                                    accumulated: accumulated.clone(),
                                    tokens: (accumulated.chars().count() / 4).max(1),
                                    done: false,
                                    reasoning: None,
                                };
                                emit_chat_delta(&app, id, delta);
                            }
                        } else if delta_type == "thinking_delta" {
                            if let Some(text) = delta_obj["thinking"].as_str() {
                                reasoning_acc.push_str(text);
                                let delta = ChatStreamDelta {
                                    delta: String::new(),
                                    accumulated: accumulated.clone(),
                                    tokens: 0,
                                    done: false,
                                    reasoning: Some(text.to_string()),
                                };
                                emit_chat_delta(&app, id, delta);
                            }
                        }
                    }
                }
                "message_stop" => {
                    let delta = ChatStreamDelta {
                        delta: String::new(),
                        accumulated: accumulated.clone(),
                        tokens: (accumulated.chars().count() / 4).max(1),
                        done: true,
                        reasoning: None,
                    };
                    emit_chat_delta(&app, id, delta);
                    return Ok(accumulated);
                }
                "error" => {
                    let msg = v["error"]["message"]
                        .as_str()
                        .unwrap_or("Anthropic stream error")
                        .to_string();
                    return Err(msg);
                }
                _ => {}
            }
        }
    }

    let delta = ChatStreamDelta {
        delta: String::new(),
        accumulated: accumulated.clone(),
        tokens: (accumulated.chars().count() / 4).max(1),
        done: true,
        reasoning: None,
    };
    emit_chat_delta(&app, id, delta);
    Ok(accumulated)
}

async fn fetch_anthropic_models(
    _base_url: &str,
    _api_key: Option<String>,
) -> Result<Vec<CloudModelDto>, String> {
    // Anthropic does not expose a /models endpoint publicly, so we ship a
    // curated, real list of the production model IDs that work today.
    let models = vec![
        ("claude-opus-4-5", "Claude Opus 4.5", 200_000),
        ("claude-sonnet-4-5", "Claude Sonnet 4.5", 200_000),
        ("claude-3-7-sonnet-latest", "Claude 3.7 Sonnet", 200_000),
        ("claude-3-5-sonnet-latest", "Claude 3.5 Sonnet", 200_000),
        ("claude-3-5-haiku-latest", "Claude 3.5 Haiku", 200_000),
        ("claude-3-opus-latest", "Claude 3 Opus", 200_000),
    ];
    Ok(models
        .iter()
        .map(|(id, name, ctx)| CloudModelDto {
            id: id.to_string(),
            name: name.to_string(),
            provider_id: "anthropic".to_string(),
            context_length: *ctx,
            capabilities: vec!["tools".into(), "vision".into()],
            description: Some(name.to_string()),
            input_per_1m: None,
            output_per_1m: None,
            available: true,
        })
        .collect())
}

// ---------------------------------------------------------------------------
// Gemini-native
// ---------------------------------------------------------------------------

async fn stream_gemini(
    app: AppHandle,
    id: &str,
    request: ChatCompletionRequest,
) -> Result<String, String> {
    let api_key = request.api_key.as_deref().unwrap_or("");
    if api_key.is_empty() {
        return Err("Missing Gemini API key".into());
    }
    // If the user's base URL is `.../v1`, transparently upgrade to `v1beta`.
    // v1beta supports the `systemInstruction` top-level field for ALL Gemini
    // models (including gemini-2.5-flash / gemini-2.5-pro) while v1 does not
    // for some of them — they reject with "Unknown name 'systeminstruction'".
    // v1beta is a strict superset of v1, so this is always safe.
    let base_url = if request.base_url.ends_with("/v1") || request.base_url.contains("/v1/") {
        request.base_url.replacen("/v1", "/v1beta", 1)
    } else {
        request.base_url.clone()
    };
    let is_stream = request.stream.unwrap_or(true);
    let method = if is_stream {
        "streamGenerateContent"
    } else {
        "generateContent"
    };
    // For streaming, use alt=sse so Gemini returns proper Server-Sent Events
    // (data: {...}\n\n lines) instead of a streaming JSON array. This is
    // much easier to parse and is the officially-recommended approach.
    let url = if is_stream {
        format!(
            "{}/models/{}:{}?alt=sse&key={}",
            base_url.trim_end_matches('/'),
            request.model,
            method,
            api_key,
        )
    } else {
        format!(
            "{}/models/{}:{}?key={}",
            base_url.trim_end_matches('/'),
            request.model,
            method,
            api_key,
        )
    };

    let client = reqwest::Client::builder()
        .timeout(STREAM_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;

    let mut contents: Vec<serde_json::Value> = Vec::new();
    let mut system_instruction: Option<serde_json::Value> = None;
    for m in &request.messages {
        if m.role == "system" {
            system_instruction = Some(serde_json::json!({
                "parts": [{ "text": m.content }]
            }));
            continue;
        }
        let role = if m.role == "assistant" {
            "model"
        } else {
            "user"
        };
        contents.push(serde_json::json!({
            "role": role,
            "parts": [{ "text": m.content }],
        }));
    }

    let mut body = serde_json::json!({
        "contents": contents,
    });
    if let Some(si) = system_instruction {
        body["systemInstruction"] = si;
    }
    let mut gen_config = serde_json::json!({});
    if let Some(t) = request.temperature {
        gen_config["temperature"] = serde_json::json!(t);
    }
    if let Some(mt) = request.max_tokens {
        gen_config["maxOutputTokens"] = serde_json::json!(mt);
    }
    if let Some(p) = request.top_p {
        gen_config["topP"] = serde_json::json!(p);
    }
    if !gen_config.as_object().map(|o| o.is_empty()).unwrap_or(true) {
        body["generationConfig"] = gen_config;
    }

    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        // Try to parse the structured Gemini error for a friendlier message.
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
            if let Some(err) = v.get("error") {
                let msg = err["message"].as_str().unwrap_or("Gemini API error");
                let code = err["code"].as_i64().unwrap_or(status.as_u16() as i64);
                return Err(format!("Gemini error ({}): {}", code, msg));
            }
        }
        return Err(format!("HTTP {}: {}", status, truncate_str(&text, 500)));
    }

    // Non-streaming: parse as a single JSON object.
    if !is_stream {
        let v: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
        if let Some(err) = v.get("error") {
            let msg = err["message"].as_str().unwrap_or("Gemini API error");
            return Err(msg.to_string());
        }
        let content = v["candidates"][0]["content"]["parts"][0]["text"]
            .as_str()
            .ok_or_else(|| "Malformed Gemini response".to_string())?
            .to_string();
        let delta = ChatStreamDelta {
            delta: content.clone(),
            accumulated: content.clone(),
            tokens: (content.chars().count() / 4).max(1),
            done: true,
            reasoning: None,
        };
        emit_chat_delta(&app, id, delta);
        return Ok(content);
    }

    // Streaming with alt=sse: each event is `data: {json}\n\n`.
    // Much simpler than the previous streaming JSON-array parser.
    let mut stream = response.bytes_stream();
    use futures_util::StreamExt;
    let mut accumulated = String::new();
    let mut buf = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        buf.push_str(&String::from_utf8_lossy(&chunk));

        // Process complete SSE events (terminated by \n\n).
        while let Some(idx) = buf.find("\n\n") {
            let raw_event = buf[..idx].to_string();
            buf.drain(..idx + 2);

            for line in raw_event.lines() {
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                let data = line
                    .strip_prefix("data: ")
                    .or_else(|| line.strip_prefix("data:"))
                    .unwrap_or("");
                let data = data.trim();
                if data.is_empty() || data == "[DONE]" {
                    continue;
                }
                let v: serde_json::Value = match serde_json::from_str(data) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                if let Some(err) = v.get("error") {
                    let msg = err["message"]
                        .as_str()
                        .unwrap_or("Gemini API error")
                        .to_string();
                    return Err(msg);
                }
                if let Some(candidates) = v["candidates"].as_array() {
                    for cand in candidates {
                        if let Some(parts) = cand["content"]["parts"].as_array() {
                            for part in parts {
                                if let Some(text) = part["text"].as_str() {
                                    if !text.is_empty() {
                                        accumulated.push_str(text);
                                        let delta = ChatStreamDelta {
                                            delta: text.to_string(),
                                            accumulated: accumulated.clone(),
                                            tokens: (accumulated.chars().count() / 4).max(1),
                                            done: false,
                                            reasoning: None,
                                        };
                                        emit_chat_delta(&app, id, delta);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let delta = ChatStreamDelta {
        delta: String::new(),
        accumulated: accumulated.clone(),
        tokens: (accumulated.chars().count() / 4).max(1),
        done: true,
        reasoning: None,
    };
    emit_chat_delta(&app, id, delta);
    Ok(accumulated)
}

async fn fetch_gemini_models(
    base_url: &str,
    api_key: Option<String>,
) -> Result<Vec<CloudModelDto>, String> {
    let api_key = api_key.as_deref().unwrap_or("");
    if api_key.is_empty() {
        return Err("Missing Gemini API key".into());
    }
    // Same v1 → v1beta upgrade as `stream_gemini` (see comment there).
    let base = if base_url.ends_with("/v1") || base_url.contains("/v1/") {
        base_url.replacen("/v1", "/v1beta", 1)
    } else {
        base_url.to_string()
    };
    let url = format!("{}/models?key={}", base.trim_end_matches('/'), api_key);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("HTTP {}: {}", status, truncate_str(&text, 500)));
    }
    let v: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    let arr = v["models"]
        .as_array()
        .ok_or_else(|| "Missing 'models' array".to_string())?;
    let models = arr
        .iter()
        .filter_map(|m| {
            let full_name = m["name"].as_str()?.to_string();
            // Gemini names look like "models/gemini-1.5-flash" — strip the prefix.
            let id = full_name
                .strip_prefix("models/")
                .unwrap_or(&full_name)
                .to_string();
            let display = m["displayName"].as_str().unwrap_or(&id).to_string();
            let ctx = m["inputTokenLimit"]
                .as_u64()
                .map(|n| n as usize)
                .unwrap_or_else(|| guess_context(&id));
            Some(CloudModelDto {
                id,
                name: display,
                provider_id: "gemini".to_string(),
                context_length: ctx,
                capabilities: vec!["tools".into(), "vision".into()],
                description: m["description"].as_str().map(|s| s.to_string()),
                input_per_1m: None,
                output_per_1m: None,
                available: true,
            })
        })
        .collect();
    Ok(models)
}

// ---------------------------------------------------------------------------
// Heuristics
// ---------------------------------------------------------------------------

fn prettify_model_name(id: &str) -> String {
    // If the id has a slash (e.g. "meta-llama/Llama-3.1-8B"), use the part after the slash.
    let id = id.rsplit('/').next().unwrap_or(id);
    // Replace hyphens and underscores with spaces, then title-case the result,
    // except for known acronyms.
    let mut out = String::with_capacity(id.len());
    let mut prev_was_word = false;
    for ch in id.chars() {
        if ch == '-' || ch == '_' {
            if prev_was_word {
                out.push(' ');
            }
            prev_was_word = false;
        } else {
            out.push(ch);
            prev_was_word = true;
        }
    }
    out
}

fn guess_context(id: &str) -> usize {
    let id = id.to_lowercase();
    if id.contains("gpt-4o") || id.contains("gpt-4-turbo") {
        128_000
    } else if id.contains("gpt-4") {
        8_192
    } else if id.contains("gpt-3.5") {
        16_385
    } else if id.contains("o1") || id.contains("o3") {
        200_000
    } else if id.contains("claude-3")
        || id.contains("claude-opus")
        || id.contains("claude-sonnet")
        || id.contains("claude-haiku")
    {
        200_000
    } else if id.contains("gemini-1.5") || id.contains("gemini-2") {
        1_000_000
    } else if id.contains("llama-3.3") || id.contains("llama-3.1") || id.contains("llama-3.2") {
        128_000
    } else if id.contains("qwen") {
        32_768
    } else if id.contains("mistral") {
        32_000
    } else if id.contains("phi-3") || id.contains("phi3") {
        128_000
    } else if id.contains("codestral") {
        32_000
    } else {
        8_192
    }
}

fn guess_capabilities(id: &str, kind: &str) -> Vec<String> {
    let id = id.to_lowercase();
    let mut caps: Vec<String> = vec!["tools".into()];
    if id.contains("vision")
        || id.contains("gpt-4o")
        || id.contains("claude-3")
        || id.contains("gemini")
        || id.contains("llava")
        || id.contains("qwen2-vl")
        || id.contains("qwen2.5-vl")
    {
        caps.push("vision".into());
    }
    if id.contains("o1") || id.contains("o3") || id.contains("reasoning") || id.contains("thinking")
    {
        caps.push("reasoning".into());
    }
    if id.contains("embed") {
        caps.push("embedding".into());
    }
    if id.contains("whisper") || id.contains("audio") {
        caps.push("audio".into());
    }
    // Ollama's /v1/models returns lowercase model names — enable tools by default.
    if kind == "ollama" {
        caps.push("vision".into());
    }
    caps
}

fn truncate_str(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let truncated: String = s.chars().take(max).collect();
        format!("{}…", truncated)
    }
}
