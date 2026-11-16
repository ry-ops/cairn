//! `cairn-mcp`: Cairn's notes for Claude, as a local MCP server over stdio.
//!
//! Reads and writes the same vault as the app (its `config.json`, or
//! `--vault <path>`, or `CAIRN_VAULT`). Search uses the app's FTS5 index;
//! links resolve the way the app resolves them. Writing is additive only:
//! Claude can start a note or append to one, never overwrite or delete.
//!
//! Register with Claude Code:
//!   claude mcp add cairn -- /path/to/cairn-mcp

use std::io::{BufRead, Write};
use std::path::PathBuf;

use cairn_lib::search::SearchIndex;
use cairn_lib::vault::{Notebook, Vault, note_title};
use serde_json::{Value, json};

const PROTOCOL: &str = "2025-06-18";

fn main() {
    let vault = match find_vault()
        .and_then(|p| Vault::open(&p).map_err(|e| format!("{}: {e}", p.display())))
    {
        Ok(v) => v,
        Err(e) => {
            eprintln!("cairn-mcp: {e}");
            std::process::exit(2);
        }
    };
    let mut server = Server { vault, index: None };
    let stdin = std::io::stdin();
    let mut out = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let reply = match serde_json::from_str::<Value>(&line) {
            Ok(msg) => server.handle(&msg),
            Err(e) => Some(error(Value::Null, -32700, &format!("parse error: {e}"))),
        };
        if let Some(r) = reply {
            let _ = writeln!(out, "{r}");
            let _ = out.flush();
        }
    }
}

/// `--vault`, then `CAIRN_VAULT`, then the Cairn app's own config.
fn find_vault() -> Result<PathBuf, String> {
    let args: Vec<String> = std::env::args().collect();
    if let Some(i) = args.iter().position(|a| a == "--vault") {
        return args
            .get(i + 1)
            .map(PathBuf::from)
            .ok_or("--vault needs a path".into());
    }
    if let Ok(p) = std::env::var("CAIRN_VAULT") {
        return Ok(PathBuf::from(p));
    }
    let home = std::env::var("HOME").map_err(|_| "HOME isn't set")?;
    let cfg = PathBuf::from(home).join("Library/Application Support/dev.ry-ops.cairn/config.json");
    let text = std::fs::read_to_string(&cfg).map_err(|_| {
        format!(
            "no vault: pass --vault, set CAIRN_VAULT, or open one in Cairn ({})",
            cfg.display()
        )
    })?;
    let v: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    v.get("vault_path")
        .and_then(Value::as_str)
        .map(PathBuf::from)
        .ok_or_else(|| "Cairn has no vault selected yet".into())
}

struct Server {
    vault: Vault,
    index: Option<SearchIndex>,
}

