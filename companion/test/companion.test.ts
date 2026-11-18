// Companion server pieces, in plain Node (no deps): pnpm test (or npm test).
import { verifyAccess } from "../src/access.ts";
import { captureText, noteTitle, parseVault, slugify, untar } from "../src/vault.ts";
import { blobSha, checkChanges, conflictPath, isSynced, planCommit, snapshotFrom } from "../src/files.ts";
import { handle } from "../src/worker.ts";

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

// ---- a tiny tar writer for fixtures ----
function header(name: string, size: number, type: string): Uint8Array {
  const h = new Uint8Array(512);
  const put = (s: string, o: number) => h.set(new TextEncoder().encode(s), o);
  put(name, 0);
  put("0000644\0", 100);
  put(size.toString(8).padStart(11, "0") + "\0", 124);
  put(type, 156);
  put("ustar\0", 257);
  put("        ", 148);
  let sum = 0;
  for (const b of h) sum += b;
  put(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  return h;
}
function tar(entries: [string, string, string?][]): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const [name, text, type = "0"] of entries) {
    const body = new TextEncoder().encode(text);
    chunks.push(header(name, body.length, type), body, new Uint8Array((512 - (body.length % 512)) % 512));
  }
  chunks.push(new Uint8Array(1024));
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

const longName = `notebooks/0002-cairn/2026-11-15-${"a".repeat(120)}.md`;
const files = untar(
  tar([
    ["pax_global_header", "52 comment=0123456789abcdef0123456789abcdef01234567\n", "g"],
    ["owner-cairn-vault-0123456/", "", "5"],
    ["owner-cairn-vault-0123456/notebooks/0001-first-cairn/notebook.yml", "title: First Cairn\nedition: 1\ncolor: pine        # token\n"],
    ["owner-cairn-vault-0123456/notebooks/0001-first-cairn/2026-11-15-welcome.md", "---\ntitle: Welcome\n---\n\n# Welcome\n\nSee [[Ridge]].\n"],
    ["owner-cairn-vault-0123456/notebooks/0001-first-cairn/2026-11-16-ridge.md", "# Ridge loop\n\nUp top.\n"],
    ["owner-cairn-vault-0123456/notebooks/0001-first-cairn/cover.svg", "<svg/>"],
    ["PaxHeader", `${String(longName.length + 32 + 9).length + longName.length + 32 + 9 - 2} path=owner-cairn-vault-0123456/${longName}\n`, "x"],
    ["owner-cairn-vault-0123456/truncated-name", "# Long\n"],
    ["owner-cairn-vault-0123456/README.md", "# Vault\n"],
  ]),
);
const v = parseVault("abc", files);
eq(v.notebooks, [{ id: "0001-first-cairn", title: "First Cairn", color: "pine", edition: 1 }], "notebook.yml parsed (comment stripped)");
eq(v.notes.map((n) => [n.notebook, n.file, n.title]), [
  ["0001-first-cairn", "2026-11-16-ridge.md", "Ridge loop"],
  ["0001-first-cairn", "2026-11-15-welcome.md", "Welcome"],
  ["0002-cairn", longName.split("/").pop(), "Long"],
], "notes from tar, newest first; pax long path honored; non-notes skipped");
eq(noteTitle("plain text", "2026-11-15-ridge-loop.md"), "ridge loop", "title falls back to file name");
eq(slugify("  Hello, World!! "), "hello-world", "slugify");
eq(captureText('A "quoted" title', " body \n"), '---\ntitle: "A \'quoted\' title"\ntags: []\nstickers: []\n---\n\n# A "quoted" title\n\nbody\n', "capture template matches the app's");

