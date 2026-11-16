# Letterpress

Examples: `src/cover-presets/letterpress.svg` (cover) and `src/cover-presets/letterpress.button.svg` (button)

## Tells
- **Spot colors only**: 1–3 flat inks, each its own plate (`<g>`). Overlaps **overprint** (multiply), so two inks make a third, darker color.
- **Misregistration**: offset one plate by 1–2 px (`transform="translate(1.6 -1.2)"`).
- **Salty ink**: tiny speckles of paper show through solid areas.
- **Impression bite**: ink sits in a slight deboss, with an inner shadow along the top-left of shapes.
- **Blind deboss**: pressed shapes with no ink (rings, borders, rules) that show only as shadow and highlight.
- Bold, simple, geometric shapes: woodtype and linocut energy. Double-rule borders and small triangle or dot ornaments.
- Thick cotton stock with visible fibres.

## Technique

Ink plate (salt + bite):
```xml
<filter id="press" x="-5%" y="-5%" width="110%" height="110%">
  <feTurbulence type="fractalNoise" baseFrequency="0.95" numOctaves="1" seed="9" result="n"/>
  <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -7 0 0 0 5.6" result="salt"/>
  <feComposite in="SourceGraphic" in2="salt" operator="in" result="ink"/>
  <feGaussianBlur in="SourceAlpha" stdDeviation="1.1" result="b"/>
  <feOffset in="b" dx="1.1" dy="1.3" result="o"/>
  <feComposite in="SourceAlpha" in2="o" operator="out" result="rim"/>
  <feFlood flood-color="#000" flood-opacity="0.32"/>
  <feComposite in2="rim" operator="in" result="bite"/>
  <feMerge><feMergeNode in="ink"/><feMergeNode in="bite"/></feMerge>
</filter>
```
The salt matrix sets alpha = 5.6 − 7·noise. Lower the constant for saltier, more worn ink; raise it for solid.

Blind deboss: the same idea with no ink. Draw the shapes in the stock color, then merge a dark inner shadow (offset +x+y) with a light highlight (offset −x−y). See `#blind` in the example.

Fibres: anisotropic noise, `baseFrequency="0.02 0.6"`, desaturated, alpha 0–0.12, multiply.

Knock-outs: to leave a shape unprinted inside an ink area, draw it in the stock color above that plate, or use `fill-rule="evenodd"` cut-outs within one path.

## Palette (2–3 inks plus stock)
- Rust `#b4482b` + navy `#1f3a5a` on cream `#f2ecdf` (overprint is near-black)
- Pine `#2f5a45` + goldenrod `#d4a033` on birch
- Cherry `#9b2d30` + slate `#3a4652` on kraft `#c49a6c` (on kraft, inks look darker; use heavier shapes)
- One-color: black `#1c1c1c` on blaze `#e0662f`

## Pitfalls
- Gradients and soft shading break the illusion. Everything is flat ink.
- Keep detail chunky: nothing thinner than about 1.5 px at 350 wide (it disappears at shelf size).
- Apply `mix-blend-mode:multiply` on the second plate so the overprint happens.
