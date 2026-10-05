# xclaude

App desktop per lavorare con più sessioni di Claude Code. A sinistra una card per
sessione che si accende col suo stato: arancio mentre lavora, verde quando ha
finito, lavanda quando aspetta te. A destra il terminale, con font e colori del
profilo gnome-terminal.

Tauri 2 (Rust) + xterm.js 6. Linux; macOS non ancora provato.

## Requisiti

- `claude` nel PATH della shell di login
- Rust, Node 20+, pnpm
- Fedora: `sudo dnf install webkit2gtk4.1-devel gtk3-devel libsoup3-devel javascriptcoregtk4.1-devel librsvg2-devel libappindicator-gtk3-devel libxdo-devel`

## Sviluppo

```sh
pnpm install
pnpm tauri dev
cd src-tauri && cargo test
```

## Versioni e installazione

La versione sta in `package.json` (`tauri.conf.json` la legge da lì).

```sh
# 1. annota le novità sotto "Unreleased" in CHANGELOG.md e fai commit
# 2. alza la versione, aggiorna il changelog, commit + tag vX.Y.Z
pnpm release patch        # oppure minor, major, 1.2.3
# 3. compila e installa in ~/.local con la voce nel launcher
pnpm install-app
```

## Come funziona lo stato

Ogni `claude` parte con `--settings` che aggiunge hook HTTP verso un server locale
dell'app; l'id della sessione viaggia in un header preso da `XCLAUDE_SID`.
Esc, Ctrl+C e i permessi rifiutati non generano hook: l'app li riconosce dai tasti
inviati al terminale.
