# Monoprint (gel plate)

Examples: `src/cover-presets/monoprint.svg` (cover) and `src/cover-presets/monoprint.button.svg` (button)

Inspiration: Field Notes "Hunter's Moon" (FNC-72, Fall 2026). Its covers were gel-plate monoprints, layering collaged images, inks and paint pressed and transferred to paper, in ochre and "moonlit rust" on warm-white stock with ochre-ruled pages. Borrow the **process**, not the picture.

## Tells
- **Brayer streaks**: ink coverage varies in long horizontal bands, with lighter streaks where the roller skipped.
- **Ghost print**: a second, fainter pull of a shape, slightly offset (a moon behind the moon).
- **Collage**: torn paper rectangles with ragged edges, slightly rotated, sitting under the ink.
- **Layered translucency**: inks multiply where they overlap; nothing is fully opaque.
- **Plate edge**: faint ink build-up along a rounded rectangle near the border.
- Dreamlike and simplified subject matter: big moon or sun, horizon, a lone tree, field rows, a fence, a house silhouette.

## Technique

Gel ink (streaks plus wandering edge):
```xml
<filter id="gel" x="-10%" y="-10%" width="120%" height="120%">
  <feTurbulence type="fractalNoise" baseFrequency="0.006 0.11" numOctaves="3" seed="11" result="streak"/>
  <feColorMatrix in="streak" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -4 0 0 0 3.3" result="mask"/>
  <feComposite in="SourceGraphic" in2="mask" operator="in" result="inked"/>
  <feTurbulence type="fractalNoise" baseFrequency="0.025" numOctaves="2" seed="4" result="warp"/>
  <feDisplacementMap in="inked" in2="warp" scale="12" xChannelSelector="R" yChannelSelector="G"/>
</filter>
```
The anisotropic `baseFrequency="0.006 0.11"` is the brayer: it's long horizontally and tight vertically. Rotate the shape's group to change the roll direction.

- **Ghost**: same shape, a darker or complementary ink at opacity about 0.35, offset 8–12 px, through a sparser streak mask.
- **Torn paper**: `feDisplacementMap` scale 6–8 on a rect, with no blur.
- Wrap ink layers in `<g style="mix-blend-mode:multiply">`.

## Palette
- Harvest: ochre `#e3a033`, moonlit rust `#a24a2a`, dusk rose `#d38c6b`, collage ochre `#ead19f`, umber `#2b1d16`, on warm white `#efe6d4`
- Winter: indigo `#2e3b5c`, frost blue `#9fb4c8`, birch `#e9e2d0`, charcoal `#2a2a2e`
- Spring: sap `#6b8c4a`, blossom `#d99aa0`, sky `#a9c4cf`, on cream

A matching `ruling:` (e.g. ochre `#c98a3a`) makes the inside pages echo the cover, like Hunter's Moon.

## Pitfalls
- Too much streaking makes it look like scan lines. Keep the mask mostly solid (constant ≥ 3).
- Converging furrow lines overshoot the canvas; that's fine, since `clip-path` trims them.
