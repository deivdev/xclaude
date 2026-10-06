/** Interface strings in English and Italian; `L` always holds the current language. */

export type Lang = "en" | "it";

const en = {
  label: { starting: "Starting", ready: "Ready", working: "Working", idle: "Done", waiting: "Needs you", ended: "Shell" },
  defaultDetail: {
    starting: "starting Claude Code…",
    ready: "type a prompt",
    working: "thinking",
    idle: "waiting for your next prompt",
    waiting: "needs you",
    ended: "Claude Code has exited",
  },
  /** Fixed details, from the hooks or the app; `{}` is the tool call. */
  detail: {
    permission: "permission: {}",
    question: "has a question",
    plan: "approve the plan",
    mcp: "an MCP server is asking for input",
    compacting: "compacting the context",
    compacted: "context compacted",
    error: "stopped on an error",
    interrupted: "interrupted",
    noStatus: "state unavailable",
  } as Record<string, string>,
  now: "now",
  ago: (n: number, unit: "min" | "h" | "d") => `${n} ${unit} ago`,
  newSession: "New session",
  closeSession: "Close session",
  closeConfirm: "Close?",
  model: "Model",
  context: (n: string) => `Context <b>${n}</b> tokens`,
  countWaiting: "Need you",
  countWorking: "Working",
  countIdle: "Done",
  recentSessions: "Recent sessions",
  recentFolders: "Recent folders",
  needsYou: (name: string) => `${name} needs you`,
  open: "Open",
  settingsNotSaved: "Settings not saved",
  cannotStart: "Cannot start the session",
  hooksSilent: "Claude Code's hooks are not responding",
  hooksSilentText: "The cards won't show the state of the sessions.",
  pastOpen: "open",
  pastOpenHere: "Already open in xclaude: go to its card",
  pastOpenElsewhere: "Open in another terminal: close it there to resume it here",
  openElsewhere: "Open in another terminal",
  loadingSessions: "Loading sessions…",
  noMatch: "No session matches.",
  noPast: "No Claude Code sessions to resume.",
  projectFolder: "Project folder",
  stillWorking: (n: number) => (n === 1 ? "A session is still working" : `${n} sessions are still working`),
  closingCloses: "Closing xclaude closes them too.",
  closeAnyway: "Close anyway",
  /** Static text in index.html, by `data-i18n*` key. */
  html: {
    settings: "Settings",
    settingsTip: "Settings (Ctrl+,)",
    next: "Next session that needs you",
    nextTip: "Next session that needs you (Ctrl+Shift+J)",
    minimize: "Minimize",
    minimizeWindow: "Minimize window",
    maximize: "Maximize",
    maximizeWindow: "Maximize window",
    close: "Close",
    closeWindow: "Close window",
    openSessions: "Open sessions",
    sessions: "Sessions",
    newSession: "New session",
    newSessionTip: "New session (Ctrl+Shift+N)",
    resumeSession: "Resume a session",
    noSessions: "No open sessions",
    emptyText: "Pick a project folder: xclaude opens Claude Code there, in your shell. Or resume an earlier session.",
    openFolder: "Open a folder",
    search: "Search by title, folder, branch or prompt",
    searchLabel: "Search sessions",
    theme: "Theme",
    system: "System",
    dark: "Dark",
    light: "Light",
    themeHint: 'For Claude Code\'s colors to follow the theme too, pick <code>/theme</code> → "Auto (match terminal)" in Claude Code.',
    language: "Language",
    startup: "Starting Claude Code",
    startupNote: "Applies to the sessions you open from now on.",
    skip: "Start without asking for permissions",
    skipHint: "Adds <code>--dangerously-skip-permissions</code>: Claude runs commands and edits files without asking you first.",
    args: "Extra arguments for claude",
    argsExample: "e.g. --model opus",
    command: "Command",
    cancel: "Cancel",
    save: "Save",
  } as Record<string, string>,
};

export type Strings = typeof en;

