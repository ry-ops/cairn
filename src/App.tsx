import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CairnMark, CoverDefs } from "./components/Cover";
import { NotebookMenu, NotebookTools, type SyncLook, SortableCovers, TrashNotebookSheet, VaultCard } from "./components/ShelfParts";
import { RepoSheet } from "./components/RepoSheet";
import { NotebookGrid } from "./components/NotebookGrid";
import { CoverChoice, CoverPicker } from "./components/CoverPicker";
import { DeskBook } from "./components/DeskBook";
import { SyncSheet } from "./components/SyncSheet";
import { Art, resolveArt } from "./cover-presets";
import { EDITIONS, edition } from "./covers";
import { Editor, EditorHandle } from "./editor/Editor";
import type { FocusMode } from "./editor/focus";
import { FONTS, font as fontById } from "./fonts";
import { getKey, setKey } from "./frontmatter";
import type { LinkHost } from "./editor/wikilinks";
import { Book, IndexedNote, WikiLink, backlinks, findBook, indexNote, linkText, resolve } from "./links";
import { NoteMeta, Notebook, NotebookMeta, Paper, SyncInfo, SyncReport, noteTitle, store } from "./store";
import { Backlinks } from "./components/Backlinks";
import { SearchPalette } from "./components/SearchPalette";
import { PageStickers, pageGeometry } from "./components/PageStickers";
import { BadgeAward, BadgeSash } from "./components/Badges";
import { BADGES, vaultStats } from "./badges";
import { type StickTo, StickerSheet } from "./components/StickerSheet";
import { BUILTIN, type Sticker, StickerContext, coverPlacements, customStickers, freshPlacement, parsePlacements, placementsValue } from "./stickers";
import "./App.css";

const PAPERS: Paper[] = ["graph", "ruled", "dot", "blank"];
const FOCUS_CYCLE: FocusMode[] = ["off", "sentence", "paragraph"];
const SAVE_DELAY_MS = 500;
const SYNC_AFTER_SAVE_MS = 20_000; // a quiet moment after typing
const SYNC_EVERY_MS = 5 * 60_000; // pick up changes from elsewhere
const MIRROR_AFTER_SAVE_MS = 10_000;
const HEX = /^#[0-9a-f]{6}$/i;
const IN_TAURI = "__TAURI_INTERNALS__" in window;

type SaveState = "saved" | "dirty" | "saving" | "error";

function loadPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`cairn.${key}`);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
function savePref(key: string, value: unknown) {
  try {
    localStorage.setItem(`cairn.${key}`, JSON.stringify(value));
  } catch {
    /* prefs are a convenience */
  }
}

