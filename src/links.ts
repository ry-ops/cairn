// Wikilinks: [[Note title]], [[Notebook/Note title]], [[Title|shown text]],
// [[Title#Heading]]. A link names a note by its title (frontmatter `title:`,
// else the first `# Heading`, else the file name), the way you'd say it, not
// by file name. Notes in the same notebook win; then the rest of the vault.
//
// One parser for everything: the editor's decorations, the backlink index,
// the left page in notebook mode.

export interface WikiLink {
  /** Offsets of the whole `[[…]]` in the text. */
  from: number;
  to: number;
  /** Notebook part of `Notebook/Title`, if any. */
  book: string | null;
  /** The note's title as written. */
  title: string;
  heading: string | null;
  alias: string | null;
}

/** A note as the link index knows it. */
export interface IndexedNote {
  notebook: string; // notebook id, e.g. 0002-cairn
  file: string;
  title: string;
  links: WikiLink[];
  /** Lines holding links, by line start offset: for backlink context. */
  text: string;
}

export interface NoteRef {
  notebook: string;
  file: string;
}

const LINK = /\[\[([^[\]\n]+?)\]\]/g;

/** Every wikilink in `text`, skipping frontmatter, fenced code and `inline code`. */
export function parseLinks(text: string): WikiLink[] {
  const out: WikiLink[] = [];
  const skip = codeRanges(text);
  for (const m of text.matchAll(LINK)) {
    const from = m.index!;
    if (skip.some(([s, e]) => s <= from && from < e)) continue;
    const link = splitLink(m[1]);
    if (link) out.push({ from, to: from + m[0].length, ...link });
  }
  return out;
}

/** `Notebook/Title#Heading|alias` → parts. Empty titles aren't links. */
export function splitLink(inner: string): Omit<WikiLink, "from" | "to"> | null {
  let rest = inner;
  let alias: string | null = null;
  const bar = rest.indexOf("|");
  if (bar >= 0) {
    alias = rest.slice(bar + 1).trim() || null;
    rest = rest.slice(0, bar);
  }
  let heading: string | null = null;
  const hash = rest.indexOf("#");
  if (hash >= 0) {
    heading = rest.slice(hash + 1).trim() || null;
    rest = rest.slice(0, hash);
  }
  let book: string | null = null;
  const slash = rest.lastIndexOf("/");
  if (slash >= 0) {
    book = rest.slice(0, slash).trim() || null;
    rest = rest.slice(slash + 1);
  }
  const title = rest.trim();
  if (!title) return null;
  return { book, title, heading, alias };
}

/** [start, end) ranges where `[[` isn't a link: frontmatter, fences, inline code. */
function codeRanges(text: string): [number, number][] {
  const out: [number, number][] = [];
  const fm = text.match(/^---\n[\s\S]*?\n---(\n|$)/);
  if (fm) out.push([0, fm[0].length]);
  let fence: { start: number; marker: string } | null = null;
  let pos = 0;
  for (const line of text.split("\n")) {
    const end = pos + line.length + 1;
    const f = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (f && f[1][0] === fence.marker[0] && f[1].length >= fence.marker.length) {
        out.push([fence.start, end]);
        fence = null;
      }
    } else if (f) {
      fence = { start: pos, marker: f[1] };
    } else {
      for (const m of line.matchAll(/(`+)[^`\n]*?\1/g)) out.push([pos + m.index!, pos + m.index! + m[0].length]);
    }
    pos = end;
  }
  if (fence) out.push([fence.start, text.length]);
  return out;
}

/** Case-, space- and punctuation-insensitive key for titles and names. */
export function norm(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** A note's names: its title, and its file name with and without the date. */
function names(n: { file: string; title: string }): string[] {
  const stem = n.file.replace(/\.md$/, "");
  return [n.title, stem, stem.replace(/^\d{4}-\d{2}-\d{2}-/, "")].map(norm);
}

export interface Book {
  id: string;
  title: string;
}

/** Which notebook a `Notebook/` prefix means: by title or by id (with or
 *  without its number). */
export function findBook(name: string, books: Book[]): Book | undefined {
  const k = norm(name);
  return books.find((b) => norm(b.title) === k) ??
    books.find((b) => norm(b.id) === k || norm(b.id.replace(/^\d+-/, "")) === k);
}

/** The note a link points at, seen from notebook `here`. */
export function resolve(
  link: Pick<WikiLink, "book" | "title">,
  here: string | null,
  index: IndexedNote[],
  books: Book[],
): IndexedNote | undefined {
  const k = norm(link.title);
  const hits = (nb: string) => index.filter((n) => n.notebook === nb && names(n).includes(k));
  // Prefer an exact title over a file-name match.
  const best = (list: IndexedNote[]) => list.find((n) => norm(n.title) === k) ?? list[0];
  if (link.book) {
    const b = findBook(link.book, books);
    return b ? best(hits(b.id)) : undefined;
  }
  if (here) {
    const local = best(hits(here));
    if (local) return local;
  }
  return best(index.filter((n) => names(n).includes(k)));
}

export interface Backlink {
  from: IndexedNote;
  /** The line the link sits on, trimmed, for context. */
  context: string;
}

/** Notes that link to `target`, one entry per linking line. */
export function backlinks(target: NoteRef, index: IndexedNote[], books: Book[]): Backlink[] {
  const out: Backlink[] = [];
  for (const n of index) {
    if (n.notebook === target.notebook && n.file === target.file) continue;
    const seen = new Set<number>();
    for (const l of n.links) {
      const r = resolve(l, n.notebook, index, books);
      if (!r || r.notebook !== target.notebook || r.file !== target.file) continue;
      const start = n.text.lastIndexOf("\n", l.from - 1) + 1;
      if (seen.has(start)) continue;
      seen.add(start);
      const endAt = n.text.indexOf("\n", l.to);
      out.push({ from: n, context: lineContext(n.text.slice(start, endAt < 0 ? undefined : endAt)) });
    }
  }
  return out;
}

/** A line as readable context: no list or heading markers, links as text. */
function lineContext(line: string): string {
  const plain = line
    .replace(/^\s*(?:[-*+]|\d+\.|#{1,6}|>)\s+/, "")
    .replace(LINK, (_, inner: string) => {
      const l = splitLink(inner);
      return l ? `[[${l.alias ?? l.title}]]` : _;
    })
    .trim();
  return plain.length > 180 ? `${plain.slice(0, 177)}…` : plain;
}

/** Index one note's text. */
export function indexNote(notebook: string, file: string, title: string, text: string): IndexedNote {
  return { notebook, file, title, links: parseLinks(text), text };
}

/** What to write inside `[[…]]` so it reaches `note` from notebook `here`. */
export function linkText(note: IndexedNote, here: string | null, index: IndexedNote[], books: Book[]): string {
  const r = resolve({ book: null, title: note.title }, here, index, books);
  if (r && r.notebook === note.notebook && r.file === note.file) return note.title;
  const b = books.find((x) => x.id === note.notebook);
  return `${b?.title ?? note.notebook}/${note.title}`;
}
