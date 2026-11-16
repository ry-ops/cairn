import { parseLinks, resolve, backlinks, indexNote, linkText } from "./links.ts";
// Wikilink parsing and resolution. Run: pnpm test:links (plain Node, no deps).
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
const t = "---\ntitle: X [[not]]\n---\n# X\nSee [[Ridge]] and [[Trail Log/Lake|the lake]], [[Ridge#Top]].\n`[[code]]`\n```\n[[fenced]]\n```\nafter [[  ]] [[Café notes]]";
eq(parseLinks(t).map((l) => [l.book, l.title, l.heading, l.alias]), [[null,"Ridge",null,null],["Trail Log","Lake",null,"the lake"],[null,"Ridge","Top",null],[null,"Café notes",null,null]], "parse: frontmatter/code/fences skipped, parts split");
const books = [{ id: "0001-a", title: "A" }, { id: "0003-trail-log", title: "Trail Log" }];
const idx = [
  indexNote("0001-a", "2026-11-15-x.md", "X", t),
  indexNote("0001-a", "2026-11-14-ridge.md", "Ridge", "# Ridge\n"),
  indexNote("0003-trail-log", "2026-11-10-ridge.md", "Ridge", "# Ridge\n- back to [[A/X]]\n"),
  indexNote("0003-trail-log", "2026-11-11-lake.md", "Lake", "# Lake\n"),
  indexNote("0003-trail-log", "2026-11-12-cafe.md", "cafe notes", ""),
];
eq(resolve({ book: null, title: "ridge" }, "0001-a", idx, books)?.notebook, "0001-a", "same notebook wins");
eq(resolve({ book: null, title: "Ridge" }, "0003-trail-log", idx, books)?.notebook, "0003-trail-log", "from the other notebook, its own");
eq(resolve({ book: "trail log", title: "lake" }, "0001-a", idx, books)?.file, "2026-11-11-lake.md", "notebook prefix by title");
eq(resolve({ book: "trail-log", title: "Lake" }, "0001-a", idx, books)?.file, "2026-11-11-lake.md", "notebook prefix by id slug");
eq(resolve({ book: null, title: "Café Notes" }, "0001-a", idx, books)?.file, "2026-11-12-cafe.md", "accent/case-insensitive, vault-wide");
eq(resolve({ book: null, title: "2026-11-11-lake" }, null, idx, books)?.title, "Lake", "file name works");
eq(resolve({ book: null, title: "Nope" }, "0001-a", idx, books), undefined, "missing");
const bl = backlinks({ notebook: "0001-a", file: "2026-11-14-ridge.md" }, idx, books);
eq(bl.map((b) => [b.from.title, b.context]), [["X", "See [[Ridge]] and [[the lake]], [[Ridge]]."]], "backlinks: one per line, aliases shown");
eq(backlinks({ notebook: "0001-a", file: "2026-11-15-x.md" }, idx, books).map((b) => b.context), ["back to [[X]]"], "backlink context strips list marker");
eq(linkText(idx[2], "0001-a", idx, books), "Trail Log/Ridge", "suggestion qualifies when shadowed");
eq(linkText(idx[3], "0001-a", idx, books), "Lake", "suggestion bare when unique");
if (failed) throw new Error(`${failed} link test(s) failed`);
