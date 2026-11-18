// The web build's vault (the companion): the files the app syncs, read from
// the vault repo through the companion's Worker, with the same rules as the
// Rust vault (src-tauri/src/vault.rs). Edits apply here at once and go up as
// one signed commit per sync, so the desktop's sync UI (Synced 2m ago, Sync
// now, sync after a quiet moment and when the tab hides) works unchanged.
import { parse, stringify } from "yaml";
import type { NoteMeta, NoteText, Notebook, NotebookMeta, Paper, SearchHit, SyncInfo, SyncReport, VaultStore } from "./store.ts";
import { noteTitle, previewSearch, slugify } from "./store.ts";

interface FileEntry {
  path: string;
  text: string;
  sha: string;
}
interface Snapshot {
  repo: string;
  branch: string;
  head: string;
  files: FileEntry[];
}

const PAPERS = ["graph", "ruled", "dot", "blank"];
const MAX_ART = 2 * 1024 * 1024;
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const now = () => Math.floor(Date.now() / 1000);
const nbPath = (id: string, name: string) => `notebooks/${id}/${name}`;

/** A single path segment, as vault.rs's check_segment. */
function checkSegment(name: string) {
  if (!name || name.length > 200 || name.startsWith(".") || /[/\\\0]/.test(name)) throw new Error(`invalid name: ${name}`);
}

/** notebook.yml, with the Rust defaults; unknown keys are kept. */
export function parseMeta(text: string | undefined, id: string): NotebookMeta {
  const base: NotebookMeta = {
    title: noteTitle("", `${id}.md`),
    edition: parseInt(id, 10) || 0,
    color: "kraft",
    cover: "kraft-classic",
    paper: "graph",
    started: "",
    stickers: [],
  };
  if (text === undefined) return base;
  let y: Record<string, unknown> = {};
  try {
    y = (parse(text) as Record<string, unknown>) ?? {};
  } catch {
    return base;
  }
  return {
    ...y,
    title: String(y.title ?? base.title),
    edition: Number(y.edition ?? 0) || 0,
    color: String(y.color ?? "kraft"),
    cover: String(y.cover ?? "kraft-classic"),
    paper: (PAPERS.includes(String(y.paper)) ? y.paper : "graph") as Paper,
    started: String(y.started ?? ""),
    stickers: Array.isArray(y.stickers) ? y.stickers : [],
  };
}

/** notebook.yml in the field order serde writes, empty repo keys left out. */
export function writeMeta(meta: NotebookMeta): string {
  const { title, edition, color, cover, paper, started, stickers, repo, repo_branch, repo_path, ...extra } = meta;
  const out: Record<string, unknown> = { title, edition, color, cover, paper, started, stickers };
  if (repo) out.repo = repo;
  if (repo_branch) out.repo_branch = repo_branch;
  if (repo_path) out.repo_path = repo_path;
  return stringify({ ...out, ...extra });
}

export function writeShelf(order: string[]): string {
  order.forEach(checkSegment);
  return `# Cairn shelf: the order notebooks sit in the sidebar (drag to change).\norder:\n${order.map((id) => `  - "${id}"\n`).join("")}`;
}

