// Storage abstraction (ADR-001 consequences): the desktop app talks to the
// Rust vault over Tauri IPC; the web build (the companion, `vite build
// --mode web`) reads and commits the vault repo through the companion's
// Worker (webstore.ts); a plain `vite dev` gets an in-memory preview.
import { invoke } from "@tauri-apps/api/core";
import { webStore } from "./webstore.ts";

export type Paper = "graph" | "ruled" | "dot" | "blank";

export interface NotebookMeta {
  title: string;
  edition: number;
  color: string;
  cover: string;
  paper: Paper;
  started: string;
  stickers: unknown[];
  /** Notes sync with this repo (`owner/name`) instead of the vault repo. */
  repo?: string;
  repo_branch?: string;
  repo_path?: string;
  [extra: string]: unknown;
}

/** Where a notebook's notes sync, when not with the vault repo. */
export interface RepoLink {
  repo: string;
  branch: string;
  path: string;
}

export interface Notebook {
  id: string;
  meta: NotebookMeta;
  note_count: number;
}

export interface NoteMeta {
  file: string;
  title: string;
  modified: number;
}

export interface NoteText {
  notebook: string;
  file: string;
  title: string;
  text: string;
}

/** A search result. Matches in `title` and `snippet` are wrapped in
 *  \u0002 … \u0003. */
export interface SearchHit {
  notebook: string;
  file: string;
  title: string;
  snippet: string;
}

export interface VaultStore {
  readonly kind: "tauri" | "memory" | "web";
  getVault(): Promise<string | null>;
  pickVault(): Promise<string | null>;
  listNotebooks(): Promise<Notebook[]>;
  /** Save the sidebar order (`<vault>/shelf.yml`). */
  setShelfOrder(order: string[]): Promise<void>;
  createNotebook(title: string, color: string, paper: Paper): Promise<Notebook>;
  updateNotebook(id: string, meta: NotebookMeta): Promise<void>;
  listNotes(notebook: string): Promise<NoteMeta[]>;
  readNote(notebook: string, file: string): Promise<string>;
  writeNote(notebook: string, file: string, contents: string): Promise<void>;
  createNote(notebook: string, title: string): Promise<NoteMeta>;
  trashNote(notebook: string, file: string): Promise<void>;
  /** Move a notebook folder to `<vault>/.trash/`. */
  trashNotebook(id: string): Promise<void>;
  /** Link a notebook to its own repo (null: back to the vault repo). With
   *  dryRun, only previews; otherwise saves the link and syncs it. */
  linkNotebookRepo(id: string, link: RepoLink | null, dryRun: boolean): Promise<SyncReport>;
  /** Every note's text, for the link index. */
  allNotes(): Promise<NoteText[]>;
  /** Merit badges earned: id → date (`<vault>/badges.yml`). */
  readBadges(): Promise<Record<string, string>>;
  writeBadges(earned: Record<string, string>): Promise<void>;
  /** Your own stickers (`<vault>/stickers/*.svg`): [name, svg] pairs. */
  listStickers(): Promise<[string, string][]>;
  /** Full-text search across every notebook, best first. */
  search(query: string): Promise<SearchHit[]>;
  /** Custom cover SVG (`cover: *.svg` or `lib:<name>`), or null for built-in. */
  readCover(notebook: string): Promise<string | null>;
  /** Custom button SVG, or null to derive one from the cover. */
  readButton(notebook: string): Promise<string | null>;
  /** Shared cover library (`<vault>/covers/`). */
  listLibrary(): Promise<string[]>;
  readLibrary(name: string): Promise<string | null>;
  saveToLibrary(notebook: string, name: string): Promise<string>;
  /** GitHub sync + iCloud mirror (desktop only). */
  getSync(): Promise<SyncInfo>;
  setSync(settings: SyncSettings, mirror: boolean): Promise<void>;
  setToken(token: string): Promise<void>;
  syncNow(dryRun: boolean): Promise<SyncReport>;
  /** Does the vault repo in these settings exist yet (and who's signed in)? */
  checkVaultRepo(settings: SyncSettings): Promise<{ exists: boolean; login: string }>;
  /** Create the vault repo, private with a README; returns its branch. */
  createVaultRepo(settings: SyncSettings): Promise<string>;
  mirrorNow(): Promise<{ dest: string; copied: number; trashed: number } | null>;
}

export interface SyncSettings {
  enabled: boolean;
  repo: string;
  branch: string;
  token_source: "gh" | "keychain";
}

export interface SyncInfo {
  settings: SyncSettings;
  mirror: boolean;
  gh_available: boolean;
  keychain_has_token: boolean;
  vault_in_icloud: boolean;
  icloud_available: boolean;
  last_sync: string | null;
}

