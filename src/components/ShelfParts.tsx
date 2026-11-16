// The sidebars' working parts: covers you can drag into your own order, the
// notebook's paper and cover controls, and the vault card at the foot of the
// shelf (vault folder, sync, merit badges).
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Notebook, Paper } from "../store";
import { Cover, CoverArt } from "./Cover";

type Place = "below-start" | "below-end" | "above-stretch";

/**
 * A small menu anchored to its trigger (the element it's rendered in);
 * closes on outside click or Esc. Drawn in a layer over the whole window,
 * so a narrow sidebar never clips it, and nudged to stay inside the window.
 */
export function Popover({ open, onClose, place = "below-start", className = "", children }: {
  open: boolean;
  onClose: () => void;
  place?: Place;
  className?: string;
  children: ReactNode;
}) {
  const marker = useRef<HTMLSpanElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<React.CSSProperties>({ visibility: "hidden" });

  useLayoutEffect(() => {
    if (!open) return;
    const GAP = 6;
    const EDGE = 8;
    const place_ = () => {
      const host = marker.current?.parentElement;
      const pop = ref.current;
      if (!host || !pop) return;
      const r = host.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = place === "above-stretch" ? Math.max(r.width, pop.offsetWidth) : pop.offsetWidth;
      let left = place === "below-end" ? r.right - w : r.left;
      left = Math.min(Math.max(EDGE, left), vw - w - EDGE);
      if (place === "above-stretch") {
        setPos({ left, bottom: vh - r.top + GAP, width: w });
      } else {
        let top = r.bottom + GAP;
        if (top + pop.offsetHeight > vh - EDGE) top = Math.max(EDGE, r.top - GAP - pop.offsetHeight);
        setPos({ left, top });
      }
    };
    place_();
    window.addEventListener("resize", place_);
    return () => window.removeEventListener("resize", place_);
  }, [open, place]);

  useEffect(() => {
    if (!open) {
      setPos({ visibility: "hidden" });
      return;
    }
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      const host = marker.current?.parentElement;
      if (host?.contains(t) || ref.current?.contains(t)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [open, onClose]);

  return (
    <>
      <span ref={marker} hidden />
      {open &&
        createPortal(
          <div ref={ref} className={`popover ${className}`} role="menu" style={pos}>
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}

const DRAG_START_PX = 5;

/**
 * The shelf of covers. Drag a cover to move it; the others make room as you
 * go, and the new order is saved when you let go. Pointer events, not HTML
 * drag-and-drop, which the desktop webview hands to the OS.
 */
export function SortableCovers({ notebooks, art, selected, onSelect, onReorder, onMenu, children }: {
  notebooks: Notebook[];
  art: Record<string, { cover?: string | null } | undefined>;
  selected: string | null;
  onSelect: (id: string) => void;
  onReorder: (ids: string[]) => void;
  /** Right-click (or ctrl-click) on a cover: open that notebook's menu. */
  onMenu: (id: string) => void;
  children?: ReactNode;
}) {
  const ids = notebooks.map((n) => n.id);
  const [order, setOrder] = useState<string[] | null>(null); // live order while dragging
  const [dragId, setDragId] = useState<string | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  // Where the drag began, where the pointer grabbed the cover, where it is now.
  const start = useRef<{ id: string; x: number; y: number; grabX: number; grabY: number; moved: boolean } | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const suppressClick = useRef(false);
  const shown = order ?? ids;
  const byId = new Map(notebooks.map((n) => [n.id, n]));

  const slotOf = (id: string) => grid.current?.querySelector<HTMLElement>(`[data-book="${CSS.escape(id)}"]`) ?? null;

  /** Keep the dragged cover under the pointer, whatever slot it sits in. */
  function place() {
    const s = start.current;
    const el = grid.current;
    const slot = s && slotOf(s.id);
    if (!s?.moved || !el || !slot) return;
    const g = el.getBoundingClientRect();
    const left = g.left + slot.offsetLeft - el.scrollLeft;
    const top = g.top + slot.offsetTop - el.scrollTop;
    slot.style.transform = `translate(${pointer.current.x - s.grabX - left}px, ${pointer.current.y - s.grabY - top}px)`;
  }

  // FLIP: covers that changed place glide there instead of jumping. Layout
  // offsets, not client rects, so running animations don't skew the reading.
  const spots = useRef(new Map<string, { x: number; y: number }>());
  useLayoutEffect(() => {
    const el = grid.current;
    if (!el) return;
    const next = new Map<string, { x: number; y: number }>();
    for (const c of el.querySelectorAll<HTMLElement>("[data-book]")) {
      const id = c.dataset.book!;
      const at = { x: c.offsetLeft, y: c.offsetTop };
      next.set(id, at);
      const was = spots.current.get(id);
      if (was && id !== dragId && (was.x !== at.x || was.y !== at.y)) {
        c.animate(
          [{ transform: `translate(${was.x - at.x}px, ${was.y - at.y}px)` }, { transform: "none" }],
          { duration: 180, easing: "cubic-bezier(.2,.7,.3,1)" },
        );
      }
    }
    spots.current = next;
    place();
  });

  function onPointerDown(e: React.PointerEvent<HTMLElement>, id: string) {
    if (e.button !== 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    start.current = { id, x: e.clientX, y: e.clientY, grabX: e.clientX - r.left, grabY: e.clientY - r.top, moved: false };
  }

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const s = start.current;
      if (!s) return;
      pointer.current = { x: e.clientX, y: e.clientY };
      if (!s.moved) {
        if (Math.hypot(e.clientX - s.x, e.clientY - s.y) < DRAG_START_PX) return;
        s.moved = true;
        setOrder(ids);
        setDragId(s.id);
        document.body.classList.add("dragging-cover");
      }
      // The slot under the pointer: the nearest other cover's centre.
      const el = grid.current;
      if (!el) return;
      // Near the top or bottom of the shelf, scroll it along.
      const box = el.getBoundingClientRect();
      const EDGE = 48;
      if (e.clientY < box.top + EDGE) el.scrollTop -= Math.ceil((box.top + EDGE - e.clientY) / 3);
      else if (e.clientY > box.bottom - EDGE) el.scrollTop += Math.ceil((e.clientY - box.bottom + EDGE) / 3);
      let best: string | null = null;
      let bestD = Infinity;
      for (const c of el.querySelectorAll<HTMLElement>("[data-book]")) {
        if (c.dataset.book === s.id) continue;
        const r = c.getBoundingClientRect();
        const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
        if (d < bestD) {
          bestD = d;
          best = c.dataset.book!;
        }
      }
      // Only swap once the dragged cover's centre is closer to that slot than its own.
      const mine = slotOf(s.id);
      if (best && mine) {
        const g = el.getBoundingClientRect();
        const myX = g.left + mine.offsetLeft - el.scrollLeft + mine.offsetWidth / 2;
        const myY = g.top + mine.offsetTop - el.scrollTop + mine.offsetHeight / 2;
        if (Math.hypot(e.clientX - myX, e.clientY - myY) <= bestD) best = null;
      }
      if (best) {
        const target = best;
        setOrder((cur) => {
          const list = cur ?? ids;
          const next = list.filter((x) => x !== s.id);
          next.splice(list.indexOf(target), 0, s.id);
          return next;
        });
      }
      place();
    };
    const up = () => {
      const s = start.current;
      start.current = null;
      if (!s?.moved) return;
      suppressClick.current = true;
      window.setTimeout(() => (suppressClick.current = false), 0);
      document.body.classList.remove("dragging-cover");
      const slot = slotOf(s.id);
      if (slot) {
        // Settle into the slot from where it was dropped.
        const from = slot.style.transform;
        slot.style.transform = "";
        if (from) slot.animate([{ transform: from }, { transform: "none" }], { duration: 160, easing: "ease-out" });
      }
      setDragId(null);
      const final = order;
      if (final && final.join() !== ids.join()) onReorder(final);
      setOrder(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  });

  return (
    <div className="covers" ref={grid}>
      {shown.map((id) => {
        const nb = byId.get(id);
        if (!nb) return null;
        return (
          <div
            key={id}
            data-book={id}
            className={`cover-slot${dragId === id ? " dragging" : ""}`}
            onPointerDown={(e) => !e.ctrlKey && onPointerDown(e, id)}
            onContextMenu={(e) => {
              e.preventDefault();
              start.current = null;
              onMenu(id);
            }}
            onClickCapture={(e) => {
              if (suppressClick.current) {
                suppressClick.current = false;
                e.stopPropagation();
                e.preventDefault();
              }
            }}
          >
            <Cover notebook={nb} art={art[id]?.cover} selected={id === selected} onClick={() => onSelect(id)} />
          </div>
        );
      })}
      {children}
    </div>
  );
}

const PAPER_LABEL: Record<Paper, string> = { graph: "Graph", ruled: "Ruled", dot: "Dot grid", blank: "Blank" };

/** Paper and cover for the open notebook: two chips under its title. */
export function NotebookTools({ notebook, art, papers, onPaper, onCover, onRepo }: {
  notebook: Notebook;
  art: string | null;
  papers: Paper[];
  onPaper: (p: Paper) => void;
  onCover: () => void;
  onRepo: () => void;
}) {
  const repo = notebook.meta.repo;
  const [open, setOpen] = useState(false);
  const paper = notebook.meta.paper;
  return (
    <div className="book-tools">
      <div className="tool-anchor">
        <button className={`tool-chip${open ? " on" : ""}`} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} title="Default paper for this notebook">
          <span className={`tool-swatch paper-swatch paper-${paper}`} aria-hidden="true" />
          {PAPER_LABEL[paper]}
          <Caret />
        </button>
        <Popover open={open} onClose={() => setOpen(false)} className="paper-pop">
          <div className="pop-label">Paper</div>
          <div className="pop-papers">
            {papers.map((p) => (
              <button
                key={p}
                role="menuitemradio"
                aria-checked={p === paper}
                className={`pop-paper${p === paper ? " on" : ""}`}
                onClick={() => {
                  onPaper(p);
                  setOpen(false);
                }}
              >
                <span className={`paper-swatch paper-${p}`} aria-hidden="true" />
                {PAPER_LABEL[p]}
              </button>
            ))}
          </div>
          <p className="pop-hint">New pages use this. A page can choose its own in the status bar.</p>
        </Popover>
      </div>
      <button className="tool-chip" onClick={onCover} title="Choose this notebook's cover">
        <span className="tool-swatch cover-swatch" aria-hidden="true">
          <CoverArt notebook={notebook} art={art} />
        </span>
        Cover
      </button>
      {repo && (
        <button className="tool-chip repo-chip" onClick={onRepo} title={`Notes sync with ${repo}${notebook.meta.repo_path ? `/${notebook.meta.repo_path}` : ""}`}>
          <svg className="tool-swatch repo-icon" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M5 3.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM5 12.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM14 5.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM3.5 5v6M12.5 7c0 3-4 2.5-8.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <span className="repo-name">{repo.split("/")[1]}{notebook.meta.repo_path ? `/${notebook.meta.repo_path}` : ""}</span>
        </button>
      )}
    </div>
  );
}

/** The ⋯ menu beside New note: what you can do to the notebook itself. */
export function NotebookMenu({ open, setOpen, linked, onCover, onRepo, onTrash }: {
  open: boolean;
  setOpen: (o: boolean) => void;
  linked: boolean;
  onCover: () => void;
  onRepo: () => void;
  onTrash: () => void;
}) {
  const pick = (f: () => void) => () => {
    setOpen(false);
    f();
  };
  return (
    <div className="tool-anchor">
      <button className={`icon-btn more-btn${open ? " on" : ""}`} onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} title="Notebook" aria-label="Notebook menu">
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
          <circle cx="4.5" cy="10" r="1.6" fill="currentColor" />
          <circle cx="10" cy="10" r="1.6" fill="currentColor" />
          <circle cx="15.5" cy="10" r="1.6" fill="currentColor" />
        </svg>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} place="below-end" className="book-pop">
        <button role="menuitem" className="pop-item" onClick={pick(onCover)}>Change cover…</button>
        <button role="menuitem" className="pop-item" onClick={pick(onRepo)}>{linked ? "Repo sync…" : "Sync with a repo…"}</button>
        <div className="pop-sep" />
        <button role="menuitem" className="pop-item danger" onClick={pick(onTrash)}>Move to Trash…</button>
      </Popover>
    </div>
  );
}

/** Confirm before a notebook goes to the trash. */
export function TrashNotebookSheet({ notebook, art, synced, onConfirm, onCancel }: {
  notebook: Notebook;
  art: string | null;
  synced: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const n = notebook.note_count;
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="sheet trash-sheet" role="alertdialog" aria-label={`Move ${notebook.meta.title} to the Trash`} onKeyDown={(e) => e.key === "Escape" && onCancel()}>
        <div className="trash-cover"><CoverArt notebook={notebook} art={art} /></div>
        <div>
          <h3>Move “{notebook.meta.title}” to the Trash?</h3>
          <p>
            The notebook and its {n} {n === 1 ? "note" : "notes"} move to the vault's <code>.trash</code> folder. To bring it back,
            move its folder from <code>.trash</code> into <code>notebooks</code> in Finder.
          </p>
          {synced && <p className="hint">GitHub sync will remove it from the vault repository at the next sync; it stays in the repository's history.</p>}
          <div className="sheet-actions">
            <button className="btn" onClick={onCancel} autoFocus>Cancel</button>
            <button className="btn danger" onClick={onConfirm}>Move to Trash</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Caret() {
  return (
    <svg className="caret" viewBox="0 0 10 6" width="8" height="5" aria-hidden="true">
      <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export type SyncLook = "off" | "setup" | "syncing" | "error" | "ok";

/** Foot of the shelf: which vault is open, whether it's synced, and badges. */
export function VaultCard({ name, path, problem, sync, syncLabel, syncTitle, canSync, badges, onSyncNow, onSyncSettings, onChangeVault, onBadges }: {
  name: string;
  path: string;
  /** The last sync's error, shown in the menu. */
  problem: string | null;
  sync: SyncLook;
  syncLabel: string;
  syncTitle: string;
  canSync: boolean;
  badges: { got: number; of: number } | null;
  onSyncNow: () => void;
  onSyncSettings: () => void;
  onChangeVault: () => void;
  onBadges: () => void;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const pick = (f: () => void) => () => {
    close();
    f();
  };
  return (
    <footer className="shelf-foot">
      {badges && (
        <button className="badge-row" onClick={onBadges} title="Merit badges">
          <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true">
            <path d="M5 2h10v6l-5 3-5-3z" fill="currentColor" opacity=".35" />
            <circle cx="10" cy="13" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M10 10.7l.7 1.5 1.6.2-1.2 1.1.3 1.6-1.4-.8-1.4.8.3-1.6-1.2-1.1 1.6-.2z" fill="currentColor" />
          </svg>
          <span className="badge-label">Badges</span>
          <span className="badge-meter" aria-hidden="true">
            <span style={{ width: `${(badges.got / Math.max(1, badges.of)) * 100}%` }} />
          </span>
          <span className="badge-count">{badges.got}/{badges.of}</span>
        </button>
      )}
      <div className="tool-anchor vault-anchor">
        <button className={`vault-card ${sync}${open ? " on" : ""}`} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} title={path}>
          <svg className="vault-icon" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
            <path d="M2.5 5.5a1.5 1.5 0 0 1 1.5-1.5h3.6l1.6 1.8H16a1.5 1.5 0 0 1 1.5 1.5v7.7A1.5 1.5 0 0 1 16 16.5H4a1.5 1.5 0 0 1-1.5-1.5z" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <span className="vault-text">
            <span className="vault-name">{name}</span>
            <span className="vault-sync" title={syncTitle}>
              <span className="dot" />
              {syncLabel}
            </span>
          </span>
          <Caret />
        </button>
        <Popover open={open} onClose={close} place="above-stretch" className="vault-pop">
          <div className="pop-label">Vault</div>
          <p className="pop-path" title={path}>{path}</p>
          {problem && <p className="pop-problem">{problem}</p>}
          <div className="pop-sep" />
          {canSync && (
            <button role="menuitem" className="pop-item" disabled={sync === "syncing"} onClick={pick(onSyncNow)}>
              Sync now
            </button>
          )}
          <button role="menuitem" className="pop-item" onClick={pick(onSyncSettings)}>
            {canSync ? "Sync settings…" : "Set up GitHub sync…"}
          </button>
          <button role="menuitem" className="pop-item" onClick={pick(onChangeVault)}>
            Open another vault…
          </button>
        </Popover>
      </div>
    </footer>
  );
}
