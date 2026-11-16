---
name: cairn-cover
description: Design custom cover art for a Cairn notebook in a hand-drawn, watercolor, letterpress or monoprint (gel-plate) style, optionally with a one-shot animation, as a safe self-contained SVG, and install it into the vault. Use when the user wants to customize, design, redo, animate or "make art for" a Cairn notebook cover, or mentions one of those print or illustration styles for a notebook.
---

# Cairn cover

Make one-of-a-kind cover art for a Cairn notebook, in the spirit of Field Notes' quarterly editions: crafted, seasonal, rooted in a place. Each cover is `cover.svg`, drawn behind the app's edition number and title plate. It shows on the shelf, in All Notebooks (⌘0), in the cover picker and in notebook mode. (Cairn used to show a matching pin-back button per notebook. The All Notebooks grid replaced that view on Nov 15, 2026, so don't make buttons unless asked; an existing `button.svg` is ignored.)

Styles (each recipe file has the techniques, palettes and pitfalls):

| Style | Feel | Recipe |
|---|---|---|
| `hand-drawn` | Pen-and-ink field sketch: wobbly line, hatching, notes in the margin | [references/hand-drawn.md](references/hand-drawn.md) |
| `watercolor` | Wet washes, bleeding edges, pigment rims, cold-press tooth | [references/watercolor.md](references/watercolor.md) |
| `letterpress` | 1–3 spot inks, salty coverage, impression bite, misregistration, blind deboss | [references/letterpress.md](references/letterpress.md) |
| `monoprint` | Gel-plate pulls: brayer streaks, ghost prints, torn collage layers (cf. FN "Hunter's Moon") | [references/monoprint.md](references/monoprint.md) |

Worked examples, one cover per style, are the built-in presets in `src/cover-presets/` (`<style>.svg`; the `.button.svg` files are colorway swatches in the picker). Read the cover for your style before drawing. Don't copy them; they show technique and scale.

## Workflow

1. **Find the notebook.** The vault path is in `~/Library/Application Support/dev.ry-ops.cairn/config.json` (`vault_path`). Notebooks live at `<vault>/notebooks/<NNNN-slug>/notebook.yml`. If the user didn't name one, list them and ask.
2. **Find the subject.** Read `notebook.yml` (title, `color`, `paper`) and skim a few notes in the folder for motifs: places, weather, season, gear. A cover is better when it's about *this* notebook (e.g. Lake Superior shoreline, a ridge cairn, a harvest moon) than generic. Respect the user's style choice; if none was given, offer the four with one line each.
3. **Plan before drawing.** Write down, in 3–5 lines:
   - subject and composition
   - palette: hex values; at most 3 spot inks for letterpress
   - which edition `color` the label plate should use (see "Label plate")
   - an optional `ruling` hex that echoes the art (e.g. ochre lines for an autumn cover)
4. **Draw the cover** following the canvas contract below and the style recipe. Add a one-shot animation if asked (see Motion).
5. **Validate**: `python3 -I .claude/skills/cairn-cover/scripts/check_cover.py cover.svg`. Fix every error.
6. **Look at it**: `.claude/skills/cairn-cover/scripts/preview.sh cover.svg` renders a PNG through macOS QuickLook (the same WebKit engine the app uses). Open the PNG and critique it against the checklist below. Iterate at least once. Don't install art you haven't looked at.
7. **Install**:
   - Save as `<vault>/notebooks/<id>/cover.svg`. If one already exists, keep it as `cover-prev.svg` unless the user says to replace it.
   - Edit `notebook.yml`: set `cover: cover.svg`, plus `color:` and `ruling:` if you chose them. Change only those lines; keep the comments and other keys.
   - Tell the user to reopen the notebook (or restart Cairn) to see it. They can save a cover they love to the shared library from the cover picker (Cairn copies it to `<vault>/covers/`). Don't commit or push the vault unless asked.

## Canvas contract

- `viewBox="0 0 350 550"` (3.5 × 5.5, pocket-notebook proportions). No width or height attributes are needed.
- Full bleed: paint the whole canvas. Wrap everything in `<g clip-path="url(#page)">` with `<clipPath id="page"><rect width="350" height="550"/></clipPath>`, so filters and overhangs never leak past the edge.
- **The app overlays these zones, so keep them calm** (no focal detail, no strong edges):
  - **Edition number**, top-left: `x 30–160, y 30–80`
  - **Label plate**: `x 35–315, y 370–495`. The title is printed here on a plate in the edition's stock color.
  - **Spine**, left edge: `x 0–18`. The app adds a spine shadow and two staples.
- Put the focal subject in the band `y 90–360`. The bottom band below the label (`y 500–550`) suits a small ornament.

## Hard rules

- **Self-contained and inert.** No `<script>`, no `on*=` attributes, no `<foreignObject>`, no `<image>`, no external `href`/`url()`, no `@import`, no web fonts. The validator enforces this.
- **No text.** The app draws the title and number in Futura; fonts aren't available inside the art anyway. Glyph-like ornaments drawn as paths are fine.
- **Original art only.** Take inspiration from Field Notes editions' *craft* (gel-plate monoprint, spot-color letterpress, watercolor field guides) but never reproduce their artwork, logos, wordmark, layouts or edition designs, nor any other artist's work. Draw it yourself.
- **Size**: aim under 40 KB; the hard limit is 150 KB. Effects come from SVG filters (`feTurbulence`, `feDisplacementMap`, lighting), not thousands of paths.
- **Distinct seeds** for each filter's `feTurbulence`, so textures don't line up into visible patterns.
- Keep filter regions tight (`x="-10%" … width="120%"`). Huge regions render slowly in the shelf.

## Motion (optional, covers only)

A cover may carry a **one-shot animation**. It plays as All Notebooks (⌘0) opens and its cover arrives in the grid, and as the notebook arrives on the desktop in notebook mode, before it swings open. The cover picker's big preview plays it too, each time a cover is chosen. Everywhere else (the shelf, the picker's thumbnails), Cairn strips the animation elements and shows the still cover. Field Notes' editions are still objects, so let the motion reveal how the cover was *made* rather than add effects:
- **watercolor:** washes laid down one after another, the sun lifting into place.
- **hand-drawn:** the pen drawing the scene, then the hatching.
- **a cairn, in any style:** stack it bottom to top, then let the top stone teeter (a rotate about its base: tip, rock back, settle). It must end standing.
- **letterpress:** each ink pass biting in and settling into register.
- **monoprint:** the sky pulled from the plate, then the moon rising with its ghost.

