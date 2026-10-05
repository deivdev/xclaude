# Changelog

Formato [Keep a Changelog](https://keepachangelog.com/it-IT/1.1.0/), versioni [SemVer](https://semver.org/lang/it/).
Scrivi le novità sotto "Unreleased": `pnpm release` le sposta nella nuova versione.

## [Unreleased]

## [1.0.0] - 2026-10-05

### Aggiunto

- Più sessioni di Claude Code in una finestra, ognuna in una PTY con la shell dell'utente (`$SHELL -l -i`); uscendo da Claude Code resta la shell.
- Sidebar con una card per sessione: titolo del task, progetto e branch, ultima azione, tempo nello stato.
- Bordo della card acceso secondo lo stato, dagli hook HTTP di Claude Code: arancio lavora, verde finito, lavanda ti aspetta (permessi, domande, approvazione del piano).
- Esc, Ctrl+C e i permessi rifiutati, che non generano hook, portano comunque la card a "finito".
- Terminale xterm.js 6 (WebGL) con font, palette e cursore del profilo gnome-terminal; Ctrl+Shift+C/V, Ctrl+V a Claude Code, Shift+Enter per andare a capo.
- Riga con modello, token di contesto e percorso della sessione attiva, letti dal transcript.
- Toast e notifica desktop quando una sessione ti aspetta; il titolo della finestra conta le sessioni in attesa.
- Impostazioni: tema sistema/scuro/chiaro, avvio con `--dangerously-skip-permissions`, argomenti extra per `claude`, cartelle recenti.
- Scorciatoie: Ctrl+Shift+N nuova, Ctrl+Shift+W chiudi, Alt+1…9, Ctrl+PgSu/PgGiù, Ctrl+Shift+J prossima in attesa, Ctrl+, impostazioni.
- Conferma prima di chiudere la finestra con sessioni al lavoro.