fn error(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn text_result(text: String, is_error: bool) -> Value {
    json!({ "content": [{ "type": "text", "text": text }], "isError": is_error })
}

impl Server {
    fn handle(&mut self, msg: &Value) -> Option<Value> {
        let id = msg.get("id").cloned();
        let method = msg.get("method").and_then(Value::as_str).unwrap_or("");
        let params = msg.get("params").cloned().unwrap_or(Value::Null);
        // Notifications (no id) get no reply.
        let id = id?;
        let result = match method {
            "initialize" => json!({
                "protocolVersion": params.get("protocolVersion").and_then(Value::as_str).unwrap_or(PROTOCOL),
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "cairn", "title": "Cairn notes", "version": env!("CARGO_PKG_VERSION") },
                "instructions": "The user's Cairn notebooks: markdown notes in pocket-notebook folders. Search before answering questions about their notes, cite notes by title and notebook, and link notes with [[Note title]] (or [[Notebook/Note title]]) when writing. Writing only adds: start a note or append to one.",
            }),
            "ping" => json!({}),
            "tools/list" => json!({ "tools": tools() }),
            "tools/call" => {
                let name = params.get("name").and_then(Value::as_str).unwrap_or("");
                let args = params.get("arguments").cloned().unwrap_or(json!({}));
                match self.call(name, &args) {
                    Ok(t) => text_result(t, false),
                    Err(e) => text_result(e, true),
                }
            }
            _ => return Some(error(id, -32601, &format!("unknown method {method}"))),
        };
        Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
    }

    fn call(&mut self, name: &str, a: &Value) -> Result<String, String> {
        let s = |k: &str| {
            a.get(k)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|v| !v.is_empty())
        };
        let need = |k: &str| s(k).ok_or(format!("`{k}` is required"));
        match name {
            "cairn_notebooks" => {
                let mut out = String::new();
                for nb in self.notebooks()? {
                    out.push_str(&format!(
                        "- {} (id {}, {} notes)\n",
                        nb.meta.title, nb.id, nb.note_count
                    ));
                }
                Ok(if out.is_empty() {
                    "No notebooks yet.".into()
                } else {
                    out
                })
            }
            "cairn_notes" => {
                let nb = self.notebook(need("notebook")?)?;
                let notes = self.vault.list_notes(&nb.id).map_err(|e| e.to_string())?;
                let mut out = format!("{} — {} notes, newest first:\n", nb.meta.title, notes.len());
                for n in notes {
                    out.push_str(&format!("- {} ({})\n", n.title, n.file));
                }
                Ok(out)
            }
            "cairn_search" => {
                let q = need("query")?;
                let limit = a
                    .get("limit")
                    .and_then(Value::as_u64)
                    .unwrap_or(10)
                    .clamp(1, 50) as usize;
                if self.index.is_none() {
                    self.index = Some(SearchIndex::new().map_err(|e| e.to_string())?);
                }
                let ix = self.index.as_mut().expect("just set");
                ix.refresh(&self.vault)?;
                let hits = ix.search(q, limit)?;
                if hits.is_empty() {
                    return Ok(format!("Nothing found for “{q}”."));
                }
                let books = self.notebooks()?;
                let mut out = String::new();
                for h in hits {
                    let book = books
                        .iter()
                        .find(|b| b.id == h.notebook)
                        .map(|b| b.meta.title.as_str())
                        .unwrap_or(&h.notebook);
                    out.push_str(&format!(
                        "- {} — {} (notebook: {}, file: {})\n  {}\n",
                        plain(&h.title),
                        book,
                        h.notebook,
                        h.file,
                        plain(&h.snippet)
                            .split_whitespace()
                            .collect::<Vec<_>>()
                            .join(" ")
                    ));
                }
                Ok(out)
            }
            "cairn_read" => {
                let (nb, file) = self.locate(s("notebook"), need("note")?)?;
                let text = self
                    .vault
                    .read_note(&nb.id, &file)
                    .map_err(|e| e.to_string())?;
                Ok(format!(
                    "Notebook: {} ({})\nFile: {file}\n\n{text}",
                    nb.meta.title, nb.id
                ))
            }
            "cairn_backlinks" => {
                let (nb, file) = self.locate(s("notebook"), need("note")?)?;
                let target_title = note_title(
                    &self
                        .vault
                        .read_note(&nb.id, &file)
                        .map_err(|e| e.to_string())?,
                    &file,
                );
                let books = self.notebooks()?;
                let all = self.vault.all_notes().map_err(|e| e.to_string())?;
                let mut out = String::new();
                for n in &all {
                    if n.notebook == nb.id && n.file == file {
                        continue;
                    }
                    for (book, title, line) in wikilinks(&n.text) {
                        let book_ok = match &book {
                            Some(b) => books.iter().any(|x| {
                                x.id == nb.id
                                    && (norm(&x.meta.title) == norm(b)
                                        || norm(&x.id) == norm(b)
                                        || norm(unnumbered(&x.id)) == norm(b))
                            }),
                            None => true,
                        };
                        if book_ok && norm(&title) == norm(&target_title) {
                            out.push_str(&format!(
                                "- {} ({}/{}): {}\n",
                                n.title,
                                n.notebook,
                                n.file,
                                line.trim()
                            ));
                        }
                    }
                }
                Ok(if out.is_empty() {
                    format!("Nothing links to “{target_title}” yet.")
                } else {
                    out
                })
            }
            "cairn_create_note" => {
                let nb = self.notebook(need("notebook")?)?;
                let title = need("title")?;
                let today = chrono::Local::now().format("%Y-%m-%d").to_string();
                let n = self
                    .vault
                    .create_note(&nb.id, title, &today)
                    .map_err(|e| e.to_string())?;
                if let Some(body) = s("body") {
                    let mut text = self
                        .vault
                        .read_note(&nb.id, &n.file)
                        .map_err(|e| e.to_string())?;
                    text.push_str(body);
                    text.push('\n');
                    self.vault
                        .write_note(&nb.id, &n.file, &text)
                        .map_err(|e| e.to_string())?;
                }
                Ok(format!(
                    "Started “{}” in {} ({}/{}).",
                    n.title, nb.meta.title, nb.id, n.file
                ))
            }
            "cairn_append" => {
                let (nb, file) = self.locate(s("notebook"), need("note")?)?;
                let add = need("text")?;
                let mut text = self
                    .vault
                    .read_note(&nb.id, &file)
                    .map_err(|e| e.to_string())?;
                while text.ends_with('\n') {
                    text.pop();
                }
                text.push_str("\n\n");
                text.push_str(add);
                text.push('\n');
                self.vault
                    .write_note(&nb.id, &file, &text)
                    .map_err(|e| e.to_string())?;
                Ok(format!(
                    "Appended to {} ({}/{file}).",
                    note_title(&text, &file),
                    nb.id
                ))
            }
            _ => Err(format!("unknown tool {name}")),
        }
    }

    fn notebooks(&self) -> Result<Vec<Notebook>, String> {
        self.vault.list_notebooks().map_err(|e| e.to_string())
    }

    /// A notebook by title or folder name (with or without its number).
    fn notebook(&self, name: &str) -> Result<Notebook, String> {
        let k = norm(name);
        let all = self.notebooks()?;
        all.iter()
            .find(|b| norm(&b.meta.title) == k)
            .or_else(|| {
                all.iter()
                    .find(|b| norm(&b.id) == k || norm(unnumbered(&b.id)) == k)
            })
            .cloned()
            .ok_or_else(|| {
                let names: Vec<_> = all.iter().map(|b| b.meta.title.as_str()).collect();
                format!(
                    "No notebook called “{name}”. Notebooks: {}",
                    names.join(", ")
                )
            })
    }

    /// A note by file name or title, in the given notebook or anywhere.
    fn locate(&self, notebook: Option<&str>, note: &str) -> Result<(Notebook, String), String> {
        let books = match notebook {
            Some(n) => vec![self.notebook(n)?],
            None => self.notebooks()?,
        };
        let k = norm(note.trim_end_matches(".md"));
        for nb in &books {
            for n in self.vault.list_notes(&nb.id).map_err(|e| e.to_string())? {
                let stem = n.file.trim_end_matches(".md");
                let undated = stem
                    .get(11..)
                    .filter(|_| stem.as_bytes().get(10) == Some(&b'-'))
                    .unwrap_or(stem);
                if norm(&n.title) == k || norm(stem) == k || norm(undated) == k {
                    return Ok((nb.clone(), n.file));
                }
            }
        }
        Err(format!(
            "No note “{note}”{}. Try cairn_search.",
            notebook.map(|n| format!(" in {n}")).unwrap_or_default()
        ))
    }
}

