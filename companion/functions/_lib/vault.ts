// The vault, read from its GitHub repo: one tarball per commit (cached), so
// any number of notes costs a single outbound request. Quick capture adds a
// note with one signed commit, as the app's sync does.

export interface VaultEnv {
  GITHUB_TOKEN: string;
  /** owner/name, e.g. you/cairn-vault */
  VAULT_REPO: string;
  VAULT_BRANCH?: string;
}

export interface Note {
  notebook: string;
  file: string;
  title: string;
  text: string;
}
export interface NotebookInfo {
  id: string;
  title: string;
  color: string;
  edition: number;
}
export interface VaultData {
  head: string;
  notebooks: NotebookInfo[];
  notes: Note[];
}

const gh = (env: VaultEnv, path: string, init: RequestInit = {}) =>
  fetch(`https://api.github.com/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "cairn-companion",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {}),
    },
  });

const branch = (env: VaultEnv) => env.VAULT_BRANCH || "main";

export async function headCommit(env: VaultEnv): Promise<string> {
  const r = await gh(env, `repos/${env.VAULT_REPO}/git/ref/heads/${branch(env)}`);
  if (!r.ok) throw new Error(`GitHub: ${r.status} reading ${env.VAULT_REPO}@${branch(env)}`);
  return ((await r.json()) as { object: { sha: string } }).object.sha;
}

/** Files in a .tar (GitHub's tarballs: ustar + pax headers). */
export function untar(buf: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const dec = new TextDecoder();
  const str = (o: number, n: number) => dec.decode(buf.subarray(o, o + n)).replace(/\0[\s\S]*$/, "");
  let off = 0;
  let paxPath: string | null = null;
  while (off + 512 <= buf.length) {
    const name = str(off, 100);
    if (!name) break; // two empty blocks end the archive
    const size = parseInt(str(off + 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(buf[off + 156] || 48);
    const prefix = str(off + 345, 155);
    const body = buf.subarray(off + 512, off + 512 + size);
    if (type === "x") {
      // pax extended header: "len key=value\n" records
      for (const rec of dec.decode(body).split("\n")) {
        const m = rec.match(/^\d+ path=(.*)$/);
        if (m) paxPath = m[1];
      }
    } else if (type === "0" || type === "\0") {
      out.set(paxPath ?? (prefix ? `${prefix}/${name}` : name), body);
      paxPath = null;
    } else if (type !== "g") {
      paxPath = null;
    }
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

/** Same rule as the app: frontmatter title, first # heading, file name. */
export function noteTitle(text: string, file: string): string {
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  const t = fm?.[1].match(/^title:[ \t]*(.+)$/m)?.[1].trim().replace(/^["']|["']$/g, "");
  if (t) return t;
  const h = text.replace(/^---\n[\s\S]*?\n---\n?/, "").match(/^# (.+)$/m)?.[1].trim();
  if (h) return h;
  return file.replace(/\.md$/, "").replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/-/g, " ");
}

function yamlValue(yml: string, key: string): string | null {
  const m = yml.match(new RegExp(`^${key}:[ \\t]*(.+?)[ \\t]*(#.*)?$`, "m"));
  return m ? m[1].replace(/^["']|["']$/g, "") : null;
}

export function parseVault(head: string, files: Map<string, Uint8Array>): VaultData {
  const dec = new TextDecoder();
  const notebooks: NotebookInfo[] = [];
  const notes: Note[] = [];
  for (const [full, bytes] of files) {
    // Tarball entries are prefixed with "<owner>-<repo>-<sha>/".
    const path = full.replace(/^[^/]+\//, "");
    const m = path.match(/^notebooks\/(\d{4}-[a-z0-9-]+)\/([^/]+)$/);
    if (!m) continue;
    const [, id, name] = m;
    if (name === "notebook.yml") {
      const y = dec.decode(bytes);
      notebooks.push({
        id,
        title: yamlValue(y, "title") ?? id,
        color: yamlValue(y, "color") ?? "kraft",
        edition: Number(yamlValue(y, "edition") ?? parseInt(id, 10)) || 0,
      });
    } else if (/^\d{4}-\d{2}-\d{2}-[^/]+\.md$/.test(name)) {
      const text = dec.decode(bytes);
      notes.push({ notebook: id, file: name, title: noteTitle(text, name), text });
    }
  }
  notebooks.sort((a, b) => a.id.localeCompare(b.id));
  notes.sort((a, b) => a.notebook.localeCompare(b.notebook) || b.file.localeCompare(a.file));
  return { head, notebooks, notes };
}

export async function readVault(env: VaultEnv, cache?: Cache): Promise<VaultData> {
  const head = await headCommit(env);
  const key = new Request(`https://cairn-companion.cache/vault/${env.VAULT_REPO}/${head}`);
  const hit = await cache?.match(key);
  if (hit) return (await hit.json()) as VaultData;
  const r = await gh(env, `repos/${env.VAULT_REPO}/tarball/${head}`);
  if (!r.ok || !r.body) throw new Error(`GitHub: ${r.status} downloading the vault`);
  const tar = new Uint8Array(await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
  const data = parseVault(head, untar(tar));
  await cache?.put(key, new Response(JSON.stringify(data), { headers: { "Cache-Control": "max-age=86400" } }));
  return data;
}

export function slugify(s: string): string {
  const out = s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
  return out || "untitled";
}

function b64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** A new note, as the app writes them. */
export function captureText(title: string, body: string): string {
  const safe = title.replace(/"/g, "'");
  return `---\ntitle: "${safe}"\ntags: []\nstickers: []\npublish: false\n---\n\n# ${title}\n\n${body.trim() ? `${body.trim()}\n` : ""}`;
}

/** Add a note to a notebook with one signed commit. Returns its path. */
export async function capture(env: VaultEnv, notebook: string, title: string, body: string, today: string): Promise<string> {
  if (!/^\d{4}-[a-z0-9-]+$/.test(notebook)) throw new Error("bad notebook");
  title = title.trim().slice(0, 200);
  if (!title) throw new Error("a title is needed");
  const head = await headCommit(env);
  const tree = await gh(env, `repos/${env.VAULT_REPO}/git/trees/${head}?recursive=1`);
  if (!tree.ok) throw new Error(`GitHub: ${tree.status} listing the vault`);
  const paths = new Set(((await tree.json()) as { tree: { path: string }[] }).tree.map((e) => e.path));
  if (!paths.has(`notebooks/${notebook}/notebook.yml`)) throw new Error("no such notebook");
  const base = `notebooks/${notebook}/${today}-${slugify(title)}`;
  let path = `${base}.md`;
  for (let n = 2; paths.has(path); n++) path = `${base}-${n}.md`;
  const res = await gh(env, "graphql", {
    method: "POST",
    body: JSON.stringify({
      query: "mutation($i:CreateCommitOnBranchInput!){createCommitOnBranch(input:$i){commit{oid}}}",
      variables: {
        i: {
          branch: { repositoryNameWithOwner: env.VAULT_REPO, branchName: branch(env) },
          expectedHeadOid: head,
          message: { headline: `capture: ${title} (from the companion)` },
          fileChanges: { additions: [{ path, contents: b64(captureText(title, body)) }] },
        },
      },
    }),
  });
  const v = (await res.json()) as { errors?: unknown };
  if (v.errors) throw new Error(`GitHub: ${JSON.stringify(v.errors).slice(0, 200)}`);
  return path;
}
