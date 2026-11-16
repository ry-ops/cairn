//! Vault: a folder of field notebooks, each a folder of plain `.md` files.
//!
//! Layout (ADR-001 §4):
//! ```text
//! <vault>/notebooks/<NNNN-slug>/notebook.yml
//! <vault>/notebooks/<NNNN-slug>/YYYY-MM-DD-slug.md
//! ```
//! Every path that comes from the frontend is a single validated name segment,
//! joined under the vault root. Nothing here can escape the vault.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Debug, thiserror::Error)]
pub enum VaultError {
    #[error("no vault selected")]
    NoVault,
    #[error("invalid name: {0}")]
    InvalidName(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("notebook.yml: {0}")]
    Yaml(#[from] serde_yaml::Error),
}

impl Serialize for VaultError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, VaultError>;

pub const PAPERS: &[&str] = &["graph", "ruled", "dot", "blank"];
const MAX_ART_BYTES: u64 = 2 * 1024 * 1024;

/// Contents of `notebook.yml`. Unknown keys are preserved on rewrite.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotebookMeta {
    pub title: String,
    #[serde(default)]
    pub edition: u32,
    #[serde(default = "default_color")]
    pub color: String,
    #[serde(default = "default_cover")]
    pub cover: String,
    #[serde(default = "default_paper")]
    pub paper: String,
    #[serde(default)]
    pub started: String,
    #[serde(default)]
    pub stickers: Vec<serde_yaml::Value>,
    /// This notebook's notes sync with their own GitHub repo (`owner/name`)
    /// instead of the vault repo. Empty: they sync with the vault.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub repo: String,
    /// Branch in `repo` ("" = the repo's default branch).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub repo_branch: String,
    /// Folder in `repo` whose top-level `*.md` files are the notes ("" = root).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub repo_path: String,
    #[serde(flatten)]
    pub extra: serde_yaml::Mapping,
}

fn default_color() -> String {
    "kraft".into()
}
fn default_cover() -> String {
    "kraft-classic".into()
}
fn default_paper() -> String {
    "graph".into()
}

#[derive(Debug, Clone, Serialize)]
pub struct Notebook {
    /// Folder name, e.g. `0001-first-cairn`. Stable id.
    pub id: String,
    pub meta: NotebookMeta,
    pub note_count: usize,
}

/// A note file found on disk, with a stamp (modified time, size) that
/// changes whenever its contents do.
#[derive(Debug, Clone)]
pub struct NoteFile {
    pub notebook: String,
    pub file: String,
    pub path: PathBuf,
    pub stamp: (u128, u64),
}

/// A note's full text, for the link index.
#[derive(Debug, Clone, Serialize)]
pub struct NoteText {
    pub notebook: String,
    pub file: String,
    pub title: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct NoteMeta {
    /// File name, e.g. `2026-11-15-welcome.md`. Stable id within a notebook.
    pub file: String,
    pub title: String,
    /// Seconds since epoch.
    pub modified: u64,
}

/// A single path segment: no separators, no dot-dirs, no hidden files.
fn check_segment(name: &str) -> Result<()> {
    let bad = name.is_empty()
        || name.len() > 200
        || name.starts_with('.')
        || name.contains(['/', '\\', '\0'])
        || name == "..";
    if bad {
        Err(VaultError::InvalidName(name.into()))
    } else {
        Ok(())
    }
}

fn check_note_file(name: &str) -> Result<()> {
    check_segment(name)?;
    if !name.ends_with(".md") {
        return Err(VaultError::InvalidName(name.into()));
    }
    Ok(())
}

/// Lowercase ASCII slug, words joined by `-`. Falls back to `untitled`.
pub fn slugify(s: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for c in s.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            dash = false;
        } else if !out.is_empty() && !dash {
            out.push('-');
            dash = true;
        }
    }
    let out = out.trim_end_matches('-');
    let out: String = out.chars().take(60).collect();
    let out = out.trim_end_matches('-').to_string();
    if out.is_empty() {
        "untitled".into()
    } else {
        out
    }
}

/// `.name.md.icloud` → `name.md` (an iCloud-evicted file), else `None`.
fn icloud_placeholder(name: &str) -> Option<&str> {
    name.strip_prefix('.')?.strip_suffix(".icloud")
}

/// Ask iCloud to download an evicted file (best effort; macOS `brctl`).
fn request_download(placeholder: &Path) {
    let _ = std::process::Command::new("brctl")
        .arg("download")
        .arg(placeholder)
        .spawn();
}

/// Write via temp file + rename so a crash never leaves a half-written note.
fn atomic_write(path: &Path, contents: &[u8]) -> Result<()> {
    let dir = path
        .parent()
        .ok_or_else(|| VaultError::NotFound(path.display().to_string()))?;
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("note");
    let tmp = dir.join(format!(".{name}.tmp"));
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(contents)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path)?;
    Ok(())
}

