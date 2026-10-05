//! App preferences, stored as JSON in the config dir.

use std::{fs, path::PathBuf, sync::Mutex};

use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Serialize, Deserialize, Clone, Default, Debug, PartialEq)]
#[serde(default)]
pub struct Settings {
    /// Start claude with --dangerously-skip-permissions.
    pub skip_permissions: bool,
    /// Extra arguments, added to the shell command line as typed.
    pub claude_args: String,
    /// "system", "dark" or "light"; empty means "system".
    pub theme: String,
    /// Recently opened project folders, newest first.
    pub recent: Vec<String>,
}

impl Settings {
    /// What the session shell runs to start Claude Code.
    pub fn claude_command(&self) -> String {
        let mut cmd = String::from(r#"claude --settings "$XCLAUDE_SETTINGS""#);
        if self.skip_permissions {
            cmd.push_str(" --dangerously-skip-permissions");
        }
        let extra = self.claude_args.replace(['\n', '\r'], " ");
        if !extra.trim().is_empty() {
            cmd.push(' ');
            cmd.push_str(extra.trim());
        }
        cmd
    }
}

pub struct Store {
    path: PathBuf,
    current: Mutex<Settings>,
}

impl Store {
    pub fn load(path: PathBuf) -> Self {
        let current = fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        Self { path, current: Mutex::new(current) }
    }

    pub fn get(&self) -> Settings {
        self.current.lock().unwrap().clone()
    }
}

#[tauri::command]
pub fn get_settings(store: State<Store>) -> Settings {
    store.get()
}

#[tauri::command]
pub fn set_settings(store: State<Store>, settings: Settings) -> Result<(), String> {
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&store.path, json).map_err(|e| e.to_string())?;
    *store.current.lock().unwrap() = settings;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_claude_command() {
        let mut s = Settings::default();
        assert_eq!(s.claude_command(), r#"claude --settings "$XCLAUDE_SETTINGS""#);
        s.skip_permissions = true;
        s.claude_args = " --model opus\n--verbose ".into();
        assert_eq!(
            s.claude_command(),
            r#"claude --settings "$XCLAUDE_SETTINGS" --dangerously-skip-permissions --model opus --verbose"#
        );
    }
}
