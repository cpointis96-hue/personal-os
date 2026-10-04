use std::collections::VecDeque;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::{process::CommandEvent, ShellExt};
use tokio::sync::mpsc;

// ── State ─────────────────────────────────────────────────────────────────────

pub(crate) struct JobEntry {
    id: i64,
    url: String,
    opts: YtdlpOptions,
}

pub struct YtdlpState {
    pub queue: Arc<Mutex<VecDeque<JobEntry>>>,
    pub running: Arc<AtomicUsize>,
    pub max_concurrent: Arc<AtomicUsize>,
    pub trigger_tx: mpsc::UnboundedSender<()>,
    trigger_rx: Mutex<Option<mpsc::UnboundedReceiver<()>>>,
}

impl YtdlpState {
    pub fn new() -> Self {
        let (tx, rx) = mpsc::unbounded_channel();
        Self {
            queue: Arc::new(Mutex::new(VecDeque::new())),
            running: Arc::new(AtomicUsize::new(0)),
            max_concurrent: Arc::new(AtomicUsize::new(2)),
            trigger_tx: tx,
            trigger_rx: Mutex::new(Some(rx)),
        }
    }
}

// ── Events ─────────────────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
struct ProgressEvent {
    id: i64,
    progress: f64,
}

#[derive(Serialize, Clone)]
struct CompleteEvent {
    id: i64,
    title: String,
}

#[derive(Serialize, Clone)]
struct YtdlpErrorEvent {
    id: i64,
    message: String,
}

#[derive(Serialize, Clone)]
struct LogEvent {
    id: i64,
    line: String,
}

#[derive(Serialize, Clone)]
pub struct ChannelEntry {
    pub id: String,
    pub url: String,
    pub title: String,
    pub channel: String,
    pub duration: Option<f64>,
    pub upload_date: Option<String>,
}

// ── Options ───────────────────────────────────────────────────────────────────

#[derive(Deserialize, Clone)]
pub struct YtdlpOptions {
    pub mode: String,
    pub download_dir: Option<String>,
    pub cookies_file: Option<String>,
    // Audio
    pub audio_format: Option<String>,
    // Video
    pub video_quality: Option<String>,
    pub video_format: Option<String>,
    pub video_codec: Option<String>, // "any" | "h264" | "av1" | "vp9"
    // Subs
    pub sub_lang: Option<String>,
    pub sub_format: Option<String>, // "srt" | "vtt" | "ass"
    // Flags
    pub playlist: Option<bool>,
    pub embed_thumb: Option<bool>,
    pub embed_subs: Option<bool>,
    pub sponsorblock: Option<bool>,
    pub split_chapters: Option<bool>,
    // Time trim
    pub start: Option<String>,
    pub end: Option<String>,
    // Channel
    pub channel_folder: Option<String>,
    // Duplicate suffix index (1 => " (1)")
    pub overwrite_idx: Option<i64>,
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ytdlp_enqueue(
    job_id: i64,
    url: String,
    opts: YtdlpOptions,
    state: tauri::State<'_, YtdlpState>,
) -> Result<(), String> {
    state.queue.lock().unwrap().push_back(JobEntry { id: job_id, url, opts });
    let _ = state.trigger_tx.send(());
    Ok(())
}

#[tauri::command]
pub fn ytdlp_set_max_concurrent(n: usize, state: tauri::State<'_, YtdlpState>) {
    state.max_concurrent.store(n.clamp(1, 8), Ordering::Relaxed);
}

#[derive(Serialize)]
pub struct QueueStatus {
    queued: usize,
    running: usize,
}

#[tauri::command]
pub fn ytdlp_queue_status(state: tauri::State<'_, YtdlpState>) -> QueueStatus {
    QueueStatus {
        queued: state.queue.lock().unwrap().len(),
        running: state.running.load(Ordering::Relaxed),
    }
}

#[tauri::command]
pub async fn ytdlp_update(app: AppHandle) -> Result<String, String> {
    let output = app
        .shell()
        .command("pip3")
        .args(["install", "-U", "yt-dlp"])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if output.status.success() {
        Ok(stdout)
    } else {
        Err(if stderr.is_empty() { stdout } else { stderr })
    }
}

#[tauri::command]
pub async fn ytdlp_version(app: AppHandle) -> Result<String, String> {
    let output = app
        .shell()
        .command("yt-dlp")
        .args(["--version"])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[tauri::command]
pub async fn ytdlp_fetch_channel(url: String, app: AppHandle) -> Result<(), String> {
    let spawn_result = app
        .shell()
        .command("yt-dlp")
        .args(["--flat-playlist", "-j", "--no-warnings", &url])
        .spawn();

    let (mut rx, _child) = spawn_result.map_err(|e| e.to_string())?;

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => {
                let line = String::from_utf8_lossy(&bytes).trim().to_string();
                if line.is_empty() {
                    continue;
                }
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
                    let entry_url = v["webpage_url"]
                        .as_str()
                        .or_else(|| v["url"].as_str())
                        .map(|s| s.to_string())
                        .unwrap_or_else(|| {
                            let id = v["id"].as_str().unwrap_or("");
                            format!("https://www.youtube.com/watch?v={}", id)
                        });
                    let entry = ChannelEntry {
                        id: v["id"].as_str().unwrap_or("").to_string(),
                        url: entry_url,
                        title: v["title"].as_str().unwrap_or("").to_string(),
                        channel: v["channel"]
                            .as_str()
                            .or_else(|| v["uploader"].as_str())
                            .or_else(|| v["playlist_title"].as_str())
                            .unwrap_or("")
                            .to_string(),
                        duration: v["duration"].as_f64(),
                        upload_date: v["upload_date"].as_str().map(|s| s.to_string()),
                    };
                    let _ = app.emit("ytdlp://channel-entry", entry);
                }
            }
            CommandEvent::Terminated(_) => break,
            _ => {}
        }
    }
    let _ = app.emit("ytdlp://channel-done", ());
    Ok(())
}

