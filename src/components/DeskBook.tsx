// Notebook mode: the notebook itself, sitting on the desktop. It arrives
// closed (just the cover, centered), then the cover swings open on its spine
// to a two-page spread: the left page is the page before (or the inside front
// cover with a contents list on page one), the right page is the one you
// write on. Esc swings it shut, then the normal window comes back.
import { ReactNode, useEffect, useRef, useState } from "react";
import { splitLink } from "../links";
import { isAnimated } from "../motion";
import { edition } from "../covers";
import type { NoteMeta, Notebook } from "../store";
import { CoverArt } from "./Cover";

type Phase = "closed" | "opening" | "open" | "closing";

/** Horizontal travel (px) that counts as a deliberate swipe. */
const SWIPE_PX = 70;
const OPEN_DELAY_MS = 1100; // let the cover be seen first
const OPEN_DELAY_ANIMATED_MS = 2900; // …and its art play out, if it moves
const SWING_MS = 900;

interface Props {
  book: Notebook;
  coverArt: string | null;
  notes: NoteMeta[]; // newest first, as the list shows them
  file: string | null;
  /** Previous page's text (read-only on the left), or null on page one. */
  prevText: string | null;
  paper: string;
  /** Bumped by the app (menu, Esc) to ask the notebook to close. */
  closeSignal: number;
  onOpenNote: (file: string) => void;
  onTurn: (dir: -1 | 1) => void;
  onClosed: () => void;
  children: ReactNode; // the editor for the right page
}

const fmt = (file: string) => {
  const m = file.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
};

/** A hand isn't a grid: a small, fixed tilt and shift per line (seeded, so
 *  the writing doesn't move between openings). */
function wobble(seed: string, line: number): React.CSSProperties {
  let h = 2166136261;
  for (const c of `${seed}:${line}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const a = ((h >>> 0) % 1000) / 1000;
  const b = ((h >>> 10) % 1000) / 1000;
  return { transform: `translateX(${(b * 1.6 - 0.5).toFixed(2)}%) rotate(${(a * 2.8 - 1.4).toFixed(2)}deg)` };
}

/** Shrink the handwriting as the list grows so it fits the board. */
const tocScale = (n: number) => String(Math.max(0.55, Math.min(1, 9 / Math.max(n, 1))));

/** Markdown → quiet read-only page text: frontmatter dropped, marks kept light. */
/** [[Title|shown]] reads as just its text on paper. */
function plainLinks(line: string): string {
  return line.replace(/\[\[([^[\]\n]+?)\]\]/g, (m, inner: string) => {
    const l = splitLink(inner);
    return l ? l.alias ?? l.title : m;
  });
}

function PageText({ text }: { text: string }) {
  const body = text.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
  return (
    <div className="page-text">
      {body.split("\n").map((line, i) => {
        const h = line.match(/^(#{1,3})\s+(.*)$/);
        if (h) return <div key={i} className={`pt-h pt-h${h[1].length}`}>{h[2]}</div>;
        if (!line.trim()) return <div key={i} className="pt-gap" />;
        return <div key={i} className="pt-line">{plainLinks(line).replace(/\*\*|__|\*|_|`/g, "")}</div>;
      })}
    </div>
  );
}