export function writeBadges(earned: Record<string, string>): string {
  const ids = Object.keys(earned).sort();
  ids.forEach(checkSegment);
  return `# Cairn merit badges: earned from what's in this vault.\nearned:\n${ids
    .map((id) => `  ${id}: "${earned[id].replace(/["\\\n]/g, "")}"\n`)
    .join("")}`;
}

function readList(text: string | undefined, key: string): unknown {
  if (!text) return undefined;
  try {
    return (parse(text) as Record<string, unknown>)?.[key];
  } catch {
    return undefined;
  }
}

/** Seconds since epoch for a note: edited here, else its file date. */
function fileDate(file: string): number {
  const m = file.match(/^(\d{4}-\d{2}-\d{2})-/);
  const t = m ? Date.parse(`${m[1]}T12:00:00`) : NaN;
  return Number.isNaN(t) ? 0 : Math.floor(t / 1000);
}

/** Fired on window when an edit is waiting to sync. */
export const WEB_CHANGED = "cairn:changed";

class AccessExpired extends Error {
  constructor() {
    super("Your Cloudflare Access session expired. Reload the page to sign in again.");
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(path, { credentials: "same-origin", cache: "no-store", ...init });
  } catch {
    // Access answers an expired session with a cross-origin redirect.
    throw new AccessExpired();
  }
  if (r.redirected && !new URL(r.url).pathname.startsWith("/api/")) throw new AccessExpired();
  const out = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(out.error ?? `${r.status}`);
  return out;
}

export function webStore(): VaultStore {
  let repo = "";
  let branch = "main";
  let head = "";
  let lastSync: string | null = null;
  /** What's here now. */
  const files = new Map<string, string>();
  /** The blob sha each file had on GitHub at the last snapshot. */
  const base = new Map<string, string>();
  /** Edits not sent yet: new text, or null for a delete. */
  const dirty = new Map<string, string | null>();
  const mtime = new Map<string, number>();
  let loaded: Promise<void> | null = null;

  // Tell the app something waits to sync (it schedules a sync, as after
  // saving a note), whatever changed: a cover, the shelf order, a sticker.
  let signalled = false;
  const changed = () => {
    if (signalled) return;
    signalled = true;
    queueMicrotask(() => {
      signalled = false;
      window.dispatchEvent(new Event(WEB_CHANGED));
    });
  };
  const put = (path: string, text: string) => {
    files.set(path, text);
    dirty.set(path, text);
    mtime.set(path, now());
    changed();
  };
  const del = (path: string) => {
    if (!files.has(path) && !base.has(path)) return;
    files.delete(path);
    if (base.has(path)) dirty.set(path, null);
    else dirty.delete(path);
    changed();
  };

  function apply(s: Snapshot) {
    repo = s.repo;
    branch = s.branch;
    head = s.head;
    const seen = new Set<string>();
    for (const f of s.files) {
      seen.add(f.path);
      base.set(f.path, f.sha);
      if (!dirty.has(f.path)) files.set(f.path, f.text);
    }
    for (const p of [...base.keys()]) {
      if (seen.has(p)) continue;
      base.delete(p);
      if (!dirty.has(p)) files.delete(p);
    }
    lastSync = new Date().toISOString();
  }

  const load = () => (loaded ??= api<Snapshot>("/api/files").then(apply));

  const ids = () => {
    const out = new Set<string>();
    for (const p of files.keys()) {
      const m = p.match(/^notebooks\/([^/]+)\//);
      if (m) out.add(m[1]);
    }
    return [...out].sort();
  };
  const notesOf = (id: string) =>
    [...files.keys()].filter((p) => p.startsWith(`notebooks/${id}/`) && p.endsWith(".md")).map((p) => p.slice(`notebooks/${id}/`.length));
  const metaOf = (id: string) => parseMeta(files.get(nbPath(id, "notebook.yml")), id);
  const exists = (id: string) => ids().includes(id);
  const need = (id: string) => {
    if (!exists(id)) throw new Error(`not found: ${id}`);
  };
  const shelf = () => {
    const o = readList(files.get("shelf.yml"), "order");
    return Array.isArray(o) ? o.map(String) : [];
  };
  const svg = (path: string) => {
    const t = files.get(path);
    return t !== undefined && t.length <= MAX_ART ? t : null;
  };
  /** `<file>.svg` in the notebook folder, `lib:<name>` in covers/, else built in. */
  const artPath = (id: string, ref: string) => {
    if (ref.startsWith("lib:")) {
      checkSegment(ref.slice(4));
      return `covers/${ref.slice(4)}.svg`;
    }
    if (ref.endsWith(".svg")) {
      checkSegment(ref);
      return nbPath(id, ref);
    }
    return null;
  };

  const store: VaultStore = {
    kind: "web",
    async getVault() {
      await load();
      return repo;
    },
    pickVault: async () => repo || null,
    async listNotebooks() {
      await load();
      const order = shelf();
      const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : Infinity);
      return ids()
        .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
        .map((id): Notebook => ({ id, meta: metaOf(id), note_count: notesOf(id).length }));
    },
    async setShelfOrder(order) {
      await load();
      put("shelf.yml", writeShelf(order));
    },
    async createNotebook(title, color, paper) {
      await load();
      title = title.trim();
      if (!title) throw new Error("invalid name: ");
      const next = Math.max(0, ...ids().map((id) => parseInt(id.split("-")[0], 10) || 0)) + 1;
      const id = `${String(next).padStart(4, "0")}-${slugify(title)}`;
      const meta: NotebookMeta = {
        title, edition: next, color: color || "kraft", cover: "kraft-classic",
        paper: PAPERS.includes(paper) ? paper : "graph", started: today(), stickers: [],
      };
      put(nbPath(id, "notebook.yml"), writeMeta(meta));
      return { id, meta, note_count: 0 };
    },
    async updateNotebook(id, meta) {
      await load();
      need(id);
      put(nbPath(id, "notebook.yml"), writeMeta(meta));
    },
    async listNotes(id) {
      await load();
      need(id);
      return notesOf(id)
        .map((file): NoteMeta => {
          const p = nbPath(id, file);
          return { file, title: noteTitle(files.get(p) ?? "", file), modified: mtime.get(p) ?? fileDate(file) };
        })
        .sort((a, b) => b.file.localeCompare(a.file));
    },
    async readNote(id, file) {
      await load();
      const t = files.get(nbPath(id, file));
      if (t === undefined) throw new Error(`not found: ${file}`);
      return t;
    },
    async writeNote(id, file, contents) {
      await load();
      checkSegment(file);
      if (!file.endsWith(".md")) throw new Error(`invalid name: ${file}`);
      need(id);
      if (files.get(nbPath(id, file)) !== contents) put(nbPath(id, file), contents);
    },
    async createNote(id, title) {
      await load();
      need(id);
      title = title.trim() || "Untitled";
      const b = `${today()}-${slugify(title)}`;
      let file = `${b}.md`;
      for (let n = 2; files.has(nbPath(id, file)); n++) file = `${b}-${n}.md`;
      put(nbPath(id, file), `---\ntitle: "${title.replace(/"/g, "'")}"\ntags: []\nstickers: []\n---\n\n# ${title}\n\n`);
      return { file, title, modified: now() };
    },
    async trashNote(id, file) {
      await load();
      const p = nbPath(id, file);
      if (!files.has(p)) throw new Error(`not found: ${file}`);
      // GitHub's history keeps it; the Mac's next sync moves its copy to .trash/.
      del(p);
    },
    async trashNotebook(id) {
      await load();
      need(id);
      for (const p of [...files.keys()]) if (p.startsWith(`notebooks/${id}/`)) del(p);
      const order = shelf();
      if (order.includes(id)) put("shelf.yml", writeShelf(order.filter((o) => o !== id)));
    },
    async linkNotebookRepo() {
      throw new Error("Linking a notebook to its own repo is done in the Mac app.");
    },
    async allNotes() {
      await load();
      return [...files.entries()]
        .flatMap(([p, text]): NoteText[] => {
          const m = p.match(/^notebooks\/([^/]+)\/([^/]+\.md)$/);
          return m ? [{ notebook: m[1], file: m[2], title: noteTitle(text, m[2]), text }] : [];
        })
        .sort((a, b) => a.notebook.localeCompare(b.notebook) || b.file.localeCompare(a.file));
    },
    async readBadges() {
      await load();
      const e = readList(files.get("badges.yml"), "earned");
      return e && typeof e === "object" ? Object.fromEntries(Object.entries(e).map(([k, v]) => [k, String(v)])) : {};
    },
    async writeBadges(earned) {
      await load();
      const text = writeBadges(earned);
      if (files.get("badges.yml") !== text) put("badges.yml", text);
    },
    async listStickers() {
      await load();
      return [...files.keys()]
        .filter((p) => /^stickers\/[^/]+\.svg$/.test(p))
        .map((p): [string, string] | null => {
          const t = svg(p);
          return t ? [p.slice(9, -4), t] : null;
        })
        .filter((x): x is [string, string] => !!x)
        .sort((a, b) => a[0].localeCompare(b[0]));
    },
    async search(query): Promise<SearchHit[]> {
      return previewSearch(query, await store.allNotes());
    },
    async readCover(id) {
      await load();
      const p = artPath(id, metaOf(id).cover);
      return p ? svg(p) : null;
    },
    async readButton(id) {
      await load();
      const meta = metaOf(id);
      const b = typeof meta.button === "string" ? artPath(id, meta.button) : null;
      if (b) return svg(b);
      if (meta.cover.startsWith("lib:")) return svg(`covers/${meta.cover.slice(4)}.button.svg`);
      return null;
    },
    async listLibrary() {
      await load();
      return [...files.keys()]
        .filter((p) => /^covers\/[^/]+\.svg$/.test(p) && !p.endsWith(".button.svg"))
        .map((p) => p.slice(7, -4))
        .sort();
    },
    async readLibrary(name) {
      await load();
      checkSegment(name);
      return svg(`covers/${name}.svg`);
    },
    async saveToLibrary(id, name) {
      await load();
      const cover = await store.readCover(id);
      if (!cover) throw new Error("not found: custom cover");
      const button = await store.readButton(id);
      const b = slugify(name);
      let slug = b;
      for (let n = 2; files.has(`covers/${slug}.svg`); n++) slug = `${b}-${n}`;
      put(`covers/${slug}.svg`, cover);
      if (button) put(`covers/${slug}.button.svg`, button);
      return slug;
    },
    async getSync(): Promise<SyncInfo> {
      await load();
      return {
        settings: { enabled: true, repo, branch, token_source: "gh" },
        mirror: false, gh_available: false, keychain_has_token: false,
        vault_in_icloud: true, icloud_available: false, last_sync: lastSync,
      };
    },
    setSync: async () => {},
    setToken: async () => {},
    checkVaultRepo: async () => ({ exists: true, login: "" }),
    createVaultRepo: async () => {
      throw new Error("Creating a vault repo is done in the Mac app.");
    },
    mirrorNow: async () => null,
    async syncNow(dryRun): Promise<SyncReport> {
      await load();
      const report: SyncReport = {
        dry_run: dryRun, first_link: false, pushed: [], pulled: [], deleted_remote: [], deleted_local: [],
        conflicts: [], skipped: [], head, at: new Date().toISOString(),
      };
      const sent = new Map(dirty);
      for (const [p, t] of sent) (t === null ? report.deleted_remote : report.pushed).push(p);
      if (dryRun) return report;
      if (sent.size) {
        const body = JSON.stringify({
          changes: [...sent].map(([path, text]) => ({ path, text, base: base.get(path) ?? null })),
        });
        const r = await api<{ head: string; conflicts: string[] }>("/api/commit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          // Let a sync started as the tab hides finish (small batches only).
          keepalive: body.length < 60_000,
        });
        report.conflicts = r.conflicts;
        // Edits made while this was in flight stay queued.
        for (const [p, t] of sent) if (dirty.get(p) === t) dirty.delete(p);
      }
      const before = new Map(base);
      const snap = await api<Snapshot | { head: string; unchanged: true }>(`/api/files?have=${encodeURIComponent(sent.size ? "" : head)}`);
      if (!("unchanged" in snap)) {
        apply(snap);
        for (const [p, sha] of base) if (before.get(p) !== sha && !sent.has(p)) report.pulled.push(p);
        for (const p of before.keys()) if (!base.has(p) && !sent.has(p)) report.deleted_local.push(p);
      } else {
        lastSync = new Date().toISOString();
      }
      report.head = head;
      return report;
    },
  };
  return store;
}
