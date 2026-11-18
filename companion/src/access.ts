// Every API call must carry a valid Cloudflare Access login, checked here
// as well as at the edge: if a hostname (a preview, pages.dev) is ever
// missing from the Access app, the notes still don't leak.

export interface AccessEnv {
  /** e.g. yourteam.cloudflareaccess.com */
  ACCESS_TEAM_DOMAIN: string;
  /** The Access application's AUD tag. */
  ACCESS_AUD: string;
  /** Optional: only this email may in (comma-separate several). */
  ALLOWED_EMAILS?: string;
  /** Local `wrangler dev` only: "1" skips the check on localhost. */
  DEV_BYPASS_ACCESS?: string;
}

interface Jwk extends JsonWebKey {
  kid: string;
}

const certCache = new Map<string, { keys: Jwk[]; at: number }>();

function b64url(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
}

async function keys(team: string, fetcher: typeof fetch): Promise<Jwk[]> {
  const hit = certCache.get(team);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.keys;
  const res = await fetcher(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access certs: ${res.status}`);
  const { keys } = (await res.json()) as { keys: Jwk[] };
  certCache.set(team, { keys, at: Date.now() });
  return keys;
}

/** The signed-in email, or an error message. */
const unset = (v?: string) => !v || /^\s*(unset)?\s*$/i.test(v);

export async function verifyAccess(
  req: Request,
  env: AccessEnv,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<{ email: string } | { error: string }> {
  const host = new URL(req.url).hostname;
  if (env.DEV_BYPASS_ACCESS === "1" && (host === "localhost" || host === "127.0.0.1")) {
    return { email: "dev@localhost" };
  }
  // The button's form won't take an empty value, so "unset" counts as empty.
  if (unset(env.ACCESS_TEAM_DOMAIN) || unset(env.ACCESS_AUD)) return { error: "Access isn't configured" };
  const token = req.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return { error: "not signed in" };
  const parts = token.split(".");
  if (parts.length !== 3) return { error: "malformed token" };
  let header: { alg?: string; kid?: string };
  let claims: { aud?: string | string[]; exp?: number; nbf?: number; iss?: string; email?: string };
  try {
    header = JSON.parse(new TextDecoder().decode(b64url(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(b64url(parts[1])));
  } catch {
    return { error: "malformed token" };
  }
  if (header.alg !== "RS256") return { error: "unexpected algorithm" };
  const jwk = (await keys(env.ACCESS_TEAM_DOMAIN, fetcher)).find((k) => k.kid === header.kid);
  if (!jwk) return { error: "unknown signing key" };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64url(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!ok) return { error: "bad signature" };
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(env.ACCESS_AUD)) return { error: "wrong audience" };
  const t = now / 1000;
  if (!claims.exp || claims.exp < t || (claims.nbf && claims.nbf > t + 60)) return { error: "expired" };
  if (claims.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return { error: "wrong issuer" };
  const email = (claims.email ?? "").toLowerCase();
  const allowed = (unset(env.ALLOWED_EMAILS) ? "" : env.ALLOWED_EMAILS!).split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (allowed.length && !allowed.includes(email)) return { error: "not allowed" };
  return { email };
}
