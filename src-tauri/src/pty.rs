use std::{
    collections::HashMap,
    io::{Read, Write},
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    thread,
};

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{
    ipc::{Channel, InvokeResponseBody},
    AppHandle, Emitter, Manager, State,
};

use crate::settings;

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

pub struct Sessions {
    map: Mutex<HashMap<String, Session>>,
    next_id: AtomicU64,
    settings_file: PathBuf,
}

impl Sessions {
    pub fn new(settings_file: PathBuf) -> Self {
        Self { map: Mutex::new(HashMap::new()), next_id: AtomicU64::new(1), settings_file }
    }
}

#[derive(Serialize, Clone)]
struct SessionExit {
    id: String,
}

/// Variables a parent Claude Code leaves in the environment (e.g. when xclaude is
/// started from a Claude Code terminal); a child `claude` would think it is nested.
const INHERITED_CLAUDE_VARS: &[&str] =
    &["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_SSE_PORT"];

/// Starts `claude` in the user's interactive login shell, so PATH, aliases and
/// rc files are the same as in a normal terminal. When claude exits the user is
/// left at a shell prompt in the same terminal.
#[tauri::command]
pub fn spawn_session(
    app: AppHandle,
    state: State<Sessions>,
    store: State<settings::Store>,
    cwd: String,
    cols: u16,
    rows: u16,
    output: Channel<InvokeResponseBody>,
) -> Result<String, String> {
    let id = format!("s{}", state.next_id.fetch_add(1, Ordering::Relaxed));

    let pair = native_pty_system()
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
    let mut cmd = CommandBuilder::new(&shell);
    let script = format!(r#"{}; exec "$SHELL" -l -i"#, store.get().claude_command());
    cmd.args(["-l", "-i", "-c", &script]);
    cmd.cwd(&cwd);
    for var in INHERITED_CLAUDE_VARS {
        cmd.env_remove(var);
    }
    cmd.env("SHELL", &shell);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("XCLAUDE_SID", &id);
    cmd.env("XCLAUDE_SETTINGS", &state.settings_file);

    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let killer = child.clone_killer();
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    state.map.lock().unwrap().insert(id.clone(), Session { master: pair.master, writer, killer });

    let reader_id = id.clone();
    thread::spawn(move || {
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if output.send(InvokeResponseBody::Raw(buf[..n].to_vec())).is_err() {
                        break;
                    }
                }
            }
        }
        let _ = child.wait();
        app.state::<Sessions>().map.lock().unwrap().remove(&reader_id);
        let _ = app.emit("session-exit", SessionExit { id: reader_id });
    });

    Ok(id)
}

#[tauri::command]
pub fn write_session(state: State<Sessions>, id: String, data: String) {
    if let Some(s) = state.map.lock().unwrap().get_mut(&id) {
        let _ = s.writer.write_all(data.as_bytes());
        let _ = s.writer.flush();
    }
}

#[tauri::command]
pub fn resize_session(state: State<Sessions>, id: String, cols: u16, rows: u16) {
    if let Some(s) = state.map.lock().unwrap().get(&id) {
        let _ = s.master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 });
    }
}

#[tauri::command]
pub fn kill_session(state: State<Sessions>, id: String) {
    if let Some(mut s) = state.map.lock().unwrap().remove(&id) {
        let _ = s.killer.kill();
    }
}
