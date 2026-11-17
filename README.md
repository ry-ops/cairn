# Cairn

> Notes as markers you leave behind.

**Cairn** (pronounced *KARN*, like *kern*: one syllable, the way *Karin* sounds said as one) is named for the stacks of stones that mark a trail.

Cairn is a markdown notebook app styled like a pocket memo book: kraft covers, edition colors, stickers and merit badges. It has an iA Writer-style editor at its core and keeps your notes as plain `.md` files you own.

Cairn is a Mac app, built for Apple silicon and Intel Macs.

## Install

1. Download the disk image from the latest [release](../../releases/latest): `…_aarch64.dmg` for Apple silicon (M1 and later), `…_x64.dmg` for Intel. Open it and drag **Cairn** to Applications.
2. The builds aren't signed or notarized yet, so macOS blocks the first launch. Either:
   - open Cairn once, then go to **System Settings → Privacy & Security** and click **Open Anyway** next to the message about Cairn; or
   - run `xattr -dr com.apple.quarantine /Applications/Cairn.app` in Terminal (this also fixes a "Cairn is damaged" message).
3. Choose a folder for your vault. An empty folder starts a fresh shelf.

Or build it yourself: see *Develop* below.

**Version 0.14.0.** See [CHANGELOG.md](CHANGELOG.md) and the Releases page.

### New in 0.14.0

- Publish to the blog is gone: it was never meant to be part of Cairn.

### New in 0.13.1

- Public releases come with two disk images, one for Apple silicon and one for Intel Macs.

### New in 0.13.0

- A new vault sets itself up: an empty folder starts with a *First Cairn* notebook and a welcome note, and Sync settings can create the vault's private GitHub repo for you.

### New in 0.12.0

- Cairn is public, MIT-licensed, with a macOS disk image on every release.
- The vault can live anywhere, iCloud Drive included.

### New in 0.11.0

- A notebook can sync with a GitHub repo of its own (⋯ → *Sync with a repo…*), such as a project's `docs/` folder, instead of your vault repo.

### New in 0.10.0

- Drag notebooks on the shelf into your own order.
- Cairns on the covers stack themselves, stone by stone, and the top stone teeters before it settles.
- Delete a notebook: ⋯ beside New note, or right-click its cover → *Move to Trash…*. It goes to `<vault>/.trash/`, where you can restore it.
- Paper and cover controls are now two chips under the notebook title, with a paper-swatch menu.
- The foot of the shelf is a vault card: vault name, sync status, and a menu for syncing and switching vaults. Badges sit above it with a progress meter.

## Develop

Requires Rust (rustup), Node 24 and pnpm 10.

```sh
pnpm install
pnpm tauri dev                     # desktop app, hot reload
pnpm dev                           # browser preview with an in-memory sample vault
pnpm test                          # Rust vault tests
pnpm tauri build --bundles app     # src-tauri/target/release/bundle/macos/Cairn.app
```

On first launch, choose your vault folder. An empty folder starts with a *First Cairn* notebook and a welcome note. Any folder works, iCloud Drive included: sync talks to GitHub through its API and never runs git in the vault (ADR-001, Amendment 1).

## Keys

