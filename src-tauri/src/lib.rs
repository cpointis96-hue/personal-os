mod cmds;

use tauri::Manager;
use cmds::browser::{
    BrowserState, create_browser_webview, destroy_browser_webview, go_back_browser_webview,
    go_forward_browser_webview, hide_browser_webview, navigate_browser_webview,
    reload_browser_webview, resize_browser_webview, show_browser_webview,
};
use cmds::chat::{chat_stop_stream, chat_stream, openrouter_models, ChatStreamState};
use cmds::terminal::{TerminalState, terminal_kill, terminal_resize, terminal_spawn, terminal_write};
use cmds::x::{
    XSchedulerState, x_get_gallery_dl_path, x_scrape_all, x_scrape_profile,
    x_start_scheduler, x_test_gallery_dl,
};
use cmds::youtube::{
    YoutubeState, yt_back, yt_clear_session, yt_close, yt_forward, yt_open, yt_reload,
    yt_get_title, yt_hide, yt_show,
    yt_set_bounds,
};
use cmds::ytdlp::{
    YtdlpState, ytdlp_enqueue, ytdlp_fetch_channel, ytdlp_queue_status,
    ytdlp_set_max_concurrent, ytdlp_update, ytdlp_version, whisper_transcribe,
};
use tauri_plugin_sql::{Builder, Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "initial schema",
        sql: include_str!("../migrations/0001_init.sql"),
        kind: MigrationKind::Up,
    }];

    let ytdlp_state = YtdlpState::new();

    tauri::Builder::default()
        .manage(TerminalState::new())
        .manage(XSchedulerState::new())
        .manage(YoutubeState::new())
        .manage(BrowserState::new())
        .manage(ChatStreamState::new())
        .manage(ytdlp_state)
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            cmds::ytdlp::start_worker(
                app.handle().clone(),
                &app.state::<YtdlpState>(),
            );
            Ok(())
        })
        .plugin(
            Builder::new()
                .add_migrations("sqlite:personal-os.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            terminal_spawn,
            terminal_write,
            terminal_resize,
            terminal_kill,
            create_browser_webview,
            resize_browser_webview,
            navigate_browser_webview,
            go_back_browser_webview,
            go_forward_browser_webview,
            reload_browser_webview,
            show_browser_webview,
            hide_browser_webview,
            destroy_browser_webview,
            x_get_gallery_dl_path,
            x_test_gallery_dl,
            x_scrape_profile,
            x_scrape_all,
            x_start_scheduler,
            chat_stream,
            yt_open,
            yt_show,
            yt_hide,
            yt_get_title,
            yt_close,
            yt_set_bounds,
            yt_back,
            yt_forward,
            yt_reload,
            yt_clear_session,
            openrouter_models,
            ytdlp_enqueue,
            ytdlp_set_max_concurrent,
            ytdlp_queue_status,
            ytdlp_update,
            ytdlp_version,
            ytdlp_fetch_channel,
            whisper_transcribe,
            chat_stop_stream,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
