// The sticker sheet: pick one to stick on this page or on the notebook's
// cover. Cover stickers are arranged on a large preview right here.
import { useMemo, useState } from "react";
import type { Notebook } from "../store";
import { type Placement, type Sticker, coverPlacements } from "../stickers";
import { CoverArt, svgDataUrl } from "./Cover";
import { StickerField } from "./StickerField";

export type StickTo = "page" | "cover";

interface Props {
  sheet: Sticker[];
  notebook: Notebook;
  coverArt: string | null;
  to: StickTo;
  onTo: (to: StickTo) => void;
  /** No page open (an empty notebook): only the cover takes stickers. */
  pageOpen: boolean;
  onPick: (id: string) => void;
  onCoverChange: (next: Placement[]) => void;
  onClose: () => void;
}

const PREVIEW_W = 168;
const PREVIEW_H = PREVIEW_W * (220 / 140);

export function StickerSheet({ sheet, notebook, coverArt, to, onTo, pageOpen, onPick, onCoverChange, onClose }: Props) {
  const [preview, setPreview] = useState<HTMLDivElement | null>(null);
  const urls = useMemo(() => new Map(sheet.map((s) => [s.id, svgDataUrl(s.svg)])), [sheet]);
  const target = pageOpen ? to : "cover";
  const onCover = coverPlacements(notebook.meta.stickers);

  return (
    <aside className="sticker-sheet" aria-label="Sticker sheet" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <header>
        <span className="eyebrow">Stickers</span>
        <div className="seg" role="group" aria-label="Stick on">
          <button className={target === "page" ? "on" : ""} disabled={!pageOpen} onClick={() => onTo("page")}>this page</button>
          <button className={target === "cover" ? "on" : ""} onClick={() => onTo("cover")}>the cover</button>
        </div>
        <button className="link-btn" onClick={onClose}>close</button>
      </header>

      {target === "cover" && (
        <div className="sheet-cover" ref={setPreview} style={{ width: PREVIEW_W, height: PREVIEW_H }}>
          <CoverArt notebook={notebook} art={coverArt} noStickers />
          <StickerField
            host={preview}
            placements={onCover}
            onChange={onCoverChange}
            place={(p) => [p.x * PREVIEW_W, p.y * PREVIEW_H]}
            unplace={(l, t) => [Math.min(1, Math.max(0, l / PREVIEW_W)), Math.min(1, Math.max(0, t / PREVIEW_H))]}
            size={PREVIEW_W * 0.3}
          />
        </div>
      )}

      <ul className="sheet-grid">
        {sheet.map((s) => (
          <li key={s.id}>
            <button onClick={() => onPick(s.id)} title={`Stick on ${target === "page" ? "this page" : "the cover"}: ${s.label}`} aria-label={`Stick ${s.label}`}>
              <img src={urls.get(s.id)} alt="" draggable={false} />
            </button>
          </li>
        ))}
      </ul>
      <p className="hint">
        Click one to stick it on; drag it where you want it. Drag it off the edge to peel it off. Your own SVGs go in <code>stickers/</code> in the vault.
      </p>
    </aside>
  );
}
