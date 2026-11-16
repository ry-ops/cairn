#!/usr/bin/env python3
"""Validate a Cairn cover or button SVG against its canvas contract and safety rules.

Covers: viewBox 0 0 350 550, art clipped to #page.
Buttons (*.button.svg or button.svg): viewBox 0 0 200 200, art clipped to a circle (#disc).

Usage: python3 -I check_cover.py cover.svg button.svg [more.svg ...]
Exit status 1 if any file has errors. Warnings don't fail.
Standard library only.
"""
import re
from typing import Optional
import sys
import xml.etree.ElementTree as ET

SVG_NS = "http://www.w3.org/2000/svg"
MAX_BYTES = 150 * 1024
SOFT_BYTES = 40 * 1024
FORBIDDEN_TAGS = {"script", "foreignObject", "image", "iframe", "embed", "object", "audio", "video", "canvas"}
EXTERNAL = re.compile(r"(https?:|//|file:|javascript:|data:)", re.I)


ANIM_TAGS = {"animate", "animateTransform", "animateMotion", "set"}
MAX_MOTION_S = 2.6


def seconds(v: str) -> "Optional[float]":
    """SMIL clock value in seconds ("1.2s", "800ms", "2"), or None."""
    m = re.fullmatch(r"\s*([\d.]+)\s*(ms|s)?\s*", v or "")
    if not m:
        return None
    n = float(m.group(1))
    return n / 1000 if m.group(2) == "ms" else n


def local(tag: str) -> str:
    return tag.split("}", 1)[1] if "}" in tag else tag


def check(path: str) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    raw = open(path, "rb").read()
    if len(raw) > MAX_BYTES:
        errors.append(f"{len(raw) // 1024} KB > 150 KB limit")
    elif len(raw) > SOFT_BYTES:
        warnings.append(f"{len(raw) // 1024} KB; aim for < 40 KB")
    if b"<!ENTITY" in raw or b"<!DOCTYPE" in raw:
        errors.append("DOCTYPE/ENTITY declarations are not allowed")
        return errors, warnings
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as e:
        return [f"not well-formed XML: {e}"], warnings

    if local(root.tag) != "svg":
        errors.append("root element must be <svg>")
    is_button = path.endswith("button.svg")
    want = ["0", "0", "200", "200"] if is_button else ["0", "0", "350", "550"]
    clip_id = "disc" if is_button else "page"
    if root.get("viewBox", "").split() != want:
        errors.append(f'root needs viewBox="{" ".join(want)}" ({"button" if is_button else "cover"})')

    seeds: dict[str, int] = {}
    clip_used = False
    ids = {el.get("id") for el in root.iter() if el.get("id")}
    for el in root.iter():
        tag = local(el.tag)
        if tag in FORBIDDEN_TAGS:
            errors.append(f"<{tag}> is not allowed")
        if tag == "text" or tag == "tspan":
            errors.append("no <text>: the app prints the title; draw ornaments as paths")
        if tag == "style" and el.text and ("@import" in el.text or "url(" in el.text and EXTERNAL.search(el.text)):
            errors.append("<style> may not import or reference external resources")
        if tag == "style" and el.text and re.search(r"@keyframes|animation\s*:|transition\s*:", el.text):
            errors.append("CSS animation isn't allowed; use one-shot SMIL (see Motion in SKILL.md)")
        if tag in ANIM_TAGS:
            # Motion contract: plays once, from the start, briefly; ends on the still art.
            if el.get("repeatCount") or el.get("repeatDur"):
                errors.append(f"<{tag}> repeats: motion plays once (no repeatCount/repeatDur)")
            begin = el.get("begin", "0s")
            b = seconds(begin)
            if b is None:
                errors.append(f'<{tag}> begin="{begin}": start at 0s and stagger with keyTimes')
            elif b > 0:
                warnings.append(f'<{tag}> begin="{begin}": the base value shows until then; prefer begin 0 + keyTimes')
            d = seconds(el.get("dur", "")) if tag != "set" else 0.0
            if d is None:
                errors.append(f"<{tag}> needs a dur in seconds")
            elif (b or 0) + d > MAX_MOTION_S:
                errors.append(f"<{tag}> ends at {(b or 0) + d:g}s; all motion must finish by {MAX_MOTION_S}s")
            if el.get("fill") != "freeze":
                warnings.append(f'<{tag}> without fill="freeze": make sure it ends on the base value')
        if tag == "feTurbulence":
            s = el.get("seed", "0")
            seeds[s] = seeds.get(s, 0) + 1
        for k, v in el.attrib.items():
            name = local(k)
            if name.lower().startswith("on"):
                errors.append(f"event attribute {name}= on <{tag}>")
            if name == "href" and not v.startswith("#"):
                errors.append(f"external href on <{tag}>: {v[:40]}")
            if "url(" in v:
                for ref in re.findall(r"url\(([^)]*)\)", v):
                    ref = ref.strip("'\" ")
                    if not ref.startswith("#"):
                        errors.append(f"external url() in {name}= on <{tag}>")
                    elif ref[1:] not in ids:
                        errors.append(f"url({ref}) points at a missing id")
            if name == "clip-path" and v.strip() == f"url(#{clip_id})":
                clip_used = True
            if name == "style" and EXTERNAL.search(v) and "url(" in v:
                errors.append(f"external reference in style= on <{tag}>")

    if not clip_used:
        warnings.append(f'wrap the art in <g clip-path="url(#{clip_id})"> (see SKILL.md)')
    dup = [s for s, n in seeds.items() if n > 2]
    if dup:
        warnings.append(f"feTurbulence seed(s) {', '.join(dup)} reused >2×; vary seeds to avoid visible repetition")
    return errors, warnings


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    bad = False
    for path in sys.argv[1:]:
        errors, warnings = check(path)
        status = "FAIL" if errors else "ok"
        print(f"{status}  {path}")
        for e in errors:
            print(f"  error: {e}")
        for w in warnings:
            print(f"  warn:  {w}")
        bad |= bool(errors)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
