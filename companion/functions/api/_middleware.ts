// Every /api call: a valid Access login first.
import { type AccessEnv, verifyAccess } from "../_lib/access";

export const onRequest: PagesFunction<AccessEnv> = async (ctx) => {
  const who = await verifyAccess(ctx.request, ctx.env);
  if ("error" in who) {
    return Response.json({ error: `Sign in required (${who.error})` }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  ctx.data.email = who.email;
  const res = await ctx.next();
  const out = new Response(res.body, res);
  out.headers.set("Cache-Control", "private, no-store");
  return out;
};
