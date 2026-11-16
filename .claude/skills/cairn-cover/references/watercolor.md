# Watercolor

Examples: `src/cover-presets/watercolor.svg` (cover) and `src/cover-presets/watercolor.button.svg` (button)

## Tells
- **Bleeding, irregular edges** on every wash. Nothing has a crisp silhouette except a tiny focal detail.
- **Pigment rims**: a slightly darker line where a wash dried at its edge.
- **Transparency**: layers glaze over each other (`mix-blend-mode:multiply`, opacity 0.5–0.8).
- **Granulation** in heavy washes, and **cold-press tooth** across the whole sheet.
- **Lifted lights**: glints and highlights are paler strokes on top, as if blotted out.
- Atmospheric perspective: far shapes are lighter, cooler and softer.

## Technique

Wash (body):
```xml
<filter id="wash" x="-15%" y="-15%" width="130%" height="130%">
  <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="3" seed="5" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="16" xChannelSelector="R" yChannelSelector="G" result="d"/>
  <feGaussianBlur in="d" stdDeviation="1.4"/>
</filter>
```
Pigment rim: draw the same path again as a 2–3 px stroke in a darker shade, opacity about 0.4, through a `rim` filter. Use the **same turbulence seed** as the wash so the rim follows the bled edge, but less blur (0.9).

Granulation: a darker copy of the wash masked by fine noise:
```xml
<feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" seed="13" result="g"/>
<feColorMatrix in="g" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -2.5 0 0 0 1.6" result="m"/>
<feComposite in="SourceGraphic" in2="m" operator="in"/>
```
Cold-press tooth: `feTurbulence` (0.6) into `feDiffuseLighting` with `feDistantLight azimuth="225" elevation="55"`, laid over everything at opacity about 0.3 with multiply.

Use gradients inside washes (sky to horizon) for a graded wash.

## Composition
- Far to near: sky wash, then a sun or moon (lifted, warm), far ridge (light and cool), mid ridge, water or field, then a near dark shape with one crisp focal detail (lighthouse, canoe, cabin).
- **Don't use the `T`/`S` smooth-curve shorthand for ridgelines**: the reflected control points overshoot into towering blobs. Use explicit `C` curves.

## Palette (pick 4–5)
- North Shore: slate blue `#5d8299`, deep lake `#28485e`, sage ridge `#567278`, mist `#c9c9c0`, sun `#f0b765`
- Prairie: sienna `#b0643a`, straw `#e2c58a`, sky `#9fb7c7`, shadow `#4c4a5e`
- Forest: sap green `#5b7a4a`, indigo `#34405e`, birch `#e9e2d0`, rust `#a5502e`
- Stock: off-white `#f5f0e4`. Pure white looks digital.

## Pitfalls
- Over-blurring turns it into an airbrush. Keep blur ≤ 1.5 and rely on displacement for softness.
- Washes past the canvas edge are fine (clip-path). Let the sky bleed off the top.
