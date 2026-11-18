#!/usr/bin/env python3
"""Draw the README's animated tour of Cairn: docs/readme/*.svg.

    python3 docs/readme/build.py

Each scene is a looping SVG (SMIL), drawn in Cairn's own palette and type,
with Cairn's real art: the cover presets in their colorways (their one-shot
motion stretched into a loop), the sticker sheet, and the merit badge
patches (drawn by src/badges.ts, through docs/readme/badges.mjs). Rock Salt
is embedded where the notebook is handwritten. GitHub shows SVGs as images,
so nothing here may script or load anything from outside the file.
"""
from __future__ import annotations

import base64
import json
import math
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
PRESETS = ROOT / "src" / "cover-presets"
STICKERS = ROOT / "src" / "stickers"
ROCK_SALT = ROOT / "node_modules/@fontsource/rock-salt/files/rock-salt-latin-400-normal.woff2"

W = 880
DISPLAY = 'Futura, "Futura PT", "Century Gothic", "Avenir Next", "Trebuchet MS", sans-serif'
UI = '"Avenir Next", -apple-system, "Segoe UI", system-ui, sans-serif'
MONO = '"iA Writer Duo S", "SF Mono", Menlo, Consolas, monospace'
HAND = '"Rock Salt", "Marker Felt", cursive'

DESK, DESK2, PAGE = "#e7dcc8", "#ddd0b8", "#fbf8f1"
INK, SOFT, MARK, LINK = "#2a2622", "#5d554b", "#a89c8b", "#2f5f86"
ACCENT, LINE = "#d4552a", "rgba(42,38,34,0.12)"
RULE = "rgba(64,98,128,0.16)"

EDITIONS = {
    "kraft": ("#c49a6c", "#2b2118"), "blaze": ("#e0662f", "#24140c"),
    "pine": ("#3f5b45", "#efe6d2"), "lake": ("#2f4f6b", "#efe6d2"),
    "birch": ("#e9e2d0", "#2b2a26"), "graphite": ("#34363a", "#e8c547"),
    "cherry": ("#9b2d30", "#f2e7d5"),
}

# Colorway swaps, as in src/cover-presets/index.ts.
COLORWAYS = {
    ("monoprint", "winter"): {
        "#efe6d4": "#e9eef0", "#ead19f": "#cfdbe3", "#d38c6b": "#8fa6bf", "#b4532a": "#3d4f73",
        "#e3a033": "#f1efe6", "#a24a2a": "#2e3b5c", "#6b2b18": "#1d2742", "#2b1d16": "#14182a", "#7a3b22": "#2e3b5c"},
    ("monoprint", "spring"): {
        "#efe6d4": "#f2eee2", "#ead19f": "#e6efcf", "#d38c6b": "#d99aa0", "#b4532a": "#8c5a7a",
        "#e3a033": "#f2d27a", "#a24a2a": "#6b8c4a", "#6b2b18": "#44602f", "#2b1d16": "#26301c", "#7a3b22": "#5a6e3a"},
    ("watercolor", "sunset"): {
        "#7f9fb8": "#c9826e", "#c9c9c0": "#e3b48c", "#ecd3ad": "#f3d9a8", "#f0b765": "#f6c86a",
        "#8aa1ad": "#a98a8c", "#6c8795": "#8a6c70", "#567278": "#6e5865", "#3f585e": "#54434f",
        "#5d8299": "#7a6a8a", "#28485e": "#3a3150", "#1f3a4c": "#2a2238", "#2f4446": "#2c2430"},
    ("watercolor", "first-snow"): {
        "#7f9fb8": "#a9b8c6", "#c9c9c0": "#dfe3e6", "#ecd3ad": "#f2efe8", "#f0b765": "#f4f1e6",
        "#8aa1ad": "#b9c4cc", "#6c8795": "#9aa8b2", "#567278": "#8c9ba6", "#3f585e": "#6f7e8a",
        "#5d8299": "#8ea4b4", "#28485e": "#4c6274", "#1f3a4c": "#33475a", "#2f4446": "#3a4650"},
    ("hand-drawn", "night"): {"#2a2420": "#e9e2d0", "#ece3cf": "#26282c"},
    ("hand-drawn", "kraft"): {"#2a2420": "#2b2118", "#ece3cf": "#c9a678"},
    ("letterpress", "pine-gold"): {"#b4482b": "#d4a033", "#1f3a5a": "#2f5a45"},
    ("letterpress", "blaze"): {"#f2ecdf": "#e0662f", "#b4482b": "#f4e9d8", "#1f3a5a": "#1c1c1c"},
}

STONES = [(20, 56, 22, 7), (18.5, 42, 16.5, 6.2), (21.5, 30, 11.8, 5.3), (20, 19.5, 7.6, 4.4), (20.8, 11, 4.1, 3.1)]

EASE = "0.4 0 0.2 1"


# ---------------------------------------------------------------- helpers

def esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def fmt(v) -> str:
    if isinstance(v, float):
        return f"{v:.3f}".rstrip("0").rstrip(".")
    return str(v)


def frames(points, dur):
    """[(seconds, value), …] → (values, keyTimes), padded to 0 and dur."""
    pts = sorted(points, key=lambda p: p[0])
    if pts[0][0] > 0:
        pts.insert(0, (0, pts[0][1]))
    if pts[-1][0] < dur:
        pts.append((dur, pts[-1][1]))
    vals = ";".join(fmt(v) if not isinstance(v, tuple) else " ".join(fmt(x) for x in v) for _, v in pts)
    kts = ";".join(fmt(min(1.0, max(0.0, t / dur))) for t, _ in pts)
    return vals, kts, len(pts)


def anim(attr: str, points, dur: float, ease=True, discrete=False) -> str:
    vals, kts, n = frames(points, dur)
    mode = ' calcMode="discrete"' if discrete else (f' calcMode="spline" keySplines="{";".join([EASE] * (n - 1))}"' if ease else "")
    return f'<animate attributeName="{attr}" values="{vals}" keyTimes="{kts}" dur="{fmt(dur)}s" repeatCount="indefinite"{mode}/>'


def anim_t(kind: str, points, dur: float, ease=True, additive=False) -> str:
    vals, kts, n = frames(points, dur)
    spl = f' calcMode="spline" keySplines="{";".join([EASE] * (n - 1))}"' if ease else ""
    add = ' additive="sum"' if additive else ""
    return (f'<animateTransform attributeName="transform" type="{kind}" values="{vals}" keyTimes="{kts}" '
            f'dur="{fmt(dur)}s" repeatCount="indefinite"{spl}{add}/>')


def show(t_in: float, t_out: float, dur: float, fade=0.35) -> str:
    """Opacity: hidden, fade in at t_in, fade out at t_out."""
    pts = [(0, 0), (max(0, t_in), 0), (min(dur, t_in + fade), 1), (max(t_in + fade, t_out), 1), (min(dur, t_out + fade), 0)]
    return anim("opacity", pts, dur)


def text(x, y, s, size=14, fill=INK, family=UI, weight=400, anchor="start", spacing=0, extra="") -> str:
    ls = f' letter-spacing="{spacing}"' if spacing else ""
    if "  " in s:
        ls += ' xml:space="preserve"'
    return (f'<text x="{fmt(x)}" y="{fmt(y)}" font-family=\'{family}\' font-size="{size}" font-weight="{weight}" '
            f'fill="{fill}" text-anchor="{anchor}"{ls}{extra}>{esc(s)}</text>')


def typed(x, y, s, size, t0, t1, dur, fill=INK, family=MONO, weight=400, cid="t", caret=True, cw=0.6) -> str:
    """Monospace text that types itself between t0 and t1 (clip-path reveal)."""
    width = len(s) * size * cw + 4
    out = [f'<clipPath id="{cid}"><rect x="{fmt(x)}" y="{fmt(y - size)}" height="{fmt(size * 1.5)}" width="0">'
           f'{anim("width", [(0, 0), (t0, 0), (t1, width), (dur - 0.4, width), (dur, 0)], dur, ease=False)}</rect></clipPath>',
           f'<g clip-path="url(#{cid})">{text(x, y, s, size, fill, family, weight)}</g>']
    if caret:
        cx = [(0, x), (t0, x), (t1, x + width - 3), (dur, x + width - 3)]
        out.append(f'<rect y="{fmt(y - size * 0.85)}" width="1.6" height="{fmt(size * 1.1)}" fill="{ACCENT}" opacity="0">'
                   f'{anim("x", cx, dur, ease=False)}'
                   f'{anim("opacity", [(0, 0), (t0 - 0.01, 0), (t0, 1), (t1 + 0.6, 1), (t1 + 0.61, 0)], dur, ease=False)}</rect>')
    return "".join(out)


