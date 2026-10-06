# Changelog

Formato [Keep a Changelog](https://keepachangelog.com/it-IT/1.1.0/), versioni [SemVer](https://semver.org/lang/it/).
Scrivi le novità sotto "Unreleased": `pnpm release` le sposta nella nuova versione.

## [Unreleased]

### Modificato

- Licenza GPL-3.0.
- La voce nel menu delle applicazioni è in inglese.

## [1.2.0] - 2026-10-06

### Aggiunto

- Interfaccia anche in inglese. La lingua si sceglie nelle impostazioni, sotto il tema: Sistema (inglese, o italiano se il sistema è in italiano), English, Italiano.
- README in inglese, con immagini.

## [1.1.1] - 2026-10-06

### Corretto

- Il click centrale incollava la selezione due volte (WebKitGTK ≥ 2.46). Ora incolla una volta, come gnome-terminal: se il programma usa il mouse, il click va a lui, a meno di tenere Shift.

## [1.1.0] - 2026-10-05

### Aggiunto

- Riprendi una sessione (Ctrl+Shift+R o dalla sidebar): le ultime sessioni di Claude Code di tutti i progetti, con titolo, cartella, branch e ultimo prompt, e una ricerca. Scelta una, xclaude avvia `claude --resume` nella sua cartella.
- Le ultime sessioni da riprendere compaiono anche nella schermata senza sessioni aperte.
- Una sessione già aperta in xclaude porta alla sua card; una aperta in un altro terminale resta in lista ma non si riprende finché non la chiudi lì.

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
