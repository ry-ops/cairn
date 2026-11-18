// The companion as one Worker: static files from public/ (served by the
// assets binding), and the API under /api, which runs first.
//
// Until Cloudflare Access is set up (ACCESS_TEAM_DOMAIN and ACCESS_AUD),
// every API call is refused, so a fresh deploy from the Deploy to Cloudflare
// button can't serve a single note.
import { type AccessEnv, verifyAccess } from "./access.ts";
import { type VaultEnv, capture, readVault } from "./vault.ts";

export interface Env extends AccessEnv, VaultEnv {
  ASSETS: { fetch(req: Request): Promise<Response> };
}

// _headers only covers static files, so API responses set their own.
const API_HEADERS: Record<string, string> = {
  "Cache-Control": "private, no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: API_HEADERS });

async function vault(env: Env): Promise<Response> {
  try {
    const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
    return json(await readVault(env, cache));
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 502);
  }
}

async function captureNote(req: Request, env: Env): Promise<Response> {
  // Same-origin JSON only (Access cookies would otherwise ride along on a
  // cross-site form post).
  const origin = req.headers.get("Origin");
  if (origin && origin !== new URL(req.url).origin) return json({ error: "cross-origin" }, 403);
  if (!(req.headers.get("Content-Type") ?? "").includes("application/json")) return json({ error: "JSON only" }, 415);
  let input: { notebook?: string; title?: string; body?: string; today?: string };
  try {
    input = await req.json();
  } catch {
    return json({ error: "bad JSON" }, 400);
  }
  const today = /^\d{4}-\d{2}-\d{2}$/.test(input.today ?? "") ? input.today! : new Date().toISOString().slice(0, 10);
  try {
    const path = await capture(env, String(input.notebook ?? ""), String(input.title ?? ""), String(input.body ?? "").slice(0, 100_000), today);
    return json({ path });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 400);
  }
}

export async function handle(req: Request, env: Env, fetcher: typeof fetch = fetch): Promise<Response> {
  const { pathname } = new URL(req.url);
  if (pathname !== "/api" && !pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
  // Every /api call: a valid Access login first.
  let who: Awaited<ReturnType<typeof verifyAccess>>;
  try {
    who = await verifyAccess(req, env, fetcher);
  } catch (e) {
    // e.g. a mistyped team domain: its signing keys can't be fetched
    who = { error: String(e instanceof Error ? e.message : e) };
  }
  if ("error" in who) return json({ error: `Sign in required (${who.error})` }, 401);
  if (pathname === "/api/vault" && req.method === "GET") return vault(env);
  if (pathname === "/api/capture" && req.method === "POST") return captureNote(req, env);
  return json({ error: "not found" }, 404);
}

export default {
  fetch: (req: Request, env: Env) => handle(req, env),
};