def svg(h: int, body: str, title: str, defs: str = "", style: str = "") -> str:
    st = f"<style>{style}</style>" if style else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {h}" width="{W}" height="{h}" role="img" aria-label="{esc(title)}">'
            f"<title>{esc(title)}</title><defs>{GRAIN}{SHADOW}{defs}</defs>{st}{body}</svg>\n")


GRAIN = ('<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" '
         'numOctaves="3" seed="7" result="n"/><feColorMatrix in="n" type="saturate" values="0" result="g"/>'
         '<feComponentTransfer in="g" result="a"><feFuncA type="table" tableValues="0 0.22"/></feComponentTransfer>'
         '<feComposite in="a" in2="SourceGraphic" operator="in" result="speck"/><feBlend in="SourceGraphic" in2="speck" mode="multiply"/></filter>')
SHADOW = ('<filter id="lift" x="-20%" y="-20%" width="140%" height="150%"><feGaussianBlur in="SourceAlpha" stdDeviation="5"/>'
          '<feOffset dy="5" result="b"/><feFlood flood-color="#2a1e12" flood-opacity="0.28"/><feComposite in2="b" operator="in"/>'
          '<feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
          '<filter id="diecut" x="-25%" y="-25%" width="150%" height="150%"><feMorphology in="SourceAlpha" operator="dilate" radius="3" result="edge"/>'
          '<feFlood flood-color="#fbf8f1"/><feComposite in2="edge" operator="in" result="margin"/><feGaussianBlur in="edge" stdDeviation="1.6" result="blur"/>'
          '<feOffset in="blur" dx="0.8" dy="1.6" result="drop"/><feFlood flood-color="#000" flood-opacity="0.32"/><feComposite in2="drop" operator="in" result="shadow"/>'
          '<feMerge><feMergeNode in="shadow"/><feMergeNode in="margin"/><feMergeNode in="SourceGraphic"/></feMerge></filter>')


def panel(h, fill=DESK) -> str:
    return f'<rect x="1" y="1" width="{W - 2}" height="{h - 2}" rx="18" fill="{fill}" stroke="rgba(42,38,34,0.14)"/>'


def caption(x, y, label, sub="") -> str:
    out = text(x, y, label.upper(), 12, ACCENT, DISPLAY, 700, spacing=2.4)
    if sub:
        out += text(x, y + 20, sub, 14, SOFT, UI)
    return out


def pill(x, y, label, fill="#fff", color=INK, size=12) -> str:
    w = len(label) * size * 0.6 + 18
    return (f'<rect x="{fmt(x)}" y="{fmt(y)}" width="{fmt(w)}" height="{size + 12}" rx="{(size + 12) / 2}" fill="{fill}" stroke="{LINE}"/>'
            + text(x + w / 2, y + size + 3, label, size, color, UI, 600, "middle"))


def window(x, y, w, h, title="", fill=PAGE) -> str:
    out = (f'<g filter="url(#lift)"><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="{fill}"/></g>'
           f'<rect x="{x}" y="{y}" width="{w}" height="28" rx="12" fill="#efe7d8"/><rect x="{x}" y="{y + 16}" width="{w}" height="12" fill="#efe7d8"/>'
           f'<line x1="{x}" y1="{y + 28}" x2="{x + w}" y2="{y + 28}" stroke="{LINE}"/>')
    for i, c in enumerate(("#ec6a5e", "#f4be4f", "#61c454")):
        out += f'<circle cx="{x + 16 + i * 17}" cy="{y + 14}" r="5.2" fill="{c}"/>'
    if title:
        out += text(x + w / 2, y + 18.5, title, 12, SOFT, UI, 600, "middle")
    return out


def graph_paper(pid: str, size=17, color=RULE) -> str:
    return (f'<pattern id="{pid}" width="{size}" height="{size}" patternUnits="userSpaceOnUse">'
            f'<path d="M{size} 0H0V{size}" fill="none" stroke="{color}" stroke-width="1"/></pattern>')


# ---------------------------------------------------------------- covers

_uid = [0]


def _prefix_ids(s: str) -> str:
    _uid[0] += 1
    p = f"c{_uid[0]}"
    ids = set(re.findall(r'\bid="([^"]+)"', s))
    for i in sorted(ids, key=len, reverse=True):
        s = re.sub(rf'\bid="{re.escape(i)}"', f'id="{p}{i}"', s)
        s = s.replace(f"url(#{i})", f"url(#{p}{i})").replace(f'href="#{i}"', f'href="#{p}{i}"')
    return s


def _loop_motion(s: str, start: float, period: float) -> str:
    """Turn a preset's one-shot 2.6 s SMIL into a loop that starts at `start`."""
    def fix(m):
        tag = m.group(0)
        d = float(re.search(r'dur="([\d.]+)s"', tag).group(1))
        vals = re.search(r'values="([^"]+)"', tag)
        if not vals:
            fr, to = re.search(r'from="([^"]+)"', tag), re.search(r'to="([^"]+)"', tag)
            if not (fr and to):
                return tag
            vlist = [fr.group(1), to.group(1)]
            tag = re.sub(r'\s(from|to)="[^"]*"', "", tag)
        else:
            vlist = vals.group(1).split(";")
        kt = re.search(r'keyTimes="([^"]+)"', tag)
        kts = [float(k) for k in kt.group(1).split(";")] if kt else [i / (len(vlist) - 1) for i in range(len(vlist))]
        new_kts = [0.0] + [(start + k * d) / period for k in kts] + [1.0]
        new_vals = [vlist[0]] + vlist + [vlist[-1]]
        spl = re.search(r'keySplines="([^"]+)"', tag)
        tag = re.sub(r'\s(values|keyTimes|keySplines|fill|dur|begin|repeatCount)="[^"]*"', "", tag)
        extra = ""
        if spl:
            extra = f' keySplines="0 0 1 1;{spl.group(1)};0 0 1 1"'
        elif 'calcMode="spline"' in tag:
            extra = f' keySplines="{";".join(["0 0 1 1"] * (len(new_vals) - 1))}"'
        attrs = (f' values="{";".join(new_vals)}" keyTimes="{";".join(fmt(k) for k in new_kts)}"{extra}'
                 f' dur="{fmt(period)}s" repeatCount="indefinite"')
        return re.sub(r"\s*/?>$", attrs + "/>", tag, count=1)
    return re.sub(r"<(animate|animateTransform|animateMotion|set)\b[^>]*/>", fix, s)


def preset_art(name: str, colorway: str | None, start: float, period: float) -> str:
    s = (PRESETS / f"{name}.svg").read_text()
    for a, b in COLORWAYS.get((name, colorway), {}).items():
        s = re.sub(re.escape(a), b, s, flags=re.I)
    s = re.sub(r"<\?xml[^>]*>|<!--.*?-->", "", s, flags=re.S)
    s = _loop_motion(s, start, period)
    return _prefix_ids(s)


def cairn_stack(ink: str, start: float, period: float) -> str:
    """The Kraft cover's cairn building itself stone by stone, then teetering."""
    out = []
    for i, (cx, cy, rx, ry) in enumerate(STONES):
        t = start + i * 0.32
        drop = anim_t("translate", [(0, (0, -34)), (t, (0, -34)), (t + 0.26, (0, 0.6)), (t + 0.36, (0, -1.2)), (t + 0.46, (0, 0)),
                                    (period - 0.5, (0, 0)), (period, (0, -34))], period)
        op = anim("opacity", [(0, 0), (t, 0), (t + 0.08, 1), (period - 0.5, 1), (period - 0.2, 0)], period)
        el = f'<g>{drop}<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="{ink}" opacity="0">{op}</ellipse></g>'
        if i == len(STONES) - 1:
            tt = t + 0.6
            rot = anim_t("rotate", [(0, (0, cx, cy + ry)), (tt, (0, cx, cy + ry)), (tt + 0.35, (-32, cx, cy + ry)), (tt + 0.7, (14, cx, cy + ry)),
                                    (tt + 0.95, (-6, cx, cy + ry)), (tt + 1.15, (2, cx, cy + ry)), (tt + 1.3, (0, cx, cy + ry))], period)
            el = f"<g>{rot}{el}</g>"
        out.append(el)
    return "".join(out)


