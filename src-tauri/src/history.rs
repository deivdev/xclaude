//! Past Claude Code sessions, read from the transcripts under
//! `~/.claude/projects`, so a card can start with `claude --resume <id>`.

use std::{
    collections::HashSet,
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use serde::Serialize;
use serde_json::Value;

use crate::hooks::clip;

/// The head holds the session's first `cwd`; the tail holds the metadata lines
/// (title, last prompt) that Claude Code appends as the session goes.
const HEAD: u64 = 256 << 10;
const TAIL: u64 = 256 << 10;
/// Metadata lines worth parsing; every other line is only scanned.
const META: &[&str] = &[
    r#"{"type":"custom-title""#,
    r#"{"type":"agent-name""#,
    r#"{"type":"ai-title""#,
    r#"{"type":"last-prompt""#,
    r#"{"type":"continued-in""#,
];

#[derive(Serialize, Debug, Default, PartialEq)]
pub struct PastSession {
    id: String,
    cwd: String,
    title: String,
    /// The last prompt, when the title is something else.
    last_prompt: Option<String>,
    branch: Option<String>,
    /// Last write, in Unix ms.
    modified: u64,
    /// A `claude` process has it open (in xclaude or in another terminal).
    running: bool,
}

/// The newest sessions that can be resumed, newest first.
#[tauri::command]
pub async fn past_sessions(limit: usize) -> Vec<PastSession> {
    let Some(dir) = claude_dir() else { return Vec::new() };
    let running = running_sessions(&dir.join("sessions"));
    let mut files: Vec<(u64, PathBuf)> = fs::read_dir(dir.join("projects"))
        .into_iter()
        .flatten()
        .flatten()
        .flat_map(|project| fs::read_dir(project.path()).into_iter().flatten().flatten())
        .filter(|e| e.path().extension().is_some_and(|x| x == "jsonl"))
        .filter_map(|e| Some((modified_ms(&e.metadata().ok()?)?, e.path())))
        .collect();
    files.sort_unstable_by(|a, b| b.0.cmp(&a.0));
    files
        .into_iter()
        .filter_map(|(modified, path)| {
            let s = read(&path)?;
            let running = running.contains(&s.id);
            Some(PastSession { modified, running, ..s })
        })
        .filter(|s| Path::new(&s.cwd).is_dir())
        .take(limit)
        .collect()
}

fn claude_dir() -> Option<PathBuf> {
    std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".claude")))
}

fn modified_ms(meta: &fs::Metadata) -> Option<u64> {
    Some(meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_millis() as u64)
}

/// Every running `claude` registers itself in `sessions/<pid>.json`; a file
/// whose process is gone is left over from a crash.
fn running_sessions(dir: &Path) -> HashSet<String> {
    let mut ids = HashSet::new();
    if !cfg!(target_os = "linux") {
        return ids;
    }
    for entry in fs::read_dir(dir).into_iter().flatten().flatten() {
        let Ok(text) = fs::read_to_string(entry.path()) else { continue };
        let Ok(v) = serde_json::from_str::<Value>(&text) else { continue };
        if let (Some(pid), Some(id)) = (v["pid"].as_u64(), v["sessionId"].as_str()) {
            if Path::new("/proc").join(pid.to_string()).exists() {
                ids.insert(id.to_string());
            }
        }
    }
    ids
}

fn read(path: &Path) -> Option<PastSession> {
    let id = path.file_stem()?.to_str()?;
    let project = path.parent()?.file_name()?.to_str()?;
    let mut file = File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    let mut buf = Vec::new();
    if len <= HEAD + TAIL {
        file.read_to_end(&mut buf).ok()?;
        return parse(id, project, &String::from_utf8_lossy(&buf));
    }
    (&mut file).take(HEAD).read_to_end(&mut buf).ok()?;
    buf.push(b'\n');
    file.seek(SeekFrom::Start(len - TAIL)).ok()?;
    file.read_to_end(&mut buf).ok()?;
    // A huge last line can push the metadata out of the tail: read it all then.
    parse(id, project, &String::from_utf8_lossy(&buf))
        .or_else(|| parse(id, project, &String::from_utf8_lossy(&fs::read(path).ok()?)))
}

