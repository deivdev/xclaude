mod hooks;
mod profile;
mod pty;
mod settings;
mod transcript;

use std::{fs, process::Command};

use tauri::Manager;

/// Current branch of the git repository at `cwd`, if any.
#[tauri::command]
async fn git_branch(cwd: String) -> Option<String> {
    let out = Command::new("git")
        .args(["-C", &cwd, "rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// The default size can exceed small or scaled screens: maximize instead.
fn fit_to_screen(win: &tauri::WebviewWindow) {
    let monitor = win.current_monitor().ok().flatten().or_else(|| win.primary_monitor().ok().flatten());
    let (Some(monitor), Ok(size)) = (monitor, win.outer_size()) else { return };
    let area = monitor.work_area().size;
    if size.width > area.width || size.height > area.height {
        let _ = win.maximize();
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            fs::create_dir_all(&dir)?;
            let server = hooks::start(app.handle().clone())?;
            hooks::remove_stale(&dir);
            let hooks_file = dir.join(format!("claude-hooks-{}.json", std::process::id()));
            hooks::write_settings(&hooks_file, &server)?;
            app.manage(pty::Sessions::new(hooks_file));

            let config = app.path().app_config_dir()?;
            fs::create_dir_all(&config)?;
            app.manage(settings::Store::load(config.join("settings.json")));

            if let Some(win) = app.get_webview_window("main") {
                fit_to_screen(&win);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pty::spawn_session,
            pty::write_session,
            pty::resize_session,
            pty::kill_session,
            profile::terminal_profile,
            profile::system_dark,
            git_branch,
            settings::get_settings,
            settings::set_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running xclaude");
}
