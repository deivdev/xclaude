import "@xterm/xterm/css/xterm.css";
import "./style.css";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import { getVersion } from "@tauri-apps/api/app";
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { homeDir } from "@tauri-apps/api/path";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { createTerminal, loadProfile, terminalTheme, type Profile } from "./terminal";
import { L, resolveLang, setLang } from "./i18n";

type Status = "starting" | "ready" | "working" | "idle" | "waiting" | "ended";

interface Info {
  model: string | null;
  context_tokens: number | null;
  last_text: string | null;
}

/** What a card says next to its state: a fixed phrase (`key`, around `text`) or `text` as is. */
interface Detail {
  key: string | null;
  text: string;
}

interface StatusEvent {
  id: string;
  claude_id: string | null;
  status: Exclude<Status, "starting">;
  detail: Detail;
  cwd: string | null;
  prompt: string | null;
  info: Info | null;
}

/** A Claude Code session on disk, from `past_sessions`. */
interface PastSession {
  id: string;
  cwd: string;
  title: string;
  last_prompt: string | null;
  branch: string | null;
  modified: number;
  running: boolean;
}

type Theme = "system" | "dark" | "light";
type Language = "system" | "en" | "it";

interface Settings {
  skip_permissions: boolean;
  claude_args: string;
  theme: Theme | "";
  language: Language | "";
  recent: string[];
}

interface Session {
  id: string;
  /** Claude Code's session id, from the hooks (or the one being resumed). */
  claudeId: string | null;
  cwd: string;
  branch: string | null;
  title: string;
  prompt: string;
  status: Status;
  detail: Detail;
  since: number;
  model: string | null;
  contextTokens: number | null;
  term: Terminal;
  fit: FitAddon;
  el: HTMLDivElement;
  card: HTMLDivElement;
  lastOutput: number;
  /** Set when the user presses a key that may end the turn without a hook (Esc, Ctrl+C, a menu choice). */
  armed: number;
}

const GLYPH: Record<Status, string> = { starting: "·", ready: "›", working: "", idle: "✓", waiting: "!", ended: "$" };
const SPIN = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const $list = $("list");
const $terms = $("terms");
const $empty = $("empty");
const $toasts = $("toasts");
const win = getCurrentWindow();

const sessions: Session[] = [];
let active: Session | null = null;
let profile: Profile;
let settings: Settings = { skip_permissions: false, claude_args: "", theme: "system", language: "system", recent: [] };
let systemDark = true;
let dark = true;
let home = "";
let spin = 0;
let hooksWarned = false;

