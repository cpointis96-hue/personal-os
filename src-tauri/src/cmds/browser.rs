use std::collections::HashMap;
use std::fs;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Rect, Runtime, WebviewBuilder,
    WebviewUrl,
};
use tauri::webview::{NewWindowResponse, PageLoadEvent};

const BROWSER_SHARED_SESSION_DIR: &str = "browser-shared-session";
#[cfg(any(target_os = "macos", target_os = "ios"))]
const BROWSER_SHARED_DATA_STORE_ID: [u8; 16] = *b"browser-panels!!";

#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct BrowserSnapshot {
    panel_id: String,
    url: String,
    title: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

pub struct BrowserState {
    snapshots: Arc<Mutex<HashMap<String, BrowserSnapshot>>>,
}

impl BrowserState {
    pub fn new() -> Self {
        Self {
            snapshots: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

fn browser_label(panel_id: &str) -> String {
    format!("browser-panel-{panel_id}")
}

fn parse_url(url: &str) -> Result<url::Url, String> {
    url::Url::parse(url).map_err(|e| e.to_string())
}

fn browser_data_directory(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join(BROWSER_SHARED_SESSION_DIR);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn configure_browser_builder<R: Runtime>(
    app: &AppHandle,
    builder: WebviewBuilder<R>,
) -> Result<WebviewBuilder<R>, String> {
    let builder = builder.data_directory(browser_data_directory(app)?);

    #[cfg(any(target_os = "macos", target_os = "ios"))]
    let builder = builder.data_store_identifier(BROWSER_SHARED_DATA_STORE_ID);

    Ok(builder)
}

fn update_snapshot_state(
    snapshots: &Arc<Mutex<HashMap<String, BrowserSnapshot>>>,
    panel_id: &str,
    url: Option<String>,
    title: Option<String>,
) -> Result<BrowserSnapshot, String> {
    let mut map = snapshots.lock().map_err(|e| e.to_string())?;
    let entry = map
        .entry(panel_id.to_string())
        .or_insert_with(|| BrowserSnapshot {
            panel_id: panel_id.to_string(),
            ..BrowserSnapshot::default()
        });

    if let Some(url) = url {
        entry.url = url;
    }

    if let Some(title) = title {
        entry.title = title;
    }

    Ok(entry.clone())
}

fn emit_snapshot(
    app: &AppHandle,
    snapshots: &Arc<Mutex<HashMap<String, BrowserSnapshot>>>,
    panel_id: &str,
    url: Option<String>,
    title: Option<String>,
) {
    if let Ok(snapshot) = update_snapshot_state(snapshots, panel_id, url, title) {
        let _ = app.emit("browser://state", snapshot);
    }
}

#[tauri::command]
pub async fn create_browser_webview(
    app: AppHandle,
    state: tauri::State<'_, BrowserState>,
    panel_id: String,
    url: String,
    bounds: BrowserBounds,
) -> Result<(), String> {
    let label = browser_label(&panel_id);
    let parsed_url = parse_url(&url)?;

    if let Some(webview) = app.get_webview(&label) {
        webview
            .set_bounds(Rect {
                position: LogicalPosition::new(bounds.x, bounds.y).into(),
                size: LogicalSize::new(bounds.width, bounds.height).into(),
            })
            .map_err(|e| e.to_string())?;
        webview.navigate(parsed_url).map_err(|e| e.to_string())?;
        webview.show().map_err(|e| e.to_string())?;
        emit_snapshot(&app, &state.snapshots, &panel_id, Some(url), None);
        return Ok(());
    }

    let window = app
        .get_window("main")
        .ok_or_else(|| "main window not found".to_string())?;

    let app_for_navigation = app.clone();
    let panel_id_for_navigation = panel_id.clone();
    let snapshots_for_navigation = state.snapshots.clone();

    let app_for_load = app.clone();
    let panel_id_for_load = panel_id.clone();
    let snapshots_for_load = state.snapshots.clone();

    let app_for_title = app.clone();
    let panel_id_for_title = panel_id.clone();
    let snapshots_for_title = state.snapshots.clone();

    let builder = configure_browser_builder(
        &app,
        WebviewBuilder::new(&label, WebviewUrl::External(parsed_url))
        .on_navigation(move |next_url| {
            emit_snapshot(
                &app_for_navigation,
                &snapshots_for_navigation,
                &panel_id_for_navigation,
                Some(next_url.to_string()),
                None,
            );
            true
        })
        .on_page_load(move |_webview, payload| {
            if matches!(payload.event(), PageLoadEvent::Started | PageLoadEvent::Finished) {
                emit_snapshot(
                    &app_for_load,
                    &snapshots_for_load,
                    &panel_id_for_load,
                    Some(payload.url().to_string()),
                    None,
                );
            }
        })
        .on_document_title_changed(move |webview, title| {
            let current_url = webview.url().ok().map(|value| value.to_string());
            emit_snapshot(
                &app_for_title,
                &snapshots_for_title,
                &panel_id_for_title,
                current_url,
                Some(title),
            );
        })
        .on_new_window(|_, _| NewWindowResponse::Deny),
    )?;

    window
        .add_child(
            builder,
            LogicalPosition::new(bounds.x, bounds.y),
            LogicalSize::new(bounds.width, bounds.height),
        )
        .map_err(|e| e.to_string())?;

    emit_snapshot(&app, &state.snapshots, &panel_id, Some(url), Some("Browser".to_string()));
    Ok(())
}

#[tauri::command]
pub async fn resize_browser_webview(
    app: AppHandle,
    panel_id: String,
    bounds: BrowserBounds,
) -> Result<(), String> {
    let label = browser_label(&panel_id);
    if let Some(webview) = app.get_webview(&label) {
        webview
            .set_bounds(Rect {
                position: LogicalPosition::new(bounds.x, bounds.y).into(),
                size: LogicalSize::new(bounds.width, bounds.height).into(),
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn navigate_browser_webview(
    app: AppHandle,
    state: tauri::State<'_, BrowserState>,
    panel_id: String,
    url: String,
) -> Result<(), String> {
    let label = browser_label(&panel_id);
    let parsed_url = parse_url(&url)?;
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("browser webview not found for panel {panel_id}"))?;
    webview.navigate(parsed_url).map_err(|e| e.to_string())?;
    emit_snapshot(&app, &state.snapshots, &panel_id, Some(url), None);
    Ok(())
}

#[tauri::command]
pub async fn go_back_browser_webview(app: AppHandle, panel_id: String) -> Result<(), String> {
    let label = browser_label(&panel_id);
    if let Some(webview) = app.get_webview(&label) {
        webview
            .eval("window.history.back()")
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn go_forward_browser_webview(app: AppHandle, panel_id: String) -> Result<(), String> {
    let label = browser_label(&panel_id);
    if let Some(webview) = app.get_webview(&label) {
        webview
            .eval("window.history.forward()")
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn reload_browser_webview(app: AppHandle, panel_id: String) -> Result<(), String> {
    let label = browser_label(&panel_id);
    if let Some(webview) = app.get_webview(&label) {
        webview.reload().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn show_browser_webview(app: AppHandle, panel_id: String) -> Result<(), String> {
    let label = browser_label(&panel_id);
    if let Some(webview) = app.get_webview(&label) {
        webview.show().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn hide_browser_webview(app: AppHandle, panel_id: String) -> Result<(), String> {
    let label = browser_label(&panel_id);
    if let Some(webview) = app.get_webview(&label) {
        webview.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn destroy_browser_webview(
    app: AppHandle,
    state: tauri::State<'_, BrowserState>,
    panel_id: String,
) -> Result<(), String> {
    let label = browser_label(&panel_id);
    if let Some(webview) = app.get_webview(&label) {
        webview.close().map_err(|e| e.to_string())?;
    }
    state
        .snapshots
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&panel_id);
    Ok(())
}