function wordCount(text: string): number {
  const body = text.replace(/^---\n[\s\S]*?\n---\n?/, "");
  return (body.match(/[\p{L}\p{N}'’]+/gu) ?? []).length;
}

function fmtDate(file: string): string {
  const m = file.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

const isPaper = (p: string | null): p is Paper => !!p && (PAPERS as string[]).includes(p);

/** Desktop: turn the window into the notebook on the desktop ("book"), the
 *  or back ("off"). */
async function deskMode(mode: "book" | "off") {
  if (!IN_TAURI) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("desk_mode", { mode }).catch(() => {});
}

export default function App() {
  const [vault, setVault] = useState<string | null | undefined>(undefined);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  // Custom art files per notebook (cover.svg / button.svg / lib:…).
  const [custom, setCustom] = useState<Record<string, { cover: string | null; button: string | null }>>({});
  const [library, setLibrary] = useState<string[]>([]);
  const [view, setView] = useState<"notes" | "grid">("notes");
  const viewRef = useRef(view);
  viewRef.current = view;
  // A notebook switch that should land on a particular note once its pages
  // have loaded (a followed link, a search result).
  const pendingOpen = useRef<{ book: string; file?: string } | null>(null);
  // Every note's text and links, for [[wikilinks]] and backlinks.
  const [index, setIndex] = useState<IndexedNote[]>([]);
  const [indexVersion, setIndexVersion] = useState(0);
  const [showBacklinks, setShowBacklinks] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [mySticks, setMySticks] = useState<Sticker[]>([]);
  // Merit badges: null until badges.yml is read.
  const [earned, setEarned] = useState<Record<string, string> | null>(null);
  const [indexReady, setIndexReady] = useState(false);
  const [award, setAward] = useState<string[]>([]);
  const [showSash, setShowSash] = useState(false);
  const [showStickers, setShowStickers] = useState(false);
  const [stickTo, setStickTo] = useState<StickTo>("page");
  const sheet = useMemo(() => [...BUILTIN, ...mySticks], [mySticks]);
  const stickerMap = useMemo(() => new Map(sheet.map((x) => [x.id, x])), [sheet]);
  const [picker, setPicker] = useState(false);
  const [bookMenu, setBookMenu] = useState(false);
  const [trashBook, setTrashBook] = useState<Notebook | null>(null);
  const [repoBook, setRepoBook] = useState<Notebook | null>(null);
  const [syncInfo, setSyncInfo] = useState<SyncInfo | null>(null);
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "error">("idle");
  const [syncError, setSyncError] = useState<string | null>(null);
  const [showSync, setShowSync] = useState(false);
  const syncTimer = useRef<number | undefined>(undefined);
  const mirrorTimer = useRef<number | undefined>(undefined);
  const afterSave = useRef<() => void>(() => {});
  const [bookId, setBookId] = useState<string | null>(() => loadPref("book", null));
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [file, setFile] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<FocusMode>(() => loadPref("focus", "off"));
  const [typewriterOn, setTypewriterOn] = useState<boolean>(() => loadPref("typewriter", false));
  // Normalized so an old saved font id (e.g. "caveat") maps onto today's options.
  const [fontId, setFontId] = useState<string>(() => fontById(loadPref("font", "typewriter")).id);
  const [chrome, setChrome] = useState<boolean>(true);
  // Narrow windows fold the sidebars away until asked for (CSS does the fold;
  // "show" / ⌘\ flips this to keep them out).
  const [peek, setPeek] = useState(false); // sidebars shown on a narrow window
  const [narrow, setNarrow] = useState(() => window.innerWidth <= 860);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 860px)");
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const [bookMode, setBookMode] = useState(false);
  const bookModeRef = useRef(false);
  bookModeRef.current = bookMode;
  const [closeSignal, setCloseSignal] = useState(0);
  const [prevText, setPrevText] = useState<string | null>(null);
  const [newBook, setNewBook] = useState(false);
  const [newNote, setNewNote] = useState(false);

  const editor = useRef<EditorHandle>(null);
  // Pending write, so switching notes or quitting never loses keystrokes.
  const pending = useRef<{ book: string; file: string; text: string } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const book = useMemo(() => notebooks.find((n) => n.id === bookId) ?? null, [notebooks, bookId]);

  const fail = useCallback((e: unknown) => setError(String(e)), []);
  const bookIdRef = useRef(bookId);
  bookIdRef.current = bookId;
  const fileRef = useRef<string | null>(null);
  const justCreated = useRef<string | null>(null);
  const notesRef = useRef<NoteMeta[]>([]);
  notesRef.current = notes;
  fileRef.current = file;
  const [reloadKey, setReloadKey] = useState(0);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    setSaveState("saving");
    try {
      await store.writeNote(p.book, p.file, p.text);
      setSaveState(pending.current ? "dirty" : "saved");
      updateIndex(p.book, p.file, p.text);
      afterSave.current();
      const fresh = await store.listNotes(p.book);
      if (bookIdRef.current === p.book) setNotes(fresh);
    } catch (e) {
      setSaveState("error");
      fail(e);
    }
  }, [fail]);

  /** Re-index one note after it's written. */
  const updateIndex = useCallback((book: string, file: string, text: string) => {
    setIndex((cur) => {
      const next = cur.filter((n) => !(n.notebook === book && n.file === file));
      next.push(indexNote(book, file, noteTitle(text, file), text));
      return next;
    });
    setIndexVersion((v) => v + 1);
  }, []);
  const reloadIndex = useCallback(async () => {
    const all = await store.allNotes().catch(() => null);
    if (!all) return;
    setIndex(all.map((n) => indexNote(n.notebook, n.file, n.title, n.text)));
    setIndexVersion((v) => v + 1);
    setIndexReady(true);
  }, []);

  const refreshBooks = useCallback(async () => {
    void reloadIndex();
    store.listStickers().then((p) => setMySticks(customStickers(p))).catch(() => setMySticks([]));
    const list = await store.listNotebooks();
    setNotebooks(list);
    const files = await Promise.all(
      list.map(async (n) => ({
        cover: await store.readCover(n.id).catch(() => null),
        button: await store.readButton(n.id).catch(() => null),
      })),
    );
    setCustom(Object.fromEntries(list.map((n, i) => [n.id, files[i]])));
    setLibrary(await store.listLibrary().catch(() => []));
    return list;
  }, [reloadIndex]);

  // Resolved cover + button art for every notebook (presets, custom, kraft).
  const art = useMemo<Record<string, Art>>(
    () => Object.fromEntries(notebooks.map((n) => [n.id, resolveArt(n.meta, custom[n.id] ?? {})])),
    [notebooks, custom],
  );

  /** Persist a notebook's meta and reflect it locally right away. */
  const saveMeta = useCallback(
    async (id: string, meta: NotebookMeta) => {
      setNotebooks((cur) => cur.map((n) => (n.id === id ? { ...n, meta } : n)));
      await store.updateNotebook(id, meta).catch(fail);
    },
    [fail],
  );

  // ---- sync ----
  const loadSync = useCallback(async () => {
    const info = await store.getSync().catch(() => null);
    setSyncInfo(info);
    return info;
  }, []);

  const linked = !!syncInfo?.settings.enabled && !!syncInfo.last_sync;

  const onSynced = useCallback(
    async (r: SyncReport) => {
      // A notebook's own repo can fail while the vault synced fine.
      const errs = r.errors ?? [];
      setSyncState(errs.length ? "error" : "idle");
      setSyncError(errs.length ? `Couldn't sync ${errs.join("; ")}` : null);
      await loadSync();
      if (r.pulled.length || r.deleted_local.length || r.conflicts.length) {
        await refreshBooks();
        const nb = bookIdRef.current;
        if (nb) setNotes(await store.listNotes(nb).catch(() => []));
        // Reload the open note if it changed elsewhere and there are no unsaved edits.
        const open = nb && fileRef.current ? `notebooks/${nb}/${fileRef.current}` : null;
        if (open && r.pulled.includes(open) && !pending.current) {
          setText(await store.readNote(nb!, fileRef.current!));
          setReloadKey((k) => k + 1);
        }
      }
    },
    [loadSync, refreshBooks],
  );

  const syncQuietly = useCallback(async () => {
    if (!linked || syncState === "syncing") return;
    setSyncState("syncing");
    try {
      await flush();
      onSynced(await store.syncNow(false));
    } catch (e) {
      setSyncState("error");
      setSyncError(String(e));
    }
  }, [linked, syncState, flush, onSynced]);

  // After each save: sync after a quiet moment, and refresh the iCloud copy.
  afterSave.current = () => {
    if (linked) {
      window.clearTimeout(syncTimer.current);
      syncTimer.current = window.setTimeout(() => void syncQuietly(), SYNC_AFTER_SAVE_MS);
    }
    if (syncInfo?.mirror && !syncInfo.vault_in_icloud) {
      window.clearTimeout(mirrorTimer.current);
      mirrorTimer.current = window.setTimeout(() => void store.mirrorNow().catch(() => {}), MIRROR_AFTER_SAVE_MS);
    }
  };

  // On open, every few minutes, and when the window is hidden.
  useEffect(() => {
    if (!vault) return;
    void loadSync();
  }, [vault, loadSync]);
  useEffect(() => {
    if (!linked) return;
    void syncQuietly();
    const every = window.setInterval(() => void syncQuietly(), SYNC_EVERY_MS);
    const onHide = () => document.visibilityState === "hidden" && void syncQuietly();
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.clearInterval(every);
      document.removeEventListener("visibilitychange", onHide);
    };
    // Re-arm only when linking changes; syncQuietly reads current state.
  }, [linked]);

  async function applyCover(c: CoverChoice) {
    if (!book) return;
    const meta: NotebookMeta = { ...book.meta, cover: c.cover, color: c.color };
    if (c.ruling === null) delete meta.ruling;
    else if (c.ruling) meta.ruling = c.ruling;
    setPicker(false);
    await saveMeta(book.id, meta);
    // A library cover brings its own files; re-read this notebook's art.
    const files = { cover: await store.readCover(book.id).catch(() => null), button: await store.readButton(book.id).catch(() => null) };
    setCustom((cur) => ({ ...cur, [book.id]: files }));
  }

  // Boot: find the vault, load the shelf.
  useEffect(() => {
    store.getVault().then(setVault).catch(fail);
  }, [fail]);

  useEffect(() => {
    if (!vault) return;
    setEarned(null);
    setIndexReady(false);
    store.readBadges().then(setEarned).catch(() => setEarned({}));
    refreshBooks()
      .then((list) => {
        if (!list.some((n) => n.id === bookIdRef.current)) setBookId(list[0]?.id ?? null);
      })
      .catch(fail);
  }, [vault, refreshBooks, fail]);

  // Notebook switch: load its notes, open the newest.
  useEffect(() => {
    savePref("book", bookId);
    setFile(null);
    setNotes([]);
    if (!bookId) return;
    store
      .listNotes(bookId)
      .then(async (list) => {
        setNotes(list);
        const want = pendingOpen.current?.book === bookId ? pendingOpen.current : null;
        pendingOpen.current = null;
        if (want?.file && list.some((n) => n.file === want.file)) {
          await openNote(bookId, want.file);
        } else if (list[0]) openNote(bookId, list[0].file);
      })
      .catch(fail);
    // Only re-run on notebook change; openNote reads refs and setters.
  }, [bookId]);

  useEffect(() => savePref("focus", focus), [focus]);
  useEffect(() => savePref("typewriter", typewriterOn), [typewriterOn]);
  useEffect(() => savePref("font", fontId), [fontId]);

  async function openNote(nb: string, f: string) {
    await flush();
    try {
      const body = await store.readNote(nb, f);
      setText(body);
      setFile(f);
      setSaveState("saved");
    } catch (e) {
      fail(e);
    }
  }

  // ---- [[wikilinks]] ----
  const books = useMemo<Book[]>(() => notebooks.map((n) => ({ id: n.id, title: n.meta.title })), [notebooks]);

  /** Open a note anywhere in the vault. */
  async function goTo(nb: string, f: string) {
    await flush();
    setShowBacklinks(false);
    if (nb === bookIdRef.current) {
      if (!notesRef.current.some((n) => n.file === f)) setNotes(await store.listNotes(nb));
      await openNote(nb, f);
    } else {
      pendingOpen.current = { book: nb, file: f };
      setBookId(nb);
    }
  }

  /** Follow a link; a link to a note that doesn't exist yet starts it. */
  async function followLink(l: WikiLink) {
    const here = bookIdRef.current;
    const hit = resolve(l, here, index, books);
    if (hit) return goTo(hit.notebook, hit.file);
    const target = l.book ? findBook(l.book, books)?.id : here;
    if (!target) {
      fail(`There's no notebook called “${l.book}”.`);
      return;
    }
    try {
      await flush();
      const n = await store.createNote(target, l.title);
      justCreated.current = n.file;
      await refreshBooks();
      await goTo(target, n.file);
    } catch (e) {
      fail(e);
    }
  }
  const followRef = useRef(followLink);
  followRef.current = followLink;

  const linkHost = useMemo<LinkHost>(() => {
    const here = bookId;
    return {
      exists: (l) => !!resolve(l, here, index, books),
      follow: (l) => void followRef.current(l),
      suggestions: () =>
        [...index]
          .filter((n) => !(n.notebook === here && n.file === fileRef.current))
          .sort((a, b) => Number(b.notebook === here) - Number(a.notebook === here) || a.title.localeCompare(b.title))
          .map((n) => ({
            insert: linkText(n, here, index, books),
            title: n.title,
            detail: books.find((b) => b.id === n.notebook)?.title ?? n.notebook,
          })),
    };
  }, [index, books, bookId]);

  const linkedFrom = useMemo(
    () => (bookId && file ? backlinks({ notebook: bookId, file }, index, books) : []),
    [bookId, file, index, books],
  );

  // ---- merit badges ----
  const stats = useMemo(
    () => (indexReady ? vaultStats(index, notebooks, books, !!syncInfo?.last_sync) : null),
    [indexReady, index, notebooks, books, syncInfo?.last_sync],
  );
  useEffect(() => {
    if (!stats || !earned) return;
    // Settle first: a vault mid-load or mid-sync shouldn't award anything.
    const t = window.setTimeout(() => {
      const fresh = BADGES.filter((b) => !earned[b.id] && b.earned(stats)).map((b) => b.id);
      if (!fresh.length) return;
      const d = new Date();
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const next = { ...earned, ...Object.fromEntries(fresh.map((id) => [id, today])) };
      setEarned(next);
      store.writeBadges(next).catch(fail);
      setAward(fresh);
    }, 1500);
    return () => window.clearTimeout(t);
  }, [stats, earned, fail]);

  // ---- stickers ----
  function writePageStickers(value: string) {
    editor.current?.apply(setKey(text, "stickers", value));
  }
  function stick(id: string) {
    if (!book) return;
    const target: StickTo = file ? stickTo : "cover";
    if (target === "cover") {
      const cur = coverPlacements(book.meta.stickers);
      const p = freshPlacement(id, 0.25 + Math.random() * 0.5, 0.12 + Math.random() * 0.42);
      void saveMeta(book.id, { ...book.meta, stickers: [...cur, p] });
      return;
    }
    const cur = parsePlacements(getKey(text, "stickers"));
    if (cur === null) {
      fail("This page's stickers: line was written by hand, so Cairn leaves it alone.");
      return;
    }
    const g = pageGeometry();
    const row = g?.row ?? 28;
    const top = g ? g.scroller.scrollTop + g.scroller.clientHeight * (0.2 + Math.random() * 0.25) : row * 4;
    writePageStickers(placementsValue([...cur, freshPlacement(id, 0.68 + Math.random() * 0.2, top / row)]));
  }

  function onChange(next: string) {
    if (!bookId || !file) return;
    setText(next);
    pending.current = { book: bookId, file, text: next };
    setSaveState("dirty");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
  }

  // Flush when the window hides or closes.
  useEffect(() => {
    const onHide = () => void flush();
    window.addEventListener("beforeunload", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("beforeunload", onHide);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [flush]);

  // Notes can change while Cairn is in the background (Claude through
  // cairn-mcp, sync, another editor). Coming back, re-read the open note and
  // take the newer text, unless there's typing here not yet saved.
  const textRef = useRef(text);
  textRef.current = text;
  useEffect(() => {
    const onFocus = async () => {
      const nb = bookIdRef.current;
      const f = fileRef.current;
      void refreshBooks().catch(() => {}); // counts, covers, the link index
      if (nb) store.listNotes(nb).then((l) => bookIdRef.current === nb && setNotes(l)).catch(() => {});
      if (!nb || !f || pending.current) return;
      const disk = await store.readNote(nb, f).catch(() => null);
      if (disk === null || disk === textRef.current || pending.current || f !== fileRef.current) return;
      setText(disk);
      setReloadKey((k) => k + 1);
      updateIndex(nb, f, disk);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [updateIndex, refreshBooks]);

  async function createNote(title: string) {
    if (!bookId) return;
    try {
      await flush();
      const n = await store.createNote(bookId, title);
      justCreated.current = n.file;
      setNotes(await store.listNotes(bookId));
      await refreshBooks();
      await openNote(bookId, n.file);
    } catch (e) {
      fail(e);
    }
  }

  async function trashNote(f: string) {
    if (!bookId) return;
    try {
      if (f === file) {
        pending.current = null;
        setFile(null);
      }
      await store.trashNote(bookId, f);
      const list = await store.listNotes(bookId);
      setNotes(list);
      await refreshBooks();
      if (f === file && list[0]) await openNote(bookId, list[0].file);
    } catch (e) {
      fail(e);
    }
  }

  async function createNotebook(title: string, color: string, paper: Paper) {
    try {
      const nb = await store.createNotebook(title, color, paper);
      await refreshBooks();
      setBookId(nb.id);
      setNewBook(false);
    } catch (e) {
      fail(e);
    }
  }

  /** Notebook default paper (notebook.yml). */
  async function trashNotebook(nb: Notebook) {
    setTrashBook(null);
    try {
      await flush();
      const idx = notebooks.findIndex((n) => n.id === nb.id);
      if (nb.id === bookId) {
        pending.current = null;
        setFile(null);
      }
      await store.trashNotebook(nb.id);
      await refreshBooks();
      if (nb.id === bookId) {
        const rest = notebooks.filter((n) => n.id !== nb.id);
        setBookId(rest[Math.min(idx, rest.length - 1)]?.id ?? null);
      }
    } catch (e) {
      fail(e);
    }
  }

  async function reorderShelf(ids: string[]) {
    setNotebooks((cur) => ids.map((id) => cur.find((n) => n.id === id)).filter((n): n is Notebook => !!n));
    await store.setShelfOrder(ids).catch(fail);
  }

  const syncLook: SyncLook = !syncInfo?.settings.enabled
    ? "off"
    : syncState === "syncing"
      ? "syncing"
      : syncState === "error"
        ? "error"
        : !syncInfo.last_sync
          ? "setup"
          : "ok";

  async function setBookPaper(paper: Paper) {
    if (!book) return;
    const meta = { ...book.meta, paper };
    setNotebooks((cur) => cur.map((n) => (n.id === book.id ? { ...n, meta } : n)));
    await store.updateNotebook(book.id, meta).catch(fail);
  }

  /** This page's paper (note frontmatter); null = follow the notebook. */
  function setPagePaper(paper: Paper | null) {
    editor.current?.apply(setKey(text, "paper", paper));
  }

  /** Move to the previous/next page (note) in this notebook. */
  const turn = useCallback(
    (dir: -1 | 1) => {
      if (!bookId || !file) return;
      // List is newest-first; "next page" moves forward in time.
      const i = notes.findIndex((n) => n.file === file);
      const j = i - dir;
      if (i >= 0 && j >= 0 && j < notes.length) void openNote(bookId, notes[j].file);
    },
    // openNote is a plain function over refs and setters.
    [bookId, file, notes],
  );

  // Notebook mode: opening reshapes the window first, then the notebook
  // arrives closed and swings open. Leaving asks it to close; DeskBook calls
  // back once the cover is shut, and then the window comes back.
  const toggleBookMode = useCallback(
    (on?: boolean) => {
      const next = on ?? !bookModeRef.current;
      if (next === bookModeRef.current) return;
      if (next) {
        void flush();
        // Opening the notebook from its cover starts at page 1.
        const first = notesRef.current[notesRef.current.length - 1];
        const nb = bookIdRef.current;
        const ready = first && nb && first.file !== fileRef.current ? openNote(nb, first.file) : Promise.resolve();
        void ready.then(() => deskMode("book")).then(() => {
          setBookMode(true);
          setView("notes");
        });
      } else {
        setCloseSignal((n) => n + 1);
      }
    },
    [flush],
  );
  const leaveBookMode = useCallback(() => {
    setBookMode(false);
    void deskMode("off");
  }, []);

  // All Notebooks: the grid view.
  const lastWritten = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of index) {
      const d = n.file.slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d > (m.get(n.notebook) ?? "")) m.set(n.notebook, d);
    }
    return m;
  }, [index]);
  const toggleGrid = useCallback(() => {
    if (bookModeRef.current) return;
    setView((v) => (v === "grid" ? "notes" : "grid"));
  }, []);

  // The page before this one, for the left side of the spread.
  useEffect(() => {
    if (!bookMode || !bookId || !file) return;
    const i = notes.findIndex((n) => n.file === file);
    const older = i >= 0 ? notes[i + 1] : undefined; // notes are newest first
    if (!older) {
      setPrevText(null);
      return;
    }
    store.readNote(bookId, older.file).then(setPrevText).catch(() => setPrevText(null));
  }, [bookMode, bookId, file, notes]);

  // The desktop shows through around the notebook.
  useEffect(() => {
    document.documentElement.classList.toggle("desk-transparent", bookMode && IN_TAURI);
  }, [bookMode]);

  async function pickVault() {
    try {
      const v = await store.pickVault();
      if (v) {
        setBookId(null);
        setVault(v);
      }
    } catch (e) {
      fail(e);
    }
  }

  // Keys: ⌘N note, ⇧⌘N notebook, ⌘D focus, ⇧⌘T typewriter, ⌘\ sidebars,
  // ⇧⌘F notebook mode, ⌥⌘←/→ turn page, Esc leaves notebook mode, ⌘S save.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (view === "grid" || picker || showSearch) return; // they own their keys
      if (!IN_TAURI && (e.metaKey || e.ctrlKey) && e.key === "0") {
        e.preventDefault();
        toggleGrid();
        return;
      }
      if (bookMode) return; // DeskBook owns keys while the notebook is out
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === "k" && !IN_TAURI) setShowSearch(true); // the app menu owns ⌘K
      else if (k === "n" && e.shiftKey) setNewBook(true);
      else if (k === "n") setNewNote(true);
      else if (k === "d") setFocus((f) => FOCUS_CYCLE[(FOCUS_CYCLE.indexOf(f) + 1) % FOCUS_CYCLE.length]);
      else if (k === "t" && e.shiftKey) setTypewriterOn((t) => !t);
      else if (k === "f" && e.shiftKey && !IN_TAURI) toggleBookMode(); // the app menu owns ⇧⌘F
      else if (k === "\\") (window.innerWidth <= 860 ? setPeek((p) => !p) : setChrome((c) => !c));
      else if (k === "s") void flush();
      else if (e.altKey && e.key === "ArrowLeft") turn(-1);
      else if (e.altKey && e.key === "ArrowRight") turn(1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flush, bookMode, newBook, toggleBookMode, toggleGrid, turn, view, picker, showSearch]);

  // Native menu (View → Notebook Mode ⇧⌘F, All Notebooks ⌘0, Search ⌘K). Menu shortcuts fire
  // even when the web view lacks keyboard focus, so the desktop app relies on
  // these rather than keydown.
  useEffect(() => {
    if (!IN_TAURI) return;
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event").then(({ listen }) =>
      listen<string>("menu", (e) => {
        if (e.payload === "all-notebooks") toggleGrid();
        if (e.payload === "notebook-mode" && viewRef.current !== "grid") toggleBookMode();
        if (e.payload === "search" && viewRef.current !== "grid" && !bookModeRef.current) setShowSearch((v) => !v);
      }).then((u) => (unlisten = u)),
    );
    return () => unlisten?.();
  }, [toggleBookMode, toggleGrid]);

  if (vault === undefined) return <div className="boot" />;

  if (!vault) {
    return (
      <main className="welcome">
        <CoverDefs />
        <CairnMark color="var(--ink)" size={72} />
        <h1>Cairn</h1>
        <p>Notes as markers you leave behind.</p>
        <button className="btn primary" onClick={pickVault}>Choose vault folder…</button>
        <p className="hint">
          Pick any folder for your notebooks. An empty one starts you off with a First Cairn notebook; one in iCloud Drive is on your other Macs too. Turn on GitHub sync later if you want history.
        </p>
        {error && <p className="error">{error}</p>}
      </main>
    );
  }

  const ed = edition(book?.meta.color ?? "kraft");
  const words = wordCount(text);
  const pageOverride = getKey(text, "paper");
  const pagePaper: Paper = isPaper(pageOverride) ? pageOverride : (book?.meta.paper ?? "graph");
  const f = fontById(fontId);
  const ruling = typeof book?.meta.ruling === "string" && HEX.test(book.meta.ruling) ? book.meta.ruling : null;

  const vars = {
    "--edition": ed.stock,
    "--edition-ink": ed.ink,
    "--font-editor": f.family,
    "--editor-size": `${f.size}px`,
    "--row-k": String(f.rowK),
    ...(ruling ? { "--rule": `${ruling}33`, "--rule-strong": `${ruling}55` } : {}),
  } as React.CSSProperties;

  return (
    <StickerContext.Provider value={stickerMap}>
    <div className={`app${chrome ? "" : " no-chrome"}${narrow && chrome === true && !peek ? " auto-chrome" : ""}${bookMode ? " book-mode" : ""}${f.hand ? " hand" : ""}`} style={vars}>
      <CoverDefs />

      <aside className="shelf" aria-label="Notebooks">
        <header className="shelf-head">
          <CairnMark color="var(--ink)" size={22} />
          <span className="wordmark">Cairn</span>
          <button className="board-btn search-btn" onClick={() => setShowSearch(true)} title="Search all notes (⌘K)" aria-label="Search all notes">
            <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
              <circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <path d="M15 15l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
          <button className="board-btn" onClick={toggleGrid} title="All notebooks (⌘0)" aria-label="All notebooks">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <rect x="3.5" y="3" width="7" height="8.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <rect x="13.5" y="3" width="7" height="8.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <rect x="3.5" y="13" width="7" height="8.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <rect x="13.5" y="13" width="7" height="8.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </button>
        </header>
        <SortableCovers notebooks={notebooks} art={art} selected={bookId} onSelect={setBookId} onReorder={reorderShelf} onMenu={(id) => { setBookId(id); setBookMenu(true); }}>
          <button className="cover add" onClick={() => setNewBook(true)} title="New notebook (⇧⌘N)">
            <span>+</span>
            <small>New notebook</small>
          </button>
        </SortableCovers>
        <VaultCard
          name={store.kind === "memory" ? "Preview vault" : (vault.split("/").pop() ?? vault)}
          path={store.kind === "memory" ? "In-memory preview vault" : vault}
          problem={syncLook === "error" ? syncError : null}
          sync={syncLook}
          syncLabel={
            syncLook === "off" ? "Sync off"
            : syncLook === "syncing" ? "Syncing…"
            : syncLook === "error" ? "Sync error"
            : syncLook === "setup" ? "Set up sync"
            : `Synced ${ago(syncInfo!.last_sync!)}`
          }
          syncTitle={syncError ?? (syncInfo?.last_sync ? `Last synced ${new Date(syncInfo.last_sync).toLocaleString()}` : "Not synced yet")}
          canSync={linked}
          badges={earned ? { got: BADGES.filter((b) => earned[b.id]).length, of: BADGES.length } : null}
          onSyncNow={() => void syncQuietly()}
          onSyncSettings={() => setShowSync(true)}
          onChangeVault={() => void pickVault()}
          onBadges={() => setShowSash(true)}
        />
      </aside>

      <nav className="notes" aria-label="Notes">
        {book ? (
          <>
            <header className="notes-head">
              <div>
                <div className="eyebrow">
                  No. {String(book.meta.edition).padStart(4, "0")}
                  <span className="eyebrow-count">{book.note_count} {book.note_count === 1 ? "note" : "notes"}</span>
                </div>
                <h2>{book.meta.title}</h2>
              </div>
              <div className="head-actions">
                <NotebookMenu open={bookMenu} setOpen={setBookMenu} linked={!!book.meta.repo} onCover={() => setPicker(true)} onRepo={() => setRepoBook(book)} onTrash={() => setTrashBook(book)} />
                <button className="icon-btn" onClick={() => setNewNote(true)} title="New note (⌘N)">+</button>
              </div>
              <NotebookTools notebook={book} art={art[book.id]?.cover ?? null} papers={PAPERS} onPaper={(p) => void setBookPaper(p)} onCover={() => setPicker(true)} onRepo={() => setRepoBook(book)} />
            </header>
            {newNote && (
              <InlineInput
                placeholder="Note title"
                onSubmit={(t) => {
                  setNewNote(false);
                  void createNote(t);
                }}
                onCancel={() => setNewNote(false)}
              />
            )}
            <ul>
              {notes.map((n) => (
                <li key={n.file} className={n.file === file ? "active" : ""}>
                  <button className="note-item" onClick={() => bookId && openNote(bookId, n.file)}>
                    <span className="note-title">{n.title}</span>
                    <span className="note-date">{fmtDate(n.file)}</span>
                  </button>
                  <button className="trash" onClick={() => trashNote(n.file)} title="Move to .trash">×</button>
                </li>
              ))}
              {!notes.length && !newNote && (
                <li className="empty">
                  Blank pages. <button className="link" onClick={() => setNewNote(true)}>Start one</button>
                </li>
              )}
            </ul>
          </>
        ) : (
          <p className="empty">No notebooks yet.</p>
        )}
      </nav>

      {bookMode && book ? (
        <DeskBook
          book={book}
          coverArt={art[book.id]?.cover ?? null}
          notes={notes}
          file={file}
          prevText={prevText}
          paper={pagePaper}
          closeSignal={closeSignal}
          onOpenNote={(f) => bookId && void openNote(bookId, f)}
          onTurn={turn}
          onClosed={leaveBookMode}
        >
          {book && file ? (
            <Editor
              key={`${book.id}/${file}#${reloadKey}`}
              ref={editor}
              docKey={`${book.id}/${file}`}
              initial={text}
              focus={focus}
              typewriterOn={typewriterOn}
              onChange={onChange}
              startAtEnd={file === justCreated.current}
              links={linkHost}
              linksVersion={indexVersion}
              startAtTop
            />
          ) : (
            <div className="page-empty"><p>Blank pages.</p></div>
          )}
        </DeskBook>
      ) : (
        <div className="desk">
          <main className={`page paper-${pagePaper}`}>
          {book && file ? (
            <Editor
              key={`${book.id}/${file}#${reloadKey}`}
              ref={editor}
              docKey={`${book.id}/${file}`}
              initial={text}
              focus={focus}
              typewriterOn={typewriterOn}
              onChange={onChange}
              startAtEnd={file === justCreated.current}
              links={linkHost}
              linksVersion={indexVersion}
            />
          ) : (
            <div className="page-empty">
              <CairnMark color="var(--ink-mark)" size={56} />
              <p>{book ? "Pick a note or press ⌘N." : "Create a notebook to begin."}</p>
            </div>
          )}
            <footer className="status">
              <span>{words} {words === 1 ? "word" : "words"} · {Math.max(1, Math.round(words / 230))} min</span>
              <span className={`save ${saveState}`}>{saveState}</span>
              <button className="toggle book-toggle" onClick={() => toggleBookMode(true)} title="Notebook on the desktop (⇧⌘F)">
                notebook ⤢
              </button>
              {book && (
                <button
                  className={`toggle${showStickers ? " on" : ""}`}
                  onClick={() => setShowStickers((v) => !v)}
                  title="Sticker sheet"
                  aria-expanded={showStickers}
                >
                  stickers
                </button>
              )}
              {linkedFrom.length > 0 && (
                <button
                  className={`toggle${showBacklinks ? " on" : ""}`}
                  onClick={() => setShowBacklinks((v) => !v)}
                  title="Notes that link here"
                  aria-expanded={showBacklinks}
                >
                  linked from {linkedFrom.length}
                </button>
              )}
              <span className="spacer" />
              {book && file && (
                <select
                  value={isPaper(pageOverride) ? pageOverride : ""}
                  onChange={(e) => setPagePaper((e.target.value || null) as Paper | null)}
                  aria-label="Paper for this page"
                  title="Paper for this page"
                >
                  <option value="">page: {book.meta.paper} (notebook)</option>
                  {PAPERS.map((p) => <option key={p} value={p}>page: {p}</option>)}
                </select>
              )}
              <select value={fontId} onChange={(e) => setFontId(e.target.value)} aria-label="Font" title="Font">
                {FONTS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
              <button
                className={`toggle${focus !== "off" ? " on" : ""}`}
                onClick={() => setFocus(FOCUS_CYCLE[(FOCUS_CYCLE.indexOf(focus) + 1) % FOCUS_CYCLE.length])}
                title="Focus mode (⌘D)"
              >
                focus: {focus}
              </button>
              <button
                className={`toggle${typewriterOn ? " on" : ""}`}
                onClick={() => setTypewriterOn(!typewriterOn)}
                title="Typewriter scrolling (⇧⌘T)"
              >
                typewriter
              </button>
              <button
                className="toggle"
                onClick={() => (narrow ? setPeek(!peek) : setChrome(!chrome))}
                title="Show or hide the sidebars (⌘\)"
              >
                {(narrow ? peek : chrome) ? "hide" : "show"}
              </button>
            </footer>
            {showStickers && book && (
              <StickerSheet
                sheet={sheet}
                notebook={book}
                coverArt={art[book.id]?.cover ?? null}
                to={stickTo}
                onTo={setStickTo}
                pageOpen={!!file}
                onPick={stick}
                onCoverChange={(next) => void saveMeta(book.id, { ...book.meta, stickers: next })}
                onClose={() => setShowStickers(false)}
              />
            )}
            {showBacklinks && linkedFrom.length > 0 && (
              <Backlinks
                items={linkedFrom}
                books={books}
                here={bookId}
                onOpen={(n) => void goTo(n.notebook, n.file)}
                onClose={() => setShowBacklinks(false)}
              />
            )}
          </main>
        </div>
      )}

      {book && file && view !== "grid" && (
        <PageStickers
          key={`${book.id}/${file}#${reloadKey}/${bookMode}`}
          text={text}
          docKey={`${book.id}/${file}#${reloadKey}/${bookMode}`}
          onWrite={writePageStickers}
        />
      )}
      {view === "grid" && (
        <NotebookGrid
          notebooks={notebooks}
          covers={Object.fromEntries(notebooks.map((n) => [n.id, art[n.id]?.cover ?? null]))}
          lastWritten={lastWritten}
          selected={bookId}
          onOpen={(id) => {
            setView("notes");
            if (id !== bookIdRef.current) setBookId(id);
          }}
          onNew={() => {
            setView("notes");
            setNewBook(true);
          }}
          onClose={() => setView("notes")}
        />
      )}
      {showSash && earned && <BadgeSash earned={earned} stats={stats} onClose={() => setShowSash(false)} />}
      {award.length > 0 && !bookMode && view !== "grid" && (
        <BadgeAward
          ids={award}
          onOpen={() => {
            setAward([]);
            setShowSash(true);
          }}
          onDone={() => setAward([])}
        />
      )}
      {showSearch && (
        <SearchPalette
          books={books}
          here={bookId}
          onOpen={(h) => {
            setShowSearch(false);
            void goTo(h.notebook, h.file);
          }}
          onClose={() => setShowSearch(false)}
        />
      )}
      {showSync && syncInfo && (
        <SyncSheet
          info={syncInfo}
          onSaved={() => void loadSync()}
          onSynced={(r) => void onSynced(r)}
          onClose={() => setShowSync(false)}
        />
      )}
      {repoBook && (
        <RepoSheet
          notebook={repoBook}
          flush={flush}
          onClose={() => setRepoBook(null)}
          onDone={(r) => {
            setRepoBook(null);
            void (async () => {
              await refreshBooks();
              const nb = bookIdRef.current;
              if (nb) setNotes(await store.listNotes(nb).catch(() => []));
              if (r && (r.pushed.length || r.pulled.length)) await loadSync();
            })();
          }}
        />
      )}
      {trashBook && (
        <TrashNotebookSheet notebook={trashBook} art={art[trashBook.id]?.cover ?? null} synced={linked} onConfirm={() => void trashNotebook(trashBook)} onCancel={() => setTrashBook(null)} />
      )}
      {picker && book && (
        <CoverPicker
          notebook={book}
          custom={custom[book.id] ?? { cover: null, button: null }}
          library={library}
          readLibrary={store.readLibrary}
          onApply={applyCover}
          onSaveToLibrary={async (name) => {
            const slug = await store.saveToLibrary(book.id, name);
            setLibrary(await store.listLibrary());
            return slug;
          }}
          onClose={() => setPicker(false)}
        />
      )}
      {newBook && <NewNotebook onCreate={createNotebook} onCancel={() => setNewBook(false)} />}
      {error && (
        <div className="toast" role="alert" onClick={() => setError(null)}>
          {error} <span className="hint">(click to dismiss)</span>
        </div>
      )}
    </div>
    </StickerContext.Provider>
  );
}

