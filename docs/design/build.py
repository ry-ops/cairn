#!/usr/bin/env python3
"""Build the Cairn design guide (docs/design/cairn-specimen.html).

Fills specimen.template.html with the app's built-in cover presets
(src/cover-presets/*.svg, embedded as data URIs) and the screenshots in
docs/design/shots/*.webp, producing one self-contained HTML file.

Usage (from the repo root): python3 -I docs/design/build.py
Standard library only.
"""
import base64
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
PRESETS = ROOT / "src" / "cover-presets"
SHOTS = HERE / "shots"


def data_uri(path: pathlib.Path, mime: str) -> str:
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode()}"


def main() -> int:
    tmpl = (HERE / "specimen.template.html").read_text()
    values: dict[str, str] = {}
    for svg in PRESETS.glob("*.svg"):
        values[svg.stem] = data_uri(svg, "image/svg+xml")  # e.g. monoprint, monoprint.button
    for shot in SHOTS.glob("*.webp"):
        values[shot.stem] = data_uri(shot, "image/webp")

    missing: list[str] = []

    def fill(m: re.Match) -> str:
        key = m.group(1)
        if key not in values:
            missing.append(key)
            return m.group(0)
        return values[key]

    out = re.sub(r"\{\{([\w.-]+)\}\}", fill, tmpl)
    if missing:
        print(f"missing assets for: {', '.join(sorted(set(missing)))}", file=sys.stderr)
        return 1
    # The template's first line is a note for editors; drop it from the build.
    out = out.split("\n", 1)[1] if out.startswith("<!-- Source for") else out
    target = HERE / "cairn-specimen.html"
    target.write_text(out)
    print(f"wrote {target.relative_to(ROOT)} ({len(out) // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
