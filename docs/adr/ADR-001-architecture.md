# ADR-001: Cairn architecture

- **Status:** Accepted
- **Date:** 2026-11-15

## Context

Cairn is a markdown notebook app with the feel of a pocket memo book: kraft covers, edition colors, staple binding, merit-badge stickers. The visual inspiration is Field Notes and the Simple Bits Advencher Log. The editing core is modeled on iA Writer, and the "folder of plain `.md` files you own" model comes from Obsidian.

Requirements:

- Desktop app first (macOS). Optionally, a private companion web app later.
- An unlimited number of **field notebooks**.
- Notes stored as plain `.md` files in a private GitHub repo.
- iCloud as a secondary, Mac-only backup for a single user.
- Animated SVG notebook covers and a sticker component.

## Decision

### 1. Desktop shell: Tauri v2

Tauri v2 with a TypeScript web frontend. It produces a small native binary, gives real filesystem access through Rust commands, and lets the companion site reuse the same frontend. SwiftUI was ruled out because it would lock out the web companion.

### 2. Editor: CodeMirror 6

iA Writer-style core features:

- Focus mode by sentence or paragraph (non-focused text dimmed)
- Typewriter scrolling (the caret line stays vertically centered)
- Inline markdown styling, so syntax marks are visible but quiet
- Optional syntax highlighting by part of speech
- Distraction-free full screen; the editor stays calm and motion lives elsewhere

Obsidian-style features: `[[wikilinks]]`, backlinks, full-text search (SQLite FTS5 in the Rust layer).

### 3. Two repos

| Repo | Contents | Visibility |
|---|---|---|
| Cairn (this repo) | App code | Public |
| Your vault repo | Notes only (`.md` + notebook metadata) | Private, yours |

Keeping notes out of the app repo means a public release never needs history scrubbing.

### 4. Vault layout

```
cairn-vault/
  notebooks/
    0001-first-cairn/
      notebook.yml          # title, edition, color, cover, started, stickers
      2026-11-15-welcome.md
  stickers/                 # SVG sticker sheet (user-supplied/custom art)
```

- Each notebook is a folder with a `notebook.yml`. A numbered prefix gives a stable "edition" order.
- Note filenames are `YYYY-MM-DD-slug.md`. Per-note metadata (tags, stickers, `publish`) goes in YAML frontmatter.
- The body of every note stays plain markdown that any other editor can read.

### 5. Sync: GitHub primary, iCloud as a backup mirror

- **GitHub is the source of truth.** Only `.md` files and `notebook.yml` files are synced.
- The app commits through the GitHub GraphQL `createCommitOnBranch` API. GitHub signs those commits, which satisfies the git-steer required-signatures ruleset that unsigned local commits fail. Commits happen on a debounce and on "close notebook", so they double as version history.
- The local working copy lives **outside** iCloud Drive (in Application Support or a user-chosen path).
- **iCloud Drive is a one-way backup mirror** of the `.md` files only, with no `.git`. It's Mac-only, for one user. iCloud's out-of-order, file-by-file syncing corrupts git repos, so the two must never share a folder.

### 6. Covers, stickers and motion

- Covers are SVG. The kraft texture comes from an `feTurbulence` filter, edition colors are tokens, and covers animate via CSS and the Web Animations API: a 3D page-flip on open and a small staple-binding wobble.
- Stickers are draggable SVGs that you can rotate a little and peel off. Placement is stored in `notebook.yml` (cover) or frontmatter (page), never in the note body.
- Merit badges are earned from vault activity, for example "10 entries" or "first field trip".
- Motion is for transitions and rewards only. Nothing animates while you write.

### 7. Branding

The product is named **Cairn** (a trail marker; each note is a marker you leave behind). The design takes inspiration from Field Notes and Advencher Log but copies no logos, cover layouts, illustrations or trademarks.

### 8. Tie-ins (later)

- **Companion site** on your own Cloudflare account: Cloudflare Pages behind Cloudflare Access. Reads the vault through the GitHub API. Mostly for reading and search, plus quick capture.
- **Cairn MCP server:** search, recall and writing of notes for Claude (FTS5 first, Vectorize later).

## Milestones

1. **M1:** Tauri shell, local vault, CodeMirror editor (focus and typewriter modes), multiple notebooks, kraft UI.
2. **M2:** GitHub sync via `createCommitOnBranch`, iCloud backup mirror, wikilinks and backlinks, FTS5 search.
3. **M3:** animated SVG covers, sticker sheet, edition colors, merit badges. *Built (Nov 15, 2026):* covers carry one-shot SMIL that plays only as the notebook arrives on the desktop (still everywhere else); 15 die-cut stickers plus `<vault>/stickers/`, placed in page frontmatter or `notebook.yml`; 12 merit badges computed from the vault, earned dates in `<vault>/badges.yml` (not synced; iCloud carries it). Edition colors were already in place (seven stocks and the title-plate picker).
4. **M4:** Access-gated Pages companion, publish-to-blog, MCP server. *Built (Nov 15, 2026):* `cairn-mcp` (stdio MCP server on the app's vault and FTS5 index; writing only adds); publish opens a PR on the blog repo (never publishes directly); `companion/` Pages site reading the vault by tarball, quick capture by signed commit, Access at the edge plus JWT checks in every function.
5. **Later:** public release, possibly iOS (Tauri v2 mobile).

## Consequences

- Plain `.md` keeps notes portable, but stickers and covers need sidecar metadata.
- Syncing through the API means no local git dependency, but the app must handle conflicts itself (last-write-wins plus a conflict copy, `note.conflict-<ts>.md`).
- A Tauri frontend shared with the Pages companion needs a storage abstraction: the filesystem on desktop, the GitHub API on the web.

## Amendment 1 (2026-11-15): sync as built (M2)

**The vault may live anywhere, including iCloud Drive.** Sync never runs git locally. It reads and writes GitHub through the API, so the original "no `.git` inside iCloud Drive" concern doesn't apply. The owner's vault lives at `iCloud Drive/Cairn`.

- **What syncs:** `notebooks/<id>/*.md` and `notebooks/<id>/notebook.yml`. Covers, buttons and `covers/` stay local, and iCloud carries them when the vault is in iCloud.
- **How:** a three-way compare per file of the base (blob shas at the last sync, stored in the app data dir, not the vault), the local file and the remote tree. Changes on one side flow to the other. A note changed on both sides keeps the local version and saves the remote one as `<name>.conflict-<stamp>.md` (synced too). A note deleted on one side and edited on the other is kept. Remote deletions move local files to `.trash/sync-<stamp>/`.
- **Commits:** one `createCommitOnBranch` per sync round (signed by GitHub), with `expectedHeadOid`. If the branch moved, the round reruns once.
- **First link:** always previewed and confirmed in the UI, because it merges both ways.
- **Auth:** the GitHub CLI login (`gh auth token`) or a token stored in the macOS Keychain.
- **When:** on launch, 20 s after the last save, every 5 minutes, and when the window hides, but only once linked.
- **iCloud placeholders** (`.name.md.icloud`, from "Optimize Mac Storage") are never treated as deletions. Cairn lists them, asks iCloud to download them (`brctl download`), and sync skips them until they arrive.
- **iCloud mirror:** for vaults outside iCloud Drive, an optional one-way copy to `iCloud Drive/Cairn Backup`. Files removed from the vault move to its `.trash/`.