#[tauri::command]
pub async fn whisper_transcribe(
    _job_id: i64,
    file_path: String,
    app: AppHandle,
) -> Result<(), String> {
    app.shell()
        .command("mlx_whisper")
        .args([&file_path, "--model", "mlx-community/whisper-large-v3-turbo"])
        .output()
        .await
        .map_err(|e| e.to_string())
        .and_then(|o| {
            if o.status.success() {
                Ok(())
            } else {
                Err(String::from_utf8_lossy(&o.stderr).to_string())
            }
        })
}

// ── Worker ────────────────────────────────────────────────────────────────────

pub fn start_worker(app: AppHandle, state: &YtdlpState) {
    let mut rx = state.trigger_rx.lock().unwrap().take().unwrap();
    let queue = state.queue.clone();
    let running = state.running.clone();
    let max_concurrent = state.max_concurrent.clone();
    let trigger_tx = state.trigger_tx.clone();

    tauri::async_runtime::spawn(async move {
        while rx.recv().await.is_some() {
            loop {
                let max = max_concurrent.load(Ordering::Relaxed);
                let cur = running.load(Ordering::Relaxed);
                if cur >= max {
                    break;
                }
                let entry = { queue.lock().unwrap().pop_front() };
                let Some(entry) = entry else { break; };

                running.fetch_add(1, Ordering::Relaxed);
                let app_clone = app.clone();
                let running_clone = running.clone();
                let tx_clone = trigger_tx.clone();

                tauri::async_runtime::spawn(async move {
                    run_job(&app_clone, entry).await;
                    running_clone.fetch_sub(1, Ordering::Relaxed);
                    let _ = tx_clone.send(());
                });
            }
        }
    });
}