// ---- Access tokens ----
const kp = (await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
)) as CryptoKeyPair;
const other = (await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
)) as CryptoKeyPair;
const jwk = { ...(await crypto.subtle.exportKey("jwk", kp.publicKey)), kid: "k1" };
const team = "team.cloudflareaccess.com";
const certs = (async () => new Response(JSON.stringify({ keys: [jwk] }))) as typeof fetch;
const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
async function token(claims: object, key = kp.privateKey, kid = "k1") {
  const head = `${enc({ alg: "RS256", kid })}.${enc(claims)}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(head));
  return `${head}.${Buffer.from(sig).toString("base64url")}`;
}
const now = Date.now();
const good = { aud: ["AUD1"], exp: now / 1000 + 600, iss: `https://${team}`, email: "me@example.com" };
const env = { ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: "AUD1", ALLOWED_EMAILS: "Me@Example.com" };
const req = async (claims: object | null, host = "notes.example.com", key?: CryptoKey) =>
  new Request(`https://${host}/api/vault`, { headers: claims ? { "Cf-Access-Jwt-Assertion": await token(claims, key) } : {} });

eq(await verifyAccess(await req(good), env, certs, now), { email: "me@example.com" }, "valid Access token");
eq(await verifyAccess(await req(null), env, certs, now), { error: "not signed in" }, "no token");
eq(await verifyAccess(await req({ ...good, aud: ["OTHER"] }), env, certs, now), { error: "wrong audience" }, "wrong AUD");
eq(await verifyAccess(await req({ ...good, exp: now / 1000 - 5 }), env, certs, now), { error: "expired" }, "expired");
eq(await verifyAccess(await req({ ...good, iss: "https://evil.example" }), env, certs, now), { error: "wrong issuer" }, "wrong issuer");
eq(await verifyAccess(await req(good, undefined, other.privateKey), env, certs, now), { error: "bad signature" }, "signed by another key");
eq(await verifyAccess(await req({ ...good, email: "someone@else.com" }), env, certs, now), { error: "not allowed" }, "email not on the list");
eq(await verifyAccess(await req(null, "localhost"), { ...env, DEV_BYPASS_ACCESS: "1" }, certs, now), { email: "dev@localhost" }, "dev bypass on localhost");
eq(await verifyAccess(await req(null), { ...env, DEV_BYPASS_ACCESS: "1" }, certs, now), { error: "not signed in" }, "dev bypass never applies off localhost");
const forged = `${enc({ alg: "none", kid: "k1" })}.${enc(good)}.`;
eq(await verifyAccess(new Request("https://n/api", { headers: { "Cf-Access-Jwt-Assertion": forged } }), env, certs, now), { error: "unexpected algorithm" }, "alg=none rejected");

// ---- the Worker: routing, and no notes until Access is set up ----
const assets = { fetch: async (r: Request) => new Response(`asset ${new URL(r.url).pathname}`) };
const wenv = { ...env, ASSETS: assets, GITHUB_TOKEN: "t", VAULT_REPO: "o/r" };
const call = async (path: string, init: RequestInit = {}, e: object = wenv) => {
  const r = await handle(new Request(`https://notes.example.com${path}`, init), e as never, certs);
  return [r.status, r.headers.get("Cache-Control"), (await r.text()).slice(0, 60)];
};
eq(await call("/"), [200, null, "asset /"], "static files come from the assets binding");
eq(await call("/app.js"), [200, null, "asset /app.js"], "…every non-API path");
eq(await call("/api/vault", {}, { ...wenv, ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "" }), [401, "private, no-store", '{"error":"Sign in required (Access isn\'t configured)"}'], "fresh deploy: API refused until Access is set");
eq(await call("/api/vault", {}, { ...wenv, ACCESS_AUD: "unset" }), [401, "private, no-store", '{"error":"Sign in required (Access isn\'t configured)"}'], "the form's \"unset\" placeholder counts as not configured");
eq(await call("/api/vault"), [401, "private, no-store", '{"error":"Sign in required (not signed in)"}'], "API needs a login");
const broken = (async () => new Response("nope", { status: 404 })) as typeof fetch;
const r404 = await handle(new Request("https://notes.example.com/api/vault", { headers: { "Cf-Access-Jwt-Assertion": await token(good) } }), { ...wenv, ACCESS_TEAM_DOMAIN: "typo.cloudflareaccess.com" } as never, broken);
eq(r404.status, 401, "unreachable Access keys: 401, not a crash");
const signed = { "Cf-Access-Jwt-Assertion": await token(good) };
eq(await call("/api/nope", { headers: signed }), [404, "private, no-store", '{"error":"not found"}'], "unknown API path");
eq(await call("/api/capture", { method: "POST", headers: { ...signed, Origin: "https://evil.example", "Content-Type": "application/json" }, body: "{}" }), [403, "private, no-store", '{"error":"cross-origin"}'], "capture refuses cross-origin posts");
eq(await call("/api/capture", { method: "POST", headers: { ...signed, "Content-Type": "text/plain" }, body: "x" }), [415, "private, no-store", '{"error":"JSON only"}'], "capture takes JSON only");


// ---- the web build's files API ----
eq(["shelf.yml", "badges.yml", "stickers/heron.svg", "covers/dusk.svg", "notebooks/0001-a/x.md", "notebooks/0001-a/notebook.yml", "notebooks/0001-a/cover.svg"].every(isSynced), true, "isSynced: what the app syncs");
eq(["config.yml", "README.md", ".trash/notebooks/0001-a/x.md", "notebooks/0001-a/sub/x.md", "notebooks/0001-a/.x.md", "notebooks/0001-a/cover.conflict-1.svg", "notebooks/0001-a/photo.png", "covers/a/b.svg", "../shelf.yml"].some(isSynced), false, "…and nothing else");
eq(await blobSha(new TextEncoder().encode("hello\n")), "ce013625030ba8dba906f756967f9e9ca394464a", "blob sha matches git");
eq(conflictPath("notebooks/0001-a/x.md", "20261118-064631"), "notebooks/0001-a/x.conflict-20261118-064631.md", "conflict copies named like the app's");
const snap = await snapshotFrom(untar(tar([["o-r-abc/shelf.yml", "order: []\n"], ["o-r-abc/notebooks/0001-a/x.md", "# X\n"], ["o-r-abc/config.yml", "secret\n"], ["o-r-abc/.github/workflows/x.yml", "x"]])));
eq(snap.map((f) => f.path), ["notebooks/0001-a/x.md", "shelf.yml"], "the snapshot holds synced files only");
const bad = (x: unknown) => { try { checkChanges(x); return "accepted"; } catch (e) { return String((e as Error).message).split(":")[0]; } };
eq([bad([]), bad([{ path: "../x.md", text: "x", base: null }]), bad([{ path: ".github/workflows/x.yml", text: "x", base: null }]), bad([{ path: "shelf.yml", text: 3, base: null }]), bad([{ path: "shelf.yml", text: "x", base: "nope" }]), bad([{ path: "shelf.yml", text: "a", base: null }, { path: "shelf.yml", text: "b", base: null }])], ["bad changes", "bad path", "bad path", "bad text", "bad base", "bad path"], "commit input is checked: paths, types, shas, duplicates");
eq(bad([{ path: "notebooks/0001-a/x.md", text: "x", base: null }, { path: "shelf.yml", text: null, base: "a".repeat(40) }]), "accepted", "…good input passes");
const shaOf = async (s: string) => blobSha(new TextEncoder().encode(s));
const remoteNow = new Map([["notebooks/0001-a/x.md", await shaOf("theirs\n")], ["notebooks/0001-a/y.md", await shaOf("y\n")], ["shelf.yml", await shaOf("order: [b]\n")]]);
const plan = await planCommit([
  { path: "notebooks/0001-a/x.md", text: "mine\n", base: await shaOf("old\n") },
  { path: "notebooks/0001-a/y.md", text: null, base: await shaOf("old y\n") },
  { path: "shelf.yml", text: "order: [a]\n", base: await shaOf("order: []\n") },
  { path: "notebooks/0001-a/z.md", text: "new\n", base: null },
  { path: "notebooks/0001-a/w.md", text: "same\n", base: null },
], new Map([...remoteNow, ["notebooks/0001-a/w.md", await shaOf("same\n")]]), "20261118-000000");
eq(plan.additions.map((a) => a.path), ["notebooks/0001-a/x.md", "shelf.yml", "notebooks/0001-a/z.md"], "plan: edits go up, an identical file is skipped");
eq(plan.conflicts.map((c) => c.copy), ["notebooks/0001-a/x.conflict-20261118-000000.md"], "a note changed on both sides keeps theirs as a copy");
eq(plan.deletions, [], "a delete of a note changed elsewhere is dropped");
eq((await planCommit([{ path: "notebooks/0001-a/y.md", text: null, base: await shaOf("y\n") }], remoteNow, "s")).deletions, [{ path: "notebooks/0001-a/y.md" }], "a delete of an unchanged note goes through");
eq(await call("/api/commit", { method: "POST", headers: { ...signed, Origin: "https://evil.example", "Content-Type": "application/json" }, body: "{}" }), [403, "private, no-store", '{"error":"cross-origin"}'], "commit refuses cross-origin posts");
eq(await call("/api/commit", { method: "POST", headers: { ...signed, "Content-Type": "application/json" }, body: '{"changes":[{"path":"../x","text":"x","base":null}]}' }), [400, "private, no-store", '{"error":"bad path: ../x"}'], "commit refuses paths outside the vault's synced files");
eq((await call("/api/files"))[0], 401, "files need a login");

if (failed) throw new Error(`${failed} companion test(s) failed`);
