# Hand-drawn (pen and ink field sketch)

Examples: `src/cover-presets/hand-drawn.svg` (cover) and `src/cover-presets/hand-drawn.button.svg` (button)

## Tells (what makes it read as hand-drawn)
- Lines wobble slightly and never perfectly meet. Frame corners overshoot.
- Line weight varies: heavy for the near ground, light for far ranges, hairline for detail.
- Shading is **hatching or cross-hatching**, not gradients or fills.
- Lots of paper shows. Restraint reads as a sketch; filling everything reads as clip-art.
- Small observational marks: grass ticks, contour ticks, a dashed trail, a tiny compass or arrow.

## Technique

Pen jitter on every stroke group:
```xml
<filter id="pen" x="-5%" y="-5%" width="110%" height="110%">
  <feTurbulence type="turbulence" baseFrequency="0.045" numOctaves="2" seed="3" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="2.8" xChannelSelector="R" yChannelSelector="G"/>
</filter>
```
- `scale` 2–3.5 means steady hand; above 5 looks drunk.
- Use `stroke-linecap="round" stroke-linejoin="round"`, `fill="none"`.

Hatching is a rotated line pattern used as a fill, clipped to the shadow-side polygon:
```xml
<pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(38)">
  <line x1="0" y1="0" x2="0" y2="5" stroke="#2a2420" stroke-width="0.9"/>
</pattern>
```
Add a second pattern at about −42° for cross-hatching in the darkest areas. Put shadows on one consistent side; pick the light direction first.

Paper grain over everything (`feTurbulence` 0.9, desaturated, alpha 0–0.16, `mix-blend-mode:multiply`).

## Palette
- One ink, sometimes two: sepia or iron-gall `#2a2420`, navy `#1f2f45`, or faded black `#222`.
- An optional second ink for a single accent, e.g. red-brown `#8a3324` on a trail marker.
- Stock: birch `#ece3cf` or kraft `#c9a678` (on kraft, use a darker ink and a light-line highlight).

## Pitfalls
- No `rect` with perfect corners: draw the frame as four overshooting paths.
- Don't hatch everything; keep hatching to 2–4 shadow areas.
- Keep the label zone (`y 370–495`) nearly empty: ground lines and a few grass ticks at most.