| Key | Action |
|---|---|
| ⌘N | New note |
| ⇧⌘N | New notebook |
| ⌘D | Focus mode: off → sentence → paragraph |
| ⇧⌘T | Typewriter scrolling |
| ⌘\ | Hide or show the sidebars |
| ⇧⌘F | Notebook mode: the notebook on your desktop (cover first, then the open spread) |
| ⌥⌘← / ⌥⌘→ | Previous / next page (in notebook mode) |
| Two-finger swipe ← / → | Next / previous page (in notebook mode) |
| Esc | Leave notebook mode / All Notebooks |
| ⌘0 | All Notebooks: every cover in a grid |
| ⌘K | Search all notebooks |
| ⌘S | Save now (notes also autosave) |
| ⌘-click / ⌘↩ on a `[[link]]` | Follow it (starts the note if it doesn't exist yet) |

## Search

⌘K (or the magnifier on the shelf) searches every notebook as you type.
- **Matching:** every word must appear, and the last word can be the start of one (`switchb` finds "switchbacks"). `"Quote"` words to match them as a phrase. Case and accents don't matter.
- **Results:** title matches rank first, and each result shows a snippet around the match. Use ↑/↓ and Enter, or click.
- **The index:** SQLite FTS5, in memory and never in the vault, so it has nothing to sync or back up. Before each search it re-reads only the notes whose files changed, so edits from sync, iCloud or another editor show up at once. Notes that iCloud has offloaded are searched once they download.

## Links between notes

- **`[[Note title]]`** links to a note by its title (frontmatter `title:`, else its first `# Heading`, else its file name), ignoring case, accents and punctuation. A note in the same notebook wins; otherwise Cairn looks across the vault.
- **`[[Trail Log/Ridge loop]]`** names the notebook, by title or folder name. **`[[Title|shown text]]`** and **`[[Title#Heading]]`** also work. Links inside code are ignored.
- **Typing `[[`** suggests note titles, this notebook's first. A link to a note that doesn't exist yet is dashed; ⌘-click it to start that note.
- **Linked from N** in the status bar lists the notes that link to this one, each with the line the link sits on. Click one to go there.
- Links stay plain text in the `.md` files, the same `[[…]]` that Obsidian and other tools read.

## Pages, paper and fonts

- **Paper:** each notebook has a default (the *Paper* chip under its title, or `paper:` in `notebook.yml`); any page can override it with `paper: graph|ruled|dot|blank` in its frontmatter (status bar → *page*).
- **Ruling ink:** `ruling: "#c98a3a"` in `notebook.yml` colors the lines of graph, ruled and dot paper.
- **Fonts:** Typewriter (default) or Handwritten, which is **Rock Salt** (Apache-2.0, bundled via Fontsource). Switch in the status bar. Rock Salt is Cairn's only hand: also the inside front cover, where the notebook's details and contents are written straight onto the board.

## Sync

Click the **vault card** at the foot of the shelf: it shows the vault's name and sync status, and its menu has *Sync now*, *Sync settings…* and *Open another vault…*.
- **GitHub:** set the repository (`owner/name`) and branch, and sign in with your GitHub CLI login or a token saved in the Keychain. If the repo doesn't exist yet, *Preview* offers to create it as a private repo (with a README) in your account or an organization of yours; that needs the GitHub CLI login or a token allowed to create repositories. The first sync shows a preview and waits for your OK. After that, Cairn syncs on launch, shortly after you stop typing, every 5 minutes, and when the window hides.
- **What syncs:** notes and `notebook.yml` only, as signed commits through the GitHub API. No git runs locally, so the vault can live in iCloud Drive.
- **A notebook's own repo:** ⋯ → *Sync with a repo…* links a notebook to `owner/name`, optionally a folder such as `docs` and a branch. Its top-level `.md` files become the notebook's notes, and subfolders are ignored.
  - Preview the first sync, then link. Each sync then does the vault repo, then every linked notebook.
  - The notebook's `notebook.yml` stays in the vault repo, and its notes leave it (the history keeps them). *Unlink* brings them back.
  - Commits go straight to the branch, so a branch protected by "require a pull request" will refuse them. Pick another branch for those repos.
  - The companion site reads only the vault repo, so it doesn't see a linked notebook's notes.
- **Conflicts:** a note edited on both sides keeps yours and saves theirs as `<name>.conflict-<stamp>.md`.
- **iCloud:** a vault in iCloud Drive is already backed up. For a vault elsewhere, turn on the backup copy in `iCloud Drive/Cairn Backup`.

See ADR-001, Amendment 1, for the details.

## Cairn for Claude (MCP)

`cairn-mcp` is a local MCP server that lets Claude search, read and add to your notes. It uses the same vault as the app (read from Cairn's config, or `--vault <path>`, or `CAIRN_VAULT`).

```sh
cd src-tauri && cargo build --release --bin cairn-mcp
claude mcp add cairn -- "$PWD/target/release/cairn-mcp"
```

| Tool | What it does |
|---|---|
| `cairn_notebooks` / `cairn_notes` | List notebooks; list a notebook's notes |
| `cairn_search` | Full-text search, same rules and ranking as ⌘K |
| `cairn_read` | A note's markdown, by title or file name |
| `cairn_backlinks` | Notes that `[[link]]` to a note, with the linking line |
| `cairn_create_note` | Start a note (dated today, title as heading, optional body) |
| `cairn_append` | Add markdown to the end of a note |

Writing only adds: Claude can't overwrite or delete anything. When you come back to Cairn it re-reads the open note, so text Claude added appears (unless you have unsaved typing).

## Companion site

`companion/` is a small web app for your own Cloudflare account: read, search and jot notes from any browser, phone included, behind Cloudflare Access. It reads your GitHub vault repo, so it shows what has synced. See [companion/README.md](companion/README.md) to deploy it.

## Covers, stickers and badges

- **Cover picker** (the *Cover* chip under the notebook title): built-in covers (Kraft plus four styles, each in several colorways), your own covers, the title-plate color, and *Make an original*.
- **Original art:** ask Claude Code in this repo to use the **`cairn-cover`** skill (`.claude/skills/cairn-cover/`). It draws a `cover.svg` in hand-drawn, watercolor, letterpress or monoprint style (optionally animated) and sets it in `notebook.yml`. The built-in presets in `src/cover-presets/` are its worked examples.
- **Motion:** a cover can carry a one-shot animation that plays as covers arrive in All Notebooks and as the notebook arrives on the desktop and in the cover picker's preview each time you choose one. The built-in covers each have one: washes laid down, the pen drawing, ink passes landing in register, the moon rising. On Kraft covers the cairn is built stone by stone, and its top stone nearly topples before it settles; Ridge Sketch's inked cairn teeters the same way. The shelf and the picker's thumbnails always show the still cover, and nothing moves while you write. Every notebook also drops onto the desktop and settles on its staples.
- **Library:** save a notebook's custom cover to `<vault>/covers/` from the picker; any notebook can then use it (`cover: lib:<name>`).
- **All Notebooks** (⌘0, View → All Notebooks, or the grid icon on the shelf): every notebook's cover in a grid, with its note count and the date last written. Sort by shelf order, number, A–Z or recent, type to find, click to open, Esc to go back. Covers come in one after another, and animated ones play as they arrive.

- **Stickers** (*stickers* in the status bar): a sheet of die-cut vinyl stickers (cairn, compass, pine, peaks, moon, sun, lightning, lake wave, canoe, tent, campfire, camp mug, trail blaze, gold star, *field tested*). Click one to stick it on **this page** or **the cover**, drag it where you want it, drag it off the edge (or focus it and press Delete) to peel it off. Each lands at a slight tilt. Page stickers are saved in the note's frontmatter (`stickers:`, one JSON line), cover stickers in `notebook.yml`, never in the note body. Add your own SVGs to `<vault>/stickers/` (shown as `my:<name>`); the white die-cut edge is added for you.

- **Merit badges** (*Badges* above the vault card, with a progress meter): twelve embroidered patches earned from what's in the vault. They cover your first, tenth and fiftieth note, five notebooks, ten links, a link between notebooks, a seven-day streak, all four seasons, ten thousand words, five stickers, an original cover and your first GitHub sync. A new one stitches itself in at the bottom of the window. That and the covers are the only motion in Cairn. Earned dates are kept in `<vault>/badges.yml`, and a badge stays earned even if notes are later trashed.

- **Notebook menu** (⋯ beside New note, or right-click a cover): *Change cover…* and *Move to Trash…*. A trashed notebook's folder moves to `<vault>/.trash/<time>-<id>/`; move it back into `notebooks/` to restore it. With GitHub sync on, the next sync deletes it from the repository (the history keeps it).
- **Shelf order:** drag a cover up or down the shelf to move it; the others make room, and the shelf scrolls when you reach its edge. The order is saved in `<vault>/shelf.yml` (on this Mac and in iCloud; it isn't part of GitHub sync). Notebooks it doesn't list follow in number order.

`notebook.yml` keys: `cover` (`kraft-classic` · `<preset>` · `<preset>/<colorway>` · `cover.svg` · `lib:<name>`), `color` (title plate), `ruling`, `paper`, `stickers`.

See [the design guide](docs/design/cairn-specimen.html) for the type, cover styles and colorways.

## Releases

Each version on `main` is a release: the Release workflow tags `v<version>`, publishes the notes from [CHANGELOG.md](CHANGELOG.md), and attaches macOS disk images for Apple silicon and Intel.

## Layout

```
src/                  React + CodeMirror 6 frontend
  editor/             focus mode, typewriter mode, markdown theme
  components/Cover    SVG notebook covers (kraft grain, staples, cairn mark)
  components/ShelfParts  sortable shelf, paper + cover chips, vault card
  store.ts            VaultStore: Tauri IPC, or in-memory for the browser
src-tauri/src/vault.rs  vault filesystem layer (path-safe, atomic writes, .trash)
```

If you have iA Writer's open-source fonts installed (iA Writer Duo/Duospace), the editor uses them automatically.

## License

[MIT](LICENSE).
