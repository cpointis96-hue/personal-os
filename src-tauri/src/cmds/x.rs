use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, async_runtime::JoinHandle};
use tauri_plugin_shell::{process::CommandEvent, ShellExt};
use serde::{Deserialize, Serialize};

pub struct XSchedulerState {
    pub handle: Arc<Mutex<Option<JoinHandle<()>>>>,
}

impl XSchedulerState {
    pub fn new() -> Self {
        Self {
            handle: Arc::new(Mutex::new(None)),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TweetEvent {
    pub tweet_id: String,
    pub profile_id: Option<i64>,
    pub text: Option<String>,
    pub author_handle: Option<String>,
    pub created_at: Option<i64>,
    pub scraped_at: i64,
    pub media_json: Option<String>,
    pub raw_json: String,
}

#[derive(Serialize, Clone)]
struct ProgressEvent {
    handle: String,
    count: u32,
}

#[derive(Serialize, Clone)]
struct DoneEvent {
    total: u32,
}

#[tauri::command]
pub async fn x_get_gallery_dl_path(app: AppHandle) -> Result<String, String> {
    let output = app
        .shell()
        .command("which")
        .args(["gallery-dl"])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err("gallery-dl not found — install with: pip install -U gallery-dl".to_string())
    }
}

#[tauri::command]
pub async fn x_test_gallery_dl(app: AppHandle) -> Result<String, String> {
    let path_output = app
        .shell()
        .command("which")
        .args(["gallery-dl"])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !path_output.status.success() {
        return Ok("gallery-dl not found — install with: pip install -U gallery-dl".to_string());
    }

    let path = String::from_utf8_lossy(&path_output.stdout).trim().to_string();

    let version_output = app
        .shell()
        .command("gallery-dl")
        .args(["--version"])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    let version = String::from_utf8_lossy(&version_output.stdout).trim().to_string();

    Ok(format!("{} at {}", version, path))
}

async fn scrape_handle(handle: String, app: AppHandle) -> Result<u32, String> {
    let url = format!("https://twitter.com/{}", handle);
    let scraped_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let (mut rx, _child) = app
        .shell()
        .command("gallery-dl")
        .args(["--dump-json", &url])
        .spawn()
        .map_err(|e| e.to_string())?;

    let mut count: u32 = 0;

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(line_bytes) => {
                let line = String::from_utf8_lossy(&line_bytes);
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }

                let parsed: serde_json::Value = match serde_json::from_str(line) {
                    Ok(v) => v,
                    Err(_) => continue,
                };

                let arr = match parsed.as_array() {
                    Some(a) if a.len() >= 3 => a,
                    _ => continue,
                };

                let entry_type = match arr[0].as_u64() {
                    Some(t) => t,
                    None => continue,
                };

                if entry_type != 1 {
                    continue;
                }

                let data = &arr[2];

                let tweet_id = match data.get("tweet_id")
                    .or_else(|| data.get("id_str"))
                    .or_else(|| data.get("id"))
                    .and_then(|v| v.as_str().map(|s| s.to_string()).or_else(|| v.as_u64().map(|n| n.to_string())))
                {
                    Some(id) => id,
                    None => continue,
                };

                let text = data.get("full_text")
                    .or_else(|| data.get("text"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                let author_handle = data.get("user")
                    .and_then(|u| u.get("screen_name"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .or_else(|| Some(handle.clone()));

                let created_at = data.get("date_modified")
                    .or_else(|| data.get("created_at"))
                    .and_then(|v| {
                        if let Some(n) = v.as_i64() {
                            return Some(n);
                        }
                        if let Some(s) = v.as_str() {
                            return s.parse::<i64>().ok();
                        }
                        None
                    });

                let media_json = data.get("media")
                    .map(|m| serde_json::to_string(m).unwrap_or_default());

                let raw_json = serde_json::to_string(data).unwrap_or_default();

                let tweet_event = TweetEvent {
                    tweet_id,
                    profile_id: None,
                    text,
                    author_handle,
                    created_at,
                    scraped_at,
                    media_json,
                    raw_json,
                };

                let _ = app.emit("x://tweet", &tweet_event);
                count += 1;

                if count % 10 == 0 {
                    let _ = app.emit("x://progress", ProgressEvent { handle: handle.clone(), count });
                }
            }
            CommandEvent::Terminated(_) => break,
            _ => {}
        }
    }

    let _ = app.emit("x://progress", ProgressEvent { handle: handle.clone(), count });

    Ok(count)
}

#[tauri::command]
pub async fn x_scrape_profile(handle: String, app: AppHandle) -> Result<(), String> {
    scrape_handle(handle, app).await.map(|_| ())
}

#[tauri::command]
pub async fn x_scrape_all(handles: Vec<String>, app: AppHandle) -> Result<(), String> {
    let _ = app.emit("x://scrape-start", ());

    let mut total: u32 = 0;
    for handle in handles {
        match scrape_handle(handle, app.clone()).await {
            Ok(n) => total += n,
            Err(e) => {
                let _ = app.emit("x://error", e);
            }
        }
    }

    let _ = app.emit("x://done", DoneEvent { total });
    Ok(())
}

#[tauri::command]
pub async fn x_start_scheduler(
    minutes: u32,
    handles: Vec<String>,
    app: AppHandle,
    state: tauri::State<'_, XSchedulerState>,
) -> Result<(), String> {
    let mut lock = state.handle.lock().map_err(|e| e.to_string())?;

    if let Some(existing) = lock.take() {
        existing.abort();
    }

    if minutes == 0 {
        return Ok(());
    }

    let app_clone = app.clone();
    let task = tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(minutes as u64 * 60));
        interval.tick().await;
        loop {
            interval.tick().await;
            let _ = app_clone.emit("x://scrape-start", ());
            let mut total: u32 = 0;
            for handle in &handles {
                match scrape_handle(handle.clone(), app_clone.clone()).await {
                    Ok(n) => total += n,
                    Err(e) => {
                        let _ = app_clone.emit("x://error", e);
                    }
                }
            }
            let _ = app_clone.emit("x://done", DoneEvent { total });
        }
    });

    *lock = Some(task);
    Ok(())
}
