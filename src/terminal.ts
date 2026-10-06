import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { ClipboardAddon, type IClipboardProvider } from "@xterm/addon-clipboard";
import { invoke } from "@tauri-apps/api/core";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";

/** The user's gnome-terminal profile, as read by the backend. */
export interface Profile {
  font_family: string;
  font_size: number;
  /** null: "use colors from system theme". */
  foreground: string | null;
  background: string | null;
  cursor: string | null;
  palette: string[];
  cursor_shape: "block" | "underline" | "bar";
  cursor_blink: boolean;
  scrollback: number;
  bold_is_bright: boolean;
}

export const loadProfile = () => invoke<Profile>("terminal_profile");

const ANSI = [
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
] as const;

/** Terminal colors; theme colors are gnome-terminal's (Adwaita GTK3 view colors). */
export function terminalTheme(p: Profile, dark: boolean): ITheme {
  const foreground = p.foreground ?? (dark ? "#ffffff" : "#000000");
  const background = p.background ?? (dark ? "#2d2d2d" : "#ffffff");
  const t: ITheme = {
    background,
    foreground,
    cursor: p.cursor ?? foreground,
    cursorAccent: background,
    // VTE's default selection is reverse video.
    selectionBackground: foreground,
    selectionForeground: background,
  };
  ANSI.forEach((name, i) => {
    if (p.palette[i]) t[name] = p.palette[i];
  });
  return t;
}

// OSC 52 and copy/paste go through the system clipboard, not the webview's.
const clipboard: IClipboardProvider = {
  readText: () => readText().catch(() => ""),
  writeText: (_selection, text) => writeText(text),
};

/**
 * A terminal that behaves like gnome-terminal: Ctrl+Shift+C/V copy and paste,
 * Ctrl+V reaches the program (Claude Code pastes images with it), middle click
 * pastes the selection, Shift+Enter inserts a newline in Claude Code's prompt.
 */
export function createTerminal(p: Profile, theme: ITheme, el: HTMLElement, send: (data: string) => void) {
  const term = new Terminal({
    fontFamily: `"${p.font_family}", monospace`,
    fontSize: p.font_size,
    lineHeight: 1,
    cursorBlink: p.cursor_blink,
    cursorStyle: p.cursor_shape,
    cursorInactiveStyle: "outline",
    scrollback: p.scrollback,
    drawBoldTextInBrightColors: p.bold_is_bright,
    minimumContrastRatio: 1,
    macOptionIsMeta: true,
    allowProposedApi: true,
    theme,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new Unicode11Addon());
  term.unicode.activeVersion = "11";
  term.loadAddon(new WebLinksAddon((_event, uri) => void openUrl(uri).catch(() => {})));
  term.loadAddon(new ClipboardAddon(undefined, clipboard));

  term.attachCustomKeyEventHandler((e) => {
    const down = e.type === "keydown";
    const plain = !e.altKey && !e.metaKey;
    if (plain && e.ctrlKey && e.shiftKey && e.code === "KeyC") {
      if (down) {
        const sel = term.getSelection();
        if (sel) void writeText(sel);
      }
      return false;
    }
    if (plain && e.ctrlKey && e.shiftKey && e.code === "KeyV") {
      e.preventDefault();
      if (down) void readText().then((t) => t && term.paste(t)).catch(() => {});
      return false;
    }
    if (plain && e.ctrlKey && !e.shiftKey && e.code === "KeyV") {
      e.preventDefault();
      if (down) send("\x16");
      return false;
    }
    if (plain && e.shiftKey && !e.ctrlKey && e.key === "Enter") {
      if (down) send("\x1b\r");
      return false;
    }
    return true;
  });

  // WebKitGTK pastes PRIMARY by itself on middle-button release, and the text
  // reaches the terminal twice. Swallowing the release makes WebKit skip it;
  // paste once instead, like gnome-terminal: a program that tracks the mouse
  // gets the click, unless Shift is held.
  el.addEventListener(
    "mouseup",
    (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      if (term.modes.mouseTrackingMode !== "none" && !e.shiftKey) return;
      void invoke<string | null>("read_primary").then((t) => t && term.paste(t)).catch(() => {});
    },
    true,
  );

  term.open(el);
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => webgl.dispose());
    term.loadAddon(webgl);
  } catch {
    // No WebGL: xterm.js keeps its DOM renderer.
  }
  return { term, fit };
}
