// Print Cairn's merit-badge patches as JSON ({id, name, how, svg}), loaded
// through Vite so the app's own code draws them. Used by build.py.
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
try {
  const { BADGES, patchFor } = await server.ssrLoadModule("/src/badges.ts");
  const out = BADGES.map((b) => ({ id: b.id, name: b.name, how: b.how, svg: patchFor(b.id) }));
  process.stdout.write(JSON.stringify(out));
} finally {
  await server.close();
}