def cover(x, y, w, title, no=1, edition="kraft", art=None, stack=None, plate=None, rot=0) -> str:
    """A notebook cover (viewBox 140×220) at x,y, w wide. `art` is preset SVG
    markup; `stack` = (start, period) builds the Kraft cairn."""
    stock, ink = EDITIONS[edition]
    h = w * 220 / 140
    cid = f"cc{_uid[0] + 1}"
    _uid[0] += 1
    body = [f'<clipPath id="{cid}"><rect width="140" height="220" rx="5"/></clipPath><g clip-path="url(#{cid})">']
    if art:
        inner = re.sub(r"^<svg[^>]*>|</svg>\s*$", "", art.strip())
        body.append(f'<svg width="140" height="220" viewBox="0 0 350 550" preserveAspectRatio="xMidYMid slice">{inner}</svg>')
    else:
        body.append(f'<rect width="140" height="220" fill="{stock}" filter="url(#grain)"/>')
        if stack:
            body.append(f'<g transform="translate(50 64)">{cairn_stack(ink, *stack)}</g>')
        else:
            body.append(f'<g transform="translate(50 64)" fill="{ink}">' + "".join(f'<ellipse cx="{a}" cy="{b}" rx="{c}" ry="{d}"/>' for a, b, c, d in STONES) + "</g>")
    body.append('<rect width="7" height="220" fill="#000" opacity="0.1"/><rect x="2.2" y="52" width="2.2" height="18" rx="1" fill="#b9bcc0"/>'
                '<rect x="2.2" y="150" width="2.2" height="18" rx="1" fill="#b9bcc0"/></g>')
    pstock, pink = EDITIONS[plate or edition]
    if art:
        body.append(f'<rect x="13" y="16" width="68" height="14" rx="2" fill="{pstock}" opacity="0.92"/>')
    body.append(text(18, 26, f"No. {no:04d}", 9, pink if art else ink, DISPLAY, 700, spacing=2.4))
    body.append(f'<rect x="16" y="150" width="108" height="46" fill="{pstock if art else "none"}" fill-opacity="0.92" stroke="{pink if art else ink}" stroke-width="1.2"/>')
    words = title.upper().split()
    lines, cur = [], ""
    for wd in words:
        if len(cur) + len(wd) + 1 > 12 and cur:
            lines.append(cur)
            cur = wd
        else:
            cur = f"{cur} {wd}".strip()
    lines.append(cur)
    y0 = 177 - (len(lines) - 1) * 7
    for i, ln in enumerate(lines):
        body.append(text(70, y0 + i * 14, ln, 11, pink if art else ink, DISPLAY, 700, "middle", 1.4))
    tr = f' transform="rotate({rot} {x + w / 2} {y + h / 2})"' if rot else ""
    return (f'<g{tr}><g filter="url(#lift)"><rect x="{fmt(x)}" y="{fmt(y)}" width="{fmt(w)}" height="{fmt(h)}" rx="{fmt(w / 28)}" fill="#000" opacity="0.001"/></g>'
            f'<svg x="{fmt(x)}" y="{fmt(y)}" width="{fmt(w)}" height="{fmt(h)}" viewBox="0 0 140 220" overflow="visible">{"".join(body)}</svg></g>')


def sticker(name: str, x, y, size, rot=0) -> str:
    s = (STICKERS / f"{name}.svg").read_text()
    s = re.sub(r"<!--.*?-->", "", s, flags=re.S)
    vb = re.search(r'viewBox="([^"]+)"', s).group(1)
    inner = re.sub(r"^\s*<svg[^>]*>|</svg>\s*$", "", s.strip())
    return (f'<g transform="rotate({rot} {x + size / 2} {y + size / 2})" filter="url(#diecut)">'
            f'<svg x="{fmt(x)}" y="{fmt(y)}" width="{size}" height="{size}" viewBox="{vb}">{_prefix_ids(inner)}</svg></g>')


