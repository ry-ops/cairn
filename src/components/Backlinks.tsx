// "Linked from": the notes that link to this one, each with the line the
// link sits on. Opens over the bottom of the page from the status bar.
import { useEffect } from "react";
import type { Backlink, Book, IndexedNote } from "../links";

interface Props {
  items: Backlink[];
  books: Book[];
  /** The open notebook; other notebooks' names are shown. */
  here: string | null;
  onOpen: (n: IndexedNote) => void;
  onClose: () => void;
}

export function Backlinks({ items, books, here, onOpen, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside className="backlinks" aria-label="Notes that link here">
      <header>
        <span className="eyebrow">Linked from</span>
        <button className="link-btn" onClick={onClose} aria-label="Close">close</button>
      </header>
      <ul>
        {items.map((b, i) => (
          <li key={`${b.from.notebook}/${b.from.file}/${i}`}>
            <button onClick={() => onOpen(b.from)}>
              <span className="bl-title">
                {b.from.title}
                {b.from.notebook !== here && (
                  <span className="bl-book"> · {books.find((x) => x.id === b.from.notebook)?.title ?? b.from.notebook}</span>
                )}
              </span>
              <span className="bl-context">{highlight(b.context)}</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

/** The context line, with its [[links]] set off. */
function highlight(line: string) {
  return line.split(/(\[\[[^\]]+\]\])/).map((part, i) =>
    part.startsWith("[[") ? <mark key={i}>{part.slice(2, -2)}</mark> : part,
  );
}
