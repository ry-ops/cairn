// The web build's store, against a fake companion API. Run: pnpm test:web
// (plain Node, no browser).
export {};
(globalThis as { window?: unknown }).window = globalThis;
const { webStore, parseMeta, writeMeta, writeShelf, writeBadges, WEB_CHANGED } = await import("./webstore.ts");

let failed = 0;
const eq = (a: unknown, b: unknown, m: string) => {
  const A = JSON.stringify(a);
  const B = JSON.stringify(b);
  if (A === B) console.log("ok  ", m);
  else {
    failed++;
    console.log("FAIL", m, A, "!=", B);
  }
};

// ---- notebook.yml and friends, as vault.rs writes them ----
const meta = parseMeta("title: DriveIQ\nedition: 1\ncolor: lake\ncover: monoprint/winter\npaper: dot\nstarted: 2026-11-15\nstickers: []\npin:\n  rot: -22.6\nruling: '#7c94b0'\n", "0001-driveiq");
eq([meta.title, meta.edition, meta.color, meta.paper, (meta.pin as { rot: number }).rot], ["DriveIQ", 1, "lake", "dot", -22.6], "notebook.yml parses, unknown keys kept");
eq(writeMeta({ ...meta, cover: "watercolor" }).split("\n").slice(0, 8), ["title: DriveIQ", "edition: 1", "color: lake", "cover: watercolor", "paper: dot", "started: 2026-11-15", "stickers: []", "pin:"], "…and writes back in serde's field order");
eq(parseMeta(undefined, "0003-trail-log").edition, 3, "a bare folder is still a notebook");
eq(parseMeta("paper: lined\n", "0004-x").paper, "graph", "an unknown paper falls back to graph");
eq(writeShelf(["0002-b", "0001-a"]), '# Cairn shelf: the order notebooks sit in the sidebar (drag to change).\norder:\n  - "0002-b"\n  - "0001-a"\n', "shelf.yml as the app writes it");
eq(writeBadges({ trailhead: "2026-11-15", "first-cairn": '2026"11' }).split("\n").slice(2, 4), ['  first-cairn: "202611"', '  trailhead: "2026-11-15"'], "badges.yml sorted, quotes stripped");

// ---- a vault behind a fake /api ----
const sha = (n: number) => String(n).padStart(40, "0");
let remote: { path: string; text: string; sha: string }[] = [
  { path: "shelf.yml", text: writeShelf(["0002-cairn"]), sha: sha(1) },
  { path: "notebooks/0001-driveiq/notebook.yml", text: "title: DriveIQ\nedition: 1\ncover: lib:dusk\n", sha: sha(2) },
  { path: "notebooks/0001-driveiq/2026-11-15-roadmap.md", text: "# Roadmap\n", sha: sha(3) },
  { path: "notebooks/0002-cairn/notebook.yml", text: "title: CAIRN\nedition: 2\n", sha: sha(4) },
  { path: "covers/dusk.svg", text: "<svg id='dusk'/>", sha: sha(5) },
  { path: "stickers/heron.svg", text: "<svg id='heron'/>", sha: sha(6) },
];
let head = "h1";
const commits: { changes: { path: string; text: string | null; base: string | null }[] }[] = [];
let changedEvents = 0;
(globalThis as { addEventListener?: unknown }).addEventListener ??= () => {};
const realDispatch = (globalThis as { dispatchEvent?: (e: Event) => boolean }).dispatchEvent;
(globalThis as { dispatchEvent: (e: Event) => boolean }).dispatchEvent = (e: Event) => {
  if (e.type === WEB_CHANGED) changedEvents++;
  return realDispatch?.call(globalThis, e) ?? true;
};
globalThis.fetch = (async (url: string, init?: RequestInit) => {
  const u = new URL(url, "https://notes.example.com");
  if (u.pathname === "/api/files") {
    const body = u.searchParams.get("have") === head ? { head, unchanged: true } : { repo: "you/vault", branch: "main", head, files: remote };
    return new Response(JSON.stringify(body), { status: 200 });
  }
  if (u.pathname === "/api/commit") {
    const b = JSON.parse(String(init?.body));
    commits.push(b);
    for (const c of b.changes) {
      remote = remote.filter((f) => f.path !== c.path);
      if (c.text !== null) remote.push({ path: c.path, text: c.text, sha: sha(100 + commits.length) });
    }
    head = `h${commits.length + 1}`;
    return new Response(JSON.stringify({ head, conflicts: [] }), { status: 200 });
  }
  return new Response("{}", { status: 404 });
}) as typeof fetch;