export function DeskBook({ book, coverArt, notes, file, prevText, paper, closeSignal, onOpenNote, onTurn, onClosed, children }: Props) {
  const [phase, setPhase] = useState<Phase>("closed");
  // A fresh take each time the notebook comes out, so its cover art plays.
  const [take] = useState(() => Date.now());
  const timers = useRef<number[]>([]);
  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Arrive closed, then open.
  useEffect(() => {
    const hold = coverArt && isAnimated(coverArt) ? OPEN_DELAY_ANIMATED_MS : OPEN_DELAY_MS;
    later(() => setPhase("opening"), hold);
    later(() => setPhase("open"), hold + SWING_MS);
  }, []);

  function close() {
    if (phase === "closing") return;
    setPhase("closing");
    later(onClosed, SWING_MS + 120);
  }
  // Close only when the signal actually changes (not on mount, and not when
  // React re-runs effects in development).
  const seenSignal = useRef(closeSignal);
  useEffect(() => {
    if (closeSignal === seenSignal.current) return;
    seenSignal.current = closeSignal;
    close();
  }, [closeSignal]);

  // Turning a page: the spread slides a little the way the page goes.
  const spread = useRef<HTMLDivElement>(null);
  const turnRef = useRef<(dir: -1 | 1) => void>(() => {});
  turnRef.current = (dir) => {
    if (phase !== "open") return;
    if (dir === 1 ? pageNo >= notes.length || pageNo < 1 : pageNo <= 1) return;
    onTurn(dir);
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    spread.current?.querySelectorAll<HTMLElement>(".leaf").forEach((leaf) =>
      leaf.animate(
        [
          { translate: `${dir * 22}px 0`, opacity: 0.35 },
          { translate: "0 0", opacity: 1 },
        ],
        { duration: 280, easing: "cubic-bezier(0.2, 0.8, 0.3, 1)" },
      ),
    );
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.altKey && (e.metaKey || e.ctrlKey) && e.key === "ArrowLeft") {
        e.preventDefault();
        turnRef.current(-1);
      } else if (e.altKey && (e.metaKey || e.ctrlKey) && e.key === "ArrowRight") {
        e.preventDefault();
        turnRef.current(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Trackpad: a two-finger swipe left or right turns one page. A swipe
  // arrives as a stream of horizontal wheel events (then momentum), so add
  // them up, turn once past a threshold, and wait for the stream to stop
  // before the next turn. Mostly-vertical scrolling is left alone.
  useEffect(() => {
    let sum = 0;
    let turned = false;
    let idle: number | undefined;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 1.5) return;
      e.preventDefault();
      window.clearTimeout(idle);
      idle = window.setTimeout(() => {
        sum = 0;
        turned = false;
      }, 240);
      if (turned) return;
      sum += e.deltaX;
      if (Math.abs(sum) > SWIPE_PX) {
        turned = true;
        // Fingers moving left (content moving left) means the next page.
        turnRef.current(sum > 0 ? 1 : -1);
      }
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.clearTimeout(idle);
    };
  }, []);

  const ed = edition(book.meta.color);
  const no = String(book.meta.edition).padStart(4, "0");
  const oldestFirst = [...notes].reverse();
  const idx = oldestFirst.findIndex((n) => n.file === file);
  const pageNo = idx + 1;
  const isOpen = phase === "open" || phase === "opening";

  return (
    <div className="deskbook" data-phase={phase} style={{ "--edition": ed.stock, "--edition-ink": ed.ink } as React.CSSProperties}>
      {/* Grab the edges to move the notebook around the desktop. */}
      <div className="drag-edge top" data-tauri-drag-region />
      <div className="drag-edge bottom" data-tauri-drag-region />
      <div className="spread" ref={spread} data-tauri-drag-region>
        {/* back cover board under the right page; once open, the front
            cover's inside lies under the left page */}
        <div className="board" aria-hidden="true" />
        <div className="board board-left" aria-hidden="true" />

        <section
          className={prevText === null ? "leaf left cover-side" : `leaf left paper-${paper}`}
          aria-label={prevText === null ? "Inside front cover" : "Previous page"}
        >
          {prevText === null ? (
            <div className="inside-cover">
              {/* Written on the inside of the board in marker, by hand. */}
              <div className="ic-hand" style={{ "--toc-k": tocScale(notes.length) } as React.CSSProperties}>
                <div className="ich-head" style={wobble(book.id, -1)}>
                  <div className="ich-no">No. {no}</div>
                  <div className="ich-title">{book.meta.title}</div>
                  {book.meta.started && <div className="ich-started">Started {fmt(`${book.meta.started}`)}</div>}
                </div>
                <div className="ich-label" style={wobble(book.id, -2)}>
                  Contents
                  <svg viewBox="0 0 200 12" preserveAspectRatio="none" aria-hidden="true">
                    <path d="M2 8 C 40 3, 90 10, 130 5 S 185 7, 198 4" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
                  </svg>
                </div>
                <ol className="ich-toc">
                  {oldestFirst.map((n, i) => (
                    <li key={n.file} className={n.file === file ? "here" : ""} style={wobble(book.id, i)}>
                      <button onClick={() => onOpenNote(n.file)}>
                        <span className="ich-p">{i + 1}</span>
                        <span className="ich-t">{n.title}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          ) : (
            <>
              <header className="leaf-head"><span>No. {no} · {book.meta.title}</span><span>{pageNo - 1}</span></header>
              <PageText text={prevText} />
            </>
          )}
        </section>

        <section className={`leaf right paper-${paper}`} aria-label="Page">
          <header className="leaf-head">
            <span>{file ? fmt(file) : ""}</span>
            <span>{pageNo || ""}</span>
          </header>
          <div className="leaf-body">{children}</div>
          <footer className="leaf-foot">
            <button className="turn" onClick={() => turnRef.current(-1)} disabled={pageNo <= 1} title="Previous page (⌥⌘←)">‹</button>
            <span>{pageNo ? `${pageNo} / ${notes.length}` : ""}</span>
            <button className="turn" onClick={() => turnRef.current(1)} disabled={pageNo >= notes.length} title="Next page (⌥⌘→)">›</button>
          </footer>
        </section>

        <div className="spine" aria-hidden="true">
          <span className="staple s1" />
          <span className="staple s2" />
          <span className="staple s3" />
        </div>

        {/* The front cover: art outside, plain board inside. */}
        <button
          className="front-cover"
          onClick={() => !isOpen && setPhase("opening")}
          aria-label={isOpen ? "Front cover (open)" : `Open ${book.meta.title}`}
          tabIndex={isOpen ? -1 : 0}
        >
          <span className="fc-outside"><CoverArt notebook={book} art={coverArt} take={take} /></span>
          <span className="fc-inside" />
        </button>
      </div>
      <button className="desk-close" onClick={close} title="Put the notebook away (Esc)">✕</button>
    </div>
  );
}