def badges() -> list[dict]:
    out = subprocess.run(["node", str(OUT / "badges.mjs")], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def patch(b: dict, x, y, size) -> str:
    inner = re.sub(r"^<svg[^>]*>|</svg>$", "", b["svg"].strip())
    return f'<svg x="{fmt(x)}" y="{fmt(y)}" width="{size}" height="{size}" viewBox="0 0 120 120">{_prefix_ids(inner)}</svg>'


def rock_salt() -> str:
    data = base64.b64encode(ROCK_SALT.read_bytes()).decode()
    return f'@font-face{{font-family:"Rock Salt";src:url(data:font/woff2;base64,{data}) format("woff2");}}'


# ---------------------------------------------------------------- scenes

def hero() -> str:
    D, H = 10.0, 380
    b = [panel(H)]
    # covers fanning in behind the kraft one
    fan = [("watercolor", None, "North Shore", 4, "lake", -14, 70), ("letterpress", None, "Pine Press", 7, "birch", -6, 128),
           ("monoprint", None, "Hunter's Field", 3, "birch", 4, 186)]
    for i, (p, cw, t, no, plate, rot, dx) in enumerate(fan):
        t0 = 0.2 + i * 0.25
        art = preset_art(p, cw, t0 + 0.3, D)
        g = cover(dx, 62, 150, t, no, art=art, plate=plate, rot=rot)
        mv = anim_t("translate", [(0, (0, 40)), (t0, (0, 40)), (t0 + 0.6, (0, 0)), (D - 0.6, (0, 0)), (D, (0, 30))], D)
        b.append(f'<g opacity="0">{mv}{show(t0, D - 0.6, D)}{g}</g>')
    k = cover(250, 74, 150, "First Cairn", 1, stack=(1.4, D), rot=5)
    mv = anim_t("translate", [(0, (0, 50)), (0.9, (0, 50)), (1.4, (0, 0)), (D - 0.6, (0, 0)), (D, (0, 30))], D)
    b.append(f'<g opacity="0">{mv}{show(0.9, D - 0.6, D)}{k}</g>')
    b.append(f'<g opacity="0">{show(4.2, D - 0.6, D)}{anim_t("scale", [(0, 1.6), (4.2, 1.6), (4.5, 1), (D, 1)], D, additive=True)}'
             f'{sticker("field-tested", 352, 70, 58, 12)}</g>')
    # wordmark
    x = 470
    b.append(f'<g opacity="0">{show(0.5, D - 0.6, D)}' + text(x, 150, "CAIRN", 64, INK, DISPLAY, 700, spacing=12) + "</g>")
    b.append(f'<g opacity="0">{show(1.0, D - 0.6, D)}' + text(x + 2, 186, "Notes as markers you leave behind.", 20, SOFT, UI, 500) + "</g>")
    b.append(f'<g opacity="0">{show(1.5, D - 0.6, D)}' + text(x + 2, 216, "Said KARN.", 14, MARK, UI, 600, spacing=0.4) + "</g>")
    chips = [["Plain markdown files", "Animated covers"], ["Signed GitHub sync", "Claude can read it"]]
    for r, row in enumerate(chips):
        cx = x
        for i, c in enumerate(row):
            b.append(f'<g opacity="0">{show(2.0 + (r * 2 + i) * 0.2, D - 0.6, D)}{pill(cx, 244 + r * 34, c)}</g>')
            cx += len(c) * 12 * 0.62 + 30
    return svg(H, "".join(b), "Cairn: notes as markers you leave behind. Notebook covers arrive and a cairn stacks itself.")


def editor() -> str:
    D, H = 14.0, 500
    b = [panel(H), window(30, 24, 820, 452, "Cairn")]
    x0, y0 = 30, 52
    b.append(f'<rect x="{x0}" y="{y0}" width="150" height="424" fill="{DESK}"/>')
    b.append(text(x0 + 18, y0 + 26, "CAIRN", 13, INK, DISPLAY, 700, spacing=3.4))
    for i, (ed, t, art) in enumerate([("kraft", "Trail Log", None), ("blaze", "Bench Notes", None), ("pine", "Field Kit", None)]):
        b.append(cover(x0 + 22, y0 + 44 + i * 172, 106, t, 3 + i, ed))
    b.append(f'<rect x="{x0 + 18}" y="{y0 + 40}" width="114" height="174" rx="7" fill="none" stroke="{ACCENT}" stroke-width="2"/>')
    nx = x0 + 150
    b.append(f'<rect x="{nx}" y="{y0}" width="180" height="424" fill="{DESK2}"/>')
    b.append(text(nx + 16, y0 + 24, "No. 0003  ·  4 notes", 10, SOFT, DISPLAY, 700, spacing=1.4))
    b.append(text(nx + 16, y0 + 46, "TRAIL LOG", 17, INK, DISPLAY, 700, spacing=1.6))
    b.append(pill(nx + 16, y0 + 58, "Graph ▾", size=11) + pill(nx + 90, y0 + 58, "Cover", size=11))
    notes = [("Ridge loop", "Nov 16"), ("Gooseberry Falls", "Nov 14"), ("Split Rock", "Nov 9"), ("Gear list", "Nov 2")]
    for i, (t, d) in enumerate(notes):
        yy = y0 + 98 + i * 50
        if i == 0:
            b.append(f'<rect x="{nx}" y="{yy - 6}" width="180" height="46" fill="{PAGE}"/><rect x="{nx}" y="{yy - 6}" width="3" height="46" fill="{ACCENT}"/>')
        b.append(text(nx + 16, yy + 12, t, 13, INK, UI, 600) + text(nx + 16, yy + 29, d + ", 2026", 11, SOFT, UI))
    px = nx + 180
    b.append(f'<rect x="{px}" y="{y0}" width="{850 - px}" height="424" fill="url(#gp)"/>')
    tx, ty = px + 54, y0 + 64
    b.append(f'<g>{text(tx - 22, ty, "#", 24, MARK, DISPLAY, 700)}</g>')
    b.append(typed(tx, ty, "Ridge loop", 24, 0.6, 1.4, D, INK, DISPLAY, 700, "e0", caret=False, cw=0.66))
    lines = ["Up the switchbacks before sunrise.", "The cairn at the top was taller", "than last fall: someone added a stone.",
             "", "Frost on the boardwalk, so slow going.", "Back at the car by 9:40."]
    t = 1.6
    groups = []
    for i, ln in enumerate(lines):
        if not ln:
            continue
        dt = len(ln) * 0.045
        groups.append((i, typed(tx, ty + 44 + i * 29, ln, 15, t, t + dt, D, cid=f"e{i + 1}")))
        t += dt + 0.15
    # focus mode: everything but the sentence being written dims
    for i, g in groups:
        dim = i not in (4, 5)
        if dim:
            b.append(f'<g>{anim("opacity", [(0, 1), (8.4, 1), (8.9, 0.28), (12.6, 0.28), (13.1, 1)], D)}{g}</g>')
        else:
            b.append(g)
    b.append(f'<g opacity="0">{show(8.4, 12.6, D)}{pill(700, y0 + 14, "⌘D  focus: sentence", "#2a2622", "#fbf8f1", 11)}</g>')
    sb = y0 + 400
    b.append(f'<rect x="{px}" y="{sb}" width="{850 - px}" height="24" fill="#f3ede1"/><line x1="{px}" y1="{sb}" x2="850" y2="{sb}" stroke="{LINE}"/>')
    b.append(text(px + 16, sb + 16, "38 words · 1 min     saved     notebook ⤢     stickers     page: graph     Typewriter     focus     typewriter", 10.5, SOFT, UI))
    return svg(H, "".join(b), "The editor: a note types itself on graph paper, then focus mode dims everything but the current sentence.",
               defs=graph_paper("gp"))


def paper() -> str:
    D, H = 10.0, 330
    b = [panel(H), caption(36, 44, "Paper and type", "Every notebook has its paper, and any page can change it.")]
    kinds = [("graph", "Graph"), ("ruled", "Ruled"), ("dot", "Dot grid"), ("blank", "Blank")]
    defs = graph_paper("pg", 14) + (f'<pattern id="pr" width="14" height="22" patternUnits="userSpaceOnUse" patternTransform="translate(0 15.5)"><line x1="0" y1="21.5" x2="14" y2="21.5" stroke="{RULE}" stroke-width="1.2"/></pattern>'
                                    f'<pattern id="pd" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="8" cy="8" r="1.3" fill="rgba(64,98,128,0.3)"/></pattern>')
    ochre = ('<pattern id="po" width="14" height="22" patternUnits="userSpaceOnUse" patternTransform="translate(0 15.5)"><line x1="0" y1="21.5" x2="14" y2="21.5" stroke="#c98a3a" stroke-opacity="0.55" stroke-width="1.2"/></pattern>')
    defs += ochre
    for i, (k, label) in enumerate(kinds):
        x = 36 + i * 206
        fill = {"graph": "url(#pg)", "ruled": "url(#pr)", "dot": "url(#pd)", "blank": PAGE}[k]
        t0 = 0.6 + i * 0.5
        card = (f'<g filter="url(#lift)"><rect x="{x}" y="86" width="190" height="200" rx="8" fill="{PAGE}"/></g>'
                f'<rect x="{x}" y="86" width="190" height="200" rx="8" fill="{fill}"/>')
        if k == "ruled":
            card += (f'<rect x="{x}" y="86" width="190" height="200" rx="8" fill="url(#po)" opacity="0">'
                     f'{anim("opacity", [(0, 0), (5.5, 0), (6.1, 1), (8.8, 1), (9.3, 0)], D)}</rect>')
            card += f'<g opacity="0">{show(5.5, 8.8, D)}{pill(x + 92, 252, "ruling: ochre", size=10)}</g>'
        if k == "blank":
            line1 = f'<text x="{x + 16}" y="140" font-family=\'{HAND}\' font-size="15" fill="{INK}">Moose at</text>'
            line2 = f'<text x="{x + 16}" y="176" font-family=\'{HAND}\' font-size="15" fill="{INK}">the lake!</text>'
            card += (f'<clipPath id="ph"><rect x="{x}" y="110" height="90" width="0">{anim("width", [(0, 0), (t0, 0), (t0 + 1.4, 190), (D - 0.4, 190), (D, 0)], D, ease=False)}</rect></clipPath>'
                     f'<g clip-path="url(#ph)">{line1}{line2}</g>')
            card += text(x + 16, 214, "Rock Salt, the hand", 10, MARK, UI, 600)
        else:
            card += typed(x + 16, 141, "Moose at the", 15, t0, t0 + 0.6, D, cid=f"pp{i}a", caret=False)
            card += typed(x + 16, 163, "lake, 6:40 am.", 15, t0 + 0.6, t0 + 1.2, D, cid=f"pp{i}b")
        card += text(x + 16, 112, label.upper(), 11, SOFT, DISPLAY, 700, spacing=1.8)
        b.append(f'<g opacity="0">{show(t0 - 0.4, D - 0.5, D)}{card}</g>')
    b.append(text(36, 312, "Typewriter face or the Rock Salt hand · ruling ink to match a cover · page: graph | ruled | dot | blank in a note's frontmatter", 12, SOFT, UI))
    return svg(H, "".join(b), "Paper: graph, ruled, dot grid and blank pages, a ruling color, and the handwritten font.", defs=defs, style=rock_salt())


def shelf() -> str:
    D, H = 10.0, 310
    b = [panel(H), caption(36, 44, "Your shelf", "Drag notebooks into your own order. Trash one from its ⋯ menu.")]
    books = [("kraft", "Trail Log", 1), ("blaze", "Bench Notes", 2), ("pine", "Field Kit", 3), ("lake", "Lake Days", 4), ("cherry", "Recipes", 5)]
    w, gap, y = 104, 138, 96
    order_after = [0, 3, 1, 2, 4]  # Lake Days moves to second
    for i, (ed, t, no) in enumerate(books):
        x_from = 40 + i * gap
        x_to = 40 + order_after.index(i) * gap
        if i == 3:
            pts = [(0, (0, 0)), (1.2, (0, 0)), (1.6, (0, -16)), (3.4, (x_to - x_from, -16)), (3.8, (x_to - x_from, 0)), (8.6, (x_to - x_from, 0)), (9.2, (0, 0))]
        else:
            pts = [(0, (0, 0)), (2.2, (0, 0)), (2.9, (x_to - x_from, 0)), (8.6, (x_to - x_from, 0)), (9.2, (0, 0))]
        g = cover(x_from, y, w, t, no, ed)
        if i == 3:
            g = f'<g>{anim_t("scale", [(0, 1), (1.2, 1), (1.6, 1.06), (3.4, 1.06), (3.8, 1)], D, additive=False)}</g>' if False else g
        b.append(f'<g>{anim_t("translate", pts, D)}{g}</g>')
    # pointer
    cur = '<path d="M0 0 L0 17 L4.5 13 L7.5 20 L10 19 L7 12 L13 12 Z" fill="#111" stroke="#fff" stroke-width="1.2"/>'
    b.append(f'<g>{anim_t("translate", [(0, (500, 260)), (1.0, (500, 200)), (1.6, (500, 186)), (3.4, (225, 186)), (3.9, (240, 220)), (5.2, (790, 112)), (6.0, (792, 116)), (8.6, (720, 170)), (9.4, (500, 260))], D)}{cur}</g>')
    # ⋯ menu
    mx, my = 700, 120
    menu = (f'<g filter="url(#lift)"><rect x="{mx}" y="{my}" width="150" height="106" rx="10" fill="#fff"/></g>'
            + text(mx + 14, my + 26, "Change cover…", 12.5, INK) + text(mx + 14, my + 52, "Sync with a repo…", 12.5, INK)
            + f'<rect x="{mx + 6}" y="{my + 64}" width="138" height="30" rx="6" fill="{ACCENT}" opacity="0">{anim("opacity", [(0, 0), (6.6, 0), (6.8, 0.14), (8.4, 0.14), (8.6, 0)], D)}</rect>'
            + text(mx + 14, my + 84, "Move to Trash…", 12.5, "#b4362a", UI, 600))
    b.append(f'<rect x="{mx + 110}" y="{my - 30}" width="30" height="22" rx="6" fill="#fff" stroke="{LINE}"/>' + text(mx + 125, my - 14, "⋯", 14, INK, UI, 700, "middle"))
    b.append(f'<g opacity="0">{show(5.6, 8.6, D, 0.2)}{menu}</g>')
    b.append(text(36, 290, "The order lives in shelf.yml. A trashed notebook moves to .trash/, ready to restore.", 12, SOFT, UI))
    return svg(H, "".join(b), "The shelf: a notebook is dragged into a new place, then the notebook menu offers Move to Trash.")


def covers() -> str:
    D, H = 14.0, 520
    b = [panel(H), caption(36, 44, "Covers worth looking at", "Built-in covers in colorways, each with its own one-shot motion. Or have Claude draw an original.")]
    items = [
        (None, None, "First Cairn", 1, "kraft", None), ("monoprint", None, "Hunter's Field", 2, None, "birch"),
        ("watercolor", None, "North Shore", 3, None, "lake"), ("hand-drawn", None, "Ridge Sketch", 4, None, "birch"),
        ("letterpress", None, "Pine Press", 5, None, "birch"), (None, None, "Bench Notes", 6, "blaze", None),
        ("monoprint", "winter", "Winter Count", 7, None, "lake"), ("watercolor", "sunset", "Split Rock", 8, None, "cherry"),
        ("hand-drawn", "night", "Night Hike", 9, None, "graphite"), ("letterpress", "blaze", "Blaze", 10, None, "blaze"),
        ("watercolor", "first-snow", "First Snow", 11, None, "birch"), ("monoprint", "spring", "Garden", 12, None, "pine"),
    ]
    w = 118
    for i, (p, cw, t, no, ed, plate) in enumerate(items):
        col, row = i % 6, i // 6
        x, y = 40 + col * 136, 92 + row * 210
        t0 = 0.3 + i * 0.28
        if p:
            g = cover(x, y, w, t, no, art=preset_art(p, cw, t0 + 0.2, D), plate=plate)
        else:
            g = cover(x, y, w, t, no, ed, stack=(t0 + 0.3, D) if ed == "kraft" else None)
        mv = anim_t("translate", [(0, (0, 26)), (t0, (0, 26)), (t0 + 0.5, (0, 0)), (D - 0.6, (0, 0)), (D, (0, 14))], D)
        b.append(f'<g opacity="0">{mv}{show(t0, D - 0.6, D)}{g}</g>')
    return svg(H, "".join(b), "Twelve covers arrive one after another, each playing its motion: the sun lifts, ink lands in register, a cairn stacks itself.")


def notebook_mode() -> str:
    D, H = 15.0, 470
    defs = graph_paper("ng", 15) + ('<linearGradient id="wall" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a5568"/>'
                                    '<stop offset="0.6" stop-color="#6f7f86"/><stop offset="1" stop-color="#c7a27a"/></linearGradient>')
    b = [f'<rect x="1" y="1" width="{W - 2}" height="{H - 2}" rx="18" fill="url(#wall)"/>',
         f'<rect x="1" y="1" width="{W - 2}" height="26" rx="18" fill="rgba(255,255,255,0.35)"/><rect x="1" y="14" width="{W - 2}" height="13" fill="rgba(255,255,255,0.35)"/>',
         text(30, 19, "Cairn    File    Edit    View    Window", 11.5, "#1d1d1f", UI, 600)]
    cw, chh = 190, 190 * 220 / 140
    sx, sy = 440, 70
    # closed cover arrives, then opens (cover folds left), spread underneath
    left_page = (f'<rect x="{sx - cw}" y="{sy}" width="{cw}" height="{chh}" rx="4" fill="#c49a6c"/><rect x="{sx - cw}" y="{sy}" width="{cw}" height="{chh}" rx="4" fill="#c49a6c" filter="url(#grain)"/>')
    hand = [("No. 0003", 15, 34), ("North Shore", 22, 70), ("Started Nov 9, 2026", 11, 96), ("Contents", 17, 140), ("1  Split Rock", 12, 170), ("2  Gooseberry Falls", 12, 194), ("3  Ridge loop", 12, 218)]
    hl = ""
    for i, (s, size, dy) in enumerate(hand):
        t0 = 4.2 + i * 0.45
        cid = f"nh{i}"
        hl += (f'<clipPath id="{cid}"><rect x="{sx - cw + 14}" y="{sy + dy - size - 6}" height="{size * 1.9}" width="0">'
               f'{anim("width", [(0, 0), (t0, 0), (t0 + 0.5, cw), (D - 0.5, cw), (D, 0)], D, ease=False)}</rect></clipPath>'
               f'<g clip-path="url(#{cid})"><text x="{sx - cw + 18}" y="{sy + dy}" font-family=\'{HAND}\' font-size="{size}" fill="#2b2118">{esc(s)}</text></g>')
    hl += f'<line x1="{sx - cw + 18}" y1="{sy + 148}" x2="{sx - 40}" y2="{sy + 148}" stroke="#2b2118" stroke-width="2" opacity="0">{anim("opacity", [(0, 0), (5.7, 0), (5.9, 1), (D - 0.5, 1), (D, 0)], D)}</line>'
    right = (f'<rect x="{sx}" y="{sy}" width="{cw}" height="{chh}" rx="4" fill="{PAGE}"/><rect x="{sx}" y="{sy}" width="{cw}" height="{chh}" rx="4" fill="url(#ng)"/>'
             + text(sx + 14, sy + 20, "NOV 9, 2026", 8.5, SOFT, DISPLAY, 700, spacing=1.6) + text(sx + cw - 14, sy + 20, "1", 9, SOFT, DISPLAY, 700, "end")
             + text(sx + 14, sy + 58, "Split Rock", 17, INK, DISPLAY, 700)
             + "".join(text(sx + 14, sy + 86 + i * 19, s, 10.5, INK, MONO) for i, s in enumerate(
                 ["Lighthouse at dusk.", "Wind off the lake,", "cold hands, good", "light. Took the", "long way back."])))
    page2 = (f'<rect x="{sx}" y="{sy}" width="{cw}" height="{chh}" rx="4" fill="{PAGE}"/><rect x="{sx}" y="{sy}" width="{cw}" height="{chh}" rx="4" fill="url(#ng)"/>'
             + text(sx + 14, sy + 20, "NOV 12, 2026", 8.5, SOFT, DISPLAY, 700, spacing=1.6) + text(sx + cw - 14, sy + 20, "2", 9, SOFT, DISPLAY, 700, "end")
             + text(sx + 14, sy + 58, "Gooseberry Falls", 17, INK, DISPLAY, 700)
             + "".join(text(sx + 14, sy + 86 + i * 19, s, 10.5, INK, MONO) for i, s in enumerate(["Upper falls", "frozen at the edges.", "Ice like glass."])))
    spread = f'<g filter="url(#lift)"><rect x="{sx - cw}" y="{sy}" width="{cw * 2}" height="{chh}" rx="5" fill="#000" opacity="0.001"/></g>{left_page}{hl}{page2}'
    # the right page turns (scaleX about the spine) to show page 2
    turn = (f'<g>{anim_t("translate", [(0, (0, 0)), (10.2, (0, 0)), (10.8, (sx * 0.98, 0)), (D, (sx * 0.98, 0))], D, ease=False)}'
            f'{anim_t("scale", [(0, (1, 1)), (10.2, (1, 1)), (10.8, (0.02, 1)), (D, (0.02, 1))], D, ease=False, additive=True)}{right}</g>')
    spread += f'<line x1="{sx}" y1="{sy}" x2="{sx}" y2="{sy + chh}" stroke="rgba(0,0,0,0.25)" stroke-width="2"/>'
    b.append(f'<g opacity="0">{show(3.2, D - 0.5, D, 0.3)}{spread}{turn}</g>')
    front = cover(sx, sy, cw, "North Shore", 3, art=preset_art("watercolor", None, 0.3, D), plate="lake")
    fold = (f'<g>{anim_t("translate", [(0, (0, 0)), (3.0, (0, 0)), (3.8, (sx * 0.98, 0)), (D, (sx * 0.98, 0))], D, ease=False)}'
            f'{anim_t("scale", [(0, (1, 1)), (3.0, (1, 1)), (3.8, (0.02, 1)), (D, (0.02, 1))], D, ease=False, additive=True)}'
            f'{anim("opacity", [(0, 1), (3.8, 1), (3.85, 0), (D - 0.1, 0), (D, 1)], D, ease=False)}{front}</g>')
    drop = anim_t("translate", [(0, (0, -60)), (0.2, (0, -60)), (0.9, (0, 0)), (D, (0, 0))], D)
    b.append(f'<g>{drop}{anim("opacity", [(0, 0), (0.2, 0), (0.6, 1), (D - 0.5, 1), (D, 0)], D)}{fold}</g>')
    # two-finger swipe hint
    sw = (f'<g opacity="0">{show(9.2, 11.2, D)}'
          f'<g>{anim_t("translate", [(0, (0, 0)), (9.6, (0, 0)), (10.6, (-90, 0)), (D, (-90, 0))], D)}'
          f'<circle cx="770" cy="400" r="9" fill="rgba(255,255,255,0.85)"/><circle cx="794" cy="400" r="9" fill="rgba(255,255,255,0.85)"/></g>'
          + pill(650, 424, "two-finger swipe turns the page", "rgba(255,255,255,0.85)", INK, 11) + "</g>")
    b.append(sw)
    b.append(f'<g opacity="0">{show(1.0, 3.0, D)}{pill(40, 424, "⇧⌘F  the notebook on your desktop", "rgba(255,255,255,0.85)", INK, 11)}</g>')
    return svg(H, "".join(b), "Notebook mode: the notebook drops onto the desktop, the cover opens to a handwritten inside cover, and a swipe turns the page.",
               defs=defs, style=rock_salt())


def links_search() -> str:
    D, H = 13.0, 400
    b = [panel(H), caption(36, 44, "Links and search", "[[Wikilinks]] with autocomplete and backlinks. ⌘K searches every notebook.")]
    b.append(f'<g filter="url(#lift)"><rect x="36" y="80" width="390" height="290" rx="12" fill="{PAGE}"/></g><rect x="36" y="80" width="390" height="290" rx="12" fill="url(#lg)"/>')
    b.append(text(58, 118, "Gear list", 20, INK, DISPLAY, 700))
    b.append(typed(58, 152, "Camped below", 14, 0.6, 1.2, D, cid="l0", caret=False))
    # the link: typed bracket text, then becomes a styled link
    b.append(typed(174, 152, "[[Spli", 14, 1.4, 1.9, D, LINK, cid="l1", caret=True))
    pop = (f'<g filter="url(#lift)"><rect x="170" y="164" width="230" height="78" rx="8" fill="#fff"/></g>'
           f'<rect x="174" y="168" width="222" height="32" rx="6" fill="{ACCENT}" opacity="0.12"/>'
           + text(184, 189, "Split Rock", 13, INK, UI, 600) + text(390, 189, "North Shore", 10.5, SOFT, UI, 400, "end")
           + text(184, 224, "Split Rock lighthouse", 13, INK, UI, 500) + text(390, 224, "Ideas", 10.5, SOFT, UI, 400, "end"))
    b.append(f'<g opacity="0">{show(2.0, 3.3, D, 0.2)}{pop}</g>')
    done = (text(174, 152, "[[", 14, MARK, MONO) + f'<text x="{174 + 16.8}" y="152" font-family=\'{MONO}\' font-size="14" fill="{LINK}" text-decoration="underline">Split Rock</text>'
            + text(174 + 16.8 + 84, 152, "]]", 14, MARK, MONO))
    b.append(f'<g opacity="0">{anim("opacity", [(0, 0), (3.3, 0), (3.4, 1), (D - 0.4, 1), (D, 0)], D)}<rect x="172" y="136" width="130" height="22" fill="{PAGE}"/>{done}</g>')
    b.append(typed(58, 182, "Sunrise from the bluff.", 14, 3.6, 4.6, D, cid="l2"))
    back = (f'<rect x="54" y="290" width="354" height="64" rx="8" fill="#fff" stroke="{LINE}"/>' + text(68, 312, "LINKED FROM 2", 10, SOFT, DISPLAY, 700, spacing=1.6)
            + text(68, 333, "Gear list · …Camped below [[Split Rock]]…", 11.5, INK, UI) + text(68, 349, "Ridge loop · …north of [[Split Rock]], the…", 11.5, INK, UI))
    b.append(f'<g opacity="0">{show(5.0, D - 0.5, D)}{back}</g>')
    # ⌘K palette
    px = 452
    pal = (f'<g filter="url(#lift)"><rect x="{px}" y="80" width="392" height="290" rx="12" fill="#fff"/></g>'
           f'<rect x="{px + 14}" y="94" width="364" height="36" rx="8" fill="{PAGE}" stroke="{LINE}"/>' + text(px + 28, 117, "⌕", 15, SOFT))
    b.append(f'<g opacity="0">{show(6.0, D - 0.5, D, 0.25)}{pal}{typed(px + 50, 117, "switchb", 14, 6.5, 7.3, D, cid="k0")}</g>')
    results = [("Ridge loop", "Trail Log", "…up the ", "switchbacks", " before sunrise…"),
               ("Superior Hiking Trail", "Trail Log", "…endless ", "switchbacks", " past Bean Lake…"),
               ("Gooseberry Falls", "North Shore", "…stairs, not ", "switchbacks", ", to the…")]
    for i, (t, nb, a, m, z) in enumerate(results):
        y = 150 + i * 70
        r = (f'<rect x="{px + 14}" y="{y}" width="364" height="60" rx="8" fill="{ACCENT if i == 0 else "#fff"}" opacity="{0.1 if i == 0 else 1}"/>'
             + text(px + 28, y + 22, t, 13.5, INK, UI, 600) + text(px + 364, y + 22, nb, 10.5, SOFT, UI, 400, "end")
             + f'<text x="{px + 28}" y="{y + 44}" font-family=\'{UI}\' font-size="12" fill="{SOFT}">{esc(a)}<tspan fill="{INK}" font-weight="700">{esc(m)}</tspan>{esc(z)}</text>')
        b.append(f'<g opacity="0">{show(7.5 + i * 0.25, D - 0.5, D, 0.25)}{r}</g>')
    return svg(H, "".join(b), "Typing [[Spli suggests Split Rock and makes a link, backlinks list who links here, and ⌘K finds switchbacks across notebooks.",
               defs=graph_paper("lg", 17))


def stickers_badges(bs: list[dict]) -> str:
    D, H = 13.0, 470
    b = [panel(H), caption(36, 44, "Stickers and merit badges", "Die-cut stickers for pages and covers. Patches you earn by writing.")]
    b.append(f'<g filter="url(#lift)"><rect x="36" y="80" width="300" height="250" rx="10" fill="{PAGE}"/></g><rect x="36" y="80" width="300" height="250" rx="10" fill="url(#sg)"/>')
    b.append(text(56, 116, "Boundary Waters", 18, INK, DISPLAY, 700))
    b.append("".join(text(56, 146 + i * 22, s, 12.5, INK, MONO) for i, s in enumerate(["Day 3. Portage to", "Ogishkemuncie, loons", "all night. Fire by 7."])))
    sheet_x, sheet_y = 370, 80
    b.append(f'<g filter="url(#lift)"><rect x="{sheet_x}" y="{sheet_y}" width="300" height="250" rx="10" fill="#f6f1e6"/></g>')
    names = ["cairn", "compass", "pine", "peaks", "moon", "sun", "bolt", "wave", "canoe", "tent", "campfire", "mug", "blaze", "star", "field-tested"]
    for i, n in enumerate(names):
        cx, cy = sheet_x + 22 + (i % 5) * 56, sheet_y + 18 + (i // 5) * 76
        b.append(sticker(n, cx, cy, 46, (i * 37) % 13 - 6))
    # three fly from the sheet to the page
    flights = [("canoe", sheet_x + 22 + 3 * 56, sheet_y + 18 + 76, 240, 238, -9, 1.2), ("campfire", sheet_x + 22, sheet_y + 18 + 152, 196, 252, 7, 2.4),
               ("moon", sheet_x + 22 + 4 * 56, sheet_y + 18, 268, 92, 12, 3.6)]
    for n, fx, fy, tx, ty, r, t0 in flights:
        mv = anim_t("translate", [(0, (fx - tx, fy - ty)), (t0, (fx - tx, fy - ty)), (t0 + 0.7, (0, 0)), (D - 0.4, (0, 0)), (D, (fx - tx, fy - ty))], D)
        b.append(f'<g opacity="0">{anim("opacity", [(0, 0), (t0 - 0.01, 0), (t0, 1), (D - 0.4, 1), (D, 0)], D, ease=False)}{mv}{sticker(n, tx, ty, 56, r)}</g>')
    # badge earned toast
    toast = (f'<g filter="url(#lift)"><rect x="690" y="104" width="160" height="200" rx="16" fill="#fff"/></g>'
             + text(770, 230, "MERIT BADGE EARNED", 8.5, SOFT, DISPLAY, 700, "middle", 1.6) + text(770, 252, "Trailhead", 16, INK, DISPLAY, 700, "middle")
             + text(770, 272, "Linked one notebook", 10.5, SOFT, UI, 400, "middle") + text(770, 286, "into another.", 10.5, SOFT, UI, 400, "middle"))
    th = next(x for x in bs if x["id"] == "trailhead")
    grow = anim_t("scale", [(0, 0.2), (5.0, 0.2), (5.6, 1.08), (5.9, 1), (D, 1)], D, additive=True)
    ring = (f'<circle cx="770" cy="166" r="50" fill="none" stroke="{ACCENT}" stroke-width="2" stroke-dasharray="314" stroke-dashoffset="314">'
            f'{anim("stroke-dashoffset", [(0, 314), (5.0, 314), (6.2, 0), (D, 0)], D)}</circle>')
    b.append(f'<g opacity="0">{show(4.8, D - 0.5, D)}{toast}{ring}<g transform="translate(770 166)"><g>{grow}<g transform="translate(-44 -44)">{patch(th, 0, 0, 88)}</g></g></g></g>')
    # the sash
    b.append(text(36, 368, "THE SASH", 10.5, SOFT, DISPLAY, 700, spacing=2))
    for i, bd in enumerate(bs):
        x = 36 + i * 68
        earned = i in (0, 1, 3, 4, 5, 10, 11)
        op = "1" if earned else "0.22"
        b.append(f'<g opacity="{op}">{patch(bd, x, 378, 58)}</g>')
        b.append(text(x + 29, 452, bd["name"], 8.5, SOFT if earned else MARK, UI, 600, "middle"))
    return svg(H, "".join(b), "Stickers fly from the sheet onto a page, the Trailhead merit badge stitches itself in, and the sash shows all twelve patches.",
               defs=graph_paper("sg", 16))


def sync() -> str:
    D, H = 13.0, 420
    b = [panel(H), caption(36, 44, "Sync that signs its commits", "GitHub through its API: no git on your Mac, every commit verified. A notebook can have a repo of its own.")]
    mac = (f'<g filter="url(#lift)"><rect x="40" y="96" width="250" height="200" rx="12" fill="#fff"/></g>' + text(58, 124, "This Mac · vault folder", 12, SOFT, UI, 600)
           + "".join(text(58, 152 + i * 24, s, 12.5, INK, MONO) for i, s in enumerate(["notebooks/", "  0001-trail-log/", "    ridge-loop.md", "    gear-list.md", "  0002-bench-notes/", "    notebook.yml"])))
    gh = (f'<g filter="url(#lift)"><rect x="590" y="96" width="250" height="200" rx="12" fill="#fff"/></g>'
          f'<circle cx="612" cy="119" r="9" fill="#24292f"/>' + text(628, 124, "you/cairn-vault", 13, INK, UI, 700) + pill(752, 108, "Private", size=10))
    b.append(mac + gh)
    commits = [("cairn: sync 2 files", 2.2), ("cairn: sync 1 file", 6.4)]
    for i, (msg, t0) in enumerate(commits):
        y = 150 + i * 44
        row = (f'<rect x="604" y="{y}" width="222" height="36" rx="7" fill="#f6f8fa"/>' + text(616, y + 22, msg, 11.5, INK, MONO)
               + f'<rect x="760" y="{y + 9}" width="58" height="18" rx="9" fill="#dafbe1"/>' + text(789, y + 22, "Verified", 9.5, "#1a7f37", UI, 700, "middle"))
        b.append(f'<g opacity="0">{show(t0, D - 0.5, D)}{row}</g>')
    arc_up = "M290 170 C 380 110, 500 110, 590 170"
    arc_dn = "M590 230 C 500 290, 380 290, 290 230"
    b.append(f'<path d="{arc_up}" fill="none" stroke="{MARK}" stroke-dasharray="4 6"/><path d="{arc_dn}" fill="none" stroke="{MARK}" stroke-dasharray="4 6"/>')
    for i, (lbl, t0, path) in enumerate([("ridge-loop.md", 0.8, arc_up), ("gear-list.md", 1.1, arc_up), ("split-rock.md", 4.6, arc_dn), ("ridge-loop.md", 5.6, arc_up)]):
        chip = pill(-46, -12, lbl, "#fff", INK, 10.5)
        b.append(f'<g opacity="0">{anim("opacity", [(0, 0), (t0, 0), (t0 + 0.1, 1), (t0 + 1.2, 1), (t0 + 1.35, 0)], D, ease=False)}'
                 f'<g>{chip}<animateMotion path="{path}" keyPoints="0;0;1;1" keyTimes="0;{fmt(t0 / D)};{fmt((t0 + 1.2) / D)};1" calcMode="linear" dur="{fmt(D)}s" repeatCount="indefinite"/></g></g>')
    b.append(f'<g opacity="0">{show(5.6, 8.0, D)}{pill(372, 300, "split-rock.md came down", size=10.5)}</g>')
    # notebook with its own repo
    lane = (f'<g filter="url(#lift)"><rect x="40" y="322" width="800" height="70" rx="12" fill="#fff"/></g>'
            + cover(56, 330, 34, "Docs", 5, "lake") + text(104, 352, "Field Kit docs", 13, INK, UI, 700) + text(104, 372, "⋯ → Sync with a repo…", 11.5, SOFT, UI)
            + text(420, 352, "↔", 18, ACCENT, UI, 700, "middle")
            + f'<circle cx="474" cy="357" r="9" fill="#24292f"/>' + text(490, 352, "you/field-kit · docs/", 13, INK, MONO) + text(490, 372, "a project's docs folder, synced as a notebook", 11.5, SOFT, UI))
    b.append(f'<g opacity="0">{show(8.6, D - 0.5, D)}{lane}</g>')
    b.append(f'<g opacity="0">{show(2.0, D - 0.5, D)}{pill(330, 76, "first sync: preview, then link", size=10.5)}</g>')
    return svg(H, "".join(b), "Notes travel from the Mac to a private GitHub repo as verified commits, one comes back down, and a notebook syncs with a project's docs folder.")


def setup() -> str:
    D, H = 13.0, 380
    b = [panel(H), caption(36, 44, "A vault that sets itself up", "Pick an empty folder and your first notebook is waiting. Cairn can make the GitHub repo too.")]
    b.append(window(36, 80, 380, 270, "Cairn"))
    b.append(f'<g opacity="1">{anim("opacity", [(0, 1), (1.8, 1), (2.1, 0), (D - 0.4, 0), (D, 1)], D)}'
             + text(226, 186, "Cairn", 26, INK, DISPLAY, 700, "middle", 4) + text(226, 210, "Notes as markers you leave behind.", 12, SOFT, UI, 400, "middle")
             + f'<rect x="156" y="226" width="140" height="30" rx="8" fill="{ACCENT}"/>' + text(226, 246, "Choose vault folder…", 12, "#fff", UI, 600, "middle") + "</g>")
    first = (f'<rect x="36" y="108" width="110" height="242" fill="{DESK}"/>' + cover(52, 124, 78, "First Cairn", 1)
             + f'<rect x="146" y="108" width="270" height="242" fill="url(#ug)"/>' + text(166, 146, "Welcome", 20, INK, DISPLAY, 700)
             + "".join(text(166, 176 + i * 20, s, 11.5, INK, MONO) for i, s in enumerate(["This is your first", "notebook. Every page", "is a markdown file", "in your folder."]))
             + text(166, 276, "## Getting around", 12, MARK, MONO))
    b.append(f'<g opacity="0">{show(2.0, D - 0.5, D)}{first}</g>')
    # sync sheet
    sx = 450
    b.append(f'<g filter="url(#lift)"><rect x="{sx}" y="80" width="394" height="270" rx="12" fill="#fff"/></g>' + text(sx + 20, 110, "SYNC", 13, INK, DISPLAY, 700, spacing=3))
    b.append(text(sx + 20, 138, "REPOSITORY", 9.5, SOFT, DISPLAY, 700, spacing=1.6) + f'<rect x="{sx + 20}" y="146" width="354" height="32" rx="6" fill="{PAGE}" stroke="{LINE}"/>')
    b.append(typed(sx + 32, 167, "you/cairn-vault", 13, 3.2, 4.1, D, cid="u0"))
    b.append(f'<rect x="{sx + 286}" y="188" width="88" height="28" rx="7" fill="#fff" stroke="{LINE}"/>' + text(sx + 330, 207, "Preview", 12, INK, UI, 600, "middle"))
    warn = (f'<rect x="{sx + 20}" y="228" width="354" height="60" rx="8" fill="#fbf1e6"/>'
            + text(sx + 32, 250, "you/cairn-vault doesn't exist yet.", 12, INK, UI, 600) + text(sx + 32, 270, "Create it as a private repository?", 12, SOFT, UI)
            + f'<rect x="{sx + 248}" y="298" width="126" height="30" rx="8" fill="{ACCENT}"/>' + text(sx + 311, 318, "Create private repo", 11.5, "#fff", UI, 700, "middle"))
    b.append(f'<g opacity="0">{show(4.9, 7.6, D, 0.25)}{warn}</g>')
    ok = (f'<rect x="{sx + 20}" y="228" width="354" height="100" rx="8" fill="#eef6ec"/>' + text(sx + 32, 252, "✓ Created you/cairn-vault (private)", 12.5, "#1a7f37", UI, 700)
          + text(sx + 32, 276, "First sync: 2 files go up", 12, INK, UI) + text(sx + 32, 296, "notebooks/0001-first-cairn/…", 11, SOFT, MONO)
          + f'<rect x="{sx + 264}" y="298" width="110" height="26" rx="7" fill="{INK}"/>' + text(sx + 319, 316, "Link and sync", 11.5, "#fff", UI, 700, "middle"))
    b.append(f'<g opacity="0">{show(8.0, D - 0.5, D, 0.25)}{ok}</g>')
    cur = '<path d="M0 0 L0 17 L4.5 13 L7.5 20 L10 19 L7 12 L13 12 Z" fill="#111" stroke="#fff" stroke-width="1.2"/>'
    b.append(f'<g>{anim_t("translate", [(0, (300, 300)), (1.2, (232, 244)), (1.8, (234, 246)), (2.6, (sx + 200, 170)), (4.2, (sx + 330, 206)), (4.6, (sx + 332, 208)), (6.4, (sx + 320, 316)), (7.6, (sx + 322, 318)), (9.5, (sx + 330, 330)), (D, (300, 300))], D)}{cur}</g>')
    return svg(H, "".join(b), "Choosing an empty folder opens a First Cairn notebook with a welcome note, and the Sync sheet creates a private vault repo.",
               defs=graph_paper("ug", 15))


def mcp() -> str:
    D, H = 14.0, 380
    b = [panel(H), caption(36, 44, "Claude can read it", "cairn-mcp is a local MCP server: Claude searches and reads your notes, and can add to them. It never edits or deletes.")]
    b.append(f'<g filter="url(#lift)"><rect x="36" y="80" width="470" height="270" rx="12" fill="#1f1c18"/></g>')
    for i, c in enumerate(("#ec6a5e", "#f4be4f", "#61c454")):
        b.append(f'<circle cx="{54 + i * 16}" cy="98" r="5" fill="{c}"/>')
    lines = [
        (0.6, "> What did I write about the ridge loop?", "#e9e2d4", 1.6),
        (2.4, "● cairn_search(\"ridge loop\")", "#f0a274", 0),
        (2.8, "  └ Ridge loop · Trail Log · Nov 16", "#b5ab9b", 0),
        (3.4, "Switchbacks before sunrise, a taller cairn", "#e9e2d4", 0),
        (3.6, "at the top, frost on the boardwalk.", "#e9e2d4", 0),
        (5.4, "> Add today's trail conditions to it.", "#e9e2d4", 1.4),
        (7.2, "● cairn_append(\"Ridge loop\", …)", "#f0a274", 0),
        (7.6, "  └ Added 2 lines", "#b5ab9b", 0),
    ]
    for i, (t0, s, color, typing) in enumerate(lines):
        y = 132 + i * 25
        if typing:
            b.append(typed(56, y, s, 12.5, t0, t0 + typing, D, color, cid=f"m{i}", caret=False))
        else:
            b.append(f'<g opacity="0">{show(t0, D - 0.5, D, 0.2)}{text(56, y, s, 12.5, color, MONO)}</g>')
    px = 530
    b.append(f'<g filter="url(#lift)"><rect x="{px}" y="80" width="314" height="270" rx="12" fill="{PAGE}"/></g><rect x="{px}" y="80" width="314" height="270" rx="12" fill="url(#mg)"/>')
    b.append(text(px + 22, 118, "Ridge loop", 19, INK, DISPLAY, 700))
    b.append("".join(text(px + 22, 148 + i * 22, s, 12, INK, MONO) for i, s in enumerate(["Up the switchbacks before", "sunrise. The cairn at the", "top was taller than last", "fall."])))
    new = (f'<rect x="{px + 14}" y="248" width="286" height="54" rx="6" fill="{ACCENT}" opacity="0.1"/>'
           + text(px + 22, 268, "Nov 17: dry and fast,", 12, INK, MONO) + text(px + 22, 290, "ice gone from the bridge.", 12, INK, MONO))
    b.append(f'<g opacity="0">{show(8.0, D - 0.5, D)}{new}</g>')
    b.append(f'<g opacity="0">{show(8.2, D - 0.5, D)}{pill(px + 168, 316, "appears in Cairn", size=10.5)}</g>')
    return svg(H, "".join(b), "In a terminal, Claude searches the vault with cairn_search, answers from the note, then appends two lines that appear in Cairn.",
               defs=graph_paper("mg", 16))


def companion() -> str:
    D, H = 13.0, 430
    b = [panel(H), caption(36, 44, "The companion", "Read, search and jot from any browser, phone included. Your own Cloudflare account, behind Cloudflare Access.")]
    px, py = 70, 80
    b.append(f'<g filter="url(#lift)"><rect x="{px}" y="{py}" width="200" height="336" rx="30" fill="#1d1d1f"/></g><rect x="{px + 9}" y="{py + 9}" width="182" height="318" rx="22" fill="{PAGE}"/>')
    b.append(f'<rect x="{px + 9}" y="{py + 9}" width="182" height="44" rx="22" fill="#efe7d8"/><rect x="{px + 9}" y="{py + 31}" width="182" height="22" fill="#efe7d8"/>')
    b.append(text(px + 100, py + 40, "🔒 notes.example.com", 10.5, SOFT, UI, 600, "middle"))
    b.append(text(px + 22, py + 78, "CAIRN", 12, INK, DISPLAY, 700, spacing=3))
    for i, (t, n) in enumerate([("Trail Log", "4 notes"), ("North Shore", "3 notes"), ("Bench Notes", "7 notes")]):
        y = py + 96 + i * 40
        b.append(f'<rect x="{px + 20}" y="{y}" width="160" height="32" rx="7" fill="#fff" stroke="{LINE}"/>' + text(px + 30, y + 21, t, 12, INK, UI, 600) + text(px + 170, y + 21, n, 10, SOFT, UI, 400, "end"))
    b.append(f'<rect x="{px + 20}" y="{py + 230}" width="160" height="56" rx="8" fill="#fff" stroke="{ACCENT}"/>' + text(px + 30, py + 248, "QUICK CAPTURE", 8.5, ACCENT, DISPLAY, 700, spacing=1.4))
    b.append(typed(px + 30, py + 270, "Moose at Lutsen, 6:40", 10.5, 1.2, 2.6, D, cid="q0"))
    b.append(f'<rect x="{px + 116}" y="{py + 294}" width="64" height="22" rx="11" fill="{INK}"/>' + text(px + 148, py + 309, "Save", 10.5, "#fff", UI, 700, "middle"))
    b.append(f'<g opacity="0">{show(3.0, D - 0.5, D, 0.2)}<rect x="{px + 20}" y="{py + 294}" width="90" height="22" rx="11" fill="#dafbe1"/>{text(px + 65, py + 309, "✓ saved", 10.5, "#1a7f37", UI, 700, "middle")}</g>')
    steps = [(320, "signed commit", "#24292f", "you/cairn-vault", 3.6), (520, "next sync", ACCENT, "Cairn on your Mac", 5.6)]
    for x, lbl, col, name, t0 in steps:
        g = (f'<path d="M{x - 30} 220 H{x}" stroke="{MARK}" stroke-width="2" stroke-dasharray="4 5"/>'
             f'<g filter="url(#lift)"><rect x="{x}" y="176" width="170" height="90" rx="12" fill="#fff"/></g>'
             f'<circle cx="{x + 24}" cy="204" r="9" fill="{col}"/>' + text(x + 40, 209, name, 12, INK, UI, 700) + text(x + 18, 240, lbl, 11.5, SOFT, UI))
        b.append(f'<g opacity="0">{show(t0, D - 0.5, D)}{g}</g>')
    b.append(f'<g opacity="0">{show(7.2, D - 0.5, D)}' + pill(560, 276, "new note in Trail Log", size=10.5) + "</g>")
    b.append(f'<g opacity="0">{show(8.0, D - 0.5, D)}' + text(320, 330, "Access at the edge, plus a token check in every function.", 12, SOFT, UI)
             + text(320, 350, "It reads only what has synced to your vault repo.", 12, SOFT, UI) + "</g>")
    return svg(H, "".join(b), "On a phone, the companion lists notebooks and saves a quick capture as a signed commit that Cairn picks up on its next sync.")


SCENES = {
    "hero": hero, "editor": editor, "paper": paper, "shelf": shelf, "covers": covers,
    "notebook-mode": notebook_mode, "links-search": links_search, "sync": sync, "setup": setup,
    "mcp": mcp, "companion": companion,
}


def main() -> None:
    bs = badges()
    for name, fn in SCENES.items():
        _uid[0] = 0
        (OUT / f"{name}.svg").write_text(fn())
    _uid[0] = 0
    (OUT / "stickers-badges.svg").write_text(stickers_badges(bs))
    for f in sorted(OUT.glob("*.svg")):
        print(f"{f.name:24} {f.stat().st_size / 1024:6.1f} KB")


if __name__ == "__main__":
    main()