function InlineInput({ placeholder, onSubmit, onCancel }: {
  placeholder: string;
  onSubmit: (v: string) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState("");
  return (
    <form
      className="inline-input"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(v);
      }}
    >
      <input
        autoFocus
        value={v}
        placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
        onBlur={() => !v && onCancel()}
      />
    </form>
  );
}

function NewNotebook({ onCreate, onCancel }: {
  onCreate: (title: string, color: string, paper: Paper) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [color, setColor] = useState("kraft");
  const [paper, setPaper] = useState<Paper>("graph");
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form
        className="sheet"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) onCreate(title.trim(), color, paper);
        }}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
      >
        <h3>New notebook</h3>
        <label>
          <span>Title</span>
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Trail Log" />
        </label>
        <fieldset>
          <legend>Edition color</legend>
          <div className="swatches">
            {EDITIONS.map((e) => (
              <button
                type="button"
                key={e.name}
                className={`swatch${e.name === color ? " on" : ""}`}
                style={{ background: e.stock }}
                onClick={() => setColor(e.name)}
                title={e.label}
                aria-label={e.label}
                aria-pressed={e.name === color}
              />
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Paper</legend>
          <div className="papers">
            {PAPERS.map((p) => (
              <button
                type="button"
                key={p}
                className={`paper-chip paper-${p}${p === paper ? " on" : ""}`}
                onClick={() => setPaper(p)}
                aria-pressed={p === paper}
              >
                {p}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="sheet-actions">
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!title.trim()}>Create</button>
        </div>
      </form>
    </div>
  );
}
