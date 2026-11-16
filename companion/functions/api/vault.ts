// GET /api/vault: every notebook and note, as of the branch head.
import { type VaultEnv, readVault } from "../_lib/vault";

export const onRequestGet: PagesFunction<VaultEnv> = async (ctx) => {
  try {
    return Response.json(await readVault(ctx.env, caches.default));
  } catch (e) {
    return Response.json({ error: String(e instanceof Error ? e.message : e) }, { status: 502 });
  }
};
