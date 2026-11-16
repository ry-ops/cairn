// The sticker sheet: Cairn's own die-cut vinyl stickers, plus yours from
// `<vault>/stickers/*.svg` (ids `my:<name>`). Placements live outside the
// note body: in a page's frontmatter `stickers:` or a notebook.yml
// `stickers:` list. The die-cut white edge and shadow come from the app's
// `#diecut` filter, so a sticker SVG is just the art on a clear background.
import { createContext, useContext } from "react";

const files = import.meta.glob("./*.svg", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export interface Sticker {
  id: string;
  label: string;
  svg: string;
}

const label = (svg: string, id: string) => svg.match(/<!-- sticker: (.+?) -->/)?.[1] ?? id.replace(/-/g, " ");

/** The built-in sheet, in display order. */
const ORDER = ["cairn", "compass", "pine", "peaks", "moon", "sun", "bolt", "wave", "canoe", "tent", "campfire", "mug", "blaze", "star", "field-tested"];
export const BUILTIN: Sticker[] = Object.entries(files)
  .map(([path, svg]) => {
    const id = path.replace(/^\.\//, "").replace(/\.svg$/, "");
    return { id, svg, label: label(svg, id) };
  })
  .sort((a, b) => (ORDER.indexOf(a.id) + 1 || 99) - (ORDER.indexOf(b.id) + 1 || 99));

export function customStickers(pairs: [string, string][]): Sticker[] {
  return pairs.map(([name, svg]) => ({ id: `my:${name}`, svg, label: name.replace(/[-_]/g, " ") }));
}

/** A sticker stuck somewhere. On a page: `x` is a fraction of the page
 *  width, `y` is in ruled rows from the top, so it keeps its spot on the
 *  paper when the type size changes. On a cover: both are fractions. */
export interface Placement {
  id: string;
  x: number;
  y: number;
  /** Rotation, degrees. */
  r: number;
  /** Scale; 1 is a 1″ sticker. */
  s?: number;
}

const isPlacement = (p: unknown): p is Placement => {
  const q = p as Placement;
  return !!q && typeof q.id === "string" && [q.x, q.y, q.r].every((n) => typeof n === "number" && Number.isFinite(n));
};

/** Read a `stickers:` value. `null` means "there, but not ours to rewrite"
 *  (hand-written YAML), so Cairn leaves it alone. */
export function parsePlacements(raw: string | null | undefined): Placement[] | null {
  if (!raw || raw === "[]") return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter(isPlacement) : null;
  } catch {
    return null;
  }
}

/** One frontmatter line. JSON is valid YAML, so any tool can read it. */
export function placementsValue(list: Placement[]): string {
  const round = (n: number, k = 1000) => Math.round(n * k) / k;
  return JSON.stringify(
    list.map((p) => ({ id: p.id, x: round(p.x), y: round(p.y, 100), r: round(p.r, 10), ...(p.s && p.s !== 1 ? { s: round(p.s, 100) } : {}) })),
  );
}

/** Cover placements from notebook.yml (already parsed YAML). */
export function coverPlacements(v: unknown): Placement[] {
  return Array.isArray(v) ? v.filter(isPlacement) : [];
}

/** Small random tilt and size, so no two stickers sit the same way. */
export function freshPlacement(id: string, x: number, y: number): Placement {
  return { id, x, y, r: Math.round((Math.random() * 28 - 14) * 10) / 10, s: Math.round((0.88 + Math.random() * 0.24) * 100) / 100 };
}

export const StickerContext = createContext<Map<string, Sticker>>(new Map(BUILTIN.map((s) => [s.id, s])));
export const useStickers = () => useContext(StickerContext);