export interface SyncReport {
  dry_run: boolean;
  first_link: boolean;
  pushed: string[];
  pulled: string[];
  deleted_remote: string[];
  deleted_local: string[];
  conflicts: string[];
  skipped: string[];
  /** Notebooks whose own-repo sync failed: "Title: reason". */
  errors?: string[];
  head: string;
  at: string;
}

const tauriStore: VaultStore = {
  kind: "tauri",
  getVault: () => invoke("get_vault"),
  async pickVault() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({ directory: true, title: "Choose your Cairn vault folder" });
    if (typeof path !== "string") return null;
    return invoke("set_vault", { path });
  },
  listNotebooks: () => invoke("list_notebooks"),
  setShelfOrder: (order) => invoke("set_shelf_order", { order }),
  createNotebook: (title, color, paper) => invoke("create_notebook", { title, color, paper }),
  updateNotebook: (id, meta) => invoke("update_notebook", { id, meta }),
  listNotes: (notebook) => invoke("list_notes", { notebook }),
  readNote: (notebook, file) => invoke("read_note", { notebook, file }),
  writeNote: (notebook, file, contents) => invoke("write_note", { notebook, file, contents }),
  createNote: (notebook, title) => invoke("create_note", { notebook, title }),
  trashNote: (notebook, file) => invoke("trash_note", { notebook, file }),
  trashNotebook: (id) => invoke("trash_notebook", { id }),
  linkNotebookRepo: (id, link, dryRun) => invoke("link_notebook_repo", { id, link, dryRun }),
  allNotes: () => invoke("all_notes"),
  listStickers: () => invoke("list_stickers"),
  readBadges: () => invoke("read_badges"),
  writeBadges: (earned) => invoke("write_badges", { earned }),
  search: (query) => invoke("search", { query }),
  readCover: (notebook) => invoke("read_cover", { notebook }),
  readButton: (notebook) => invoke("read_button", { notebook }),
  listLibrary: () => invoke("list_library"),
  readLibrary: (name) => invoke("read_library", { name }),
  saveToLibrary: (notebook, name) => invoke("save_to_library", { notebook, name }),
  getSync: () => invoke("get_sync"),
  setSync: (settings, mirror) => invoke("set_sync", { settings, mirror }),
  setToken: (token) => invoke("set_token", { token }),
  syncNow: (dryRun) => invoke("sync_now", { dryRun }),
  checkVaultRepo: (settings) => invoke("check_vault_repo", { settings }),
  createVaultRepo: (settings) => invoke("create_vault_repo", { settings }),
  mirrorNow: () => invoke("mirror_now"),
};

// ---- In-memory store (browser preview). Mirrors the Rust naming rules. ----

const today = () => new Date().toISOString().slice(0, 10);

export function slugify(s: string): string {
  const slug = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return slug || "untitled";
}

