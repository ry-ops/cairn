// Companion server pieces, in plain Node (no deps): pnpm test (or npm test).
import { verifyAccess } from "../functions/_lib/access.ts";
import { captureText, noteTitle, parseVault, slugify, untar } from "../functions/_lib/vault.ts";

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

if (failed) throw new Error(`${failed} companion test(s) failed`);