/// Title from frontmatter `title:`, else first `# ` heading, else the file stem.
pub fn note_title(contents: &str, file: &str) -> String {
    let mut lines = contents.lines();
    if contents.starts_with("---") {
        lines.next();
        for line in lines.by_ref() {
            if line.trim() == "---" {
                break;
            }
            if let Some(t) = line.strip_prefix("title:") {
                let t = t.trim().trim_matches(['"', '\'']);
                if !t.is_empty() {
                    return t.to_string();
                }
            }
        }
    }
    for line in lines {
        if let Some(h) = line.strip_prefix("# ") {
            let h = h.trim();
            if !h.is_empty() {
                return h.to_string();
            }
        }
    }
    let stem = file.trim_end_matches(".md");
    // Drop a leading YYYY-MM-DD- date prefix for display.
    let stem = if stem.len() > 11 && stem.as_bytes()[4] == b'-' && stem.as_bytes()[10] == b'-' {
        &stem[11..]
    } else {
        stem
    };
    stem.replace('-', " ")
}

/// The first note in a new vault.
const WELCOME: &str = "---
title: \"Welcome\"
tags: [cairn]
stickers: []
---

# Welcome

This is your first notebook. Every page is a plain markdown file in your vault folder, so it's yours to keep, back up or open in any other editor.

## Getting around

- **⌘N** starts a note, **⇧⌘N** a notebook.
- **⌘D** is focus mode: everything but the sentence you're on fades. **⇧⌘T** keeps your line in the middle of the page.
- **⇧⌘F** puts this notebook on your desktop, cover first. Swipe with two fingers to turn the page.
- **⌘K** searches every notebook. **⌘0** shows all your covers.

## Links

Type `[[` to link to another note by its title. ⌘-click a link to follow it; a link to a note that doesn't exist yet starts it.

## Make it yours

- The *Paper* and *Cover* chips under the notebook's title change its paper and cover.
- *stickers* in the status bar opens a sheet of stickers for this page or the cover.
- Merit badges stitch themselves in as you write.

## Keep it safe

Click the vault card at the foot of the shelf, then *Sync settings…*, to sync with a private GitHub repo. Type a name for a repo that doesn't exist yet, and Cairn creates it for you.
";

pub struct Vault {
    root: PathBuf,
}

