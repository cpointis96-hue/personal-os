use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Emitter, State};

pub struct PtySession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
}

pub type PtyMap = Arc<Mutex<HashMap<String, PtySession>>>;

#[derive(Clone)]
pub struct TerminalState {
    pub sessions: PtyMap,
}

impl TerminalState {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[tauri::command]
pub fn terminal_spawn(
    panel_id: String,
    app: AppHandle,
    state: State<TerminalState>,
) -> Result<(), String> {
    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new("/bin/zsh");
    cmd.args(["-i", "-l"]);
    cmd.env("TERM", "xterm-256color");

    pair.slave
        .spawn_command(cmd)
        .map_err(|e| e.to_string())?;

    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

    let event_name = format!("terminal://stdout/{}", panel_id);
    let app_clone = app.clone();

    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_clone.emit(&event_name, data);
                }
                Err(_) => break,
            }
        }
    });

    let session = PtySession {
        writer,
        master: pair.master,
    };

    state
        .sessions
        .lock()
        .map_err(|e| e.to_string())?
        .insert(panel_id, session);

    Ok(())
}

#[tauri::command]
pub fn terminal_write(
    panel_id: String,
    data: String,
    state: State<TerminalState>,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get_mut(&panel_id)
        .ok_or_else(|| format!("no session for panel {}", panel_id))?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn terminal_resize(
    panel_id: String,
    cols: u16,
    rows: u16,
    state: State<TerminalState>,
) -> Result<(), String> {
    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get(&panel_id)
        .ok_or_else(|| format!("no session for panel {}", panel_id))?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn terminal_kill(
    panel_id: String,
    state: State<TerminalState>,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    sessions.remove(&panel_id);
    Ok(())
}
