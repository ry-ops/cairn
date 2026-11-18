# Changelog

Each version on `main` is a release. The Release workflow tags `v<version>`, publishes that version's section below as the notes, and attaches macOS disk images for Apple silicon and Intel.

## 0.15.1 — The Deploy button, tried for real

- The Deploy to Cloudflare button now walks you through the whole form: it turns on Cloudflare Access for you, and you copy one value, the AUD tag, into your copy's `wrangler.toml`. The form won't take empty values, so type `unset`, which the companion treats as not set.
- The README explains that the variables live in your copy's `wrangler.toml` (dashboard edits are overwritten on the next deploy), and what to do if the page says *GitHub: 401*.

## 0.15.0 — Deploy the companion with one click

- **The web companion can be deployed with a Deploy to Cloudflare button**, in the README and in `companion/README.md`. It copies the companion into your GitHub account and deploys it as a Worker on your Cloudflare account. It's a Worker with static assets now, not Pages + Functions.
- **It's safe before it's set up:** until you put Cloudflare Access in front of it and set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`, it serves no notes, and the page says what to do next.

## 0.14.2 — Signed as a whole bundle

- The app is now ad-hoc signed as a whole bundle, so macOS no longer calls a downloaded copy damaged. The first launch still needs **System Settings → Privacy & Security → Open Anyway**, because Cairn isn't notarized by Apple yet.

## 0.14.1 — A README that shows off Cairn

- The README walks through everything Cairn does, with twelve animated illustrations, and spells out how to allow Cairn in **System Settings → Privacy & Security** on first launch.

## 0.14.0 — Tidier captures

- Notes captured from the companion no longer start with an unused `publish:` line.

## 0.13.1 — Disk images for Apple silicon and Intel

- Releases now attach two disk images, `…_aarch64.dmg` for Apple silicon and `…_x64.dmg` for Intel. The universal build couldn't include `cairn-mcp`, so 0.13.0 has no disk image.

## 0.13.0 — A new vault sets itself up

- An empty folder becomes a vault with a starter shelf: the *First Cairn* notebook and a welcome note on how Cairn works.
- Sync settings can create your vault's GitHub repo: type a name that doesn't exist yet, then *Preview*, and Cairn offers to create it as a private repo in your account or an organization of yours.
- New notes no longer carry an unused `publish:` line.

## 0.12.0 — First public release

Cairn (pronounced *KARN*, like *kern*) is a markdown notebook app for the Mac, styled like a pocket memo book. Your notes stay plain `.md` files in a folder you choose.

- **Writing:** an iA Writer-style editor (CodeMirror 6) with focus and typewriter modes; graph, ruled, dot or blank paper per notebook or per page; a typewriter face or the Rock Salt hand.
- **Notebooks:** a shelf of covers you can drag into order, All Notebooks (⌘0), and notebook mode (⇧⌘F): the notebook on your desktop, cover first, then the open spread, with trackpad page turns.
- **Covers:** built-in covers in several colorways with one-shot animations, your own SVG covers, a cover library, and the `cairn-cover` skill for Claude Code, which draws original covers in four print styles.
- **Links and search:** `[[wikilinks]]` with autocomplete and backlinks, and ⌘K full-text search across every notebook (SQLite FTS5).
- **Sync:** GitHub sync through the API as signed commits, with no git in the vault; a notebook can sync with a repo of its own, such as a project's `docs/` folder. The vault can live in iCloud Drive.
- **Stickers and merit badges.**
- **`cairn-mcp`:** a local MCP server so Claude can search, read and add to your notes (it only adds).
- **Companion:** a read-and-capture web app for your own Cloudflare account, behind Cloudflare Access (`companion/`).
