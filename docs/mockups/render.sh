#!/usr/bin/env bash
# Renders the README images (docs/*.png) from the HTML mockups next to this
# script, with headless Chrome at 2x on a transparent background.
#   docs/mockups/render.sh [name...]   # default: every mockup
set -euo pipefail
cd "$(dirname "$0")"

chrome=$(command -v google-chrome || command -v chromium || command -v chromium-browser) || {
  echo "render: needs google-chrome or chromium" >&2
  exit 1
}

# name: viewport width x height (the frame plus its shadow margin)
declare -A size=([hero]=1368,872 [states]=1368,328 [resume]=728,668)

names=("$@")
[ ${#names[@]} -gt 0 ] || names=(hero states resume)
for name in "${names[@]}"; do
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
    --default-background-color=00000000 --allow-file-access-from-files \
    --window-size="${size[$name]}" --screenshot="$PWD/../$name.png" "file://$PWD/$name.html" 2>/dev/null
  echo "docs/$name.png"
done
