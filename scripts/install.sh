#!/usr/bin/env bash
# Builds the release binary and installs xclaude for the current user under
# ~/.local, with an entry in the app launcher. Run it again to upgrade.
set -euo pipefail
cd "$(dirname "$0")/.."

pnpm tauri build --no-bundle

version=$(node -p 'require("./package.json").version')
bin="$HOME/.local/bin"
share="${XDG_DATA_HOME:-$HOME/.local/share}"

install -Dm755 src-tauri/target/release/xclaude "$bin/xclaude"
for size in 32 64 128; do
  install -Dm644 "src-tauri/icons/${size}x${size}.png" "$share/icons/hicolor/${size}x${size}/apps/xclaude.png"
done
install -Dm644 "src-tauri/icons/128x128@2x.png" "$share/icons/hicolor/256x256/apps/xclaude.png"
install -Dm644 "src-tauri/icons/icon.png" "$share/icons/hicolor/512x512/apps/xclaude.png"

# The window's Wayland app id is the binary name, so StartupWMClass=xclaude
# ties the running window to this entry (icon in the dock and in Alt+Tab).
mkdir -p "$share/applications"
cat > "$share/applications/xclaude.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=xclaude
GenericName=Claude Code sessions
Comment=Several Claude Code sessions in one window, with the state of each
Exec=$bin/xclaude
Icon=xclaude
Terminal=false
Categories=Development;
Keywords=claude;code;terminal;ai;
StartupWMClass=xclaude
EOF

update-desktop-database "$share/applications" 2>/dev/null || true
gtk-update-icon-cache -f -t "$share/icons/hicolor" 2>/dev/null || true

echo "xclaude $version installed: $bin/xclaude"
