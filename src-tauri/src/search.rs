//! Full-text search over every note, with SQLite FTS5.
//!
//! The index lives in memory, never in the vault: nothing extra to sync or
//! back up, and nothing to go stale between launches. Before each search it
//! compares every note file's stamp (modified time, size) with what it
//! indexed and re-reads only what changed, so edits from sync, iCloud or
//! another editor are found without any hooks. A vault of a few thousand
//! notes indexes in well under a second on first search.

use std::collections::HashMap;
use std::path::PathBuf;

use rusqlite::{Connection, params};
use serde::Serialize;

use crate::vault::{Vault, note_title};

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Hit {
    pub notebook: String,
    pub file: String,
    /// The title, with matches wrapped in \u{2} … \u{3}.
    pub title: String,
    /// A few words around the best match in the body, marked the same way.
    pub snippet: String,
}

pub struct SearchIndex {
    db: Connection,
    root: Option<PathBuf>,
    stamps: HashMap<(String, String), (u128, u64)>,
}

impl SearchIndex {
    pub fn new() -> rusqlite::Result<Self> {
        let db = Connection::open_in_memory()?;
        db.execute_batch(
            "CREATE VIRTUAL TABLE notes USING fts5(
                notebook UNINDEXED, file UNINDEXED, title, body,
                tokenize = 'unicode61 remove_diacritics 2'
            );",
        )?;
        Ok(Self {
            db,
            root: None,
            stamps: HashMap::new(),
        })
    }

    /// Bring the index up to date with the vault on disk.
    pub fn refresh(&mut self, vault: &Vault) -> Result<(), String> {
        if self.root.as_deref() != Some(vault.root()) {
            self.db.execute("DELETE FROM notes", []).map_err(err)?;
            self.stamps.clear();
            self.root = Some(vault.root().to_path_buf());
        }
        let files = vault.note_files().map_err(|e| e.to_string())?;
        let tx = self.db.transaction().map_err(err)?;
        let mut live = HashMap::with_capacity(files.len());
        for f in files {
            let key = (f.notebook.clone(), f.file.clone());
            if self.stamps.get(&key) != Some(&f.stamp) {
                // Unreadable right now (mid-write, mid-download): try next time.
                let Ok(text) = std::fs::read_to_string(&f.path) else {
                    continue;
                };
                tx.execute(
                    "DELETE FROM notes WHERE notebook = ?1 AND file = ?2",
                    params![f.notebook, f.file],
                )
                .map_err(err)?;
                tx.execute(
                    "INSERT INTO notes (notebook, file, title, body) VALUES (?1, ?2, ?3, ?4)",
                    params![f.notebook, f.file, note_title(&text, &f.file), body(&text)],
                )
                .map_err(err)?;
            }
            live.insert(key, f.stamp);
        }
        for (nb, file) in self.stamps.keys().filter(|k| !live.contains_key(*k)) {
            tx.execute(
                "DELETE FROM notes WHERE notebook = ?1 AND file = ?2",
                params![nb, file],
            )
            .map_err(err)?;
        }
        tx.commit().map_err(err)?;
        self.stamps = live;
        Ok(())
    }

    /// Best matches first; titles weigh more than bodies.
    pub fn search(&self, input: &str, limit: usize) -> Result<Vec<Hit>, String> {
        let Some(q) = fts_query(input) else {
            return Ok(vec![]);
        };
        let mut stmt = self
            .db
            .prepare_cached(
                "SELECT notebook, file,
                        highlight(notes, 2, char(2), char(3)),
                        snippet(notes, 3, char(2), char(3), '…', 16)
                 FROM notes WHERE notes MATCH ?1
                 ORDER BY bm25(notes, 0.0, 0.0, 8.0, 1.0)
                 LIMIT ?2",
            )
            .map_err(err)?;
        let rows = stmt
            .query_map(params![q, limit as i64], |r| {
                Ok(Hit {
                    notebook: r.get(0)?,
                    file: r.get(1)?,
                    title: r.get(2)?,
                    snippet: r.get(3)?,
                })
            })
            .map_err(err)?;
        rows.collect::<rusqlite::Result<_>>().map_err(err)
    }
}

fn err(e: rusqlite::Error) -> String {
    e.to_string()
}

/// The note without its frontmatter: what's worth searching.
fn without_frontmatter(text: &str) -> &str {
    if let Some(rest) = text.strip_prefix("---\n")
        && let Some(end) = rest.find("\n---")
    {
        let after = &rest[end + 4..];
        return after.strip_prefix('\n').unwrap_or(after);
    }
    text
}

/// What's indexed: the words, without frontmatter or markdown punctuation,
/// so snippets read as text (`**Bold**` → `Bold`, `[[Link]]` → `Link`).
fn body(text: &str) -> String {
    without_frontmatter(text)
        .lines()
        .map(|line| {
            let t = line.trim_start();
            let t = t
                .trim_start_matches('#')
                .trim_start_matches('>')
                .trim_start();
            let t = ["- [ ] ", "- [x] ", "- ", "* ", "+ "]
                .iter()
                .find_map(|m| t.strip_prefix(m))
                .unwrap_or(t);
            t.chars()
                .map(|c| {
                    if matches!(c, '*' | '`' | '|' | '[' | ']' | '~') {
                        ' '
                    } else {
                        c
                    }
                })
                .collect::<String>()
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
        })
        .filter(|l| !l.is_empty() && !l.chars().all(|c| c == '-' || c == ':' || c == ' '))
        .collect::<Vec<_>>()
        .join("\n")
}

