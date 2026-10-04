use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Rect, WebviewBuilder, WebviewUrl,
};

/// Shared state: map panel_id → presence marker
pub struct YoutubeState {
    pub windows: Arc<Mutex<HashMap<String, ()>>>,
    pub titles: Arc<Mutex<HashMap<String, String>>>,
}

impl YoutubeState {
    pub fn new() -> Self {
        Self {
            windows: Arc::new(Mutex::new(HashMap::new())),
            titles: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

fn yt_label(panel_id: &str) -> String {
    format!("youtube-{}", panel_id)
}

fn update_title_state(state: &YoutubeState, panel_id: &str, title: String) -> Result<(), String> {
    state
        .titles
        .lock()
        .map_err(|e| e.to_string())?
        .insert(panel_id.to_string(), title);
    Ok(())
}

#[tauri::command]
pub async fn yt_open(
    app: AppHandle,
    state: tauri::State<'_, YoutubeState>,
    panel_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let label = yt_label(&panel_id);

    if let Some(webview) = app.get_webview(&label) {
        webview
            .set_position(LogicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
        webview
            .set_size(LogicalSize::new(width, height))
            .map_err(|e| e.to_string())?;
        webview.show().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let window = app
        .get_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    let titles = state.titles.clone();
    let panel_id_for_title = panel_id.clone();
    let webview_builder = WebviewBuilder::new(
        &label,
        WebviewUrl::External(
            "https://www.youtube.com"
                .parse()
                .map_err(|e: url::ParseError| e.to_string())?,
        ),
    )
    .on_document_title_changed(move |_webview, title| {
        if let Ok(mut map) = titles.lock() {
            map.insert(panel_id_for_title.clone(), title);
        }
    });

    window
        .add_child(
            webview_builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(width, height),
        )
        .map_err(|e| e.to_string())?;

    state
        .windows
        .lock()
        .map_err(|e| e.to_string())?
        .insert(panel_id.clone(), ());
    update_title_state(&state, &panel_id, "YouTube".to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn yt_show(app: AppHandle, panel_id: String) -> Result<(), String> {
    let label = yt_label(&panel_id);
    if let Some(webview) = app.get_webview(&label) {
        webview.show().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn yt_hide(app: AppHandle, panel_id: String) -> Result<(), String> {
    let label = yt_label(&panel_id);
    if let Some(webview) = app.get_webview(&label) {
        webview.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn yt_get_title(app: AppHandle, panel_id: String) -> Result<String, String> {
    let state = app.state::<YoutubeState>();
    if let Some(title) = state
        .titles
        .lock()
        .map_err(|e| e.to_string())?
        .get(&panel_id)
        .cloned()
    {
        return Ok(title);
    }
    Ok(String::new())
}

#[tauri::command]
pub async fn yt_close(
    app: AppHandle,
    state: tauri::State<'_, YoutubeState>,
    panel_id: String,
) -> Result<(), String> {
    let label = yt_label(&panel_id);
    if let Some(webview) = app.get_webview(&label) {
        webview.close().map_err(|e| e.to_string())?;
    }
    state
        .windows
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&panel_id);
    state
        .titles
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&panel_id);
    Ok(())
}

#[tauri::command]
pub async fn yt_set_bounds(
    app: AppHandle,
    panel_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let label = yt_label(&panel_id);
    if let Some(webview) = app.get_webview(&label) {
        webview
            .set_bounds(Rect {
                position: LogicalPosition::new(x, y).into(),
                size: LogicalSize::new(width, height).into(),
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn yt_back(app: AppHandle, panel_id: String) -> Result<(), String> {
    let label = yt_label(&panel_id);
    if let Some(webview) = app.get_webview(&label) {
        webview
            .eval("window.history.back()")
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn yt_forward(app: AppHandle, panel_id: String) -> Result<(), String> {
    let label = yt_label(&panel_id);
    if let Some(webview) = app.get_webview(&label) {
        webview
            .eval("window.history.forward()")
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn yt_reload(app: AppHandle, panel_id: String) -> Result<(), String> {
    let label = yt_label(&panel_id);
    if let Some(webview) = app.get_webview(&label) {
        webview
            .eval("window.location.reload()")
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn yt_clear_session(
    app: AppHandle,
    state: tauri::State<'_, YoutubeState>,
    panel_id: String,
) -> Result<(), String> {
    yt_close(app, state, panel_id).await
}
