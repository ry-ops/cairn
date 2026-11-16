// Stickers stuck on a surface (a page, a cover): drag one to move it, drag
// it off the edge to peel it off, or focus it and press Delete. Rendered
// into `host` (which may scroll) so stickers travel with what they're on.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type Placement, useStickers } from "../stickers";
import { svgDataUrl } from "./Cover";

interface Props {
  host: HTMLElement | null;
  placements: Placement[];
  onChange: (next: Placement[]) => void;
  /** Placement → [left, top] px within the host's content. */
  place: (p: Placement) => [number, number];
  /** Content px → placement [x, y]. */
  unplace: (left: number, top: number) => [number, number];
  /** Size of a 1× sticker, px. */
  size: number;
  /** Changes when the host's geometry changes (re-render positions). */
  layoutKey?: string | number;
}

interface Drag {
  i: number;
  dx: number;
  dy: number;
  left: number;
  top: number;
  off: boolean;
  moved: boolean;
}

export function StickerField({ host, placements, onChange, place, unplace, size }: Props) {
  const stickers = useStickers();
  const [drag, setDrag] = useState<Drag | null>(null);
  const [peeling, setPeeling] = useState<number | null>(null);
  const urls = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of placements) {
      const s = stickers.get(p.id);
      if (s && !m.has(p.id)) m.set(p.id, svgDataUrl(s.svg));
    }
    return m;
  }, [placements, stickers]);
  const latest = useRef(placements);
  latest.current = placements;

  // Escape cancels a drag in progress.
  useEffect(() => {
    if (!drag) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setDrag(null);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [drag]);

  if (!host) return null;

  const local = (e: { clientX: number; clientY: number }) => {
    const r = host.getBoundingClientRect();
    return {
      left: e.clientX - r.left + host.scrollLeft,
      top: e.clientY - r.top + host.scrollTop,
      off: e.clientX < r.left - 4 || e.clientX > r.right + 4 || e.clientY < r.top - 4 || e.clientY > r.bottom + 4,
    };
  };

  function peel(i: number) {
    setPeeling(i);
    window.setTimeout(() => {
      setPeeling(null);
      onChange(latest.current.filter((_, j) => j !== i));
    }, 220);
  }

  return createPortal(
    <div className="sticker-field" aria-label="Stickers">
      {placements.map((p, i) => {
        const url = urls.get(p.id);
        if (!url) return null;
        const d = drag?.i === i && drag.moved ? drag : null;
        const [left, top] = d ? [d.left, d.top] : place(p);
        const px = size * (p.s ?? 1);
        return (
          <div
            key={i}
            className={`sticker${d ? " lifted" : ""}${d?.off ? " off" : ""}${peeling === i ? " peeling" : ""}`}
            style={{ left, top, width: px, height: px, transform: `translate(-50%, -50%) rotate(${p.r}deg)` }}
            tabIndex={0}
            role="img"
            aria-label={`${stickers.get(p.id)?.label ?? p.id} sticker. Drag to move; drag off the edge or press Delete to peel it off.`}
            title="Drag to move · drag off the edge to peel off"
            onKeyDown={(e) => {
              if (e.key === "Delete" || e.key === "Backspace") {
                e.preventDefault();
                e.stopPropagation();
                peel(i);
              }
            }}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              e.stopPropagation();
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              const at = local(e);
              const [l, t] = place(p);
              setDrag({ i, dx: at.left - l, dy: at.top - t, left: l, top: t, off: false, moved: false });
            }}
            onPointerMove={(e) => {
              if (!drag || drag.i !== i) return;
              const at = local(e);
              const left = at.left - drag.dx;
              const top = at.top - drag.dy;
              const moved = drag.moved || Math.hypot(left - drag.left, top - drag.top) > 3;
              setDrag({ ...drag, left, top, off: at.off, moved });
            }}
            onPointerUp={() => {
              if (!drag || drag.i !== i) return;
              const d0 = drag;
              setDrag(null);
              if (!d0.moved) return;
              if (d0.off) return peel(i);
              const [x, y] = unplace(d0.left, d0.top);
              onChange(placements.map((q, j) => (j === i ? { ...q, x, y } : q)));
            }}
            onPointerCancel={() => setDrag(null)}
          >
            <img src={url} alt="" draggable={false} />
          </div>
        );
      })}
    </div>,
    host,
  );
}