const it: Strings = {
  label: { starting: "Avvio", ready: "Pronta", working: "Lavora", idle: "Finito", waiting: "Ti aspetta", ended: "Shell" },
  defaultDetail: {
    starting: "avvio di Claude Code…",
    ready: "scrivi un prompt",
    working: "sta pensando",
    idle: "aspetta il prossimo prompt",
    waiting: "ti aspetta",
    ended: "Claude Code è chiuso",
  },
  detail: {
    permission: "permesso: {}",
    question: "ha una domanda",
    plan: "approva il piano",
    mcp: "un server MCP chiede dei dati",
    compacting: "compatta il contesto",
    compacted: "contesto compattato",
    error: "si è fermata per un errore",
    interrupted: "interrotta",
    noStatus: "stato non disponibile",
  },
  now: "ora",
  ago: (n, unit) => `${n} ${unit === "d" ? "g" : unit} fa`,
  newSession: "Nuova sessione",
  closeSession: "Chiudi sessione",
  closeConfirm: "Chiudi?",
  model: "Modello",
  context: (n) => `Contesto <b>${n}</b> token`,
  countWaiting: "Ti aspettano",
  countWorking: "Lavorano",
  countIdle: "Finite",
  recentSessions: "Sessioni recenti",
  recentFolders: "Cartelle recenti",
  needsYou: (name) => `${name} ti aspetta`,
  open: "Apri",
  settingsNotSaved: "Impostazioni non salvate",
  cannotStart: "Non riesco ad avviare la sessione",
  hooksSilent: "Gli hook di Claude Code non rispondono",
  hooksSilentText: "Le card non mostreranno lo stato delle sessioni.",
  pastOpen: "aperta",
  pastOpenHere: "Già aperta in xclaude: vai alla sua card",
  pastOpenElsewhere: "Aperta in un altro terminale: chiudila lì per riprenderla qui",
  openElsewhere: "Aperte in un altro terminale",
  loadingSessions: "Carico le sessioni…",
  noMatch: "Nessuna sessione corrisponde.",
  noPast: "Nessuna sessione di Claude Code da riprendere.",
  projectFolder: "Cartella del progetto",
  stillWorking: (n) => (n === 1 ? "Una sessione è ancora al lavoro" : `${n} sessioni sono ancora al lavoro`),
  closingCloses: "Chiudendo xclaude si chiudono anche loro.",
  closeAnyway: "Chiudi comunque",
  html: {
    settings: "Impostazioni",
    settingsTip: "Impostazioni (Ctrl+,)",
    next: "Prossima sessione che ti aspetta",
    nextTip: "Prossima sessione che ti aspetta (Ctrl+Shift+J)",
    minimize: "Riduci",
    minimizeWindow: "Riduci finestra",
    maximize: "Massimizza",
    maximizeWindow: "Massimizza finestra",
    close: "Chiudi",
    closeWindow: "Chiudi finestra",
    openSessions: "Sessioni aperte",
    sessions: "Sessioni",
    newSession: "Nuova sessione",
    newSessionTip: "Nuova sessione (Ctrl+Shift+N)",
    resumeSession: "Riprendi una sessione",
    noSessions: "Nessuna sessione aperta",
    emptyText: "Scegli la cartella di un progetto: xclaude apre Claude Code lì dentro, nella tua shell. Oppure riprendi una sessione di prima.",
    openFolder: "Apri una cartella",
    search: "Cerca per titolo, cartella, branch o prompt",
    searchLabel: "Cerca una sessione",
    theme: "Tema",
    system: "Sistema",
    dark: "Scuro",
    light: "Chiaro",
    themeHint: 'Perché anche i colori di Claude Code seguano il tema, in Claude Code scegli <code>/theme</code> → "Auto (match terminal)".',
    language: "Lingua",
    startup: "Avvio di Claude Code",
    startupNote: "Vale per le sessioni che apri da adesso.",
    skip: "Avvia senza chiedere i permessi",
    skipHint: "Aggiunge <code>--dangerously-skip-permissions</code>: Claude esegue comandi e modifica file senza chiederti conferma.",
    args: "Altri argomenti per claude",
    argsExample: "es. --model opus",
    command: "Comando",
    cancel: "Annulla",
    save: "Salva",
  },
};

export let L: Strings = en;

/** "en" or "it" as chosen, otherwise the system language (English unless Italian). */
export const resolveLang = (choice: string): Lang =>
  choice === "en" || choice === "it" ? choice : navigator.language.toLowerCase().startsWith("it") ? "it" : "en";

/** Switches `L` and rewrites the static text of the page. */
export function setLang(lang: Lang) {
  L = lang === "it" ? it : en;
  document.documentElement.lang = lang;
  const each = (attr: string, set: (el: HTMLElement, text: string) => void) => {
    for (const el of document.querySelectorAll<HTMLElement>(`[${attr}]`)) {
      const text = L.html[el.getAttribute(attr)!];
      if (text != null) set(el, text);
    }
  };
  each("data-i18n", (el, t) => (el.textContent = t));
  each("data-i18n-html", (el, t) => (el.innerHTML = t));
  each("data-i18n-title", (el, t) => (el.title = t));
  each("data-i18n-aria", (el, t) => el.setAttribute("aria-label", t));
  each("data-i18n-placeholder", (el, t) => ((el as HTMLInputElement).placeholder = t));
}