/// What the user typed → an FTS5 query. Every word must appear; the last one
/// may be a prefix (search as you type); "quoted words" match as a phrase.
/// Everything is quoted, so FTS5 operators typed by accident can't error.
pub fn fts_query(input: &str) -> Option<String> {
    let mut parts: Vec<String> = vec![];
    let mut rest = input;
    while !rest.is_empty() {
        rest = rest.trim_start();
        if let Some(after) = rest.strip_prefix('"') {
            let (phrase, next) = match after.find('"') {
                Some(i) => (&after[..i], &after[i + 1..]),
                None => (after, ""),
            };
            if let Some(p) = clean(phrase) {
                parts.push(format!("\"{p}\""));
            }
            rest = next;
        } else {
            let end = rest
                .find(|c: char| c.is_whitespace() || c == '"')
                .unwrap_or(rest.len());
            if let Some(w) = clean(&rest[..end]) {
                let prefix = end == rest.len() && !input.ends_with(char::is_whitespace);
                parts.push(if prefix {
                    format!("\"{w}\"*")
                } else {
                    format!("\"{w}\"")
                });
            }
            rest = &rest[end..];
        }
    }
    (!parts.is_empty()).then(|| parts.join(" "))
}

/// Words only; nothing that would close a quoted FTS5 string.
fn clean(s: &str) -> Option<String> {
    let w: String = s
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    (!w.is_empty()).then_some(w)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn plain(s: &str) -> String {
        s.replace(['\u{2}', '\u{3}'], "")
    }

    #[test]
    fn queries_are_safe_and_prefix_the_last_word() {
        assert_eq!(fts_query("lake sup").as_deref(), Some("\"lake\" \"sup\"*"));
        assert_eq!(fts_query("lake sup ").as_deref(), Some("\"lake\" \"sup\""));
        assert_eq!(
            fts_query("\"three flashes\" sill").as_deref(),
            Some("\"three flashes\" \"sill\"*")
        );
        assert_eq!(
            fts_query("NOT OR (a* \" -").as_deref(),
            Some("\"NOT\" \"OR\" \"a\"")
        );
        assert_eq!(fts_query("  ").as_deref(), None);
        assert_eq!(fts_query("\"\"").as_deref(), None);
    }

    #[test]
    fn finds_ranks_and_follows_changes() {
        let t = tempfile::tempdir().unwrap();
        let v = Vault::open(t.path()).unwrap();
        let a = v.create_notebook("Trail", "", "", "2026-11-15").unwrap();
        let b = v.create_notebook("Bench", "", "", "2026-11-15").unwrap();
        let ridge = v.create_note(&a.id, "Ridge loop", "2026-11-15").unwrap();
        v.write_note(
            &a.id,
            &ridge.file,
            "---\ntitle: Ridge loop\ntags: [secret]\n---\n# Ridge loop\n\nSwitchbacks above the lake, then the café.\n",
        )
        .unwrap();
        let log = v.create_note(&b.id, "Strike log", "2026-11-15").unwrap();
        v.write_note(
            &b.id,
            &log.file,
            "# Strike log\n\nThree flashes over the ridge before midnight.\n",
        )
        .unwrap();

        let mut ix = SearchIndex::new().unwrap();
        ix.refresh(&v).unwrap();

        // Title matches outrank body matches.
        let hits = ix.search("ridge", 10).unwrap();
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].file, ridge.file);
        assert_eq!(hits[0].title, "\u{2}Ridge\u{3} loop");
        assert!(plain(&hits[1].snippet).contains("over the ridge"));

        // Prefixes, diacritics, phrases; frontmatter isn't searched.
        assert_eq!(ix.search("switchb", 10).unwrap().len(), 1);
        assert_eq!(ix.search("cafe", 10).unwrap().len(), 1);
        assert_eq!(ix.search("\"three flashes\"", 10).unwrap().len(), 1);
        assert_eq!(ix.search("\"flashes three\"", 10).unwrap().len(), 0);
        assert!(ix.search("secret", 10).unwrap().is_empty());
        assert_eq!(
            body("---\na: 1\n---\n## Tells\n- **Bold** and `code` | [[Link]]\n|---|---|\n"),
            "Tells\nBold and code Link"
        );

        // An edit, a new note and a deletion are all picked up.
        v.write_note(&b.id, &log.file, "# Strike log\n\nQuiet night.\n")
            .unwrap();
        let n = v.create_note(&b.id, "Antenna", "2026-11-15").unwrap();
        v.write_note(&b.id, &n.file, "# Antenna\n\nNew ridge mount.\n")
            .unwrap();
        fs::remove_file(t.path().join("notebooks").join(&a.id).join(&ridge.file)).unwrap();
        ix.refresh(&v).unwrap();
        let files: Vec<_> = ix
            .search("ridge", 10)
            .unwrap()
            .into_iter()
            .map(|h| h.file)
            .collect();
        assert_eq!(files, vec![n.file]);
    }
}
