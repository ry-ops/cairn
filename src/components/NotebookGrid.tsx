// All Notebooks (View → All Notebooks, ⌘0): every notebook's cover in a
// grid. Covers come in one after another, and any with motion in their art
// play it once as they arrive, then hold still. Click to open; type or ⌘F
// to filter; Esc to go back.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Notebook } from "../store";
import { CoverArt } from "./Cover";

type Sort = "shelf" | "number" | "title" | "recent";
const SORT_KEY = "cairn.gridSort";

interface Props {
  notebooks: Notebook[];
  /** Cover art per notebook id (null = built-in kraft). */
  covers: Record<string, string | null>;
  /** Latest note date per notebook id (YYYY-MM-DD). */
  lastWritten: Map<string, string>;
  selected: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
}

const fmt = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export function NotebookGrid({ notebooks, covers, lastWritten, selected, onOpen, onNew, onClose }: Props) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>(() => {
    try {
      const s = localStorage.getItem(SORT_KEY);
      return s === "number" || s === "title" || s === "recent" ? s : "shelf";
    } catch {
      return "shelf";
    }
  });
  const [shown, setShown] = useState(0); // covers revealed so far
  const [take] = useState(() => (reduceMotion() ? undefined : Date.now()));
  const filter = useRef<HTMLInputElement>(null);

  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    const out = notebooks.filter((n) => !k || n.meta.title.toLowerCase().includes(k));
    if (sort === "title") out.sort((a, b) => a.meta.title.localeCompare(b.meta.title));
    else if (sort === "recent") out.sort((a, b) => (lastWritten.get(b.id) ?? "").localeCompare(lastWritten.get(a.id) ?? "") || a.id.localeCompare(b.id));
    else if (sort === "number") out.sort((a, b) => a.id.localeCompare(b.id));
    // "shelf": the order you dragged them into in the sidebar, as given.
    return out;
  }, [notebooks, q, sort, lastWritten]);

  useEffect(() => {
    try {
      localStorage.setItem(SORT_KEY, sort);
    } catch {
      /* convenience only */
    }
  }, [sort]);

  // Reveal covers one at a time.
  useEffect(() => {
    if (shown >= notebooks.length) return;
    const t = window.setTimeout(() => setShown((s) => s + 1), shown === 0 ? 60 : 70);
    return () => window.clearTimeout(t);
  }, [shown, notebooks.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        filter.current?.focus();
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (q) setQ("");
        else onClose();
      } else if (
        e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && e.key !== " " &&
        document.activeElement !== filter.current
      ) {
        e.preventDefault();
        setQ((v) => v + e.key);
        filter.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [q, onClose]);

  // Reveal order follows what's on screen, so covers arrive top-left first.
  const order = useMemo(() => new Map(list.map((n, i) => [n.id, i])), [list]);
  // Each cover's animation take stays fixed, so filtering doesn't replay it.
  const takeIndex = useMemo(() => new Map(notebooks.map((n, i) => [n.id, i])), [notebooks]);

  return (
    <div className="all-books" role="dialog" aria-label="All notebooks">
      <header className="all-books-bar">
        <h2>All notebooks <span className="hint">{notebooks.length}</span></h2>
        <input ref={filter} className="all-books-filter" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a notebook" aria-label="Find a notebook" />
        <div className="seg" role="group" aria-label="Sort">
          {(["shelf", "number", "title", "recent"] as Sort[]).map((s) => (
            <button key={s} className={sort === s ? "on" : ""} onClick={() => setSort(s)}>
              {s === "shelf" ? "shelf" : s === "number" ? "No." : s === "title" ? "A–Z" : "recent"}
            </button>
          ))}
        </div>
        <button className="btn" onClick={onClose} title="Back (Esc)">Done</button>
      </header>
      <ul className="all-books-grid">
        {list.map((nb) => {
          const ready = (order.get(nb.id) ?? 0) < shown;
          const last = lastWritten.get(nb.id);
          return (
            <li key={nb.id} className={ready ? "in" : ""}>
              <button className={`grid-book${nb.id === selected ? " selected" : ""}`} onClick={() => onOpen(nb.id)} title={`Open ${nb.meta.title}`}>
                <span className="grid-cover">{ready && <CoverArt notebook={nb} art={covers[nb.id] ?? null} take={take === undefined ? undefined : take + (takeIndex.get(nb.id) ?? 0)} />}</span>
                <span className="grid-title">{nb.meta.title}</span>
                <span className="hint">
                  {nb.note_count} {nb.note_count === 1 ? "note" : "notes"}
                  {last ? ` · ${fmt(last)}` : ""}
                </span>
              </button>
            </li>
          );
        })}
        {!q && (
          <li className="in">
            <button className="grid-book grid-new" onClick={onNew}>
              <span className="grid-cover new-cover">+</span>
              <span className="grid-title">New notebook</span>
              <span className="hint">⇧⌘N</span>
            </button>
          </li>
        )}
      </ul>
      {q && !list.length && <p className="hint all-books-empty">No notebook called “{q}”.</p>}
    </div>
  );
}
