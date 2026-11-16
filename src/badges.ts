// Merit badges: earned from what's in the vault, like the patches on a scout
// sash. Each is checked against vault statistics; once earned it's kept
// (with the date) in <vault>/badges.yml, even if notes are later trashed.
import type { Book, IndexedNote } from "./links";
import { resolve } from "./links";
import { getKey } from "./frontmatter";
import type { Notebook } from "./store";
import { coverPlacements, parsePlacements } from "./stickers";

export interface VaultStats {
  notes: number;
  notebooks: number;
  words: number;
  links: number;
  /** Links from one notebook into another. */
  crossLinks: number;
  /** Longest run of consecutive days with a note (by file date). */
  streak: number;
  /** Seasons of the year with at least one note. */
  seasons: number;
  stickers: number;
  originalCover: boolean;
  synced: boolean;
}

const body = (t: string) => t.replace(/^---\n[\s\S]*?\n---\n?/, "");

export function vaultStats(index: IndexedNote[], notebooks: Notebook[], books: Book[], synced: boolean): VaultStats {
  let words = 0;
  let links = 0;
  let crossLinks = 0;
  let stickers = 0;
  const days = new Set<string>();
  const seasons = new Set<number>();
  for (const n of index) {
    words += body(n.text).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;
    links += n.links.length;
    for (const l of n.links) {
      const r = resolve(l, n.notebook, index, books);
      if (r && r.notebook !== n.notebook) crossLinks++;
    }
    stickers += parsePlacements(getKey(n.text, "stickers"))?.length ?? 0;
    const d = n.file.match(/^(\d{4})-(\d{2})-(\d{2})-/);
    if (d) {
      days.add(`${d[1]}-${d[2]}-${d[3]}`);
      seasons.add(Math.floor((Number(d[2]) % 12) / 3)); // Dec–Feb, Mar–May, …
    }
  }
  for (const nb of notebooks) stickers += coverPlacements(nb.meta.stickers).length;

  let streak = 0;
  let run = 0;
  let prev = 0;
  for (const day of [...days].sort()) {
    const t = Date.parse(`${day}T12:00:00Z`);
    run = prev && Math.round((t - prev) / 86_400_000) === 1 ? run + 1 : 1;
    streak = Math.max(streak, run);
    prev = t;
  }
  const originalCover = notebooks.some((n) => /\.svg$|^lib:/.test(n.meta.cover ?? ""));
  return { notes: index.length, notebooks: notebooks.length, words, links, crossLinks, streak, seasons: seasons.size, stickers, originalCover, synced };
}

export interface Badge {
  id: string;
  name: string;
  /** How it's earned, in a few words. */
  how: string;
  earned: (s: VaultStats) => boolean;
  /** Progress toward it, for the sash. */
  progress?: (s: VaultStats) => [number, number];
  patch: PatchSpec;
}

interface PatchSpec {
  shape: "circle" | "shield" | "hex";
  ground: string;
  border: string;
  thread: string;
  /** Icon: SVG markup in a 120×120 box, drawn in `thread`. */
  icon: string;
}

const CAIRN = `<ellipse cx="60" cy="84" rx="22" ry="7"/><ellipse cx="58" cy="70" rx="16" ry="6"/><ellipse cx="61" cy="58" rx="11" ry="5"/><ellipse cx="59" cy="48" rx="7" ry="4"/>`;
const num = (n: string, y = 46) =>
  `<text x="60" y="${y}" text-anchor="middle" font-family="Futura, Avenir Next, sans-serif" font-weight="700" font-size="22">${n}</text>`;