/// Walks (parts of) a transcript; partial lines just fail to parse. None for a
/// session with no prompt, started by `claude -p`, or continued in another one.
fn parse(id: &str, project: &str, jsonl: &str) -> Option<PastSession> {
    let (mut name, mut ai_title, mut last_prompt) = (None, None, None);
    let (mut cwd, mut first_cwd, mut branch) = (None, None, None);
    for line in jsonl.lines() {
        if META.iter().any(|m| line.starts_with(m)) {
            let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
            let text = |k: &str| v[k].as_str().map(one_line).filter(|t| !t.is_empty());
            match v["type"].as_str().unwrap_or_default() {
                "custom-title" => name = text("customTitle").or(name),
                "agent-name" => name = text("agentName").or(name),
                "ai-title" => ai_title = text("aiTitle").or(ai_title),
                "last-prompt" => last_prompt = text("lastPrompt").or(last_prompt),
                "continued-in" => return None,
                _ => {}
            }
            continue;
        }
        if line.contains(r#""entrypoint":"sdk-"#) {
            return None;
        }
        if let Some(c) = field(line, r#""cwd":""#) {
            // The project folder's name is the cwd Claude Code was started in,
            // with every other character than [A-Za-z0-9] turned into '-'.
            if cwd.is_none() && encode(&c) == project {
                cwd = Some(c.clone());
            }
            first_cwd.get_or_insert(c);
        }
        if let Some(b) = field(line, r#""gitBranch":""#).filter(|b| !b.is_empty()) {
            branch = Some(b);
        }
    }
    let title = name.or(ai_title);
    let last_prompt = last_prompt.map(|p| clip(&p, 200));
    let (title, last_prompt) = match title {
        Some(t) => (clip(&t, 120), last_prompt),
        None => (last_prompt?, None),
    };
    Some(PastSession {
        id: id.to_string(),
        cwd: cwd.or(first_cwd)?,
        title,
        last_prompt,
        branch,
        ..Default::default()
    })
}

/// The string value after the first `"key":"` in a raw JSONL line, without
/// parsing the line (it can be huge, or cut).
fn field(line: &str, key: &str) -> Option<String> {
    let at = line.find(key)? + key.len() - 1;
    serde_json::Deserializer::from_str(&line[at..]).into_iter::<String>().next()?.ok()
}

fn encode(path: &str) -> String {
    path.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect()
}

fn one_line(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    const USER: &str = r#"{"parentUuid":null,"type":"user","message":{"content":"say \"cwd\":\"/x\""},"cwd":"/home/u/my.app","gitBranch":"main","entrypoint":"cli"}"#;

    #[test]
    fn reads_title_cwd_and_branch() {
        let jsonl = [
            r#"tial line","cwd":"/elsewhere"}"#,
            USER,
            r#"{"type":"last-prompt","lastPrompt":"fix the\n  build","sessionId":"a"}"#,
            r#"{"type":"ai-title","aiTitle":"Old title","sessionId":"a"}"#,
            r#"{"type":"ai-title","aiTitle":"Fix build","sessionId":"a"}"#,
            r#"{"parentUuid":"p","type":"assistant","cwd":"/home/u/my.app/src","gitBranch":"fix"}"#,
        ]
        .join("\n");
        let s = parse("a", "-home-u-my-app", &jsonl).unwrap();
        assert_eq!(s.title, "Fix build");
        assert_eq!(s.last_prompt.as_deref(), Some("fix the build"));
        assert_eq!(s.cwd, "/home/u/my.app");
        assert_eq!(s.branch.as_deref(), Some("fix"));
    }

    #[test]
    fn prefers_the_user_given_name_then_the_prompt() {
        let named = format!("{USER}\n{}\n{}", r#"{"type":"agent-name","agentName":"auth fix"}"#, r#"{"type":"ai-title","aiTitle":"T"}"#);
        assert_eq!(parse("a", "-home-u-my-app", &named).unwrap().title, "auth fix");
        let untitled = format!("{USER}\n{}", r#"{"type":"last-prompt","lastPrompt":"hello"}"#);
        let s = parse("a", "-home-u-my-app", &untitled).unwrap();
        assert_eq!((s.title.as_str(), s.last_prompt), ("hello", None));
    }

    #[test]
    fn skips_what_cannot_be_resumed() {
        assert_eq!(parse("a", "-home-u-my-app", USER), None);
        let continued = format!("{USER}\n{}\n{}", r#"{"type":"ai-title","aiTitle":"T"}"#, r#"{"type":"continued-in","continuedInSessionId":"b"}"#);
        assert_eq!(parse("a", "-home-u-my-app", &continued), None);
        let sdk = format!("{}\n{}", USER.replace(r#""cli""#, r#""sdk-cli""#), r#"{"type":"ai-title","aiTitle":"T"}"#);
        assert_eq!(parse("a", "-home-u-my-app", &sdk), None);
    }

    #[test]
    fn extracts_raw_fields() {
        assert_eq!(field(r#"{"a":1,"cwd":"/p/\"q\"","b":2}"#, r#""cwd":""#).as_deref(), Some(r#"/p/"q""#));
        assert_eq!(field(r#"{"cwd":"/p/cut"#, r#""cwd":""#), None);
        assert_eq!(encode("/home/u/.claude-x"), "-home-u--claude-x");
    }
}
