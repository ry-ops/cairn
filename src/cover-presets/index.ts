// Built-in covers: the four cairn-cover styles, each with colorways. A
// colorway is a hex→hex swap applied to both the cover and its button, so
// they stay a matched set. notebook.yml: `cover: <preset>` or `<preset>/<colorway>`.
import { edition } from "../covers";
import type { NotebookMeta } from "../store";

const files = import.meta.glob("./*.svg", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const raw = (name: string) => files[`./${name}.svg`] ?? "";

export interface Colorway {
  id: string;
  label: string;
  /** Default hex → replacement. Omitted keys keep the default color. */
  swap: Record<string, string>;
  /** Edition color suggested for the title plate. */
  plate: string;
  /** Optional ruling ink to pair with it. */
  ruling?: string;
}

export interface Preset {
  id: string;
  label: string;
  style: string;
  colorways: Colorway[];
}

export const PRESETS: Preset[] = [
  {
    id: "monoprint",
    label: "Hunter's Field",
    style: "monoprint",
    colorways: [
      { id: "harvest", label: "Harvest", swap: {}, plate: "birch", ruling: "#c98a3a" },
      {
        id: "winter", label: "Winter", plate: "lake", ruling: "#7c94b0",
        swap: {
          "#efe6d4": "#e9eef0", "#ead19f": "#cfdbe3", "#d38c6b": "#8fa6bf", "#b4532a": "#3d4f73",
          "#e3a033": "#f1efe6", "#a24a2a": "#2e3b5c", "#6b2b18": "#1d2742", "#2b1d16": "#14182a", "#7a3b22": "#2e3b5c",
        },
      },
      {
        id: "spring", label: "Spring", plate: "pine", ruling: "#7f9a5c",
        swap: {
          "#efe6d4": "#f2eee2", "#ead19f": "#e6efcf", "#d38c6b": "#d99aa0", "#b4532a": "#8c5a7a",
          "#e3a033": "#f2d27a", "#a24a2a": "#6b8c4a", "#6b2b18": "#44602f", "#2b1d16": "#26301c", "#7a3b22": "#5a6e3a",
        },
      },
    ],
  },
  {
    id: "watercolor",
    label: "North Shore",
    style: "watercolor",
    colorways: [
      { id: "north-shore", label: "North Shore", swap: {}, plate: "lake" },
      {
        id: "sunset", label: "Sunset", plate: "cherry",
        swap: {
          "#7f9fb8": "#c9826e", "#c9c9c0": "#e3b48c", "#ecd3ad": "#f3d9a8", "#f0b765": "#f6c86a",
          "#8aa1ad": "#a98a8c", "#6c8795": "#8a6c70", "#567278": "#6e5865", "#3f585e": "#54434f",
          "#5d8299": "#7a6a8a", "#28485e": "#3a3150", "#1f3a4c": "#2a2238", "#2f4446": "#2c2430",
        },
      },
      {
        id: "first-snow", label: "First Snow", plate: "birch",
        swap: {
          "#7f9fb8": "#a9b8c6", "#c9c9c0": "#dfe3e6", "#ecd3ad": "#f2efe8", "#f0b765": "#f4f1e6",
          "#8aa1ad": "#b9c4cc", "#6c8795": "#9aa8b2", "#567278": "#8c9ba6", "#3f585e": "#6f7e8a",
          "#5d8299": "#8ea4b4", "#28485e": "#4c6274", "#1f3a4c": "#33475a", "#2f4446": "#3a4650",
        },
      },
    ],
  },
  {
    id: "hand-drawn",
    label: "Ridge Sketch",
    style: "hand-drawn",
    colorways: [
      { id: "sepia", label: "Sepia", swap: {}, plate: "birch" },
      { id: "navy", label: "Navy ink", swap: { "#2a2420": "#1f2f45", "#ece3cf": "#e9e6dc" }, plate: "birch" },
      { id: "kraft", label: "On kraft", swap: { "#2a2420": "#2b2118", "#ece3cf": "#c9a678" }, plate: "kraft" },
      { id: "night", label: "Night", swap: { "#2a2420": "#e9e2d0", "#ece3cf": "#26282c" }, plate: "graphite" },
    ],
  },
  {
    id: "letterpress",
    label: "Pine Press",
    style: "letterpress",
    colorways: [
      { id: "rust-navy", label: "Rust & Navy", swap: {}, plate: "birch" },
      { id: "pine-gold", label: "Pine & Gold", swap: { "#b4482b": "#d4a033", "#1f3a5a": "#2f5a45" }, plate: "birch" },
      { id: "cherry-slate", label: "Cherry on Kraft", swap: { "#f2ecdf": "#c49a6c", "#b4482b": "#9b2d30", "#1f3a5a": "#3a4652" }, plate: "kraft" },
      { id: "blaze", label: "Blaze", swap: { "#f2ecdf": "#e0662f", "#b4482b": "#f4e9d8", "#1f3a5a": "#1c1c1c" }, plate: "blaze" },
    ],
  },
];

const PRESET_IDS = new Set(PRESETS.map((p) => p.id));

/** Parse `cover:` into a preset + colorway, or null if it isn't a preset. */
export function parsePreset(cover: string): { preset: Preset; colorway: Colorway } | null {
  const [id, cw] = cover.split("/");
  if (!PRESET_IDS.has(id)) return null;
  const preset = PRESETS.find((p) => p.id === id)!;
  const colorway = preset.colorways.find((c) => c.id === cw) ?? preset.colorways[0];
  return { preset, colorway };
}

function recolor(svg: string, swap: Record<string, string>): string {
  const keys = Object.keys(swap);
  if (!keys.length) return svg;
  const re = new RegExp(keys.map((k) => k.replace("#", "#")).join("|"), "gi");
  return svg.replace(re, (m) => swap[m.toLowerCase()] ?? m);
}

export const presetCover = (preset: string, colorway: Colorway) => recolor(raw(preset), colorway.swap);
export const presetButton = (preset: string, colorway: Colorway) => recolor(raw(`${preset}.button`), colorway.swap);

/** Built-in kraft button: edition stock, grain, cairn mark. */
function kraftButton(color: string): string {
  const ed = edition(color);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs><clipPath id="d"><circle cx="100" cy="100" r="100"/></clipPath><filter id="g"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="7"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="table" tableValues="0 0.2"/></feComponentTransfer></filter></defs><g clip-path="url(#d)"><rect width="200" height="200" fill="${ed.stock}"/><rect width="200" height="200" filter="url(#g)" style="mix-blend-mode:multiply"/><g fill="${ed.ink}" transform="translate(52 44) scale(2.4)"><ellipse cx="20" cy="34" rx="14" ry="4.5"/><ellipse cx="19" cy="25.5" rx="10.5" ry="4"/><ellipse cx="21" cy="18" rx="7.5" ry="3.4"/><ellipse cx="20" cy="11.5" rx="4.8" ry="2.8"/><ellipse cx="20.5" cy="6.4" rx="2.6" ry="2"/></g></g></svg>`;
}

/** Button cropped from a cover's focal band (y ≈ 90–360 of 550). */
function croppedButton(cover: string): string {
  const href = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(cover)}`;
  // Cover width 350 → 240 units; focal centre y≈215 lands at button centre.
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 200 200"><defs><clipPath id="d"><circle cx="100" cy="100" r="100"/></clipPath></defs><g clip-path="url(#d)"><image href="${href}" x="-20" y="-47" width="240" height="377"/></g></svg>`;
}

export interface Art {
  /** Cover SVG, or null to draw the built-in kraft cover. */
  cover: string | null;
  button: string;
}

/** Resolve a notebook's cover and button from its meta plus any custom files. */
export function resolveArt(meta: NotebookMeta, custom: { cover?: string | null; button?: string | null }): Art {
  const p = parsePreset(meta.cover);
  const cover = custom.cover ?? (p ? presetCover(p.preset.id, p.colorway) : null);
  const button =
    custom.button ??
    (p && !custom.cover ? presetButton(p.preset.id, p.colorway) : cover ? croppedButton(cover) : kraftButton(meta.color));
  return { cover, button };
}
