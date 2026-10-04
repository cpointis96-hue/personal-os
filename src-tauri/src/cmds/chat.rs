use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    sync::atomic::{AtomicU64, Ordering},
};
use tauri::{async_runtime::JoinHandle, AppHandle, Emitter, State};

const OPENROUTER_CHAT_URL: &str = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODELS_URL: &str = "https://openrouter.ai/api/v1/models";
const OPENROUTER_APP_TITLE: &str = "Personal OS";
const OPENROUTER_APP_REFERER: &str = "app://personal-os";

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ApiMessage {
    pub role: String,
    pub content: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct OpenRouterModelSummary {
    pub id: String,
    pub name: String,
    pub context_length: Option<u64>,
    pub description: Option<String>,
    pub is_free: bool,
    pub is_light: bool,
}

#[derive(Deserialize, Debug)]
struct OpenRouterPricing {
    prompt: Option<String>,
    completion: Option<String>,
    request: Option<String>,
}

#[derive(Deserialize, Debug)]
struct OpenRouterModelRecord {
    id: String,
    name: String,
    context_length: Option<u64>,
    description: Option<String>,
    pricing: Option<OpenRouterPricing>,
}

#[derive(Serialize, Clone)]
pub struct ChatChunkEvent {
    pub text: String,
    pub done: bool,
    pub error: Option<String>,
}

#[derive(Clone, Default)]
pub struct ChatStreamState {
    tasks: Arc<Mutex<HashMap<i64, ChatTaskEntry>>>,
    next_generation: Arc<AtomicU64>,
}

struct ChatTaskEntry {
    generation: u64,
    handle: JoinHandle<()>,
}

impl ChatStreamState {
    pub fn new() -> Self {
        Self {
            tasks: Arc::new(Mutex::new(HashMap::new())),
            next_generation: Arc::new(AtomicU64::new(0)),
        }
    }

    fn abort_chat(&self, chat_id: i64) -> Result<(), String> {
        let mut tasks = self.tasks.lock().map_err(|e| e.to_string())?;
        if let Some(entry) = tasks.remove(&chat_id) {
            entry.handle.abort();
        }
        Ok(())
    }
}

#[tauri::command]
pub async fn openrouter_models(
    provider: Option<String>,
    api_key: Option<String>,
) -> Result<Vec<OpenRouterModelSummary>, String> {
    let _ = provider;
    let client = reqwest::Client::new();
    let mut request = client
        .get(OPENROUTER_MODELS_URL)
        .query(&[("output_modalities", "text")])
        .header("HTTP-Referer", OPENROUTER_APP_REFERER)
        .header("X-OpenRouter-Title", OPENROUTER_APP_TITLE);

    if let Some(key) = api_key.filter(|value| !value.is_empty()) {
        request = request.header("Authorization", format!("Bearer {key}"));
    }

    let response = request.send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("API error {}: {}", status, text));
    }

    let payload: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    let models = payload["data"].as_array().cloned().unwrap_or_default();
    let mut result: Vec<OpenRouterModelSummary> = models
        .into_iter()
        .filter_map(|item| {
            let record = serde_json::from_value::<OpenRouterModelRecord>(item).ok()?;
            let pricing = record.pricing;
            let is_free = record.id.ends_with(":free")
                || record.id == "openrouter/free"
                || pricing
                    .as_ref()
                    .is_some_and(|p| p.prompt.as_deref() == Some("0")
                        && p.completion.as_deref() == Some("0")
                        && p.request.as_deref().unwrap_or("0") == "0");

            let context_length = record.context_length;
            let is_light = is_free
                || context_length.is_some_and(|len| len <= 32_768)
                || {
                    let lc = record.id.to_lowercase();
                    lc.contains("mini")
                        || lc.contains("nano")
                        || lc.contains("small")
                        || lc.contains("haiku")
                        || lc.contains("flash")
                        || lc.contains("3b")
                        || lc.contains("7b")
                        || lc.contains("8b")
                        || lc.contains("12b")
                        || lc.contains("14b")
                        || lc.contains("20b")
                        || lc.contains("30b")
                };

            Some(OpenRouterModelSummary {
                id: record.id,
                name: record.name,
                context_length,
                description: record.description,
                is_free,
                is_light,
            })
        })
        .collect();

    result.sort_by(|a, b| {
        b.is_free
            .cmp(&a.is_free)
            .then_with(|| b.is_light.cmp(&a.is_light))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    result.dedup_by(|a, b| a.id == b.id);

    let mut output = vec![OpenRouterModelSummary {
        id: "openrouter/auto".to_string(),
        name: "Sélection automatique".to_string(),
        context_length: None,
        description: Some("Routage OpenRouter automatique".to_string()),
        is_free: false,
        is_light: true,
    }];
    output.extend(result.into_iter().filter(|model| model.id != "openrouter/auto"));

    Ok(output)
}

#[tauri::command]
pub async fn chat_stream(
    state: State<'_, ChatStreamState>,
    app: AppHandle,
    chat_id: i64,
    messages: Vec<ApiMessage>,
    system: Option<String>,
    model: String,
    api_key: String,
) -> Result<(), String> {
    state.inner().abort_chat(chat_id)?;

    let generation = state.inner().next_generation.fetch_add(1, Ordering::Relaxed) + 1;
    let state_for_task = state.inner().clone();
    let app_for_task = app.clone();
    let handle = tauri::async_runtime::spawn(async move {
        let event_name = format!("chat://chunk/{}", chat_id);
        if let Err(e) = do_stream(&app_for_task, &event_name, messages, system, model, api_key).await {
            let _ = app_for_task.emit(
                &event_name,
                ChatChunkEvent {
                    text: String::new(),
                    done: true,
                    error: Some(e),
                },
            );
        }

        if let Ok(mut tasks) = state_for_task.tasks.lock() {
            if tasks.get(&chat_id).map(|entry| entry.generation) == Some(generation) {
                tasks.remove(&chat_id);
            }
        }
    });

    let mut tasks = state.inner().tasks.lock().map_err(|e| e.to_string())?;
    tasks.insert(chat_id, ChatTaskEntry { generation, handle });
    Ok(())
}

#[tauri::command]
pub async fn chat_stop_stream(state: State<'_, ChatStreamState>, chat_id: i64) -> Result<(), String> {
    state.inner().abort_chat(chat_id)
}

async fn do_stream(
    app: &AppHandle,
    event_name: &str,
    messages: Vec<ApiMessage>,
    system: Option<String>,
    model: String,
    api_key: String,
) -> Result<(), String> {
    let client = reqwest::Client::new();

    let mut request_messages = Vec::new();
    if let Some(sys) = system.filter(|value| !value.is_empty()) {
        request_messages.push(serde_json::json!({
            "role": "system",
            "content": sys,
        }));
    }

    request_messages.extend(messages.into_iter().map(|message| {
        serde_json::json!({
            "role": message.role,
            "content": message.content,
        })
    }));

    let body = serde_json::json!({
        "model": model,
        "max_tokens": 4096,
        "stream": true,
        "messages": request_messages,
    });

    let response = client
        .post(OPENROUTER_CHAT_URL)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("HTTP-Referer", OPENROUTER_APP_REFERER)
        .header("X-OpenRouter-Title", OPENROUTER_APP_TITLE)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("API error {}: {}", status, text));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut done_sent = false;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(pos) = buffer.find('\n') {
            let line = buffer[..pos].trim_end_matches('\r').to_string();
            buffer = buffer[pos + 1..].to_string();

            if line.is_empty() || line.starts_with(':') || !line.starts_with("data: ") {
                continue;
            }

            let data = &line["data: ".len()..];
            if data == "[DONE]" {
                done_sent = true;
                let _ = app.emit(
                    event_name,
                    ChatChunkEvent {
                        text: String::new(),
                        done: true,
                        error: None,
                    },
                );
                break;
            }

            let Ok(val) = serde_json::from_str::<serde_json::Value>(data) else {
                continue;
            };

            let text = val["choices"]
                .get(0)
                .and_then(|choice| choice.get("delta"))
                .and_then(|delta| delta.get("content"))
                .and_then(|content| content.as_str())
                .unwrap_or("")
                .to_string();

            if !text.is_empty() {
                let _ = app.emit(
                    event_name,
                    ChatChunkEvent {
                        text,
                        done: false,
                        error: None,
                    },
                );
            }
        }

        if done_sent {
            break;
        }
    }

    if !done_sent {
        let _ = app.emit(
            event_name,
            ChatChunkEvent {
                text: String::new(),
                done: true,
                error: None,
            },
        );
    }

    Ok(())
}
