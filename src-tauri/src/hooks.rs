//! Session status from Claude Code hooks.
//!
//! Every session's `claude` gets `--settings <file>` with HTTP hooks that POST
//! their JSON input to a local server. The xclaude session id travels in a
//! header, interpolated from the `XCLAUDE_SID` variable of the PTY environment.

use std::{
    fs,
    io::{self, Read, Write},
    path::Path,
    thread,
};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::transcript;

pub struct Server {
    port: u16,
    token: String,
}

/// (hook event, route, matcher). The route is the event name, except for the
/// Notification types that mean "the user must act now".
const HOOKS: &[(&str, &str, Option<&str>)] = &[
    ("SessionStart", "SessionStart", None),
    ("UserPromptSubmit", "UserPromptSubmit", None),
    ("UserPromptExpansion", "UserPromptExpansion", None),
    ("PreToolUse", "PreToolUse", None),
    ("PostToolUse", "PostToolUse", None),
    ("PostToolUseFailure", "PostToolUseFailure", None),
    ("PermissionRequest", "PermissionRequest", None),
    (
        "Notification",
        "NeedsInput",
        Some("permission_prompt|elicitation_dialog|elicitation_url_dialog|agent_needs_input"),
    ),
    ("Elicitation", "Elicitation", None),
    ("ElicitationResult", "ElicitationResult", None),
    ("PreCompact", "PreCompact", None),
    ("PostCompact", "PostCompact", None),
    ("Stop", "Stop", None),
    ("StopFailure", "StopFailure", None),
    ("SessionEnd", "SessionEnd", None),
];

const MAX_BODY: u64 = 32 << 20;

/// What the card says next to the state: a fixed phrase the UI words in its
/// language (`key`, around `text`), or `text` as is. Empty: the UI's default.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
struct Detail {
    key: Option<&'static str>,
    text: String,
}

impl Detail {
    fn text(text: impl Into<String>) -> Self {
        Self { key: None, text: text.into() }
    }

    fn key(key: &'static str) -> Self {
        Self { key: Some(key), text: String::new() }
    }
}

#[derive(Serialize, Clone)]
struct StatusEvent {
    id: String,
    /// Claude Code's own session id (it changes on /clear).
    claude_id: Option<String>,
    status: &'static str,
    detail: Detail,
    cwd: Option<String>,
    prompt: Option<String>,
    info: Option<transcript::Info>,
}

pub fn start(app: AppHandle) -> io::Result<Server> {
    let http = tiny_http::Server::http("127.0.0.1:0").map_err(io::Error::other)?;
    let port = http
        .server_addr()
        .to_ip()
        .map(|a| a.port())
        .ok_or_else(|| io::Error::other("hook server has no TCP port"))?;
    let token = random_token();
    let expected = token.clone();

    thread::spawn(move || {
        for mut req in http.incoming_requests() {
            let header = |name: &'static str| {
                req.headers()
                    .iter()
                    .find(|h| h.field.equiv(name))
                    .map(|h| h.value.as_str().to_string())
            };
            let sid = header("X-Xclaude-Sid");
            let authorized = header("X-Xclaude-Token").as_deref() == Some(expected.as_str());
            let route = req.url().strip_prefix("/hook/").unwrap_or_default().to_string();
            let mut body = Vec::new();
            let _ = req.as_reader().take(MAX_BODY).read_to_end(&mut body);
            // Answer before doing any work: Claude Code waits for the response.
            let _ = req.respond(tiny_http::Response::empty(200));

            let (true, Some(id)) = (authorized, sid) else { continue };
            let Ok(input) = serde_json::from_slice::<Value>(&body) else { continue };
            let Some((status, detail)) = classify(&route, &input) else { continue };
            let info = matches!(route.as_str(), "SessionStart" | "PostToolUse" | "Stop" | "StopFailure")
                .then(|| input["transcript_path"].as_str().and_then(transcript::read))
                .flatten();
            let _ = app.emit(
                "session-status",
                StatusEvent {
                    id,
                    claude_id: input["session_id"].as_str().map(String::from),
                    status,
                    detail,
                    cwd: input["cwd"].as_str().map(String::from),
                    prompt: input["prompt"].as_str().map(|p| clip(p, 200)),
                    info,
                },
            );
        }
    });

    Ok(Server { port, token })
}