export function noteTitle(contents: string, file: string): string {
  const fm = contents.match(/^---\n([\s\S]*?)\n---/);
  const t = fm?.[1].match(/^title:\s*(.+)$/m)?.[1].trim().replace(/^["']|["']$/g, "");
  if (t) return t;
  const h = contents.match(/^# (.+)$/m)?.[1].trim();
  if (h) return h;
  return file.replace(/\.md$/, "").replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/-/g, " ");
}

function memoryStore(): VaultStore {
  const books = new Map<string, NotebookMeta>();
  const notes = new Map<string, Map<string, { body: string; modified: number }>>();
  const now = () => Math.floor(Date.now() / 1000);

  const seed = (id: string, meta: Partial<NotebookMeta>, pages: Record<string, string>) => {
    books.set(id, {
      title: "", edition: 0, color: "kraft", cover: "kraft-classic", paper: "graph",
      started: today(), stickers: [], ...meta,
    });
    notes.set(id, new Map(Object.entries(pages).map(([f, body]) => [f, { body, modified: now() }])));
  };
  seed("0001-first-cairn", { title: "First Cairn", edition: 1 }, {
    "2026-11-15-welcome.md":
      "---\ntitle: Welcome\ntags: [cairn]\nstickers: []\n---\n\n# Welcome\n\nThis is the first marker in the first notebook.\n\nWrite it down now. Find your way back later. Focus mode dims everything but the sentence you're on. Typewriter mode keeps your line in the middle of the page.\n\n## Practical applications\n\n- Trail conditions\n- Bench measurements\n- *Half-formed* ideas worth **keeping**\n\n## Links\n\nLink notes by title: the [[Strike log]] lives in another notebook, and [[Trail Log/Ridge loop]] doesn't exist yet. ⌘-click one to follow it.\n",
  });
  seed("0002-sferic-bench", { title: "Sferic Bench", edition: 2, color: "blaze", paper: "dot" }, {
    "2026-11-14-strike-log.md": "# Strike log\n\nStation on the sill. Three flashes before midnight.\n",
  });
  seed("0003-trail-log", { title: "Trail Log", edition: 3, color: "pine", paper: "ruled" }, {});
  // Built-in covers (cairn-cover presets) and a spread of notebooks so the
  // buttons have something to show.
  seed("0004-hunters-moon", { title: "Hunter's Moon", edition: 4, color: "birch", paper: "ruled", cover: "monoprint", ruling: "#c98a3a" }, {
    "2026-11-15-first-frost.md": "---\ntitle: First frost\npaper: blank\n---\n\n# First frost\n\nThe moon came up orange over the ridge. This page is blank paper; the rest of the notebook is ruled in ochre.\n",
  });
  const more: [string, Partial<NotebookMeta>][] = [
    ["North Shore", { color: "lake", paper: "dot", cover: "watercolor" }],
    ["Ridge Sketches", { color: "birch", paper: "blank", cover: "hand-drawn" }],
    ["Pine Press", { color: "birch", cover: "letterpress" }],
    ["Split Rock", { color: "cherry", cover: "watercolor/sunset" }],
    ["Winter Count", { color: "lake", cover: "monoprint/winter" }],
    ["Gooseberry Falls", { color: "birch", cover: "watercolor/first-snow" }],
    ["Bench Log", { color: "graphite", cover: "hand-drawn/night" }],
    ["Garden 2026", { color: "pine", cover: "monoprint/spring" }],
    ["Boundary Waters", { color: "birch", cover: "letterpress/pine-gold" }],
    ["Recipes", { color: "kraft", cover: "letterpress/cherry-slate" }],
    ["Reading", { color: "blaze", cover: "letterpress/blaze" }],
    ["Superior Hiking Trail", { color: "kraft", cover: "hand-drawn/kraft" }],
    ["Canal Park", { color: "lake", cover: "kraft-classic" }],
    ["Ideas", { color: "kraft", cover: "kraft-classic" }],
    ["Old Projects", { color: "graphite", cover: "hand-drawn/navy" }],
  ];
  more.forEach(([title, meta], i) => {
    const n = i + 5;
    seed(`${String(n).padStart(4, "0")}-${slugify(title)}`, { title, edition: n, ...meta }, {});
  });
  const library = new Map<string, string>();
  let badges: Record<string, string> = {};
  let shelf: string[] = [];

  const book = (id: string) => {
    const m = notes.get(id);
    if (!m) throw new Error(`not found: ${id}`);
    return m;
  };

  return {
    kind: "memory",
    getVault: async () => "memory://preview",
    pickVault: async () => "memory://preview",
    async listNotebooks() {
      const rank = (id: string) => (shelf.includes(id) ? shelf.indexOf(id) : Infinity);
      return [...books.entries()]
        .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
        .map(([id, meta]) => ({ id, meta, note_count: book(id).size }));
    },
    async createNotebook(title, color, paper) {
      const next = Math.max(0, ...[...books.keys()].map((k) => parseInt(k, 10) || 0)) + 1;
      const id = `${String(next).padStart(4, "0")}-${slugify(title)}`;
      const meta: NotebookMeta = {
        title, edition: next, color: color || "kraft", cover: "kraft-classic",
        paper, started: today(), stickers: [],
      };
      books.set(id, meta);
      notes.set(id, new Map());
      return { id, meta, note_count: 0 };
    },
    async updateNotebook(id, meta) {
      books.set(id, meta);
    },
    async listNotes(id) {
      return [...book(id).entries()]
        .map(([file, n]) => ({ file, title: noteTitle(n.body, file), modified: n.modified }))
        .sort((a, b) => b.file.localeCompare(a.file));
    },
    async readNote(id, file) {
      const n = book(id).get(file);
      if (!n) throw new Error(`not found: ${file}`);
      return n.body;
    },
    async writeNote(id, file, body) {
      book(id).set(file, { body, modified: now() });
    },
    async createNote(id, title) {
      const b = book(id);
      title = title.trim() || "Untitled";
      const base = `${today()}-${slugify(title)}`;
      let file = `${base}.md`;
      for (let n = 2; b.has(file); n++) file = `${base}-${n}.md`;
      b.set(file, {
        body: `---\ntitle: "${title.replace(/"/g, "'")}"\ntags: []\nstickers: []\n---\n\n# ${title}\n\n`,
        modified: now(),
      });
      return { file, title, modified: now() };
    },
    async allNotes() {
      return [...notes.entries()].flatMap(([notebook, b]) =>
        [...b.entries()].map(([file, n]) => ({ notebook, file, title: noteTitle(n.body, file), text: n.body })),
      );
    },
    listStickers: async () => [],
    setShelfOrder: async (order) => {
      shelf = [...order];
    },
    readBadges: async () => ({ ...badges }),
    async writeBadges(e) {
      badges = { ...e };
    },
    async search(query) {
      return previewSearch(query, await this.allNotes());
    },
    async linkNotebookRepo(id, link, dryRun) {
      // The preview can't reach GitHub: pretend the repo has two docs.
      const files = [...book(id).keys()].map((f) => `notebooks/${id}/${f}`);
      const report: SyncReport = {
        dry_run: dryRun, first_link: true, pushed: files, pulled: link ? [`notebooks/${id}/README.md`, `notebooks/${id}/setup.md`] : [],
        deleted_remote: [], deleted_local: [], conflicts: [], skipped: [], head: "", at: new Date().toISOString(),
      };
      if (!dryRun) {
        const meta = books.get(id)!;
        books.set(id, { ...meta, repo: link?.repo ?? "", repo_branch: link?.branch ?? "", repo_path: link?.path ?? "" });
      }
      return report;
    },
    async trashNotebook(id) {
      if (!books.delete(id)) throw new Error(`No notebook ${id}`);
      notes.delete(id);
      shelf = shelf.filter((x) => x !== id);
    },
    async trashNote(id, file) {
      book(id).delete(file);
    },
    async readCover(id) {
      const cover = books.get(id)?.cover ?? "";
      return cover.startsWith("lib:") ? library.get(cover.slice(4)) ?? null : null;
    },
    readButton: async () => null,
    listLibrary: async () => [...library.keys()].sort(),
    readLibrary: async (name) => library.get(name) ?? null,
    async saveToLibrary(id, name) {
      const svg = await this.readCover(id);
      if (!svg) throw new Error("not found: custom cover");
      let slug = slugify(name);
      for (let n = 2; library.has(slug); n++) slug = `${slugify(name)}-${n}`;
      library.set(slug, svg);
      return slug;
    },
    getSync: async () => ({
      settings: { enabled: false, repo: "", branch: "main", token_source: "gh" },
      mirror: false, gh_available: false, keychain_has_token: false,
      vault_in_icloud: false, icloud_available: false, last_sync: null,
    }),
    setSync: async () => {},
    setToken: async () => {},
    checkVaultRepo: async () => ({ exists: false, login: "you" }),
    createVaultRepo: async () => {
      throw new Error("Creating a repo runs in the desktop app.");
    },
    syncNow: async () => {
      throw new Error("Sync runs in the desktop app.");
    },
    mirrorNow: async () => null,
  };
}

export const store: VaultStore =
  "__TAURI_INTERNALS__" in window ? tauriStore : import.meta.env?.MODE === "web" ? webStore() : memoryStore();

// Browser preview only: a plain scan standing in for the app's FTS5 index,
// with the same rules (every word, last one a prefix, title matches first).
const fold = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export function previewSearch(query: string, all: NoteText[]): SearchHit[] {
  const words = fold(query).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!words.length) return [];
  const exact = words.slice(0, -1).map((w) => new RegExp(`(?<![\\p{L}\\p{N}])${w}(?![\\p{L}\\p{N}])`, "u"));
  const last = new RegExp(`(?<![\\p{L}\\p{N}])${words[words.length - 1]}`, "u");
  const tests = [...exact, last];
  const mark = (text: string) => {
    let out = "";
    const f = fold(text);
    let i = 0;
    const re = new RegExp(tests.map((t) => t.source).join("|"), "gu");
    for (const m of f.matchAll(re)) {
      const end = m.index! + m[0].length;
      out += text.slice(i, m.index) + "\u0002" + text.slice(m.index, end) + "\u0003";
      i = end;
    }
    return out + text.slice(i);
  };
  return all
    .map((n) => {
      const body = n.text.replace(/^---\n[\s\S]*?\n---\n?/, "");
      const hay = fold(`${n.title}\n${body}`);
      if (!tests.every((t) => t.test(hay))) return null;
      const score = tests.filter((t) => t.test(fold(n.title))).length;
      const at = Math.max(0, tests.map((t) => fold(body).search(t)).filter((x) => x >= 0).sort((a, b) => a - b)[0] ?? 0);
      const start = Math.max(0, at - 40);
      const snip = body.slice(start, start + 120).replace(/\s+/g, " ").trim();
      return {
        score,
        hit: { notebook: n.notebook, file: n.file, title: mark(n.title), snippet: (start ? "…" : "") + mark(snip) + "…" },
      };
    })
    .filter((x): x is { score: number; hit: SearchHit } => !!x)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.hit)
    .slice(0, 40);
}
