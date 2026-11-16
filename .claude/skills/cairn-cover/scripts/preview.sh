#!/bin/sh
# Render cover SVG(s) to PNG through macOS QuickLook (WebKit, the same engine
# as the Cairn app) so you can look at the result before installing it.
# Usage: preview.sh cover.svg [more.svg ...]   → prints the PNG path(s)
set -eu
[ $# -ge 1 ] || { echo "usage: $0 cover.svg [...]" >&2; exit 2; }
out="${TMPDIR:-/tmp}/cairn-cover-preview"
mkdir -p "$out"
for svg in "$@"; do
  qlmanage -t -s 700 -o "$out" "$svg" >/dev/null 2>&1 || { echo "render failed: $svg" >&2; exit 1; }
  echo "$out/$(basename "$svg").png"
done
