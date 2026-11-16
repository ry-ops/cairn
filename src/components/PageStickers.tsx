// Stickers on the page being written: read from and written to the note's
// frontmatter `stickers:` line. They ride in the editor's scroller, so they
// scroll with the paper; x is a fraction of the page width and y is in
// ruled rows, so a sticker keeps its spot when the type size changes.
import { useEffect, useState } from "react";
import { getKey } from "../frontmatter";
import { parsePlacements, placementsValue } from "../stickers";
import { StickerField } from "./StickerField";

interface Props {
  text: string;
  /** Changes when a different note is open (the editor remounts). */
  docKey: string;
  /** Write a new `stickers:` value (JSON on one line). */
  onWrite: (value: string) => void;
}

/** Geometry of the open page, for placing a new sticker where you can see it. */
export function pageGeometry(): { scroller: HTMLElement; width: number; row: number } | null {
  const scroller = document.querySelector<HTMLElement>(".cm-scroller");
  if (!scroller) return null;
  return { scroller, width: scroller.clientWidth, row: parseFloat(getComputedStyle(scroller).lineHeight) || 28 };
}

export function PageStickers({ text, docKey, onWrite }: Props) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [geo, setGeo] = useState({ w: 600, row: 28 });

  useEffect(() => {
    // One editor is on screen at a time (the page, or notebook mode's page).
    const sc = document.querySelector<HTMLElement>(".cm-scroller");
    setHost(sc);
    if (!sc) return;
    const measure = () => setGeo({ w: sc.clientWidth, row: parseFloat(getComputedStyle(sc).lineHeight) || 28 });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(sc);
    return () => ro.disconnect();
  }, [docKey]);

  const list = parsePlacements(getKey(text, "stickers"));
  if (!list?.length) return null; // none, or hand-written YAML we leave alone
  return (
    <StickerField
      host={host}
      placements={list}
      onChange={(next) => onWrite(placementsValue(next))}
      place={(p) => [p.x * geo.w, p.y * geo.row]}
      unplace={(l, t) => [Math.min(1, Math.max(0, l / geo.w)), Math.max(0, t / geo.row)]}
      size={Math.round(geo.row * 2.4)}
    />
  );
}
