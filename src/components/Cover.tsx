// A pocket-notebook cover: 3.5 × 5.5 proportions, kraft grain, two staples
// on the spine, edition number, label box. Built-in art is the cairn mark;
// custom art (cairn-cover skill) is an SVG rendered as an <img>-equivalent
// <image>, so it can't run script. Art may carry a one-shot animation
// (src/motion.ts); it plays only when `take` is set (notebook mode).
import { useId, useMemo } from "react";
import { edition } from "../covers";
import { replay, stillArt } from "../motion";
import { coverPlacements, useStickers } from "../stickers";
import type { Notebook } from "../store";

/** Shared SVG defs (grain filter). Render once near the app root. */
export function CoverDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true" style={{ position: "absolute" }}>
      <defs>
        <filter id="grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="7" result="n" />
          <feColorMatrix in="n" type="saturate" values="0" result="g" />
          <feComponentTransfer in="g" result="a">
            <feFuncA type="table" tableValues="0 0.22" />
          </feComponentTransfer>
          <feComposite in="a" in2="SourceGraphic" operator="in" result="speck" />
          <feBlend in="SourceGraphic" in2="speck" mode="multiply" />
        </filter>
        {/* Die-cut vinyl: a white margin hugging the art's shape, and a
            shadow where the sticker lifts off the paper. */}
        <filter id="diecut" x="-20%" y="-20%" width="140%" height="140%">
          <feMorphology in="SourceAlpha" operator="dilate" radius="3" result="edge" />
          <feFlood floodColor="#fbf8f1" />
          <feComposite in2="edge" operator="in" result="margin" />
          <feGaussianBlur in="edge" stdDeviation="1.6" result="blur" />
          <feOffset in="blur" dx="0.8" dy="1.6" result="drop" />
          <feFlood floodColor="#000" floodOpacity="0.32" />
          <feComposite in2="drop" operator="in" result="shadow" />
          <feMerge>
            <feMergeNode in="shadow" />
            <feMergeNode in="margin" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
    </svg>
  );
}

/** Stacked-stone cairn mark. */
export function CairnMark({ color, size = 40 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <g fill={color}>
        <ellipse cx="20" cy="34" rx="14" ry="4.5" />
        <ellipse cx="19" cy="25.5" rx="10.5" ry="4" />
        <ellipse cx="21" cy="18" rx="7.5" ry="3.4" />
        <ellipse cx="20" cy="11.5" rx="4.8" ry="2.8" />
        <ellipse cx="20.5" cy="6.4" rx="2.6" ry="2" />
      </g>
    </svg>
  );
}

/** An SVG as an image URL. Still unless `take` is given: then any one-shot
 *  animation in it plays (again) from the start. */
export const svgDataUrl = (svg: string, take?: number) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(take === undefined ? stillArt(svg) : replay(svg, take))}`;

// The Kraft cover's cairn, stone by stone: (cx, cy, rx, ry), bottom first.
const STONES: [number, number, number, number][] = [
  [20, 56, 22, 7],
  [18.5, 42, 16.5, 6.2],
  [21.5, 30, 11.8, 5.3],
  [20, 19.5, 7.6, 4.4],
  [20.8, 11, 4.1, 3.1],
];

/** The cairn being built: each stone drops on with a small bounce, bottom
 *  to top, then the top one nearly topples, rocks back and settles. Ends on
 *  the still mark. Drawn in the mark's own units (see CairnMarkPaths). */
function stackingCairnSvg(color: string): string {
  const k = (n: number) => n.toFixed(3);
  const ease = "0.3 0 0.7 1";
  const stones = STONES.map(([cx, cy, rx, ry], i) => {
    const a = 0.04 + i * 0.11;
    const land = a + 0.1;
    const drop =
      `<animateTransform attributeName="transform" type="translate" values="0 -28;0 -28;0 0;0 -3;0 0;0 0" ` +
      `keyTimes="0;${k(a)};${k(land)};${k(land + 0.03)};${k(land + 0.06)};1" calcMode="spline" ` +
      `keySplines="0 0 1 1;0.5 0 1 1;0 0 0.4 1;0.6 0 1 1;0 0 1 1" dur="2.6s" fill="freeze"/>` +
      `<animate attributeName="opacity" values="0;0;1;1" keyTimes="0;${k(a)};${k(a + 0.02)};1" dur="2.6s" fill="freeze"/>`;
    const el = `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}">${drop}</ellipse>`;
    if (i < STONES.length - 1) return el;
    // The top stone teeters on its base after it lands.
    const px = cx;
    const py = cy + ry;
    const r = (d: number) => `${d} ${px} ${py}`;
    return (
      `<g><animateTransform attributeName="transform" type="rotate" ` +
      `values="${[0, 0, -32, 14, -6, 2, 0].map(r).join(";")}" keyTimes="0;0.66;0.76;0.85;0.92;0.97;1" ` +
      `calcMode="spline" keySplines="0 0 1 1;${ease};${ease};${ease};${ease};${ease}" dur="2.6s" fill="freeze"/>${el}</g>`
    );
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -32 52 98"><g fill="${color}">${stones}</g></svg>`;
}

