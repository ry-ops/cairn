// The vault as files, for the web build of the app: every file the desktop
// app syncs (see is_synced in src-tauri/src/sync.rs), with its git blob sha,
// and one signed commit for a batch of edits made in the browser.
import { type VaultEnv, gh, headCommit, untar } from "./vault.ts";

/** Same rule as the app's sync (`is_synced`): what lives in the vault repo. */
export function isSynced(rel: string): boolean {
  const parts = rel.split("/");
  const plain = (n: string) => n.length > 0 && n.length <= 200 && !n.startsWith(".");
  const art = (n: string) => plain(n) && n.endsWith(".svg") && !n.includes(".conflict-");
  if (parts.length === 1) return rel === "shelf.yml" || rel === "badges.yml";
  if (parts.length === 2) return (parts[0] === "stickers" || parts[0] === "covers") && art(parts[1]);
  if (parts.length === 3 && parts[0] === "notebooks") {
    const [, nb, name] = parts;
    return plain(nb) && plain(name) && (name.endsWith(".md") || name === "notebook.yml" || art(name));
  }
  return false;
}

/** Git's blob id for some bytes (what GitHub's tree API reports). */
export async function blobSha(bytes: Uint8Array): Promise<string> {
  const head = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(head.length + bytes.length);
  all.set(head);
  all.set(bytes, head.length);
  const d = new Uint8Array(await crypto.subtle.digest("SHA-1", all));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface VaultFile {
  path: string;
  text: string;
  sha: string;
}
export interface Snapshot {
  repo: string;
  branch: string;
  head: string;
  files: VaultFile[];
}

/** Art over 2 MB is skipped, as the app does. */
const MAX_FILE = 2 * 1024 * 1024;

export async function snapshotFrom(files: Map<string, Uint8Array>): Promise<VaultFile[]> {
  const dec = new TextDecoder();
  const out: VaultFile[] = [];
  for (const [full, bytes] of files) {
    // Tarball entries are prefixed with "<owner>-<repo>-<sha>/".
    const path = full.replace(/^[^/]+\//, "");
    if (!isSynced(path) || bytes.length > MAX_FILE) continue;
    out.push({ path, text: dec.decode(bytes), sha: await blobSha(bytes) });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

const branchOf = (env: VaultEnv) => env.VAULT_BRANCH || "main";

/** Every synced file at the branch head: one tarball per commit, cached. */
export async function readSnapshot(env: VaultEnv, cache?: Cache, have?: string): Promise<Snapshot | { head: string; unchanged: true }> {
  const head = await headCommit(env);
  if (have && have === head) return { head, unchanged: true };
  const key = new Request(`https://cairn-companion.cache/files/${env.VAULT_REPO}/${head}`);
  const hit = await cache?.match(key);
  if (hit) return (await hit.json()) as Snapshot;
  const r = await gh(env, `repos/${env.VAULT_REPO}/tarball/${head}`);
  if (!r.ok || !r.body) throw new Error(`GitHub: ${r.status} downloading the vault`);
  const tar = new Uint8Array(await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
  const snap: Snapshot = { repo: env.VAULT_REPO, branch: branchOf(env), head, files: await snapshotFrom(untar(tar)) };
  await cache?.put(key, new Response(JSON.stringify(snap), { headers: { "Cache-Control": "max-age=86400" } }));
  return snap;
}

/** One edit from the browser: new contents (null: delete), and the blob sha
 *  it was based on (null: a new file). */
export interface Change {
  path: string;
  text: string | null;
  base: string | null;
}

/** `notes.md` → `notes.conflict-<stamp>.md`, as the app names them. */
export function conflictPath(path: string, stamp: string): string {
  const i = path.lastIndexOf(".");
  return i > path.lastIndexOf("/") ? `${path.slice(0, i)}.conflict-${stamp}${path.slice(i)}` : `${path}.conflict-${stamp}`;
}

export function checkChanges(changes: unknown): Change[] {
  if (!Array.isArray(changes) || changes.length === 0 || changes.length > 500) throw new Error("bad changes");
  let total = 0;
  const seen = new Set<string>();
  return changes.map((c) => {
    const { path, text, base } = (c ?? {}) as Record<string, unknown>;
    if (typeof path !== "string" || !isSynced(path) || seen.has(path)) throw new Error(`bad path: ${String(path).slice(0, 80)}`);
    if (text !== null && typeof text !== "string") throw new Error("bad text");
    if (base !== null && !(typeof base === "string" && /^[0-9a-f]{40}$/.test(base))) throw new Error("bad base");
    total += text?.length ?? 0;
    if ((text?.length ?? 0) > MAX_FILE || total > 8 * MAX_FILE) throw new Error("too large");
    seen.add(path);
    return { path, text: text as string | null, base: base as string | null };
  });
}

const b64 = (bytes: Uint8Array) => {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

export interface Plan {
  additions: { path: string; contents: string }[];
  deletions: { path: string }[];
  /** Notes changed here and elsewhere: ours is kept, theirs saved beside it. */
  conflicts: { path: string; copy: string; sha: string }[];
}

/** What to commit, given what's on GitHub now. The app's rules: a file
 *  changed elsewhere since you loaded it keeps your version; for a note,
 *  theirs is saved beside it as a conflict copy. A delete of something
 *  changed elsewhere is dropped (the edit wins). Pure but for hashing. */
export async function planCommit(changes: Change[], remote: Map<string, string>, stamp: string): Promise<Plan> {
  const enc = new TextEncoder();
  const plan: Plan = { additions: [], deletions: [], conflicts: [] };
  for (const c of changes) {
    const cur = remote.get(c.path) ?? null;
    const bytes = c.text === null ? null : enc.encode(c.text);
    const mine = bytes ? await blobSha(bytes) : null;
    if (cur === mine) continue; // already there
    const movedOn = cur !== c.base;
    if (bytes === null) {
      if (cur !== null && !movedOn) plan.deletions.push({ path: c.path });
      continue;
    }
    plan.additions.push({ path: c.path, contents: b64(bytes) });
    if (movedOn && cur !== null && c.path.endsWith(".md")) {
      plan.conflicts.push({ path: c.path, copy: conflictPath(c.path, stamp), sha: cur });
    }
  }
  return plan;
}

/** Commit a batch of edits as one signed commit. Returns the new head and
 *  the notes that conflicted. */
export async function commitChanges(env: VaultEnv, changes: Change[], now = new Date()): Promise<{ head: string; conflicts: string[] }> {
  const head = await headCommit(env);
  const t = await gh(env, `repos/${env.VAULT_REPO}/git/trees/${head}?recursive=1`);
  if (!t.ok) throw new Error(`GitHub: ${t.status} listing the vault`);
  const tree = (await t.json()) as { tree: { path: string; sha: string; type: string }[]; truncated?: boolean };
  if (tree.truncated) throw new Error("the vault repo is too large to list");
  const remote = new Map(tree.tree.filter((e) => e.type === "blob").map((e) => [e.path, e.sha]));
  const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const plan = await planCommit(changes, remote, stamp);
  for (const c of plan.conflicts) {
    const r = await gh(env, `repos/${env.VAULT_REPO}/git/blobs/${c.sha}`);
    if (!r.ok) throw new Error(`GitHub: ${r.status} reading ${c.path}`);
    const blob = (await r.json()) as { content: string };
    plan.additions.push({ path: c.copy, contents: blob.content.replace(/\s/g, "") });
  }
  if (!plan.additions.length && !plan.deletions.length) return { head, conflicts: [] };
  const n = plan.additions.length + plan.deletions.length;
  const res = await gh(env, "graphql", {
    method: "POST",
    body: JSON.stringify({
      query: "mutation($i:CreateCommitOnBranchInput!){createCommitOnBranch(input:$i){commit{oid}}}",
      variables: {
        i: {
          branch: { repositoryNameWithOwner: env.VAULT_REPO, branchName: branchOf(env) },
          expectedHeadOid: head,
          message: { headline: `cairn: sync ${n} file${n === 1 ? "" : "s"} (from the web)` },
          fileChanges: { additions: plan.additions, deletions: plan.deletions },
        },
      },
    }),
  });
  const v = (await res.json()) as { data?: { createCommitOnBranch?: { commit?: { oid: string } } }; errors?: unknown };
  const oid = v.data?.createCommitOnBranch?.commit?.oid;
  if (v.errors || !oid) throw new Error(`GitHub: ${JSON.stringify(v.errors ?? v).slice(0, 200)}`);
  return { head: oid, conflicts: plan.conflicts.map((c) => c.path) };
}