export const BADGES: Badge[] = [
  {
    id: "first-marker", name: "First Marker", how: "Write your first note.",
    earned: (s) => s.notes >= 1, progress: (s) => [Math.min(s.notes, 1), 1],
    patch: { shape: "circle", ground: "#c49a6c", border: "#3a2a1c", thread: "#2b2118", icon: CAIRN },
  },
  {
    id: "ten-markers", name: "Ten Markers", how: "Write ten notes.",
    earned: (s) => s.notes >= 10, progress: (s) => [Math.min(s.notes, 10), 10],
    patch: { shape: "circle", ground: "#3f5b45", border: "#e8c547", thread: "#efe6d2", icon: `<g transform="translate(0 14) scale(1 .8)">${CAIRN}</g>${num("10", 44)}` },
  },
  {
    id: "fifty-markers", name: "Fifty Markers", how: "Write fifty notes.",
    earned: (s) => s.notes >= 50, progress: (s) => [Math.min(s.notes, 50), 50],
    patch: { shape: "shield", ground: "#2f4f6b", border: "#e8c547", thread: "#efe6d2", icon: `<g transform="translate(0 14) scale(1 .8)">${CAIRN}</g>${num("50", 44)}` },
  },
  {
    id: "field-library", name: "Field Library", how: "Keep five notebooks.",
    earned: (s) => s.notebooks >= 5, progress: (s) => [Math.min(s.notebooks, 5), 5],
    patch: {
      shape: "hex", ground: "#e9e2d0", border: "#9b2d30", thread: "#9b2d30",
      icon: `<rect x="34" y="36" width="14" height="50" rx="2"/><rect x="51" y="30" width="14" height="56" rx="2"/><rect x="68" y="40" width="14" height="46" rx="2" transform="rotate(8 75 63)"/><path d="M30 90 H90" stroke="#9b2d30" stroke-width="4" stroke-linecap="round"/>`,
    },
  },
  {
    id: "cartographer", name: "Cartographer", how: "Link notes together ten times.",
    earned: (s) => s.links >= 10, progress: (s) => [Math.min(s.links, 10), 10],
    patch: {
      shape: "circle", ground: "#efe6d2", border: "#2f4f6b", thread: "#2f4f6b",
      icon: `<path d="M30 40 L50 34 L70 40 L90 34 V80 L70 86 L50 80 L30 86 Z" fill="none" stroke="#2f4f6b" stroke-width="4" stroke-linejoin="round"/><path d="M50 34 V80 M70 40 V86" stroke="#2f4f6b" stroke-width="2.5"/><path d="M36 74 Q 48 56 60 64 T 84 46" fill="none" stroke="#c2412b" stroke-width="3" stroke-dasharray="4 3" stroke-linecap="round"/>`,
    },
  },
  {
    id: "trailhead", name: "Trailhead", how: "Link from one notebook into another.",
    earned: (s) => s.crossLinks >= 1, progress: (s) => [Math.min(s.crossLinks, 1), 1],
    patch: {
      shape: "shield", ground: "#7a5a3e", border: "#e0662f", thread: "#efe6d2",
      icon: `<rect x="57" y="34" width="6" height="56" rx="1"/><path d="M40 40 H78 L86 47 L78 54 H40 Z"/><path d="M80 60 H42 L34 67 L42 74 H80 Z"/>`,
    },
  },
  {
    id: "seven-days-out", name: "Seven Days Out", how: "Write on seven days in a row.",
    earned: (s) => s.streak >= 7, progress: (s) => [Math.min(s.streak, 7), 7],
    patch: {
      shape: "circle", ground: "#e0662f", border: "#2b2118", thread: "#2b2118",
      icon: `<path d="M60 34 L84 80 H36 Z"/><path d="M60 54 L70 80 H50 Z" fill="#e0662f"/>${[0, 1, 2, 3, 4, 5, 6].map((i) => `<rect x="${33 + i * 8}" y="86" width="4" height="8" rx="1"/>`).join("")}`,
    },
  },
  {
    id: "four-seasons", name: "Four Seasons", how: "Write in winter, spring, summer and fall.",
    earned: (s) => s.seasons >= 4, progress: (s) => [s.seasons, 4],
    patch: {
      shape: "circle", ground: "#efe6d2", border: "#3f5b45", thread: "#2b2118",
      icon: `<path d="M60 60 V30 A30 30 0 0 1 90 60 Z" fill="#9cc3d5"/><path d="M60 60 H90 A30 30 0 0 1 60 90 Z" fill="#7fae6b"/><path d="M60 60 V90 A30 30 0 0 1 30 60 Z" fill="#e8b130"/><path d="M60 60 H30 A30 30 0 0 1 60 30 Z" fill="#c2412b"/><circle cx="60" cy="60" r="30" fill="none" stroke="#2b2118" stroke-width="3"/>`,
    },
  },
  {
    id: "long-haul", name: "Long Haul", how: "Write ten thousand words.",
    earned: (s) => s.words >= 10_000, progress: (s) => [Math.min(s.words, 10_000), 10_000],
    patch: {
      shape: "hex", ground: "#34363a", border: "#e8c547", thread: "#e8c547",
      icon: `<path d="M26 86 L50 46 L62 64 L74 50 L94 86 Z"/><path d="M50 46 L56 56 L50 54 L45 58 Z" fill="#efe6d2"/><path d="M40 86 Q 56 74 52 66 T 70 56" fill="none" stroke="#efe6d2" stroke-width="2.5" stroke-dasharray="3 3"/>`,
    },
  },
  {
    id: "sticker-collector", name: "Sticker Collector", how: "Stick five stickers on pages or covers.",
    earned: (s) => s.stickers >= 5, progress: (s) => [Math.min(s.stickers, 5), 5],
    patch: {
      shape: "circle", ground: "#9cc3d5", border: "#2f4f6b", thread: "#e8b130",
      icon: `<path d="M60 30 L68 50 L90 51 L73 65 L79 87 L60 75 L41 87 L47 65 L30 51 L52 50 Z" stroke="#fbf8f1" stroke-width="5" stroke-linejoin="round" paint-order="stroke"/>`,
    },
  },
  {
    id: "original-edition", name: "Original Edition", how: "Give a notebook an original cover.",
    earned: (s) => s.originalCover,
    patch: {
      shape: "shield", ground: "#e9e2d0", border: "#2f4f6b", thread: "#2f4f6b",
      icon: `<rect x="40" y="30" width="40" height="60" rx="3" fill="none" stroke="#2f4f6b" stroke-width="4"/><path d="M44 74 Q 52 60 60 68 T 76 56" fill="none" stroke="#e0662f" stroke-width="5" stroke-linecap="round"/><circle cx="68" cy="44" r="6" fill="#e8b130"/>`,
    },
  },
  {
    id: "base-camp", name: "Base Camp", how: "Sync with GitHub for the first time.",
    earned: (s) => s.synced,
    patch: {
      shape: "hex", ground: "#3f5b45", border: "#efe6d2", thread: "#efe6d2",
      icon: `<path d="M60 52 L84 90 H36 Z"/><path d="M60 68 L68 90 H52 Z" fill="#3f5b45"/><path d="M60 46 V26 M50 36 L60 26 L70 36" fill="none" stroke="#efe6d2" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`,
    },
  },
];