fn build_args(url: &str, opts: &YtdlpOptions) -> Vec<String> {
    let dl_dir = opts
        .download_dir
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or("~/Downloads/personal-os");

    // Compute time suffix early — used in output template and --download-sections
    let trim_start = opts.start.as_deref().unwrap_or("").trim();
    let trim_end = opts.end.as_deref().unwrap_or("").trim();
    let time_suffix = if !trim_start.is_empty() || !trim_end.is_empty() {
        let s = if trim_start.is_empty() { "0" } else { trim_start };
        let e = if trim_end.is_empty() { "inf" } else { trim_end };
        format!(" [{}-{}]", s, e)
    } else {
        String::new()
    };
    let duplicate_suffix = match opts.overwrite_idx.unwrap_or(0) {
        n if n > 0 => format!(" ({})", n),
        _ => String::new(),
    };
    let name_suffix = format!("{}{}", time_suffix, duplicate_suffix);

    // Output template — channel_folder takes priority, then playlist, then default
    // Time-trimmed files get suffix in name to avoid collisions with full downloads
    let out_tpl = match opts.channel_folder.as_deref().filter(|s| !s.is_empty()) {
        Some(folder) => format!(
            "{}/{}/%(upload_date>%d.%m.%Y)s - %(title).160B{}.%(ext)s",
            dl_dir, folder, name_suffix
        ),
        None if opts.playlist.unwrap_or(false) => format!(
            "{}/%(playlist_title|%(uploader)s)s/%(playlist_index|0)03d - %(upload_date>%d.%m.%Y)s - %(title).160B{}.%(ext)s",
            dl_dir, name_suffix
        ),
        None => format!(
            "{}/%(upload_date>%d.%m.%Y)s - %(title).170B{}.%(ext)s",
            dl_dir, name_suffix
        ),
    };

    let mut args: Vec<String> = vec![
        "--newline".into(),
        "--progress".into(),
        "--no-warnings".into(),
        "--no-overwrites".into(),
        "--retries".into(),
        "5".into(),
        "--fragment-retries".into(),
        "5".into(),
        "--retry-sleep".into(),
        "3".into(),
        "-o".into(),
        out_tpl,
    ];

    if opts.playlist.unwrap_or(false) {
        args.push("--yes-playlist".into());
    } else {
        args.push("--no-playlist".into());
    }

    if let Some(cf) = &opts.cookies_file {
        if !cf.is_empty() && std::path::Path::new(cf).exists() {
            args.push("--cookies".into());
            args.push(cf.clone());
        }
    }

    // Time section trim
    if !trim_start.is_empty() || !trim_end.is_empty() {
        let s = if trim_start.is_empty() { "0" } else { trim_start };
        let e = if trim_end.is_empty() { "inf" } else { trim_end };
        args.extend_from_slice(&[
            "--download-sections".into(),
            format!("*{}-{}", s, e),
            "--force-keyframes-at-cuts".into(),
        ]);
    }

    // SponsorBlock
    if opts.sponsorblock.unwrap_or(false) {
        args.extend_from_slice(&[
            "--sponsorblock-remove".into(),
            "sponsor,intro,outro,selfpromo,interaction".into(),
        ]);
    }

    match opts.mode.as_str() {
        "Audio" => {
            let fmt = opts
                .audio_format
                .as_deref()
                .unwrap_or("mp3")
                .to_lowercase();
            args.extend_from_slice(&[
                "-x".into(),
                "--audio-format".into(),
                fmt,
                "--audio-quality".into(),
                "0".into(),
                "--embed-metadata".into(),
            ]);
            if opts.embed_thumb.unwrap_or(false) {
                args.push("--embed-thumbnail".into());
            }
            if opts.split_chapters.unwrap_or(false) {
                args.extend_from_slice(&[
                    "--split-chapters".into(),
                    "-o".into(),
                    "chapter:%(title)s - %(section_title)s.%(ext)s".into(),
                ]);
            }
        }
        "Vidéo" | "Video" => {
            let quality = opts.video_quality.as_deref().unwrap_or("Best");
            let fmt = opts
                .video_format
                .as_deref()
                .unwrap_or("mp4")
                .to_lowercase();
            let codec = opts.video_codec.as_deref().unwrap_or("any");
            let req_h = if quality == "Best" {
                "2160"
            } else {
                quality.trim_end_matches('p')
            };

            let format_str = match codec {
                "h264" => format!("bv*[vcodec^=avc][height<={}]+ba/b", req_h),
                "av1" => "bv*[vcodec^=av01]+ba/b".to_string(),
                "vp9" => format!("bv*[vcodec^=vp09][height<={}]+ba/b", req_h),
                _ => {
                    if quality == "Best" {
                        "bv*+ba/b".to_string()
                    } else {
                        format!("bv*[height<={}]+ba/b[height<={}]", req_h, req_h)
                    }
                }
            };

            args.extend_from_slice(&[
                "-f".into(),
                format_str,
                "--merge-output-format".into(),
                fmt,
                "--embed-metadata".into(),
                "--embed-chapters".into(),
            ]);
            if opts.embed_thumb.unwrap_or(false) {
                args.push("--embed-thumbnail".into());
            }
            if opts.embed_subs.unwrap_or(false) {
                let lang = opts.sub_lang.as_deref().unwrap_or("fr");
                args.extend_from_slice(&[
                    "--embed-subs".into(),
                    "--sub-langs".into(),
                    lang.into(),
                    "--write-auto-subs".into(),
                ]);
            }
            if opts.split_chapters.unwrap_or(false) {
                args.push("--split-chapters".into());
            }
        }
        "Subs" | "Sous-titres" => {
            let lang = opts.sub_lang.as_deref().unwrap_or("fr");
            let sub_fmt = opts
                .sub_format
                .as_deref()
                .unwrap_or("srt")
                .to_lowercase();
            // "txt" is not a valid yt-dlp convert target — use "srt" as fallback
            let convert_fmt = if sub_fmt == "txt" { "srt" } else { sub_fmt.as_str() };
            args.extend_from_slice(&[
                "--skip-download".into(),
                "--write-subs".into(),
                "--write-auto-subs".into(),
                "--sub-langs".into(),
                lang.into(),
                "--convert-subs".into(),
                convert_fmt.into(),
                "--sleep-subtitles".into(),
                "2".into(),
            ]);
        }
        _ => {}
    }

    args.push(url.to_string());
    args
}