/// `0003-trail-log` → `trail-log`.
fn unnumbered(id: &str) -> &str {
    id.split_once('-').map_or("", |(_, rest)| rest)
}

/// Search marks matches with \u{2}…\u{3}; Claude gets plain text.
fn plain(s: &str) -> String {
    s.replace(['\u{2}', '\u{3}'], "")
}

/// Same idea as the app's `norm`: case and punctuation don't matter.
fn norm(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_alphanumeric() {
                c.to_lowercase().next().unwrap_or(c)
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// `[[Notebook/Title#Heading|alias]]` links outside code: (notebook, title, line).
fn wikilinks(text: &str) -> Vec<(Option<String>, String, String)> {
    let mut out = vec![];
    let mut fence = false;
    let body = text
        .strip_prefix("---\n")
        .and_then(|r| r.find("\n---").map(|i| &r[i + 4..]))
        .unwrap_or(text);
    for line in body.lines() {
        if line.trim_start().starts_with("```") || line.trim_start().starts_with("~~~") {
            fence = !fence;
            continue;
        }
        if fence {
            continue;
        }
        let mut rest = line;
        while let Some(i) = rest.find("[[") {
            let after = &rest[i + 2..];
            let Some(j) = after.find("]]") else { break };
            let inner = &after[..j];
            rest = &after[j + 2..];
            if inner.contains('[') || line[..line.len() - rest.len()].matches('`').count() % 2 == 1
            {
                continue;
            }
            let inner = inner.split('|').next().unwrap_or("");
            let inner = inner.split('#').next().unwrap_or("");
            let (book, title) = match inner.rfind('/') {
                Some(k) => (
                    Some(inner[..k].trim().to_string()).filter(|b| !b.is_empty()),
                    inner[k + 1..].trim(),
                ),
                None => (None, inner.trim()),
            };
            if !title.is_empty() {
                out.push((book, title.to_string(), line.to_string()));
            }
        }
    }
    out
}

fn tools() -> Value {
    let note_args = json!({
        "notebook": { "type": "string", "description": "Notebook title or folder name. Optional: without it, every notebook is searched." },
        "note": { "type": "string", "description": "The note's title (as shown in Cairn) or file name." },
    });
    json!([
        {
            "name": "cairn_notebooks",
            "title": "List notebooks",
            "description": "List the user's Cairn notebooks with their ids and note counts.",
            "inputSchema": { "type": "object", "properties": {} },
            "annotations": { "readOnlyHint": true },
        },
        {
            "name": "cairn_notes",
            "title": "List notes in a notebook",
            "description": "List one notebook's notes (title and file), newest first.",
            "inputSchema": { "type": "object", "properties": { "notebook": { "type": "string", "description": "Notebook title or folder name." } }, "required": ["notebook"] },
            "annotations": { "readOnlyHint": true },
        },
        {
            "name": "cairn_search",
            "title": "Search notes",
            "description": "Full-text search across every notebook. Every word must appear; the last can be a prefix; \"quote\" a phrase. Returns titles, notebooks and snippets, best first.",
            "inputSchema": { "type": "object", "properties": {
                "query": { "type": "string" },
                "limit": { "type": "integer", "minimum": 1, "maximum": 50, "default": 10 },
            }, "required": ["query"] },
            "annotations": { "readOnlyHint": true },
        },
        {
            "name": "cairn_read",
            "title": "Read a note",
            "description": "Read a note's full markdown (frontmatter included).",
            "inputSchema": { "type": "object", "properties": note_args, "required": ["note"] },
            "annotations": { "readOnlyHint": true },
        },
        {
            "name": "cairn_backlinks",
            "title": "Notes linking here",
            "description": "Notes that link to this one with [[wikilinks]], each with the linking line.",
            "inputSchema": { "type": "object", "properties": note_args, "required": ["note"] },
            "annotations": { "readOnlyHint": true },
        },
        {
            "name": "cairn_create_note",
            "title": "Start a note",
            "description": "Start a new note in a notebook (today's date, the title as its heading), optionally with a markdown body. Use [[Note title]] to link other notes.",
            "inputSchema": { "type": "object", "properties": {
                "notebook": { "type": "string", "description": "Notebook title or folder name." },
                "title": { "type": "string" },
                "body": { "type": "string", "description": "Markdown to put under the title." },
            }, "required": ["notebook", "title"] },
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "idempotentHint": false },
        },
        {
            "name": "cairn_append",
            "title": "Add to a note",
            "description": "Append markdown to the end of an existing note. Never replaces what's there.",
            "inputSchema": { "type": "object", "properties": {
                "notebook": { "type": "string", "description": "Notebook title or folder name (optional)." },
                "note": { "type": "string", "description": "The note's title or file name." },
                "text": { "type": "string", "description": "Markdown to add." },
            }, "required": ["note", "text"] },
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "idempotentHint": false },
        },
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn links_outside_code() {
        let t = "---\ntitle: X\n---\nSee [[Ridge]] and [[Trail Log/Lake|the lake]].\n`[[code]]`\n```\n[[fenced]]\n```\n[[A#h]]";
        let got: Vec<_> = wikilinks(t).into_iter().map(|(b, t, _)| (b, t)).collect();
        assert_eq!(
            got,
            vec![
                (None, "Ridge".into()),
                (Some("Trail Log".into()), "Lake".into()),
                (None, "A".into())
            ]
        );
    }

    #[test]
    fn protocol_round_trip() {
        let t = tempfile::tempdir().unwrap();
        let v = Vault::open(t.path()).unwrap();
        let nb = v
            .create_notebook("Trail Log", "", "", "2026-11-15")
            .unwrap();
        let mut s = Server {
            vault: v,
            index: None,
        };
        let init = s.handle(&json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}})).unwrap();
        assert_eq!(init["result"]["serverInfo"]["name"], "cairn");
        assert!(
            s.handle(&json!({"jsonrpc":"2.0","method":"notifications/initialized"}))
                .is_none()
        );
        let list = s
            .handle(&json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}))
            .unwrap();
        assert_eq!(list["result"]["tools"].as_array().unwrap().len(), 7);

        let call = |s: &mut Server, name: &str, args: Value| {
            let r = s.handle(&json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":name,"arguments":args}})).unwrap();
            (
                r["result"]["content"][0]["text"]
                    .as_str()
                    .unwrap()
                    .to_string(),
                r["result"]["isError"].as_bool().unwrap(),
            )
        };
        let (t1, e1) = call(
            &mut s,
            "cairn_create_note",
            json!({"notebook":"trail log","title":"Ridge loop","body":"Switchbacks to the [[Lake]]."}),
        );
        assert!(!e1, "{t1}");
        let (t2, e2) = call(
            &mut s,
            "cairn_create_note",
            json!({"notebook":"trail-log","title":"Lake"}),
        );
        assert!(!e2, "{t2}");
        let (_, e3) = call(
            &mut s,
            "cairn_append",
            json!({"note":"lake","text":"Cold and clear."}),
        );
        assert!(!e3);
        let (read, _) = call(&mut s, "cairn_read", json!({"note":"Lake"}));
        assert!(
            read.contains("# Lake") && read.ends_with("Cold and clear.\n"),
            "{read}"
        );
        let (found, _) = call(&mut s, "cairn_search", json!({"query":"switchb"}));
        assert!(found.contains("Ridge loop"), "{found}");
        let (bl, _) = call(
            &mut s,
            "cairn_backlinks",
            json!({"note":"Lake","notebook":"Trail Log"}),
        );
        assert!(bl.contains("Ridge loop") && bl.contains("[[Lake]]"), "{bl}");
        let (miss, e4) = call(&mut s, "cairn_read", json!({"note":"Nope"}));
        assert!(e4 && miss.contains("cairn_search"));
        let (bad, e5) = call(&mut s, "cairn_notes", json!({"notebook":"Nope"}));
        assert!(e5 && bad.contains("Trail Log"));
        let unk = s
            .handle(&json!({"jsonrpc":"2.0","id":9,"method":"resources/list"}))
            .unwrap();
        assert_eq!(unk["error"]["code"], -32601);
        let _ = nb;
    }
}