/** An embroidered patch: twill ground, satin-stitched border, running
 *  stitch inside the edge, icon in thread. 120×120. */
export function patchSvg({ shape, ground, border, thread, icon }: PatchSpec): string {
  const outline =
    shape === "circle"
      ? `<circle cx="60" cy="60" r="52"/>`
      : shape === "shield"
        ? `<path d="M60 8 L104 22 V58 C104 86 84 104 60 112 C36 104 16 86 16 58 V22 Z"/>`
        : `<path d="M60 6 L107 33 V87 L60 114 L13 87 V33 Z"/>`;
  const inner =
    shape === "circle"
      ? `<circle cx="60" cy="60" r="44"/>`
      : shape === "shield"
        ? `<path d="M60 17 L96 28 V58 C96 81 80 96 60 103 C40 96 24 81 24 58 V28 Z"/>`
        : `<path d="M60 15 L99 38 V82 L60 105 L21 82 V38 Z"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs><filter id="twill" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="1.4 0.18" numOctaves="2" seed="5"/><feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -0.9 0.55"/></filter><clipPath id="in">${outline}</clipPath></defs><g fill="${ground}">${outline}</g><g clip-path="url(#in)"><rect width="120" height="120" filter="url(#twill)" transform="rotate(-35 60 60)" opacity="0.5"/></g><g fill="none" stroke="${border}" stroke-width="9">${outline}</g><g fill="none" stroke="#fff" stroke-opacity="0.22" stroke-width="9" stroke-dasharray="1.2 1.6">${outline}</g><g fill="none" stroke="${border}" stroke-width="1.6" stroke-dasharray="3 2.4">${inner}</g><g fill="${thread}" stroke="none">${icon}</g></svg>`;
}

export const patchFor = (id: string) => {
  const b = BADGES.find((x) => x.id === id);
  return b ? patchSvg(b.patch) : null;
};