const s = webStore();
eq(s.kind, "web", "kind is web");
eq(await s.getVault(), "you/vault", "the vault is the repo");
eq((await s.listNotebooks()).map((n) => [n.id, n.note_count]), [["0002-cairn", 0], ["0001-driveiq", 1]], "shelf.yml order first, then by number");
eq(await s.readCover("0001-driveiq"), "<svg id='dusk'/>", "lib: covers come from covers/");
eq(await s.listLibrary(), ["dusk"], "the cover library");
eq((await s.listStickers()).map(([n]) => n), ["heron"], "your stickers");
eq((await s.getSync()).settings.enabled, true, "sync is on: the vault is the repo");

const n = await s.createNote("0001-driveiq", 'Ridge "loop"');
eq(n.file.endsWith("-ridge-loop.md"), true, "a new note is named like the app's");
await s.writeNote("0001-driveiq", n.file, `${await s.readNote("0001-driveiq", n.file)}Switchbacks.\n`);
await s.trashNote("0001-driveiq", "2026-11-15-roadmap.md");
const nb = await s.createNotebook("Trail Log", "pine", "ruled");
eq(nb.id, "0003-trail-log", "a new notebook takes the next number");
await new Promise((r) => setTimeout(r, 0));
eq(changedEvents > 0, true, "edits tell the app a sync is due");

const dry = await s.syncNow(true);
eq([dry.pushed.length, dry.deleted_remote], [2, ["notebooks/0001-driveiq/2026-11-15-roadmap.md"]], "a dry run lists what would go up");
eq(commits.length, 0, "…and sends nothing");

const r = await s.syncNow(false);
eq(commits.length, 1, "one commit per sync");
const sent = Object.fromEntries(commits[0].changes.map((c) => [c.path, c]));
eq(sent["notebooks/0001-driveiq/2026-11-15-roadmap.md"], { path: "notebooks/0001-driveiq/2026-11-15-roadmap.md", text: null, base: sha(3) }, "a trashed note is a delete, based on what was loaded");
eq(sent[`notebooks/0001-driveiq/${n.file}`].base, null, "a new note has no base");
eq(sent[`notebooks/0001-driveiq/${n.file}`].text?.endsWith("Switchbacks.\n"), true, "the latest text goes up");
eq(r.pulled, [], "nothing came down");

// Changed elsewhere (the Mac): the next sync brings it down.
remote = remote.map((f) => (f.path === "notebooks/0002-cairn/notebook.yml" ? { ...f, text: "title: Cairn\nedition: 2\n", sha: sha(99) } : f));
head = "h-mac";
const r2 = await s.syncNow(false);
eq([commits.length, r2.pulled], [1, ["notebooks/0002-cairn/notebook.yml"]], "a change from elsewhere is pulled, no empty commit");
eq((await s.listNotebooks()).find((b) => b.id === "0002-cairn")?.meta.title, "Cairn", "…and shows");
const r3 = await s.syncNow(false);
eq([commits.length, r3.pulled], [1, []], "nothing new: one cheap check");

await s.trashNotebook("0002-cairn");
await s.syncNow(false);
eq(commits[1].changes.map((c) => [c.path, c.text === null ? "delete" : "write"]).sort(), [
  ["notebooks/0002-cairn/notebook.yml", "delete"],
  ["shelf.yml", "write"],
], "trashing a notebook deletes its files and drops it from the shelf");
await s.linkNotebookRepo("0001-driveiq", null, true).then(
  () => eq(true, false, "linking a repo is refused"),
  (e) => eq(/Mac app/.test(String(e)), true, "linking a repo is left to the Mac app"),
);

if (failed) throw new Error(`${failed} web store test(s) failed`);