async fn run_job(app: &AppHandle, entry: JobEntry) {
    let args = build_args(&entry.url, &entry.opts);

    let _ = app.emit(
        "ytdlp://log",
        LogEvent {
            id: entry.id,
            line: format!("$ yt-dlp {}", args.join(" ")),
        },
    );

    let spawn_result = app.shell().command("yt-dlp").args(&args).spawn();
    let (mut rx, _child) = match spawn_result {
        Ok(r) => r,
        Err(e) => {
            let _ = app.emit(
                "ytdlp://error",
                YtdlpErrorEvent {
                    id: entry.id,
                    message: e.to_string(),
                },
            );
            return;
        }
    };

    let mut title = String::new();

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                let line = String::from_utf8_lossy(&bytes).trim().to_string();
                if line.is_empty() {
                    continue;
                }
                let _ = app.emit(
                    "ytdlp://log",
                    LogEvent {
                        id: entry.id,
                        line: line.clone(),
                    },
                );

                if let Some(rest) = line.strip_prefix("[download]") {
                    let rest = rest.trim();
                    if let Some(progress) = parse_download_progress(rest) {
                        let _ = app.emit(
                            "ytdlp://progress",
                            ProgressEvent {
                                id: entry.id,
                                progress,
                            },
                        );
                    }
                    // Title from destination filename
                    if title.is_empty() {
                        if let Some(dest) = rest.strip_prefix("Destination: ") {
                            let path = std::path::Path::new(dest.trim());
                            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                                title = if let Some(pos) = stem.find(" - ") {
                                    let prefix = &stem[..pos];
                                    if prefix.chars().all(|c| c.is_ascii_digit() || c == '.') {
                                        stem[pos + 3..].to_string()
                                    } else {
                                        stem.to_string()
                                    }
                                } else {
                                    stem.to_string()
                                };
                            }
                        }
                    }
                }
            }
            CommandEvent::Terminated(payload) => {
                if payload.code == Some(0) {
                    let _ = app.emit(
                        "ytdlp://complete",
                        CompleteEvent {
                            id: entry.id,
                            title: title.clone(),
                        },
                    );
                } else {
                    let _ = app.emit(
                        "ytdlp://error",
                        YtdlpErrorEvent {
                            id: entry.id,
                            message: format!("exit {}", payload.code.unwrap_or(-1)),
                        },
                    );
                }
                break;
            }
            _ => {}
        }
    }
}

fn parse_download_progress(download_line: &str) -> Option<f64> {
    // Fast path for the canonical format: "85.3% of ..."
    if let Some(pct_str) = download_line.split_whitespace().next() {
        if let Some(stripped) = pct_str.strip_suffix('%') {
            if let Ok(pct) = stripped.replace(',', ".").parse::<f64>() {
                if (0.0..=100.0).contains(&pct) {
                    return Some(pct / 100.0);
                }
            }
        }
    }

    // Fallback: find first '%' and parse the numeric chunk immediately before it.
    let pct_idx = download_line.find('%')?;
    if pct_idx == 0 {
        return None;
    }

    let bytes = download_line.as_bytes();
    let mut start = pct_idx;
    while start > 0 {
        let c = bytes[start - 1] as char;
        if c.is_ascii_digit() || c == '.' || c == ',' {
            start -= 1;
        } else {
            break;
        }
    }

    if start == pct_idx {
        return None;
    }

    let raw = &download_line[start..pct_idx];
    let pct = raw.replace(',', ".").parse::<f64>().ok()?;
    if (0.0..=100.0).contains(&pct) {
        Some(pct / 100.0)
    } else {
        None
    }
}