/// Each running xclaude writes its own hook file (`claude-hooks-<pid>.json`), so
/// a dev build and the installed app can run side by side. This removes the
/// files of instances that are gone.
pub fn remove_stale(dir: &Path) {
    #[cfg(target_os = "linux")]
    for entry in fs::read_dir(dir).into_iter().flatten().flatten() {
        let name = entry.file_name();
        let pid = name.to_str().and_then(|n| n.strip_prefix("claude-hooks-")).and_then(|n| n.strip_suffix(".json"));
        if let Some(pid) = pid {
            if !Path::new("/proc").join(pid).exists() {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
}

pub fn write_settings(path: &Path, server: &Server) -> io::Result<()> {
    let mut hooks = serde_json::Map::new();
    for (event, route, matcher) in HOOKS {
        let mut group = json!({ "hooks": [{
            "type": "http",
            "url": format!("http://127.0.0.1:{}/hook/{route}", server.port),
            "timeout": 3,
            "headers": { "X-Xclaude-Sid": "$XCLAUDE_SID", "X-Xclaude-Token": server.token },
            "allowedEnvVars": ["XCLAUDE_SID"],
        }]});
        if let Some(m) = matcher {
            group["matcher"] = json!(m);
        }
        hooks.entry(event.to_string()).or_insert_with(|| json!([])).as_array_mut().unwrap().push(group);
    }
    let body = serde_json::to_string_pretty(&json!({ "hooks": hooks }))?;

    // The file carries the server token: owner-only.
    let mut file = fs::OpenOptions::new().write(true).create(true).truncate(true).open(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(0o600))?;
    }
    file.write_all(body.as_bytes())
}

/// Maps a hook to (status, detail).
fn classify(route: &str, v: &Value) -> Option<(&'static str, Detail)> {
    let tool = v["tool_name"].as_str().unwrap_or_default();
    Some(match route {
        // A compaction restarts the session in the middle of a turn.
        "SessionStart" if v["source"] == "compact" => return None,
        "SessionStart" => ("ready", Detail::default()),
        "UserPromptSubmit" | "UserPromptExpansion" | "ElicitationResult" => ("working", Detail::default()),
        "PreToolUse" if matches!(tool, "AskUserQuestion" | "ExitPlanMode") => ("waiting", waiting_detail(v)),
        "PreToolUse" | "PostToolUse" | "PostToolUseFailure" => ("working", Detail::text(tool_call(v))),
        "PermissionRequest" => ("waiting", waiting_detail(v)),
        "NeedsInput" => ("waiting", Detail::text(v["message"].as_str().unwrap_or_default())),
        "Elicitation" => ("waiting", Detail::key("mcp")),
        "PreCompact" => ("working", Detail::key("compacting")),
        "PostCompact" if v["trigger"] == "manual" => ("idle", Detail::key("compacted")),
        "PostCompact" => ("working", Detail::default()),
        "Stop" => ("idle", Detail::default()),
        "StopFailure" => ("idle", Detail::key("error")),
        "SessionEnd" => ("ended", Detail::default()),
        _ => return None,
    })
}

fn waiting_detail(v: &Value) -> Detail {
    match v["tool_name"].as_str().unwrap_or_default() {
        "AskUserQuestion" => v["tool_input"]["questions"][0]["question"]
            .as_str()
            .map_or_else(|| Detail::key("question"), |q| Detail::text(clip(q, 160))),
        "ExitPlanMode" => Detail::key("plan"),
        _ => Detail { key: Some("permission"), text: tool_call(v) },
    }
}

/// "Bash(cargo check)", "Edit(src/main.ts)": the tool and its main argument.
fn tool_call(v: &Value) -> String {
    let name = v["tool_name"].as_str().unwrap_or("tool");
    let input = &v["tool_input"];
    let arg = ["command", "file_path", "notebook_path", "pattern", "url", "query", "skill", "description"]
        .iter()
        .find_map(|k| input[*k].as_str());
    let Some(arg) = arg else { return name.to_string() };
    let cwd = v["cwd"].as_str().unwrap_or_default();
    let arg = match arg.strip_prefix(cwd) {
        Some(rest) if !cwd.is_empty() && rest.starts_with('/') => &rest[1..],
        _ => arg,
    };
    format!("{name}({})", clip(arg.lines().next().unwrap_or_default(), 80))
}

pub fn clip(s: &str, max: usize) -> String {
    let s = s.trim();
    match s.char_indices().nth(max) {
        Some((i, _)) => format!("{}…", &s[..i]),
        None => s.to_string(),
    }
}

fn random_token() -> String {
    let mut bytes = [0u8; 16];
    if fs::File::open("/dev/urandom").and_then(|mut f| f.read_exact(&mut bytes)).is_err() {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or_default();
        bytes = (nanos ^ u128::from(std::process::id())).to_le_bytes();
    }
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_hooks_to_states() {
        let bash = json!({"tool_name": "Bash", "tool_input": {"command": "cargo check\n--all"}, "cwd": "/p"});
        assert_eq!(classify("PreToolUse", &bash), Some(("working", Detail::text("Bash(cargo check)"))));
        let permission = Detail { key: Some("permission"), text: "Bash(cargo check)".into() };
        assert_eq!(classify("PermissionRequest", &bash), Some(("waiting", permission)));
        let ask = json!({"tool_name": "AskUserQuestion", "tool_input": {"questions": [{"question": "Quale?"}]}});
        assert_eq!(classify("PreToolUse", &ask), Some(("waiting", Detail::text("Quale?"))));
        let plan = json!({"tool_name": "ExitPlanMode", "tool_input": {}});
        assert_eq!(classify("PreToolUse", &plan), Some(("waiting", Detail::key("plan"))));
        assert_eq!(classify("PostToolUse", &ask).unwrap().0, "working");
        assert_eq!(classify("SessionStart", &json!({"source": "compact"})), None);
        assert_eq!(classify("Stop", &json!({})).unwrap().0, "idle");
        assert_eq!(classify("Unknown", &json!({})), None);
    }

    #[test]
    fn tool_call_is_relative_to_cwd() {
        let edit = json!({"tool_name": "Edit", "tool_input": {"file_path": "/p/src/a.rs"}, "cwd": "/p"});
        assert_eq!(tool_call(&edit), "Edit(src/a.rs)");
        let other = json!({"tool_name": "Read", "tool_input": {"file_path": "/px/a.rs"}, "cwd": "/p"});
        assert_eq!(tool_call(&other), "Read(/px/a.rs)");
    }

    #[test]
    fn clip_counts_chars() {
        assert_eq!(clip("àèìòù", 3), "àèì…");
        assert_eq!(clip("  ok ", 3), "ok");
    }
}
