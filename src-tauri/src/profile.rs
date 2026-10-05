//! Font and colors of the user's default gnome-terminal profile, so the embedded
//! terminals look like the terminal they already use.

use std::{collections::HashMap, process::Command};

use serde::Serialize;

#[derive(Serialize, Debug, PartialEq)]
pub struct Profile {
    font_family: String,
    /// CSS pixels.
    font_size: f64,
    /// None: "use colors from system theme", picked by the UI for dark or light.
    foreground: Option<String>,
    background: Option<String>,
    cursor: Option<String>,
    palette: Vec<String>,
    /// "block" | "underline" | "bar", as xterm.js names them.
    cursor_shape: String,
    cursor_blink: bool,
    scrollback: u32,
    bold_is_bright: bool,
}

const TANGO: [&str; 16] = [
    "#2e3436", "#cc0000", "#4e9a06", "#c4a000", "#3465a4", "#75507b", "#06989a", "#d3d7cf",
    "#555753", "#ef2929", "#8ae234", "#fce94f", "#729fcf", "#ad7fa8", "#34e2e2", "#eeeeec",
];

#[tauri::command]
pub async fn terminal_profile() -> Profile {
    gnome_terminal().unwrap_or_else(fallback)
}

/// GNOME's dark style preference; None outside GNOME.
#[tauri::command]
pub async fn system_dark() -> Option<bool> {
    gsettings(&["get", "org.gnome.desktop.interface", "color-scheme"]).map(|s| s.contains("dark"))
}

fn fallback() -> Profile {
    Profile {
        font_family: if cfg!(target_os = "macos") { "Menlo" } else { "monospace" }.into(),
        font_size: if cfg!(target_os = "macos") { 13.0 } else { 15.0 },
        foreground: None,
        background: None,
        cursor: None,
        palette: TANGO.iter().map(|c| c.to_string()).collect(),
        cursor_shape: "block".into(),
        cursor_blink: true,
        scrollback: 10_000,
        bold_is_bright: false,
    }
}

fn gnome_terminal() -> Option<Profile> {
    let id = gsettings(&["get", "org.gnome.Terminal.ProfilesList", "default"])?;
    let id = unquote(id.trim());
    let schema = format!("org.gnome.Terminal.Legacy.Profile:/org/gnome/terminal/legacy/profiles:/:{id}/");
    // `list-recursively` includes schema defaults, unlike `dconf dump`.
    let keys: HashMap<String, String> = gsettings(&["list-recursively", &schema])?
        .lines()
        .filter_map(|l| {
            let mut parts = l.splitn(3, ' ');
            parts.next()?;
            Some((parts.next()?.to_string(), parts.next()?.to_string()))
        })
        .collect();
    let get = |k: &str| keys.get(k).map(String::as_str);
    let interface = |k: &str| gsettings(&["get", "org.gnome.desktop.interface", k]).map(|v| v.trim().to_string());

    let font = match get("use-system-font") {
        Some("false") => get("font").map(unquote),
        _ => interface("monospace-font-name").map(|f| unquote(&f)),
    }
    .unwrap_or_else(|| "Monospace 11".into());
    let (family, points) = split_font(&font);
    let scale = interface("text-scaling-factor").and_then(|s| s.parse::<f64>().ok()).unwrap_or(1.0);

    let (foreground, background) = if get("use-theme-colors") == Some("false") {
        (get("foreground-color").and_then(color), get("background-color").and_then(color))
    } else {
        (None, None)
    };

    let palette: Vec<String> = get("palette")
        .map(|p| p.split('\'').skip(1).step_by(2).filter_map(color).collect())
        .filter(|p: &Vec<String>| p.len() == 16)
        .unwrap_or_else(|| TANGO.iter().map(|c| c.to_string()).collect());

    let cursor = (get("cursor-colors-set") == Some("true"))
        .then(|| get("cursor-background-color").and_then(color))
        .flatten();

    let cursor_blink = match get("cursor-blink-mode").map(unquote).as_deref() {
        Some("on") => true,
        Some("off") => false,
        _ => interface("cursor-blink").as_deref() != Some("false"),
    };

    let scrollback = if get("scrollback-unlimited") == Some("true") {
        100_000
    } else {
        get("scrollback-lines").and_then(|s| s.parse().ok()).unwrap_or(10_000)
    };

    Some(Profile {
        font_family: resolve_family(&family),
        font_size: (points * 96.0 / 72.0 * scale * 10.0).round() / 10.0,
        foreground,
        background,
        cursor,
        palette,
        cursor_shape: match get("cursor-shape").map(unquote).as_deref() {
            Some("ibeam") => "bar",
            Some("underline") => "underline",
            _ => "block",
        }
        .into(),
        cursor_blink,
        scrollback,
        bold_is_bright: get("bold-is-bright") == Some("true"),
    })
}

fn gsettings(args: &[&str]) -> Option<String> {
    run("gsettings", args)
}

fn run(program: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(program).args(args).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

fn unquote(s: &str) -> String {
    s.trim().trim_matches('\'').to_string()
}

/// "Noto Sans Mono Bold 12" -> ("Noto Sans Mono Bold", 12.0)
fn split_font(font: &str) -> (String, f64) {
    match font.rsplit_once(' ') {
        Some((family, size)) if size.parse::<f64>().is_ok() => (family.to_string(), size.parse().unwrap()),
        _ => (font.to_string(), 11.0),
    }
}

/// Aliases like "Monospace" mean nothing to CSS: ask fontconfig for the real family.
fn resolve_family(family: &str) -> String {
    run("fc-match", &["-f", "%{family[0]}", family])
        .map(|f| f.trim().to_string())
        .filter(|f| !f.is_empty())
        .unwrap_or_else(|| family.to_string())
}

/// "rgb(46,52,54)", "rgba(46,52,54,1)" or "#2e3436" -> "#2e3436"
fn color(s: &str) -> Option<String> {
    let s = unquote(s);
    if s.starts_with('#') && s.len() == 7 {
        return Some(s.to_lowercase());
    }
    let inner = s.strip_prefix("rgba(").or_else(|| s.strip_prefix("rgb("))?.strip_suffix(')')?;
    let rgb: Vec<u8> = inner.split(',').take(3).filter_map(|c| c.trim().parse::<f64>().ok()).map(|c| c.round() as u8).collect();
    (rgb.len() == 3).then(|| format!("#{:02x}{:02x}{:02x}", rgb[0], rgb[1], rgb[2]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_gsettings_values() {
        assert_eq!(color("'rgb(46,52,54)'").as_deref(), Some("#2e3436"));
        assert_eq!(color("'#FFFFFF'").as_deref(), Some("#ffffff"));
        assert_eq!(split_font("Monospace 12"), ("Monospace".into(), 12.0));
        assert_eq!(split_font("Fira Code"), ("Fira Code".into(), 11.0));
        let palette = "['rgb(46,52,54)', 'rgb(204,0,0)']";
        let parsed: Vec<String> = palette.split('\'').skip(1).step_by(2).filter_map(color).collect();
        assert_eq!(parsed, ["#2e3436", "#cc0000"]);
    }
}