/** The cover art itself, no button chrome. Reused by the shelf and book mode. */
export function CoverArt({ notebook, art, take, noStickers }: {
  notebook: Notebook;
  art?: string | null;
  take?: number;
  /** Leave stickers off (the sheet draws its own, draggable ones). */
  noStickers?: boolean;
}) {
  const { meta } = notebook;
  // Unique per instance: the same notebook's cover can be on screen twice
  // (shelf + notebook mode), and a shared id would clip against the other one.
  const clipId = `clip-${useId().replace(/:/g, "")}`;
  const ed = edition(meta.color);
  const no = String(meta.edition || 0).padStart(4, "0");
  const url = useMemo(() => (art ? svgDataUrl(art, take) : ""), [art, take]);
  const sheet = useStickers();
  const stuck = useMemo(
    () =>
      noStickers
        ? []
        : coverPlacements(meta.stickers).flatMap((p) => {
            const s = sheet.get(p.id);
            return s ? [{ p, url: svgDataUrl(s.svg) }] : [];
          }),
    [meta.stickers, sheet, noStickers],
  );
  return (
    <svg viewBox="0 0 140 220" role="img" aria-label={meta.title}>
      <defs>
        <clipPath id={clipId}>
          <rect width="140" height="220" rx="5" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        {art ? (
          <image href={url} width="140" height="220" preserveAspectRatio="xMidYMid slice" />
        ) : (
          <>
            <rect width="140" height="220" fill={ed.stock} filter="url(#grain)" />
            {take === undefined ? (
              <g transform="translate(50 64)">
                <CairnMarkPaths color={ed.ink} />
              </g>
            ) : (
              <image href={svgDataUrl(stackingCairnSvg(ed.ink), take)} x="44" y="32" width="52" height="98" />
            )}
          </>
        )}
        {/* spine shadow + saddle-stitch staples */}
        <rect x="0" y="0" width="7" height="220" fill="#000" opacity="0.10" />
        <rect x="2.2" y="52" width="2.2" height="18" rx="1" fill="#b9bcc0" />
        <rect x="2.2" y="150" width="2.2" height="18" rx="1" fill="#b9bcc0" />
      </g>
      {art && <rect x="13" y="16" width="68" height="14" rx="2" fill={ed.stock} opacity="0.9" />}
      <text x="18" y="26" fill={ed.ink} fontSize="9" letterSpacing="2.4" className="cover-small">
        No. {no}
      </text>
      {/* label box: on custom art it gets a stock-colored plate */}
      <rect
        x="16" y="150" width="108" height="46"
        fill={art ? ed.stock : "none"} fillOpacity={art ? 0.92 : 1}
        stroke={ed.ink} strokeWidth="1.2"
      />
      <foreignObject x="18" y="152" width="104" height="42">
        <div className="cover-title" style={{ color: ed.ink }}>{meta.title}</div>
      </foreignObject>
      {/* stickers go on last: stuck over everything, the title plate too */}
      {stuck.map(({ p, url: u }, i) => {
        const w = 42 * (p.s ?? 1);
        return (
          <image
            key={i}
            href={u}
            x={p.x * 140 - w / 2}
            y={p.y * 220 - w / 2}
            width={w}
            height={w}
            filter="url(#diecut)"
            transform={`rotate(${p.r} ${p.x * 140} ${p.y * 220})`}
          />
        );
      })}
    </svg>
  );
}

export function Cover({ notebook, art, selected, onClick }: {
  notebook: Notebook;
  art?: string | null;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`cover${selected ? " selected" : ""}`}
      onClick={onClick}
      title={`${notebook.meta.title} · ${notebook.note_count} notes`}
      aria-pressed={selected}
    >
      <CoverArt notebook={notebook} art={art} />
      <span className="cover-count">{notebook.note_count}</span>
    </button>
  );
}

function CairnMarkPaths({ color }: { color: string }) {
  return (
    <g fill={color}>
      {STONES.map(([cx, cy, rx, ry]) => <ellipse key={cy} cx={cx} cy={cy} rx={rx} ry={ry} />)}
    </g>
  );
}