impl Vault {
    /// Open (and lay out, if empty) a vault at `root`.
    pub fn open(root: impl Into<PathBuf>) -> Result<Self> {
        let root = root.into();
        if !root.is_dir() {
            return Err(VaultError::NotFound(root.display().to_string()));
        }
        fs::create_dir_all(root.join("notebooks"))?;
        Ok(Self { root })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// A folder with nothing in it but hidden files (`.DS_Store`, iCloud's
    /// placeholders): somewhere to start a new vault.
    pub fn is_blank(root: &Path) -> bool {
        fs::read_dir(root).is_ok_and(|mut it| {
            it.all(|e| e.is_ok_and(|e| e.file_name().to_string_lossy().starts_with('.')))
        })
    }

    /// A new vault's first shelf: the notebook *First Cairn* with a note on
    /// how Cairn works. Does nothing if the vault has any notebook.
    pub fn seed(&self, today: &str) -> Result<Option<Notebook>> {
        if !self.list_notebooks()?.is_empty() {
            return Ok(None);
        }
        let nb = self.create_notebook("First Cairn", "kraft", "graph", today)?;
        let note = self.create_note(&nb.id, "Welcome", today)?;
        self.write_note(&nb.id, &note.file, WELCOME)?;
        Ok(Some(nb))
    }

    fn notebooks_dir(&self) -> PathBuf {
        self.root.join("notebooks")
    }

    fn notebook_dir(&self, id: &str) -> Result<PathBuf> {
        check_segment(id)?;
        let dir = self.notebooks_dir().join(id);
        if !dir.is_dir() {
            return Err(VaultError::NotFound(id.into()));
        }
        Ok(dir)
    }

    fn note_path(&self, notebook: &str, file: &str) -> Result<PathBuf> {
        check_note_file(file)?;
        Ok(self.notebook_dir(notebook)?.join(file))
    }

    fn read_meta(dir: &Path, id: &str) -> Result<NotebookMeta> {
        let yml = dir.join("notebook.yml");
        if yml.is_file() {
            Ok(serde_yaml::from_str(&fs::read_to_string(yml)?)?)
        } else {
            // A bare folder is still a notebook; derive a title from its name.
            Ok(NotebookMeta {
                title: note_title("", &format!("{id}.md")),
                edition: id
                    .split('-')
                    .next()
                    .and_then(|n| n.parse().ok())
                    .unwrap_or(0),
                color: default_color(),
                cover: default_cover(),
                paper: default_paper(),
                started: String::new(),
                stickers: vec![],
                repo: String::new(),
                repo_branch: String::new(),
                repo_path: String::new(),
                extra: Default::default(),
            })
        }
    }

    pub fn list_notebooks(&self) -> Result<Vec<Notebook>> {
        let mut out = vec![];
        for entry in fs::read_dir(self.notebooks_dir())? {
            let entry = entry?;
            let id = entry.file_name().to_string_lossy().to_string();
            if id.starts_with('.') || !entry.file_type()?.is_dir() {
                continue;
            }
            let dir = entry.path();
            let meta = Self::read_meta(&dir, &id)?;
            let note_count = fs::read_dir(&dir)?
                .filter_map(|e| e.ok())
                .filter(|e| {
                    let n = e.file_name();
                    let n = n.to_string_lossy();
                    (n.ends_with(".md") && !n.starts_with('.'))
                        || icloud_placeholder(&n).is_some_and(|r| r.ends_with(".md"))
                })
                .count();
            out.push(Notebook {
                id,
                meta,
                note_count,
            });
        }
        out.sort_by(|a, b| a.id.cmp(&b.id));
        // The shelf order you dragged them into (`shelf.yml`) comes first;
        // notebooks it doesn't mention follow in number order.
        let order = self.read_shelf()?;
        let rank = |id: &str| order.iter().position(|o| o == id).unwrap_or(usize::MAX);
        out.sort_by_key(|n| rank(&n.id));
        Ok(out)
    }

    /// Shelf order (`<vault>/shelf.yml`): notebook ids, first to last.
    pub fn read_shelf(&self) -> Result<Vec<String>> {
        let p = self.root.join("shelf.yml");
        if !p.is_file() {
            return Ok(vec![]);
        }
        #[derive(Deserialize)]
        struct File {
            #[serde(default)]
            order: Vec<String>,
        }
        Ok(serde_yaml::from_str::<File>(&fs::read_to_string(p)?)
            .map(|f| f.order)
            .unwrap_or_default())
    }

    pub fn write_shelf(&self, order: &[String]) -> Result<()> {
        let mut out = String::from(
            "# Cairn shelf: the order notebooks sit in the sidebar (drag to change).\norder:\n",
        );
        for id in order {
            check_segment(id)?;
            out.push_str(&format!("  - \"{id}\"\n"));
        }
        atomic_write(&self.root.join("shelf.yml"), out.as_bytes())
    }

    pub fn create_notebook(
        &self,
        title: &str,
        color: &str,
        paper: &str,
        today: &str,
    ) -> Result<Notebook> {
        let title = title.trim();
        if title.is_empty() {
            return Err(VaultError::InvalidName(title.into()));
        }
        let next = self
            .list_notebooks()?
            .iter()
            .filter_map(|n| n.id.split('-').next()?.parse::<u32>().ok())
            .max()
            .unwrap_or(0)
            + 1;
        let id = format!("{next:04}-{}", slugify(title));
        let dir = self.notebooks_dir().join(&id);
        fs::create_dir(&dir)?;
        let meta = NotebookMeta {
            title: title.into(),
            edition: next,
            color: if color.is_empty() {
                default_color()
            } else {
                color.into()
            },
            cover: default_cover(),
            paper: if PAPERS.contains(&paper) {
                paper.into()
            } else {
                default_paper()
            },
            started: today.into(),
            stickers: vec![],
            repo: String::new(),
            repo_branch: String::new(),
            repo_path: String::new(),
            extra: Default::default(),
        };
        atomic_write(
            &dir.join("notebook.yml"),
            serde_yaml::to_string(&meta)?.as_bytes(),
        )?;
        Ok(Notebook {
            id,
            meta,
            note_count: 0,
        })
    }

    pub fn update_notebook(&self, id: &str, meta: &NotebookMeta) -> Result<()> {
        let dir = self.notebook_dir(id)?;
        atomic_write(
            &dir.join("notebook.yml"),
            serde_yaml::to_string(meta)?.as_bytes(),
        )
    }

    pub fn list_notes(&self, notebook: &str) -> Result<Vec<NoteMeta>> {
        let dir = self.notebook_dir(notebook)?;
        let mut out = vec![];
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let file = entry.file_name().to_string_lossy().to_string();
            // iCloud offloaded this note (Optimize Mac Storage): list it anyway
            // and start the download; it opens once it arrives.
            if let Some(real) = icloud_placeholder(&file) {
                if check_note_file(real).is_ok() {
                    request_download(&entry.path());
                    out.push(NoteMeta {
                        title: note_title("", real),
                        file: real.to_string(),
                        modified: 0,
                    });
                }
                continue;
            }
            if check_note_file(&file).is_err() || !entry.file_type()?.is_file() {
                continue;
            }
            let contents = fs::read_to_string(entry.path()).unwrap_or_default();
            let modified = entry
                .metadata()?
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            out.push(NoteMeta {
                title: note_title(&contents, &file),
                file,
                modified,
            });
        }
        // Newest file name first (names are date-prefixed).
        out.sort_by(|a, b| b.file.cmp(&a.file));
        Ok(out)
    }

