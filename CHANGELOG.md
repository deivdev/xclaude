# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions: [SemVer](https://semver.org/).
Write the changes under "Unreleased": `pnpm release` moves them into the new version.

## [Unreleased]

### Fixed

- On Linux the window no longer dies when WebKitGTK's Skia compositor crashes: xclaude starts WebKit with its TextureMapper compositor, still on the GPU (`WEBKIT_USE_SKIA_FOR_COMPOSITION=1` brings Skia back).

## [1.2.1] - 2026-10-06

### Added

- `.deb`, `.rpm` and AppImage packages on the GitHub releases.

### Changed

- GPL-3.0 license.
- The app launcher entry is in English.
- The changelog is in English.

## [1.2.0] - 2026-10-06

### Added

- English interface. The language is chosen in the settings, below the theme: System (English, or Italian if the system is in Italian), English, Italiano.
- README in English, with images.

## [1.1.1] - 2026-10-06

### Fixed

- Middle click pasted the selection twice (WebKitGTK ≥ 2.46). It now pastes once, like gnome-terminal: if the program uses the mouse, the click goes to it, unless you hold Shift.

## [1.1.0] - 2026-10-05

### Added

- Resume a session (Ctrl+Shift+R or from the sidebar): the latest Claude Code sessions from every project, with title, folder, branch and last prompt, and a search. Pick one and xclaude runs `claude --resume` in its folder.
- The latest sessions to resume also show on the screen with no open sessions.
- A session already open in xclaude takes you to its card; one open in another terminal stays in the list but cannot be resumed until you close it there.

## [1.0.0] - 2026-10-05

### Added

- Several Claude Code sessions in one window, each in a PTY with the user's shell (`$SHELL -l -i`); when Claude Code exits, the shell is still there.
- Sidebar with a card per session: task title, project and branch, last action, time in the current state.
- The card border lights up with the state, from Claude Code's HTTP hooks: orange working, green done, lavender waiting for you (permissions, questions, plan approval).
- Esc, Ctrl+C and denied permissions, which fire no hook, still bring the card to "done".
- xterm.js 6 terminal (WebGL) with the font, palette and cursor of the gnome-terminal profile; Ctrl+Shift+C/V, Ctrl+V to Claude Code, Shift+Enter for a new line.
- Line with model, context tokens and path of the active session, read from the transcript.
- Toast and desktop notification when a session is waiting for you; the window title counts the waiting sessions.
- Settings: system/dark/light theme, start with `--dangerously-skip-permissions`, extra arguments for `claude`, recent folders.
- Shortcuts: Ctrl+Shift+N new, Ctrl+Shift+W close, Alt+1…9, Ctrl+PgUp/PgDn, Ctrl+Shift+J next waiting, Ctrl+, settings.
- Confirmation before closing the window with sessions at work.