/* ---------- formatting ---------- */

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const basename = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;
const tilde = (p: string) => (home && p.startsWith(home) ? "~" + p.slice(home.length) : p);
const plain = (t: string) => t.replace(/[`*_#>]+/g, "").replace(/\s+/g, " ").trim();
const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const ago = (ms: number) => {
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  return m < 1 ? L.now : m < 60 ? L.ago(m, "min") : h < 24 ? L.ago(h, "h") : L.ago(Math.floor(h / 24), "d");
};
const ktok = (n: number) => (n < 1000 ? String(n) : `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`);
const prettyModel = (m: string) => {
  const r = /claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?!\d)/.exec(m);
  return r ? `${r[1][0].toUpperCase()}${r[1].slice(1)} ${r[2]}${r[3] ? "." + r[3] : ""}` : m;
};
/** Claude Code prefixes the terminal title with a spinner glyph. */
const cleanTitle = (t: string) => {
  const c = t.replace(/^[^\p{L}\p{N}]+/u, "").trim();
  return /^claude( code)?$/i.test(c) ? "" : c;
};
const titleOf = (s: Session) => s.title || s.prompt || L.newSession;
const NO_DETAIL: Detail = { key: null, text: "" };
const said = (text: string): Detail => ({ key: null, text });
const detailOf = (s: Session) => {
  const { key, text } = s.detail;
  const fixed = key ? L.detail[key] : undefined;
  return fixed ? fixed.replace("{}", text) : text || L.defaultDetail[s.status];
};
const timeOf = (s: Session) => {
  const d = Date.now() - s.since;
  return s.status === "working" || s.status === "waiting" ? clock(d) : ago(d);
};

/* ---------- rendering ---------- */

function buildCard(s: Session) {
  const card = s.card;
  card.className = "card";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.innerHTML = `<span class="gl" aria-hidden="true"></span><span class="ti"></span><span class="tm"></span><span class="pt"></span><span class="dt"><b></b><span class="dx"></span></span>
    <button class="btn x" type="button"><svg viewBox="0 0 16 16"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg></button>`;
  card.addEventListener("click", () => select(s));
  card.addEventListener("keydown", (e) => {
    if (e.target === card && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      select(s);
    }
  });
  const x = card.querySelector<HTMLButtonElement>(".x")!;
  x.addEventListener("click", (e) => {
    e.stopPropagation();
    // A click on a busy session only arms the button; the second one closes it.
    const busy = s.status === "working" || s.status === "waiting";
    if (busy && !x.classList.contains("confirm")) {
      x.classList.add("confirm");
      x.textContent = L.closeConfirm;
      setTimeout(() => {
        x.classList.remove("confirm");
        x.innerHTML = `<svg viewBox="0 0 16 16"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>`;
      }, 3000);
      return;
    }
    closeSession(s);
  });
}

function render(s: Session) {
  const on = s === active;
  const c = s.card;
  c.className = `card st-${s.status}${on ? " active" : ""}`;
  c.setAttribute("aria-current", on ? "true" : "false");
  const detail = detailOf(s);
  c.title = `${titleOf(s)}\n${tilde(s.cwd)}\n${L.label[s.status]} · ${detail}`;
  c.querySelector(".ti")!.textContent = titleOf(s);
  c.querySelector(".pt")!.textContent = basename(s.cwd) + (s.branch ? ` · ${s.branch}` : "");
  c.querySelector(".dt b")!.textContent = L.label[s.status];
  c.querySelector(".dx")!.textContent = " · " + detail;
  const x = c.querySelector<HTMLButtonElement>(".x")!;
  x.title = `${L.closeSession} (Ctrl+Shift+W)`;
  x.setAttribute("aria-label", L.closeSession);
  renderGlyph(s);
  renderTime(s);
  if (on) renderHeader(s);
}

function renderGlyph(s: Session) {
  s.card.querySelector(".gl")!.textContent = s.status === "working" ? SPIN[spin % SPIN.length] : GLYPH[s.status];
}

function renderTime(s: Session) {
  s.card.querySelector(".tm")!.textContent = timeOf(s);
}

function renderHeader(s: Session | null) {
  const strip = $("strip");
  const title = $("wtitle");
  if (!s) {
    strip.innerHTML = "";
    title.textContent = "";
    return;
  }
  strip.innerHTML =
    (s.model ? `<span>${L.model} <b>${esc(prettyModel(s.model))}</b></span>` : "") +
    (s.contextTokens != null ? `<span>${L.context(ktok(s.contextTokens))}</span>` : "") +
    `<span class="sp">${esc(tilde(s.cwd))}${s.branch ? " · " + esc(s.branch) : ""}</span>`;
  title.innerHTML = `<b>${esc(titleOf(s))}</b> — ${esc(basename(s.cwd))}`;
}

function summary() {
  const n = (st: Status) => sessions.filter((s) => s.status === st).length;
  const waiting = n("waiting");
  $("counts").innerHTML = sessions.length
    ? `<span style="--k:var(--wait)" title="${L.countWaiting}">${waiting}</span>` +
      `<span style="--k:var(--work)" title="${L.countWorking}">${n("working")}</span>` +
      `<span style="--k:var(--idle)" title="${L.countIdle}">${n("idle")}</span>`
    : "";
  const badge = $("badge");
  badge.hidden = !waiting;
  badge.textContent = String(waiting);
  void win.setTitle(waiting ? `(${waiting}) xclaude` : "xclaude");
  $empty.hidden = sessions.length > 0;
  if (!sessions.length) renderRecent();
}

function renderRecent() {
  void invoke<PastSession[]>("past_sessions", { limit: 30 }).then((all) => {
    const list = all.filter(canPick).slice(0, 5);
    const box = $("past");
    box.innerHTML = list.length ? `<span class="lbl">${L.recentSessions}</span>` : "";
    box.append(...list.map((p) => pastRow(p, () => pick(p))));
  });
  const dirs = settings.recent;
  const box = $("recent");
  box.innerHTML = dirs.length ? `<span class="lbl">${L.recentFolders}</span>` : "";
  for (const d of dirs) {
    const b = document.createElement("button");
    b.className = "btn";
    b.type = "button";
    b.textContent = tilde(d);
    b.addEventListener("click", () => void createSession(d));
    box.append(b);
  }
}

function toast(opts: { glyph?: string; title: string; text?: string; action?: string; run?: () => void; attn?: boolean }) {
  const el = document.createElement("div");
  el.className = "toast" + (opts.attn ? " attn" : "");
  el.innerHTML =
    (opts.glyph ? `<span class="gl" aria-hidden="true">${esc(opts.glyph)}</span>` : "") +
    `<div class="tx"><b>${esc(opts.title)}</b>${opts.text ? `<span>${esc(opts.text)}</span>` : ""}</div>` +
    (opts.action ? `<button class="btn" type="button">${esc(opts.action)}</button>` : "");
  el.querySelector("button")?.addEventListener("click", () => {
    opts.run?.();
    el.remove();
  });
  $toasts.prepend(el);
  setTimeout(() => el.remove(), 8000);
}

/* ---------- state ---------- */

function setStatus(s: Session, status: Status, detail = NO_DETAIL) {
  if (s.status !== status) {
    s.status = status;
    s.since = Date.now();
    if (status === "waiting") void attention(s);
  }
  s.detail = detail;
  render(s);
  summary();
}

async function attention(s: Session) {
  const focused = document.hasFocus();
  const text = detailOf(s);
  if (s !== active || !focused) {
    toast({ glyph: "!", title: L.needsYou(basename(s.cwd)), text, action: L.open, run: () => select(s), attn: true });
  }
  if (!focused) {
    let ok = await isPermissionGranted();
    if (!ok) ok = (await requestPermission()) === "granted";
    if (ok) sendNotification({ title: L.needsYou(basename(s.cwd)), body: text });
  }
}

function refreshBranch(s: Session) {
  void invoke<string | null>("git_branch", { cwd: s.cwd }).then((b) => {
    if (b !== s.branch) {
      s.branch = b;
      render(s);
    }
  });
}

function onHook(e: StatusEvent) {
  const s = sessions.find((x) => x.id === e.id);
  if (!s) return;
  s.armed = 0;
  if (e.claude_id) s.claudeId = e.claude_id;
  if (e.cwd && e.cwd !== s.cwd) {
    s.cwd = e.cwd;
    refreshBranch(s);
  }
  if (e.prompt && !s.prompt) s.prompt = e.prompt;
  if (e.info) {
    s.model = e.info.model ?? s.model;
    s.contextTokens = e.info.context_tokens ?? s.contextTokens;
  }
  let detail = e.detail;
  if (e.status === "idle") {
    if (!detail.key && !detail.text && e.info?.last_text) detail = said(plain(e.info.last_text));
    refreshBranch(s);
  }
  setStatus(s, e.status, detail);
}

function onInput(s: Session, data: string) {
  void invoke("write_session", { id: s.id, data });
  const ends = (s.status === "working" && (data === "\x1b" || data === "\x03")) ||
    (s.status === "waiting" && /^(\r|\x1b|[1-9])$/.test(data));
  if (ends) s.armed = Date.now();
}

/* ---------- theme ---------- */

const isDark = (theme: Settings["theme"] = settings.theme) => (theme === "dark" ? true : theme === "light" ? false : systemDark);

function applyTheme(nextDark: boolean) {
  dark = nextDark;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const theme = terminalTheme(profile, dark);
  document.documentElement.style.setProperty("--term-bg", theme.background!);
  for (const s of sessions) s.term.options.theme = theme;
  // GTK widgets (the folder picker) follow too.
  void win.setTheme(dark ? "dark" : "light").catch(() => {});
}

async function readSystemDark() {
  const fromGnome = await invoke<boolean | null>("system_dark").catch(() => null);
  return fromGnome ?? matchMedia("(prefers-color-scheme: dark)").matches;
}

/* ---------- language ---------- */

/** Rewrites the page and every card in the chosen language. */
function applyLanguage(choice: Settings["language"] = settings.language) {
  setLang(resolveLang(choice));
  for (const s of sessions) render(s);
  renderHeader(active);
  summary();
  if ($resume.open) renderPicker();
}

function saveSettings(next: Settings) {
  settings = next;
  return invoke("set_settings", { settings }).catch((err) =>
    toast({ glyph: "!", title: L.settingsNotSaved, text: String(err), attn: true }),
  );
}

function remember(dir: string) {
  void saveSettings({ ...settings, recent: [dir, ...settings.recent.filter((d) => d !== dir)].slice(0, 8) });
}

/* ---------- settings dialog ---------- */

const $settings = $<HTMLDialogElement>("settings");
const $skip = $<HTMLInputElement>("s-skip");
const $args = $<HTMLInputElement>("s-args");

function renderPreview() {
  const parts = ["claude", $skip.checked ? "--dangerously-skip-permissions" : "", $args.value.trim()];
  $("s-preview").textContent = parts.filter(Boolean).join(" ");
}

const themeInputs = () => [...document.querySelectorAll<HTMLInputElement>('input[name="s-theme"]')];
const chosenTheme = () => (themeInputs().find((i) => i.checked)?.value ?? "system") as Theme;
const langInputs = () => [...document.querySelectorAll<HTMLInputElement>('input[name="s-lang"]')];
const chosenLang = () => (langInputs().find((i) => i.checked)?.value ?? "system") as Language;

function openSettings() {
  if ($settings.open || $resume.open) return;
  for (const i of themeInputs()) i.checked = i.value === (settings.theme || "system");
  for (const i of langInputs()) i.checked = i.value === (settings.language || "system");
  $skip.checked = settings.skip_permissions;
  $args.value = settings.claude_args;
  renderPreview();
  $settings.showModal();
}

// Theme and language preview live; closing without saving puts the saved ones back.
for (const i of themeInputs()) i.addEventListener("change", () => applyTheme(isDark(chosenTheme())));
for (const i of langInputs()) i.addEventListener("change", () => applyLanguage(chosenLang()));
$skip.addEventListener("change", renderPreview);
$args.addEventListener("input", renderPreview);
$("s-cancel").addEventListener("click", () => $settings.close());
$("settings-form").addEventListener("submit", () => {
  void saveSettings({
    ...settings,
    theme: chosenTheme(),
    language: chosenLang(),
    skip_permissions: $skip.checked,
    claude_args: $args.value.trim(),
  });
});
$settings.addEventListener("close", () => {
  applyTheme(isDark());
  applyLanguage();
  active?.term.focus();
});

async function createSession(cwd: string, resume?: PastSession) {
  const el = document.createElement("div");
  el.className = "term";
  $terms.append(el);
  const { term, fit } = createTerminal(profile, terminalTheme(profile, dark), el, (data) => onInput(s, data));
  const s: Session = {
    id: "", claudeId: resume?.id ?? null, cwd, branch: null, title: "", prompt: resume?.title ?? "", status: "starting", detail: NO_DETAIL, since: Date.now(),
    model: null, contextTokens: null, term, fit, el, card: document.createElement("div"), lastOutput: 0, armed: 0,
  };
  buildCard(s);
  sessions.push(s);
  $list.append(s.card);
  select(s);
  fit.fit();

  const output = new Channel<ArrayBuffer>();
  output.onmessage = (buf) => {
    s.lastOutput = Date.now();
    term.write(new Uint8Array(buf));
  };
  try {
    s.id = await invoke<string>("spawn_session", { cwd, cols: term.cols, rows: term.rows, resume: resume?.id ?? null, output });
  } catch (err) {
    term.write(`\r\n\x1b[31m${L.cannotStart}: ${err}\x1b[0m\r\n`);
    setStatus(s, "ended", said(String(err)));
    return;
  }
  term.onData((data) => onInput(s, data));
  term.onResize(({ cols, rows }) => void invoke("resize_session", { id: s.id, cols, rows }));
  term.onTitleChange((t) => {
    const c = cleanTitle(t);
    if (c && c !== s.title) {
      s.title = c;
      render(s);
    }
  });
  remember(cwd);
  refreshBranch(s);
  render(s);
  summary();

  // SessionStart should arrive within a few seconds; if not, hooks are not reaching us.
  setTimeout(() => {
    if (s.status !== "starting" || !sessions.includes(s)) return;
    setStatus(s, "ready", { key: "noStatus", text: "" });
    if (!hooksWarned) {
      hooksWarned = true;
      toast({ glyph: "!", title: L.hooksSilent, text: L.hooksSilentText, attn: true });
    }
  }, 20000);
}

function select(s: Session | null) {
  const prev = active;
  active = s;
  if (prev && prev !== s) {
    prev.el.classList.remove("active");
    render(prev);
  }
  if (!s) {
    renderHeader(null);
    return;
  }
  s.el.classList.add("active");
  render(s);
  s.term.focus();
}

function removeSession(s: Session) {
  const i = sessions.indexOf(s);
  if (i < 0) return;
  sessions.splice(i, 1);
  s.term.dispose();
  s.el.remove();
  s.card.remove();
  if (active === s) select(sessions[Math.min(i, sessions.length - 1)] ?? null);
  summary();
}

function closeSession(s: Session) {
  if (s.id) void invoke("kill_session", { id: s.id });
  removeSession(s);
}

/* ---------- resume dialog ---------- */

const $resume = $<HTMLDialogElement>("resume");
const $filter = $<HTMLInputElement>("r-filter");
let past: PastSession[] = [];
let shown: PastSession[] = [];
let sel = 0;
let loading = false;

const openHere = (p: PastSession) => sessions.find((s) => s.claudeId === p.id);
const canPick = (p: PastSession) => !p.running || !!openHere(p);

function pastRow(p: PastSession, run: () => void) {
  const b = document.createElement("button");
  b.className = "ps";
  b.type = "button";
  const here = openHere(p);
  const line = (cls: string, text: string) => {
    const el = document.createElement("span");
    el.className = cls;
    el.textContent = text;
    b.append(el);
  };
  line("ti", p.title);
  line("tm", here ? L.pastOpen : ago(Date.now() - p.modified));
  line("pt", tilde(p.cwd) + (p.branch ? ` · ${p.branch}` : ""));
  if (p.last_prompt) line("lp", p.last_prompt);
  if (here) b.title = L.pastOpenHere;
  else if (p.running) {
    b.disabled = true;
    b.title = L.pastOpenElsewhere;
  }
  b.addEventListener("click", run);
  return b;
}

/** Resuming a session that is already open here just selects its card. */
function pick(p: PastSession) {
  if ($resume.open) $resume.close();
  const here = openHere(p);
  if (here) select(here);
  else if (!p.running) void createSession(p.cwd, p);
}

/** Sessions open in another terminal go last, under their own label; the
 * arrows and Enter only move through the ones that can be picked. */
function renderPicker() {
  const q = $filter.value.trim().toLowerCase();
  const match = past.filter((p) => !q || [p.title, p.cwd, p.branch, p.last_prompt].some((t) => t?.toLowerCase().includes(q)));
  shown = match.filter(canPick);
  const busy = match.filter((p) => !canPick(p));
  sel = Math.min(sel, Math.max(0, shown.length - 1));
  const rows: HTMLElement[] = shown.map((p, i) => {
    const row = pastRow(p, () => pick(p));
    row.classList.toggle("sel", i === sel);
    return row;
  });
  if (busy.length) {
    const lbl = document.createElement("span");
    lbl.className = "lbl";
    lbl.textContent = L.openElsewhere;
    rows.push(lbl, ...busy.map((p) => pastRow(p, () => {})));
  }
  const list = $("r-list");
  list.replaceChildren(...rows);
  list.querySelector(".sel")?.scrollIntoView({ block: "nearest" });
  $("r-empty").hidden = match.length > 0;
  $("r-empty").textContent = loading ? L.loadingSessions : past.length ? L.noMatch : L.noPast;
}

// The list from the last opening shows at once, then the fresh one replaces it.
async function openResume() {
  if ($resume.open || $settings.open) return;
  $filter.value = "";
  sel = 0;
  loading = true;
  renderPicker();
  $resume.showModal();
  past = await invoke<PastSession[]>("past_sessions", { limit: 100 }).catch(() => past);
  loading = false;
  if ($resume.open) renderPicker();
}

$filter.addEventListener("input", () => {
  sel = 0;
  renderPicker();
});
$filter.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    sel = Math.max(0, Math.min(shown.length - 1, sel + (e.key === "ArrowDown" ? 1 : -1)));
    renderPicker();
  } else if (e.key === "Enter") {
    e.preventDefault();
    const p = shown[sel];
    if (p && canPick(p)) pick(p);
  }
});
$resume.addEventListener("close", () => active?.term.focus());

async function newSession() {
  const dir = await open({ directory: true, multiple: false, defaultPath: settings.recent[0] ?? home, title: L.projectFolder });
  if (typeof dir === "string") await createSession(dir);
}

function cycle(step: number) {
  if (!sessions.length) return;
  const i = active ? sessions.indexOf(active) : -1;
  select(sessions[(i + step + sessions.length) % sessions.length]);
}

function nextWaiting() {
  const i = active ? sessions.indexOf(active) : -1;
  const order = [...sessions.slice(i + 1), ...sessions.slice(0, i + 1)];
  const s = order.find((x) => x.status === "waiting");
  if (s) select(s);
}

const busyCount = () => sessions.filter((s) => s.status === "working" || s.status === "waiting").length;

// Closing xclaude ends every session: ask first when some are still busy.
void win.onCloseRequested((e) => {
  const busy = busyCount();
  if (!busy) return;
  e.preventDefault();
  toast({
    glyph: "!",
    title: L.stillWorking(busy),
    text: L.closingCloses,
    action: L.closeAnyway,
    run: () => void win.destroy(),
    attn: true,
  });
});

/* ---------- wiring ---------- */

function stop(e: Event) {
  e.preventDefault();
  e.stopPropagation();
}

// Capture phase: app shortcuts win over the terminal.
window.addEventListener(
  "keydown",
  (e) => {
    const ctrl = e.ctrlKey && !e.altKey && !e.metaKey;
    if (ctrl && e.shiftKey && e.code === "KeyN") {
      stop(e);
      void newSession();
    } else if (ctrl && e.shiftKey && e.code === "KeyR") {
      stop(e);
      void openResume();
    } else if (ctrl && e.shiftKey && e.code === "KeyW") {
      stop(e);
      if (active) closeSession(active);
    } else if (ctrl && !e.shiftKey && e.code === "Comma") {
      stop(e);
      openSettings();
    } else if (ctrl && e.shiftKey && e.code === "KeyJ") {
      stop(e);
      nextWaiting();
    } else if (ctrl && !e.shiftKey && (e.key === "PageDown" || e.key === "PageUp")) {
      stop(e);
      cycle(e.key === "PageDown" ? 1 : -1);
    } else if (e.altKey && !e.ctrlKey && !e.shiftKey && /^Digit[1-9]$/.test(e.code)) {
      const s = sessions[Number(e.code.slice(5)) - 1];
      if (s) {
        stop(e);
        select(s);
      }
    }
  },
  true,
);
window.addEventListener("contextmenu", (e) => e.preventDefault());

for (const id of ["new", "new2", "new3"]) $(id).addEventListener("click", () => void newSession());
for (const id of ["resume2", "resume3"]) $(id).addEventListener("click", () => void openResume());
$("next").addEventListener("click", nextWaiting);
$("open-settings").addEventListener("click", openSettings);
$("w-min").addEventListener("click", () => void win.minimize());
$("w-max").addEventListener("click", () => void win.toggleMaximize());
$("w-close").addEventListener("click", () => void win.close());

let fitQueued = false;
new ResizeObserver(() => {
  if (fitQueued) return;
  fitQueued = true;
  requestAnimationFrame(() => {
    fitQueued = false;
    for (const s of sessions) s.fit.fit();
  });
}).observe($terms);

setInterval(() => {
  spin++;
  for (const s of sessions) if (s.status === "working") renderGlyph(s);
}, 120);

setInterval(() => {
  const now = Date.now();
  for (const s of sessions) {
    renderTime(s);
    // Esc / Ctrl+C / "No" end a turn without any hook: once the terminal goes
    // quiet after such a key, the session is waiting for a new prompt.
    if (s.armed && now - s.armed > 1500 && now - s.lastOutput > 1200 && (s.status === "working" || s.status === "waiting")) {
      s.armed = 0;
      setStatus(s, "idle", { key: "interrupted", text: "" });
    }
  }
}, 500);

async function main() {
  [profile, home, settings, systemDark] = await Promise.all([
    loadProfile(),
    homeDir().catch(() => ""),
    invoke<Settings>("get_settings"),
    readSystemDark(),
  ]);
  applyTheme(isDark());
  setLang(resolveLang(settings.language));
  void getVersion().then((v) => ($("s-version").textContent = `xclaude ${v}`));
  // Follow a system switch (quick settings) when the window comes back into focus.
  void win.onFocusChanged(async ({ payload: focused }) => {
    if (!focused || (settings.theme && settings.theme !== "system")) return;
    systemDark = await readSystemDark();
    if (isDark() !== dark) applyTheme(isDark());
  });
  await document.fonts.load(`${profile.font_size}px "${profile.font_family}"`).catch(() => {});
  await listen<StatusEvent>("session-status", ({ payload }) => onHook(payload));
  await listen<{ id: string }>("session-exit", ({ payload }) => {
    const s = sessions.find((x) => x.id === payload.id);
    if (s) removeSession(s);
  });
  summary();
}

// The system language until the settings arrive.
setLang(resolveLang("system"));
void main();