    /// Every note in every notebook, with its text, for the link index.
    /// Notes iCloud has offloaded are left out (reading them would download
    /// the whole vault); they join the index once opened.
    pub fn all_notes(&self) -> Result<Vec<NoteText>> {
        let mut out = vec![];
        for f in self.note_files()? {
            let Ok(text) = fs::read_to_string(&f.path) else {
                continue;
            };
            out.push(NoteText {
                title: note_title(&text, &f.file),
                notebook: f.notebook,
                file: f.file,
                text,
            });
        }
        out.sort_by(|a, b| (&a.notebook, &b.file).cmp(&(&b.notebook, &a.file)));
        Ok(out)
    }

    /// Every note file on disk (iCloud placeholders excluded), without
    /// reading it: for indexes that only re-read what changed.
    pub fn note_files(&self) -> Result<Vec<NoteFile>> {
        let mut out = vec![];
        for nb in self.list_notebooks()? {
            let dir = self.notebook_dir(&nb.id)?;
            for entry in fs::read_dir(dir)?.filter_map(|e| e.ok()) {
                let file = entry.file_name().to_string_lossy().to_string();
                let Ok(md) = entry.metadata() else { continue };
                if check_note_file(&file).is_err() || !md.is_file() {
                    continue;
                }
                let modified = md
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_nanos())
                    .unwrap_or(0);
                out.push(NoteFile {
                    notebook: nb.id.clone(),
                    file,
                    path: entry.path(),
                    stamp: (modified, md.len()),
                });
            }
        }
        Ok(out)
    }

    pub fn read_note(&self, notebook: &str, file: &str) -> Result<String> {
        let p = self.note_path(notebook, file)?;
        if !p.is_file() {
            // Offloaded to iCloud? Ask for it and wait a little.
            let placeholder = p.with_file_name(format!(".{file}.icloud"));
            if placeholder.is_file() {
                request_download(&placeholder);
                for _ in 0..40 {
                    std::thread::sleep(std::time::Duration::from_millis(250));
                    if p.is_file() {
                        return Ok(fs::read_to_string(p)?);
                    }
                }
                return Err(VaultError::NotFound(format!(
                    "{file} (still downloading from iCloud; try again in a moment)"
                )));
            }
            return Err(VaultError::NotFound(file.into()));
        }
        Ok(fs::read_to_string(p)?)
    }

    pub fn write_note(&self, notebook: &str, file: &str, contents: &str) -> Result<()> {
        let p = self.note_path(notebook, file)?;
        atomic_write(&p, contents.as_bytes())
    }

    /// Create `YYYY-MM-DD-slug.md`, suffixing `-2`, `-3`… on collision.
    pub fn create_note(&self, notebook: &str, title: &str, today: &str) -> Result<NoteMeta> {
        let dir = self.notebook_dir(notebook)?;
        let title = if title.trim().is_empty() {
            "Untitled"
        } else {
            title.trim()
        };
        let base = format!("{today}-{}", slugify(title));
        let mut file = format!("{base}.md");
        let mut n = 2;
        while dir.join(&file).exists() {
            file = format!("{base}-{n}.md");
            n += 1;
        }
        let safe_title = title.replace('"', "'");
        let body =
            format!("---\ntitle: \"{safe_title}\"\ntags: []\nstickers: []\n---\n\n# {title}\n\n");
        atomic_write(&dir.join(&file), body.as_bytes())?;
        Ok(NoteMeta {
            file,
            title: title.into(),
            modified: 0,
        })
    }

    fn library_dir(&self) -> PathBuf {
        self.root.join("covers")
    }

    /// Read an SVG if it exists and is under the 2 MB cap; else `None`.
    fn read_svg(p: &Path) -> Result<Option<String>> {
        if !p.is_file() || fs::metadata(p)?.len() > MAX_ART_BYTES {
            return Ok(None);
        }
        Ok(Some(fs::read_to_string(p)?))
    }

    /// Resolve an art reference to a path: `<file>.svg` lives in the notebook
    /// folder, `lib:<name>` in `<vault>/covers/<name>.svg`. Anything else
    /// (`kraft-classic`, `monoprint/winter`, …) is built in → `None`.
    fn art_path(&self, dir: &Path, reference: &str) -> Result<Option<PathBuf>> {
        if let Some(name) = reference.strip_prefix("lib:") {
            check_segment(name)?;
            return Ok(Some(self.library_dir().join(format!("{name}.svg"))));
        }
        if reference.ends_with(".svg") {
            check_segment(reference)?;
            return Ok(Some(dir.join(reference)));
        }
        Ok(None)
    }

    /// Custom cover art (`cover:` in notebook.yml) written by the
    /// `cairn-cover` skill, or `None` for a built-in cover. The frontend
    /// renders it as an image, so any script inside never runs.
    pub fn read_cover(&self, notebook: &str) -> Result<Option<String>> {
        let dir = self.notebook_dir(notebook)?;
        let meta = Self::read_meta(&dir, notebook)?;
        match self.art_path(&dir, &meta.cover)? {
            Some(p) => Self::read_svg(&p),
            None => Ok(None),
        }
    }

    /// Custom button art: `button: button.svg` (notebook folder), else the
    /// library cover's companion `<name>.button.svg`, else `None` (the
    /// frontend derives a button from the cover).
    pub fn read_button(&self, notebook: &str) -> Result<Option<String>> {
        let dir = self.notebook_dir(notebook)?;
        let meta = Self::read_meta(&dir, notebook)?;
        if let Some(b) = meta.extra.get("button").and_then(|v| v.as_str())
            && let Some(p) = self.art_path(&dir, b)?
        {
            return Self::read_svg(&p);
        }
        if let Some(name) = meta.cover.strip_prefix("lib:") {
            check_segment(name)?;
            return Self::read_svg(&self.library_dir().join(format!("{name}.button.svg")));
        }
        Ok(None)
    }

    /// Names in the shared cover library (`<vault>/covers/<name>.svg`).
    pub fn list_library(&self) -> Result<Vec<String>> {
        let dir = self.library_dir();
        if !dir.is_dir() {
            return Ok(vec![]);
        }
        let mut out: Vec<String> = fs::read_dir(dir)?
            .filter_map(|e| e.ok())
            .filter_map(|e| e.file_name().to_str().map(String::from))
            .filter(|n| n.ends_with(".svg") && !n.ends_with(".button.svg") && !n.starts_with('.'))
            .map(|n| n.trim_end_matches(".svg").to_string())
            .collect();
        out.sort();
        Ok(out)
    }

    /// Merit badges earned so far (`<vault>/badges.yml`): badge id → the
    /// date it was earned. Missing or unreadable means none yet.
    pub fn read_badges(&self) -> Result<BTreeMap<String, String>> {
        let p = self.root.join("badges.yml");
        if !p.is_file() {
            return Ok(BTreeMap::new());
        }
        let text = fs::read_to_string(p)?;
        #[derive(Deserialize)]
        struct File {
            #[serde(default)]
            earned: BTreeMap<String, String>,
        }
        Ok(serde_yaml::from_str::<File>(&text)
            .map(|f| f.earned)
            .unwrap_or_default())
    }

    pub fn write_badges(&self, earned: &BTreeMap<String, String>) -> Result<()> {
        let mut out =
            String::from("# Cairn merit badges: earned from what's in this vault.\nearned:\n");
        for (id, date) in earned {
            check_segment(id)?;
            out.push_str(&format!(
                "  {id}: \"{}\"\n",
                date.replace(['"', '\\', '\n'], "")
            ));
        }
        atomic_write(&self.root.join("badges.yml"), out.as_bytes())
    }

    /// Your own stickers: `<vault>/stickers/*.svg`, as (name, svg) pairs.
    /// Oversized or unreadable files are skipped.
    pub fn list_stickers(&self) -> Result<Vec<(String, String)>> {
        let dir = self.root.join("stickers");
        if !dir.is_dir() {
            return Ok(vec![]);
        }
        let mut out = vec![];
        for e in fs::read_dir(dir)?.filter_map(|e| e.ok()) {
            let Some(name) = e.file_name().to_str().map(String::from) else {
                continue;
            };
            let Some(stem) = name.strip_suffix(".svg") else {
                continue;
            };
            if check_segment(stem).is_err() {
                continue;
            }
            if let Ok(Some(svg)) = Self::read_svg(&e.path()) {
                out.push((stem.to_string(), svg));
            }
        }
        out.sort();
        Ok(out)
    }

    pub fn read_library(&self, name: &str) -> Result<Option<String>> {
        check_segment(name)?;
        Self::read_svg(&self.library_dir().join(format!("{name}.svg")))
    }

    /// Copy a notebook's custom cover (and button, if any) into the library
    /// as `<slug>.svg` / `<slug>.button.svg`, suffixing `-2`… on collision.
    pub fn save_to_library(&self, notebook: &str, name: &str) -> Result<String> {
        let cover = self
            .read_cover(notebook)?
            .ok_or_else(|| VaultError::NotFound("custom cover".into()))?;
        let button = self.read_button(notebook)?;
        let lib = self.library_dir();
        fs::create_dir_all(&lib)?;
        let base = slugify(name);
        let mut slug = base.clone();
        let mut n = 2;
        while lib.join(format!("{slug}.svg")).exists() {
            slug = format!("{base}-{n}");
            n += 1;
        }
        atomic_write(&lib.join(format!("{slug}.svg")), cover.as_bytes())?;
        if let Some(b) = button {
            atomic_write(&lib.join(format!("{slug}.button.svg")), b.as_bytes())?;
        }
        Ok(slug)
    }

    /// Move a note to `<vault>/.trash/<notebook>/` rather than deleting it.
    /// Move a whole notebook to `.trash/<stamp>-<id>/` and drop it from the
    /// shelf order. Nothing is deleted; restore it by moving the folder back.
    pub fn trash_notebook(&self, id: &str) -> Result<()> {
        check_segment(id)?;
        let dir = self.notebooks_dir().join(id);
        if !dir.is_dir() {
            return Err(VaultError::NotFound(id.into()));
        }
        let trash = self.root.join(".trash");
        fs::create_dir_all(&trash)?;
        let stamp = chrono::Local::now().format("%Y%m%d%H%M%S");
        fs::rename(&dir, trash.join(format!("{stamp}-{id}")))?;
        let order = self.read_shelf()?;
        if order.iter().any(|o| o == id) {
            let rest: Vec<String> = order.into_iter().filter(|o| o != id).collect();
            self.write_shelf(&rest)?;
        }
        Ok(())
    }

    pub fn trash_note(&self, notebook: &str, file: &str) -> Result<()> {
        let p = self.note_path(notebook, file)?;
        if !p.is_file() {
            return Err(VaultError::NotFound(file.into()));
        }
        let trash = self.root.join(".trash").join(notebook);
        fs::create_dir_all(&trash)?;
        let stamp = chrono::Local::now().format("%Y%m%d%H%M%S");
        fs::rename(p, trash.join(format!("{stamp}-{file}")))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault() -> (tempfile::TempDir, Vault) {
        let t = tempfile::tempdir().unwrap();
        let v = Vault::open(t.path()).unwrap();
        (t, v)
    }

    #[test]
    fn slugify_cases() {
        assert_eq!(slugify("First Cairn"), "first-cairn");
        assert_eq!(slugify("  Hello, World!! "), "hello-world");
        assert_eq!(slugify("¿Qué?"), "qu");
        assert_eq!(slugify("!!!"), "untitled");
        assert_eq!(slugify(&"a".repeat(100)).len(), 60);
    }

    #[test]
    fn rejects_traversal() {
        let (_t, v) = vault();
        v.create_notebook("A", "", "", "2026-11-15").unwrap();
        for bad in ["..", "../x", "a/b", ".hidden", "", "x\\y"] {
            assert!(v.notebook_dir(bad).is_err(), "{bad}");
        }
        assert!(v.read_note("0001-a", "../../etc/passwd").is_err());
        assert!(v.write_note("0001-a", "note.txt", "x").is_err());
        assert!(v.write_note("0001-a", ".x.md", "x").is_err());
    }

    #[test]
    fn notebook_numbering_and_meta() {
        let (_t, v) = vault();
        let a = v
            .create_notebook("Trail Log", "blaze", "dot", "2026-11-15")
            .unwrap();
        let b = v
            .create_notebook("Bench Notes", "", "nope", "2026-11-15")
            .unwrap();
        assert_eq!(a.id, "0001-trail-log");
        assert_eq!(b.id, "0002-bench-notes");
        assert_eq!(b.meta.paper, "graph");
        let list = v.list_notebooks().unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].meta.color, "blaze");
        assert_eq!(list[0].meta.paper, "dot");
        assert_eq!(list[1].meta.edition, 2);
    }

    #[test]
    fn reads_existing_vault_yaml_and_keeps_unknown_keys() {
        let (t, v) = vault();
        let dir = t.path().join("notebooks/0001-first-cairn");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("notebook.yml"),
            "title: First Cairn\nedition: 1\ncolor: kraft        # token\ncover: kraft-classic\nstarted: 2026-11-15\nstickers: []\nfuture_key: keep-me\n",
        )
        .unwrap();
        let nb = &v.list_notebooks().unwrap()[0];
        assert_eq!(nb.meta.title, "First Cairn");
        assert_eq!(nb.meta.paper, "graph");
        v.update_notebook(&nb.id, &nb.meta).unwrap();
        let back = fs::read_to_string(dir.join("notebook.yml")).unwrap();
        assert!(back.contains("future_key: keep-me"));
    }

    #[test]
    fn note_lifecycle() {
        let (_t, v) = vault();
        let nb = v.create_notebook("A", "", "", "2026-11-15").unwrap();
        let n1 = v
            .create_note(&nb.id, "Hello \"there\"", "2026-11-15")
            .unwrap();
        let n2 = v.create_note(&nb.id, "Hello there", "2026-11-15").unwrap();
        assert_eq!(n1.file, "2026-11-15-hello-there.md");
        assert_eq!(n2.file, "2026-11-15-hello-there-2.md");
        let body = v.read_note(&nb.id, &n1.file).unwrap();
        assert!(body.starts_with("---\ntitle: \"Hello 'there'\""));
        v.write_note(&nb.id, &n1.file, "# Changed\n\nbody").unwrap();
        let notes = v.list_notes(&nb.id).unwrap();
        assert_eq!(notes.len(), 2);
        assert!(notes.iter().any(|n| n.title == "Changed"));
        v.trash_note(&nb.id, &n2.file).unwrap();
        assert_eq!(v.list_notes(&nb.id).unwrap().len(), 1);
        assert_eq!(v.list_notebooks().unwrap()[0].note_count, 1);
    }

    #[test]
    fn custom_cover() {
        let (t, v) = vault();
        let mut nb = v.create_notebook("A", "", "", "2026-11-15").unwrap();
        assert!(v.read_cover(&nb.id).unwrap().is_none());
        let dir = t.path().join("notebooks").join(&nb.id);
        fs::write(dir.join("cover.svg"), "<svg/>").unwrap();
        nb.meta.cover = "cover.svg".into();
        v.update_notebook(&nb.id, &nb.meta).unwrap();
        assert_eq!(v.read_cover(&nb.id).unwrap().as_deref(), Some("<svg/>"));
        nb.meta.cover = "../../x.svg".into();
        v.update_notebook(&nb.id, &nb.meta).unwrap();
        assert!(v.read_cover(&nb.id).is_err());
    }

    #[test]
    fn library_and_buttons() {
        let (t, v) = vault();
        let mut nb = v.create_notebook("A", "", "", "2026-11-15").unwrap();
        let dir = t.path().join("notebooks").join(&nb.id);
        assert!(
            v.save_to_library(&nb.id, "x").is_err(),
            "no custom cover yet"
        );
        fs::write(dir.join("cover.svg"), "<svg>c</svg>").unwrap();
        fs::write(dir.join("button.svg"), "<svg>b</svg>").unwrap();
        nb.meta.cover = "cover.svg".into();
        nb.meta.extra.insert("button".into(), "button.svg".into());
        v.update_notebook(&nb.id, &nb.meta).unwrap();
        assert_eq!(
            v.read_button(&nb.id).unwrap().as_deref(),
            Some("<svg>b</svg>")
        );

        assert_eq!(
            v.save_to_library(&nb.id, "Lake Walks").unwrap(),
            "lake-walks"
        );
        assert_eq!(
            v.save_to_library(&nb.id, "Lake Walks").unwrap(),
            "lake-walks-2"
        );
        assert_eq!(
            v.list_library().unwrap(),
            vec!["lake-walks", "lake-walks-2"]
        );

        // A second notebook wearing the library cover gets its button too.
        let mut b = v.create_notebook("B", "", "", "2026-11-15").unwrap();
        b.meta.cover = "lib:lake-walks".into();
        v.update_notebook(&b.id, &b.meta).unwrap();
        assert_eq!(
            v.read_cover(&b.id).unwrap().as_deref(),
            Some("<svg>c</svg>")
        );
        assert_eq!(
            v.read_button(&b.id).unwrap().as_deref(),
            Some("<svg>b</svg>")
        );
        b.meta.cover = "lib:../../etc".into();
        v.update_notebook(&b.id, &b.meta).unwrap();
        assert!(v.read_cover(&b.id).is_err());
        b.meta.cover = "monoprint/winter".into();
        v.update_notebook(&b.id, &b.meta).unwrap();
        assert!(v.read_cover(&b.id).unwrap().is_none());
    }

    #[test]
    fn shelf_order() {
        let (_t, v) = vault();
        let a = v
            .create_notebook("Alpha", "kraft", "graph", "2026-11-15")
            .unwrap();
        let b = v
            .create_notebook("Beta", "kraft", "graph", "2026-11-15")
            .unwrap();
        let c = v
            .create_notebook("Gamma", "kraft", "graph", "2026-11-15")
            .unwrap();
        let ids = |v: &Vault| {
            v.list_notebooks()
                .unwrap()
                .into_iter()
                .map(|n| n.id)
                .collect::<Vec<_>>()
        };
        assert_eq!(ids(&v), vec![a.id.clone(), b.id.clone(), c.id.clone()]);
        v.write_shelf(&[c.id.clone(), a.id.clone()]).unwrap();
        assert_eq!(ids(&v), vec![c.id.clone(), a.id.clone(), b.id.clone()]);
        assert!(v.write_shelf(&["../x".into()]).is_err());
    }

    #[test]
    fn trash_notebook_moves_folder() {
        let (t, v) = vault();
        let a = v
            .create_notebook("Alpha", "kraft", "graph", "2026-11-15")
            .unwrap();
        let b = v
            .create_notebook("Beta", "kraft", "graph", "2026-11-15")
            .unwrap();
        v.write_shelf(&[b.id.clone(), a.id.clone()]).unwrap();
        v.trash_notebook(&a.id).unwrap();
        let left: Vec<_> = v
            .list_notebooks()
            .unwrap()
            .into_iter()
            .map(|n| n.id)
            .collect();
        assert_eq!(left, vec![b.id.clone()]);
        assert_eq!(v.read_shelf().unwrap(), vec![b.id.clone()]);
        let trashed: Vec<_> = fs::read_dir(t.path().join(".trash"))
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        assert!(trashed.iter().any(|n| n.ends_with(&a.id)));
        assert!(v.trash_notebook("../x").is_err());
        assert!(v.trash_notebook(&a.id).is_err());
    }

    #[test]
    fn badges_round_trip() {
        let (_t, v) = vault();
        assert!(v.read_badges().unwrap().is_empty());
        let mut b = BTreeMap::new();
        b.insert("first-marker".to_string(), "2026-11-15".to_string());
        b.insert("ten-markers".to_string(), "2026-11-16".to_string());
        v.write_badges(&b).unwrap();
        assert_eq!(v.read_badges().unwrap(), b);
        b.insert("../evil".to_string(), "x".to_string());
        assert!(v.write_badges(&b).is_err());
    }

    #[test]
    fn stickers_from_the_vault() {
        let (t, v) = vault();
        assert!(v.list_stickers().unwrap().is_empty());
        let d = t.path().join("stickers");
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("loon.svg"), "<svg>loon</svg>").unwrap();
        fs::write(d.join(".hidden.svg"), "<svg/>").unwrap();
        fs::write(d.join("notes.txt"), "x").unwrap();
        assert_eq!(
            v.list_stickers().unwrap(),
            vec![("loon".to_string(), "<svg>loon</svg>".to_string())]
        );
    }

    #[test]
    fn all_notes_for_the_link_index() {
        let (t, v) = vault();
        let a = v.create_notebook("A", "", "", "2026-11-15").unwrap();
        let b = v.create_notebook("B", "", "", "2026-11-15").unwrap();
        let n = v.create_note(&a.id, "Lake", "2026-11-15").unwrap();
        v.write_note(&a.id, &n.file, "# Lake\n\nSee [[Ridge]].\n")
            .unwrap();
        v.create_note(&b.id, "Ridge", "2026-11-15").unwrap();
        // An offloaded note stays out of the index rather than downloading.
        fs::write(
            t.path()
                .join("notebooks")
                .join(&b.id)
                .join(".2026-01-01-gone.md.icloud"),
            "",
        )
        .unwrap();
        let all = v.all_notes().unwrap();
        assert_eq!(all.len(), 2);
        let lake = all.iter().find(|x| x.notebook == a.id).unwrap();
        assert_eq!(lake.title, "Lake");
        assert!(lake.text.contains("[[Ridge]]"));
        assert!(all.iter().any(|x| x.notebook == b.id && x.title == "Ridge"));
    }

    #[test]
    fn icloud_placeholders_are_listed() {
        let (t, v) = vault();
        let nb = v.create_notebook("A", "", "", "2026-11-15").unwrap();
        let dir = t.path().join("notebooks").join(&nb.id);
        fs::write(dir.join(".2026-11-14-evicted-note.md.icloud"), "").unwrap();
        let notes = v.list_notes(&nb.id).unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].file, "2026-11-14-evicted-note.md");
        assert_eq!(notes[0].title, "evicted note");
        assert_eq!(v.list_notebooks().unwrap()[0].note_count, 1);
    }

    #[test]
    fn titles() {
        assert_eq!(note_title("---\ntitle: \"X\"\n---\n# Y", "a.md"), "X");
        assert_eq!(note_title("---\ntags: []\n---\n\n# Y\n", "a.md"), "Y");
        assert_eq!(note_title("plain", "2026-11-15-field-day.md"), "field day");
    }

    #[test]
    fn new_vault_is_seeded_once() {
        let t = tempfile::tempdir().unwrap();
        fs::write(t.path().join(".DS_Store"), "").unwrap();
        assert!(Vault::is_blank(t.path()));
        let v = Vault::open(t.path()).unwrap();
        let nb = v.seed("2026-11-16").unwrap().expect("seeded");
        assert_eq!(nb.id, "0001-first-cairn");
        let notes = v.list_notes(&nb.id).unwrap();
        assert_eq!(notes.len(), 1);
        let text = v.read_note(&nb.id, &notes[0].file).unwrap();
        assert!(text.starts_with("---\ntitle: \"Welcome\""), "{text}");
        assert!(!Vault::is_blank(t.path()));
        // A vault with a notebook is left alone.
        assert!(v.seed("2026-11-17").unwrap().is_none());
        assert_eq!(v.list_notebooks().unwrap().len(), 1);
    }
}
