// POST /api/capture {notebook, title, body}: a new note, one signed commit.
// The app picks it up on its next sync.
import { type VaultEnv, capture } from "../_lib/vault";

export const onRequestPost: PagesFunction<VaultEnv> = async (ctx) => {
  // Same-origin JSON only (Access cookies would otherwise ride along on a
  // cross-site form post).
  const origin = ctx.request.headers.get("Origin");
  if (origin && origin !== new URL(ctx.request.url).origin) return Response.json({ error: "cross-origin" }, { status: 403 });
  if (!(ctx.request.headers.get("Content-Type") ?? "").includes("application/json")) {
    return Response.json({ error: "JSON only" }, { status: 415 });
  }
  let input: { notebook?: string; title?: string; body?: string; today?: string };
  try {
    input = await ctx.request.json();
  } catch {
    return Response.json({ error: "bad JSON" }, { status: 400 });
  }
  const today = /^\d{4}-\d{2}-\d{2}$/.test(input.today ?? "") ? input.today! : new Date().toISOString().slice(0, 10);
  try {
    const path = await capture(ctx.env, String(input.notebook ?? ""), String(input.title ?? ""), String(input.body ?? "").slice(0, 100_000), today);
    return Response.json({ path });
  } catch (e) {
    return Response.json({ error: String(e instanceof Error ? e.message : e) }, { status: 400 });
  }
};
