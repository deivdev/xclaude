//! Model, context size and last reply, read from the tail of a session transcript.

use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
};

use serde::Serialize;
use serde_json::Value;

use crate::hooks::clip;

const TAIL: u64 = 1 << 20;

#[derive(Serialize, Clone, Default, Debug, PartialEq)]
pub struct Info {
    model: Option<String>,
    context_tokens: Option<u64>,
    last_text: Option<String>,
}

pub fn read(path: &str) -> Option<Info> {
    let mut file = File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    file.seek(SeekFrom::Start(len.saturating_sub(TAIL))).ok()?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).ok()?;
    Some(parse(&String::from_utf8_lossy(&buf)))
}

/// Walks the JSONL backwards and takes each field from the newest main-thread
/// assistant message that has it. A partial first line just fails to parse.
fn parse(jsonl: &str) -> Info {
    let mut info = Info::default();
    for line in jsonl.lines().rev() {
        if !line.contains("\"assistant\"") {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        if v["type"] != "assistant" || v["isSidechain"] == true {
            continue;
        }
        let msg = &v["message"];
        if info.model.is_none() {
            info.model = msg["model"].as_str().filter(|m| !m.starts_with('<')).map(String::from);
        }
        if info.context_tokens.is_none() && msg["usage"].is_object() {
            let usage = &msg["usage"];
            info.context_tokens = Some(
                ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens"]
                    .iter()
                    .filter_map(|k| usage[*k].as_u64())
                    .sum(),
            );
        }
        if info.last_text.is_none() {
            info.last_text = msg["content"]
                .as_array()
                .and_then(|blocks| blocks.iter().rev().find(|b| b["type"] == "text"))
                .and_then(|b| b["text"].as_str())
                .filter(|t| !t.trim().is_empty())
                .map(|t| clip(t, 400));
        }
        if info.model.is_some() && info.context_tokens.is_some() && info.last_text.is_some() {
            break;
        }
    }
    info
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn takes_newest_values() {
        let jsonl = [
            r#"tial line {"type":"assistant""#,
            r#"{"type":"assistant","message":{"model":"claude-opus-5-5","usage":{"input_tokens":10,"cache_read_input_tokens":1000,"output_tokens":5},"content":[{"type":"text","text":"Fatto."}]}}"#,
            r#"{"type":"user","message":{"content":"ok"}}"#,
            r#"{"type":"assistant","isSidechain":true,"message":{"model":"claude-haiku","content":[{"type":"text","text":"sub"}]}}"#,
            r#"{"type":"assistant","message":{"model":"claude-opus-5-5","usage":{"input_tokens":20,"cache_read_input_tokens":2000,"output_tokens":7},"content":[{"type":"tool_use","name":"Bash"}]}}"#,
        ]
        .join("\n");
        let info = parse(&jsonl);
        assert_eq!(info.model.as_deref(), Some("claude-opus-5-5"));
        assert_eq!(info.context_tokens, Some(2027));
        assert_eq!(info.last_text.as_deref(), Some("Fatto."));
    }
}
