// Editor fonts: the typewriter default and one handwritten face, Rock Salt
// (Apache-2.0, self-hosted via Fontsource so it works offline under the app
// CSP). Rock Salt is Cairn's only hand: the editor, the buttons' tape labels and
// the inside front cover all use it.
import "@fontsource/rock-salt/latin-400.css";

export const HAND_FAMILY = `"Rock Salt", "Marker Felt", cursive`;

export interface EditorFont {
  id: string;
  label: string;
  family: string;
  /** Base size in px. */
  size: number;
  /** Line height as a multiple of size; Rock Salt's tall loops need room. */
  rowK: number;
  hand: boolean;
}

export const FONTS: EditorFont[] = [
  {
    id: "typewriter",
    label: "Typewriter",
    family: `"iA Writer Duo S", "iA Writer Duospace", ui-monospace, "SF Mono", Menlo, monospace`,
    size: 17,
    rowK: 1.7,
    hand: false,
  },
  { id: "hand", label: "Handwritten", family: HAND_FAMILY, size: 15, rowK: 2.2, hand: true },
];

/** Unknown ids fall back to Typewriter; the old "caveat" pref means the hand. */
export const font = (id: string): EditorFont =>
  FONTS.find((f) => f.id === (id === "caveat" ? "hand" : id)) ?? FONTS[0];