The built-in presets in `src/cover-presets/` each do one of these; read one first.

Contract (the validator enforces it):
- **SMIL only:** `<animate>`, `<animateTransform>`, `<animateMotion>`, `<set>`. No CSS `@keyframes`, `animation:` or `transition:`.
- **Plays once:** no `repeatCount` or `repeatDur`, and everything finishes by **2.6s**.
- **Starts at 0:** no `begin` delays (the base value would flash first). Stagger with `values` and `keyTimes` over a shared `dur`, holding the start value until each element's turn, for example `values="0;0;0.75" keyTimes="0;0.4;1"`.
- **Ends on the still art:** the element's own attributes are the final frame, and the animation runs *to* them with `fill="freeze"`. Stripped of its animations, the file must be the finished cover.
- **Pen strokes:** use `pathLength="1" stroke-dasharray="1"` on the element and animate `stroke-dashoffset` from `1` to `0`. Hide the stroke until its turn (`opacity` `0;0;1`), because round caps draw a dot even at zero length.
- **Keep it calm:** move a few things, gently (`calcMode="spline"` with ease-out `keySplines`). Never animate the safe zones.

To check motion, open the notebook in Cairn (⇧⌘F); `preview.sh` renders only the final frame.

## Label plate

The label plate uses the notebook's edition `color` (`src/covers.ts`): kraft `#c49a6c`, blaze `#e0662f`, pine `#3f5b45`, lake `#2f4f6b`, birch `#e9e2d0`, graphite `#34363a`, cherry `#9b2d30`. Pick the one that sits best on the art. Light art usually wants `birch`; dark art wants a mid or dark plate.

## Critique checklist (look at the PNG)

- Does it read at shelf size (about 70 px wide)? Squint: one clear focal shape, value contrast between sky, subject and ground.
- Does it look made by hand and press, not vector-clean? (Texture, wobble, ink variance.)
- Is the style convincing? Each recipe lists its tells; check them.
- Are the safe zones calm? Would the title plate and number sit cleanly?
- Is the palette 2–5 colors and in harmony with the edition plate?
- Any filter artifacts: hard rectangular filter edges, banding, displacement tearing at the canvas edge?
