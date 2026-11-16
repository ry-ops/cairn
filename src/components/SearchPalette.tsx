// Search every notebook (⌘K): type, arrow through results, Enter to open.
// Every word must appear; the last can be a prefix; "quote" a phrase.
import { useEffect, useRef, useState } from "react";
import type { Book } from "../links";
import { type SearchHit, store } from "../store";

interface Props {
  books: Book[];
  /** The open notebook: its results get no notebook label. */
  here: string | null;
  onOpen: (hit: SearchHit) => void;
  onClose: () => void;
}

const LAST_QUERY = "cairn.search";

export function SearchPalette({ books, here, onOpen, onClose }: Props) {
  const [q, setQ] = useState(() => {
    try {
      return sessionStorage.getItem(LAST_QUERY) ?? "";
    } catch {
      return "";
    }
  });
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [sel, setSel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  // Search as you type; only the latest answer counts.
  useEffect(() => {
    try {
      sessionStorage.setItem(LAST_QUERY, q);
    } catch {
      /* convenience only */
    }
    const n = ++seq.current;
    if (!q.trim()) {
      setHits([]);
      return;
    }
    const t = window.setTimeout(() => {
      store
        .search(q)
        .then((h) => {
          if (n !== seq.current) return;
          setHits(h);
          setSel(0);
          setError(null);
        })
        .catch((e) => n === seq.current && setError(String(e)));
    }, 70);
    return () => window.clearTimeout(t);
  }, [q]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, hits.length - 1));
    } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter" && hits[sel]) {
      e.preventDefault();
      onOpen(hits[sel]);
    }
  }

  const bookTitle = (id: string) => books.find((b) => b.id === id)?.title ?? id;

  return (
    <div className="scrim search-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="search-palette" role="dialog" aria-label="Search all notes" onKeyDown={onKey}>
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search all notebooks"
          aria-label="Search all notebooks"
          aria-controls="search-results"
          aria-activedescendant={hits[sel] ? `sr-${sel}` : undefined}
          spellCheck={false}
        />
        {error ? (
          <p className="search-empty error">{error}</p>
        ) : q.trim() && !hits.length ? (
          <p className="search-empty">Nothing found.</p>
        ) : !q.trim() ? (
          <p className="search-empty">Every word must appear. <code>"Quote"</code> a phrase.</p>
        ) : (
          <ul id="search-results" ref={list} role="listbox">
            {hits.map((h, i) => (
              <li
                key={`${h.notebook}/${h.file}`}
                id={`sr-${i}`}
                data-i={i}
                role="option"
                aria-selected={i === sel}
                onMouseMove={() => setSel(i)}
                onClick={() => onOpen(h)}
              >
                <span className="sr-title">
                  <span><Marked text={h.title} /></span>
                  {h.notebook !== here && <span className="sr-book">{bookTitle(h.notebook)}</span>}
                </span>
                {h.snippet.trim() && (
                  <span className="sr-snippet">
                    <Marked text={h.snippet.replace(/\s+/g, " ")} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Text with \u0002…\u0003 match markers, as <mark>s. */
function Marked({ text }: { text: string }) {
  const parts = text.split(/(\u0002[^\u0003]*\u0003)/);
  return (
    <>
      {parts.map((p, i) => (p.startsWith("\u0002") ? <mark key={i}>{p.slice(1, -1)}</mark> : p))}
    </>
  );
}
