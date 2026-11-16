//! GitHub sync and iCloud mirror (ADR-001 §5).
//!
//! Sync talks to the GitHub API directly; no git runs locally, so the vault
//! can live anywhere, including iCloud Drive. Only notes (`*.md`) and
//! `notebook.yml` files under `notebooks/<id>/` are synced.
//!
//! Each sync covers a [`Scope`]. The vault repo holds every `notebook.yml`
//! and the notes of notebooks without a repo of their own; a notebook with
//! `repo:` in its `notebook.yml` syncs its notes with that repo (optionally a
//! folder in it, like `docs/`). A note lives in exactly one repo.
//!
//! A three-way compare per file decides what to do: the **base** (each file's
//! git blob sha at the last sync, kept outside the vault), the **local** file,
//! and the **remote** tree. Changes on one side flow to the other; a file
//! changed on both sides keeps the local version and saves the remote one
//! next to it as `<name>.conflict-<stamp>.md`. Commits are made with GraphQL
//! `createCommitOnBranch`, so GitHub signs them.

use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

pub type Sha = String;

#[derive(Debug, thiserror::Error)]
pub enum SyncError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("GitHub: {0}")]
    Http(#[from] reqwest::Error),
    #[error("GitHub: {0}")]
    Api(String),
    /// The branch moved while we were syncing; run again.
    #[error("the branch moved during sync")]
    HeadMoved,
}

pub type Result<T> = std::result::Result<T, SyncError>;

/// Local file state. A `Placeholder` is an iCloud-evicted file
/// (`.name.md.icloud`): present, contents unknown, never a deletion.
#[derive(Debug, Clone, PartialEq)]
pub enum Local {
    File(Sha),
    Placeholder,
}

/// Is this vault-relative path (with `/` separators) synced?
pub fn is_synced(rel: &str) -> bool {
    let parts: Vec<&str> = rel.split('/').collect();
    if parts.len() != 3 || parts[0] != "notebooks" {
        return false;
    }
    let (nb, name) = (parts[1], parts[2]);
    !nb.starts_with('.')
        && !name.starts_with('.')
        && (name.ends_with(".md") || name == "notebook.yml")
}

/// What one sync covers, and where its files live in the repo. Paths in
/// plans and reports are always vault-relative (`notebooks/<id>/<file>`).
#[derive(Debug, Clone, PartialEq)]
pub enum Scope {
    /// The vault repo. `own_repo` lists notebooks whose notes sync elsewhere:
    /// their `notebook.yml` stays here, their notes don't.
    Vault { own_repo: BTreeSet<String> },
    /// One notebook's notes ↔ the top-level `*.md` files in `path` (a folder
    /// in the repo, "" for its root). `notebook.yml` stays in the vault repo.
    Notebook { id: String, path: String },
}

impl Scope {
    /// The folder in the repo (for the sync state: a change means a new link).
    pub fn path(&self) -> String {
        match self {
            Scope::Vault { .. } => String::new(),
            Scope::Notebook { path, .. } => path.clone(),
        }
    }

    /// Is this vault-relative path part of this sync, locally?
    pub fn covers(&self, rel: &str) -> bool {
        if !is_synced(rel) {
            return false;
        }
        let mut parts = rel.split('/').skip(1);
        let (nb, name) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
        match self {
            Scope::Vault { own_repo } => !(name.ends_with(".md") && own_repo.contains(nb)),
            Scope::Notebook { id, .. } => nb == id && name.ends_with(".md"),
        }
    }

    /// Where a vault-relative path lives in the repo.
    pub fn to_remote(&self, rel: &str) -> String {
        match self {
            Scope::Vault { .. } => rel.to_string(),
            Scope::Notebook { path, .. } => {
                let name = rel.rsplit('/').next().unwrap_or(rel);
                if path.is_empty() {
                    name.to_string()
                } else {
                    format!("{path}/{name}")
                }
            }
        }
    }

    /// The vault-relative path for a file in the repo, if this sync covers it.
    /// The vault scope also reports notes of notebooks that moved to their own
    /// repo, so the plan can retire them from the vault repo.
    pub fn to_local(&self, remote: &str) -> Option<String> {
        match self {
            Scope::Vault { .. } => is_synced(remote).then(|| remote.to_string()),
            Scope::Notebook { id, path } => {
                let name = if path.is_empty() {
                    remote
                } else {
                    remote.strip_prefix(path.as_str())?.strip_prefix('/')?
                };
                let rel = format!("notebooks/{id}/{name}");
                (!name.contains('/') && self.covers(&rel)).then_some(rel)
            }
        }
    }

    /// Notes of a notebook that has its own repo, as seen from the vault scope.
    fn moved_out(&self, rel: &str) -> bool {
        matches!(self, Scope::Vault { .. }) && is_synced(rel) && !self.covers(rel)
    }
}

/// `docs`, `/docs/`, `` → a clean folder path (no leading or trailing `/`).
pub fn clean_path(p: &str) -> String {
    p.trim().trim_matches('/').to_string()
}

/// Git blob id of some bytes (what GitHub's tree API reports).
pub fn blob_sha(bytes: &[u8]) -> Sha {
    let mut h = Sha1::new();
    h.update(format!("blob {}\0", bytes.len()).as_bytes());
    h.update(bytes);
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// Every synced file under `<vault>/notebooks`, with iCloud placeholders.
pub fn scan_local(vault: &Path) -> Result<BTreeMap<String, Local>> {
    let mut out = BTreeMap::new();
    let root = vault.join("notebooks");
    if !root.is_dir() {
        return Ok(out);
    }
    for nb in fs::read_dir(&root)? {
        let nb = nb?;
        if !nb.file_type()?.is_dir() {
            continue;
        }
        let nb_name = nb.file_name().to_string_lossy().to_string();
        for f in fs::read_dir(nb.path())? {
            let f = f?;
            if !f.file_type()?.is_file() {
                continue;
            }
            let name = f.file_name().to_string_lossy().to_string();
            // iCloud placeholder: ".<name>.icloud"
            if let Some(real) = name
                .strip_prefix('.')
                .and_then(|n| n.strip_suffix(".icloud"))
            {
                let rel = format!("notebooks/{nb_name}/{real}");
                if is_synced(&rel) {
                    out.insert(rel, Local::Placeholder);
                }
                continue;
            }
            let rel = format!("notebooks/{nb_name}/{name}");
            if is_synced(&rel) {
                out.insert(rel, Local::File(blob_sha(&fs::read(f.path())?)));
            }
        }
    }
    Ok(out)
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Action {
    /// Local is new or changed: upload it.
    Push { path: String },
    /// Deleted locally: delete on GitHub.
    DeleteRemote { path: String },
    /// New or changed on GitHub: download it.
    Pull { path: String, sha: Sha },
    /// Deleted on GitHub: move the local copy to `.trash/`.
    DeleteLocal { path: String },
    /// Changed on both sides: keep local, save remote as `copy` (pushed too).
    Conflict {
        path: String,
        sha: Sha,
        copy: String,
    },
    /// Left alone this round (e.g. not downloaded from iCloud yet).
    Skip { path: String, reason: String },
}

/// `notes.md` → `notes.conflict-<stamp>.md`.
pub fn conflict_path(path: &str, stamp: &str) -> String {
    match path.rsplit_once('.') {
        Some((stem, ext)) => format!("{stem}.conflict-{stamp}.{ext}"),
        None => format!("{path}.conflict-{stamp}"),
    }
}

/// Decide what to do for every path. Pure: no IO.
pub fn plan(
    base: &BTreeMap<String, Sha>,
    local: &BTreeMap<String, Local>,
    remote: &BTreeMap<String, Sha>,
    stamp: &str,
) -> Vec<Action> {
    let paths: BTreeSet<&String> = base
        .keys()
        .chain(local.keys())
        .chain(remote.keys())
        .collect();
    let mut out = vec![];
    for path in paths {
        let b = base.get(path);
        let r = remote.get(path);
        let l = match local.get(path) {
            Some(Local::Placeholder) => {
                if r != b {
                    out.push(Action::Skip {
                        path: path.clone(),
                        reason: "waiting for iCloud to download it".into(),
                    });
                }
                continue;
            }
            Some(Local::File(s)) => Some(s),
            None => None,
        };
        if l == r {
            continue; // in sync
        }
        let local_changed = l != b;
        let remote_changed = r != b;
        let p = path.clone();
        match (local_changed, remote_changed) {
            (true, false) => out.push(match l {
                Some(_) => Action::Push { path: p },
                None => Action::DeleteRemote { path: p },
            }),
            (false, true) => out.push(match r {
                Some(s) => Action::Pull {
                    path: p,
                    sha: s.clone(),
                },
                None => Action::DeleteLocal { path: p },
            }),
            (true, true) => out.push(match (l, r) {
                // Edited here, deleted there (or the reverse): keep the edit.
                (Some(_), None) => Action::Push { path: p },
                (None, Some(s)) => Action::Pull {
                    path: p,
                    sha: s.clone(),
                },
                (Some(_), Some(s)) => Action::Conflict {
                    copy: conflict_path(&p, stamp),
                    path: p,
                    sha: s.clone(),
                },
                (None, None) => continue,
            }),
            (false, false) => {}
        }
    }
    out
}

// ---------------------------------------------------------------- GitHub

pub struct GitHub {
    http: reqwest::Client,
    token: String,
    pub repo: String,
    pub branch: String,
}

#[derive(Deserialize)]
struct BranchInfo {
    commit: BranchCommit,
}
#[derive(Deserialize)]
struct BranchCommit {
    sha: String,
    commit: CommitInner,
}
#[derive(Deserialize)]
struct CommitInner {
    tree: TreeRef,
}
#[derive(Deserialize)]
struct TreeRef {
    sha: String,
}
#[derive(Deserialize)]
struct Tree {
    tree: Vec<TreeEntry>,
    truncated: bool,
}
#[derive(Deserialize)]
struct TreeEntry {
    path: String,
    sha: String,
    #[serde(rename = "type")]
    kind: String,
}
#[derive(Deserialize)]
struct Blob {
    content: String,
}

impl GitHub {
    pub fn new(token: String, repo: String, branch: String) -> Self {
        Self {
            http: reqwest::Client::new(),
            token,
            repo,
            branch,
        }
    }

    fn get(&self, url: String) -> reqwest::RequestBuilder {
        self.http
            .get(url)
            .bearer_auth(&self.token)
            .header("User-Agent", "Cairn")
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
    }

    async fn json<T: serde::de::DeserializeOwned>(&self, url: String) -> Result<T> {
        let res = self.get(url).send().await?;
        let status = res.status();
        if !status.is_success() {
            let body = res.text().await.unwrap_or_default();
            return Err(SyncError::Api(format!(
                "{status}: {}",
                body.chars().take(200).collect::<String>()
            )));
        }
        Ok(res.json().await?)
    }

    /// Any REST call: `None` for a 404, the JSON otherwise.
    pub async fn rest(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> Result<Option<serde_json::Value>> {
        let mut req = self
            .http
            .request(method, format!("https://api.github.com/{path}"))
            .bearer_auth(&self.token)
            .header("User-Agent", "Cairn")
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28");
        if let Some(b) = body {
            req = req.json(&b);
        }
        let res = req.send().await?;
        let status = res.status();
        if status == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !status.is_success() {
            let body = res.text().await.unwrap_or_default();
            return Err(SyncError::Api(format!(
                "{status}: {}",
                body.chars().take(300).collect::<String>()
            )));
        }
        Ok(Some(res.json().await?))
    }

    /// (head commit, the files this scope covers, keyed by vault path).
    pub async fn snapshot(&self, scope: &Scope) -> Result<(String, BTreeMap<String, Sha>)> {
        let b: BranchInfo = self
            .json(format!(
                "https://api.github.com/repos/{}/branches/{}",
                self.repo, self.branch
            ))
            .await?;
        let t: Tree = self
            .json(format!(
                "https://api.github.com/repos/{}/git/trees/{}?recursive=1",
                self.repo, b.commit.commit.tree.sha
            ))
            .await?;
        if t.truncated {
            return Err(SyncError::Api("repository tree too large to list".into()));
        }
        let files = t
            .tree
            .into_iter()
            .filter(|e| e.kind == "blob")
            .filter_map(|e| scope.to_local(&e.path).map(|rel| (rel, e.sha)))
            .collect();
        Ok((b.commit.sha, files))
    }

    /// The repo's default branch (for a notebook linked without one).
    pub async fn default_branch(&self) -> Result<String> {
        let v = self
            .rest(reqwest::Method::GET, &format!("repos/{}", self.repo), None)
            .await?
            .ok_or_else(|| {
                SyncError::Api(format!(
                    "{} not found, or this sign-in can't see it",
                    self.repo
                ))
            })?;
        v.get("default_branch")
            .and_then(|b| b.as_str())
            .map(String::from)
            .ok_or_else(|| SyncError::Api("no default branch".into()))
    }

    pub async fn blob(&self, sha: &str) -> Result<Vec<u8>> {
        let b: Blob = self
            .json(format!(
                "https://api.github.com/repos/{}/git/blobs/{sha}",
                self.repo
            ))
            .await?;
        B64.decode(b.content.replace(['\n', '\r'], ""))
            .map_err(|e| SyncError::Api(format!("bad blob encoding: {e}")))
    }

    /// One signed commit. `HeadMoved` if the branch isn't at `expected` anymore.
    pub async fn commit(
        &self,
        expected: &str,
        headline: &str,
        additions: &[(String, Vec<u8>)],
        deletions: &[String],
    ) -> Result<String> {
        if self.branch.is_empty() {
            return Err(SyncError::Api("no branch".into()));
        }
        let query =
            "mutation($i:CreateCommitOnBranchInput!){createCommitOnBranch(input:$i){commit{oid}}}";
        let body = serde_json::json!({
            "query": query,
            "variables": {"i": {
                "branch": {"repositoryNameWithOwner": self.repo, "branchName": self.branch},
                "expectedHeadOid": expected,
                "message": {"headline": headline},
                "fileChanges": {
                    "additions": additions.iter().map(|(p, c)| serde_json::json!({"path": p, "contents": B64.encode(c)})).collect::<Vec<_>>(),
                    "deletions": deletions.iter().map(|p| serde_json::json!({"path": p})).collect::<Vec<_>>(),
                },
            }},
        });
        let res = self
            .http
            .post("https://api.github.com/graphql")
            .bearer_auth(&self.token)
            .header("User-Agent", "Cairn")
            .json(&body)
            .send()
            .await?;
        let v: serde_json::Value = res.json().await?;
        if let Some(errs) = v.get("errors") {
            let msg = errs.to_string();
            if msg.contains("expectedHeadOid")
                || msg.contains("is at")
                || msg.contains("STALE_DATA")
            {
                return Err(SyncError::HeadMoved);
            }
            return Err(SyncError::Api(msg.chars().take(300).collect()));
        }
        v.pointer("/data/createCommitOnBranch/commit/oid")
            .and_then(|o| o.as_str())
            .map(String::from)
            .ok_or_else(|| SyncError::Api("no commit returned".into()))
    }
}

// ---------------------------------------------------------------- state

/// What was in sync last time, stored outside the vault.
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct SyncState {
    pub repo: String,
    pub branch: String,
    /// Folder in the repo (notebook syncs); "" for the vault repo.
    #[serde(default)]
    pub path: String,
    pub head: Option<String>,
    pub files: BTreeMap<String, Sha>,
    pub at: Option<String>,
}

impl SyncState {
    pub fn load(path: &Path) -> Self {
        fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }
    pub fn save(&self, path: &Path) -> Result<()> {
        if let Some(d) = path.parent() {
            fs::create_dir_all(d)?;
        }
        write_atomic(
            path,
            serde_json::to_string_pretty(self)
                .unwrap_or_default()
                .as_bytes(),
        )
    }
}

#[derive(Debug, Default, Clone, Serialize)]
pub struct Report {
    pub dry_run: bool,
    /// No previous sync with this repo and branch: the preview matters.
    pub first_link: bool,
    pub pushed: Vec<String>,
    pub pulled: Vec<String>,
    pub deleted_remote: Vec<String>,
    pub deleted_local: Vec<String>,
    pub conflicts: Vec<String>,
    pub skipped: Vec<String>,
    /// Notebooks whose own-repo sync failed this round: "Title: reason".
    #[serde(default)]
    pub errors: Vec<String>,
    pub head: String,
    pub at: String,
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(d) = path.parent() {
        fs::create_dir_all(d)?;
    }
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let tmp = path.with_file_name(format!(".{name}.cairn-tmp"));
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    fs::rename(tmp, path)?;
    Ok(())
}

fn to_trash(vault: &Path, rel: &str, stamp: &str) -> Result<()> {
    let src = vault.join(rel);
    if src.is_file() {
        let dst = vault.join(".trash").join(format!("sync-{stamp}")).join(rel);
        if let Some(d) = dst.parent() {
            fs::create_dir_all(d)?;
        }
        fs::rename(src, dst)?;
    }
    Ok(())
}

/// Ask iCloud to download evicted files (best effort, macOS only).
fn request_downloads(vault: &Path, rels: &[String]) {
    for rel in rels {
        if let Some((dir, name)) = rel.rsplit_once('/') {
            let p = vault.join(dir).join(format!(".{name}.icloud"));
            let _ = std::process::Command::new("brctl")
                .arg("download")
                .arg(p)
                .spawn();
        }
    }
}

/// One full sync round. With `dry_run`, only reports what would happen.
pub async fn sync_once(
    gh: &GitHub,
    scope: &Scope,
    vault: &Path,
    state_path: &Path,
    dry_run: bool,
) -> Result<Report> {
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let prev = SyncState::load(state_path);
    let linked = prev.repo == gh.repo
        && prev.branch == gh.branch
        && prev.path == scope.path()
        && prev.head.is_some();
    let base: BTreeMap<String, Sha> = if linked {
        prev.files.clone()
    } else {
        BTreeMap::new()
    };

    let (head, mut remote) = gh.snapshot(scope).await?;
    // Notes that moved to their notebook's own repo: retire the vault repo's
    // copies we synced before (they're deleted there, kept in its history),
    // and never pull ones we didn't.
    remote.retain(|p, _| !scope.moved_out(p) || base.contains_key(p));
    let local: BTreeMap<String, Local> = scan_local(vault)?
        .into_iter()
        .filter(|(p, _)| scope.covers(p))
        .collect();
    let actions: Vec<Action> = plan(&base, &local, &remote, &stamp)
        .into_iter()
        .map(|a| match a {
            // Their home is the notebook's repo now: whatever the vault repo
            // still has of them is retired, even if it changed there.
            Action::Pull { path, .. } | Action::Conflict { path, .. } if scope.moved_out(&path) => {
                Action::DeleteRemote { path }
            }
            a => a,
        })
        .collect();

    let mut rep = Report {
        dry_run,
        first_link: !linked,
        head: head.clone(),
        at: chrono::Local::now().to_rfc3339(),
        ..Default::default()
    };
    for a in &actions {
        match a {
            Action::Push { path } => rep.pushed.push(path.clone()),
            Action::DeleteRemote { path } => rep.deleted_remote.push(path.clone()),
            Action::Pull { path, .. } => rep.pulled.push(path.clone()),
            Action::DeleteLocal { path } => rep.deleted_local.push(path.clone()),
            Action::Conflict { path, .. } => rep.conflicts.push(path.clone()),
            Action::Skip { path, .. } => rep.skipped.push(path.clone()),
        }
    }
    if dry_run {
        return Ok(rep);
    }
    request_downloads(vault, &rep.skipped);

    // 1. Bring remote changes down.
    let mut additions: Vec<(String, Vec<u8>)> = vec![];
    let mut deletions: Vec<String> = vec![];
    for a in &actions {
        match a {
            Action::Pull { path, sha } => write_atomic(&vault.join(path), &gh.blob(sha).await?)?,
            Action::DeleteLocal { path } => to_trash(vault, path, &stamp)?,
            Action::Conflict { path, sha, copy } => {
                let theirs = gh.blob(sha).await?;
                // notebook.yml conflicts keep a local-only copy; notes push theirs too.
                let local_copy = if path.ends_with("notebook.yml") {
                    path.replace("notebook.yml", &format!("notebook.conflict-{stamp}.yml"))
                } else {
                    copy.clone()
                };
                write_atomic(&vault.join(&local_copy), &theirs)?;
                if scope.covers(&local_copy) {
                    additions.push((local_copy, theirs));
                }
                additions.push((path.clone(), fs::read(vault.join(path))?));
            }
            Action::Push { path } => additions.push((path.clone(), fs::read(vault.join(path))?)),
            Action::DeleteRemote { path } => deletions.push(path.clone()),
            Action::Skip { .. } => {}
        }
    }

    // 2. Send local changes up, as one signed commit.
    let mut new_head = head.clone();
    if !additions.is_empty() || !deletions.is_empty() {
        let n = additions.len() + deletions.len();
        let headline = format!("cairn: sync {n} file{}", if n == 1 { "" } else { "s" });
        let additions: Vec<(String, Vec<u8>)> = additions
            .into_iter()
            .map(|(p, c)| (scope.to_remote(&p), c))
            .collect();
        let deletions: Vec<String> = deletions.iter().map(|p| scope.to_remote(p)).collect();
        new_head = gh.commit(&head, &headline, &additions, &deletions).await?;
    }

    // 3. Remember what's now in sync. Placeholders keep their old base.
    let now = scan_local(vault)?;
    let mut files = BTreeMap::new();
    for (path, st) in now.iter().filter(|(p, _)| scope.covers(p)) {
        match st {
            Local::File(s) => {
                files.insert(path.clone(), s.clone());
            }
            Local::Placeholder => {
                if let Some(s) = base.get(path).or(remote.get(path)) {
                    files.insert(path.clone(), s.clone());
                }
            }
        }
    }
    let state = SyncState {
        repo: gh.repo.clone(),
        branch: gh.branch.clone(),
        path: scope.path(),
        head: Some(new_head.clone()),
        files,
        at: Some(rep.at.clone()),
    };
    state.save(state_path)?;
    rep.head = new_head;
    Ok(rep)
}

// ---------------------------------------------------------------- iCloud mirror

#[derive(Debug, Default, Serialize)]
pub struct MirrorReport {
    pub dest: String,
    pub copied: usize,
    pub trashed: usize,
}

/// One-way copy of synced files into `dest` (an iCloud Drive folder). Files
/// gone from the vault move to `dest/.trash/` rather than being deleted.
pub fn mirror(vault: &Path, dest: &Path) -> Result<MirrorReport> {
    let mut rep = MirrorReport {
        dest: dest.display().to_string(),
        ..Default::default()
    };
    let src = scan_local(vault)?;
    let have = scan_local(dest)?;
    for (rel, st) in &src {
        if let Local::File(sha) = st
            && have.get(rel) != Some(&Local::File(sha.clone()))
        {
            write_atomic(&dest.join(rel), &fs::read(vault.join(rel))?)?;
            rep.copied += 1;
        }
    }
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    for rel in have.keys() {
        if !src.contains_key(rel) {
            to_trash(dest, rel, &stamp)?;
            rep.trashed += 1;
        }
    }
    Ok(rep)
}

/// `~/Library/Mobile Documents/com~apple~CloudDocs` if iCloud Drive is on.
pub fn icloud_drive() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    let p = PathBuf::from(home).join("Library/Mobile Documents/com~apple~CloudDocs");
    p.is_dir().then_some(p)
}

pub fn in_icloud(path: &Path) -> bool {
    path.components()
        .any(|c| c.as_os_str() == "Mobile Documents")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn m(pairs: &[(&str, &str)]) -> BTreeMap<String, Sha> {
        pairs
            .iter()
            .map(|(p, s)| (p.to_string(), s.to_string()))
            .collect()
    }
    fn l(pairs: &[(&str, Option<&str>)]) -> BTreeMap<String, Local> {
        pairs
            .iter()
            .map(|(p, s)| {
                (
                    p.to_string(),
                    s.map(|s| Local::File(s.into()))
                        .unwrap_or(Local::Placeholder),
                )
            })
            .collect()
    }
    const A: &str = "notebooks/0001-a/2026-11-15-a.md";
    const B: &str = "notebooks/0001-a/2026-11-15-b.md";

    #[test]
    fn scopes_map_paths() {
        let own: BTreeSet<String> = ["0002-proj".to_string()].into();
        let v = Scope::Vault { own_repo: own };
        assert!(v.covers("notebooks/0001-a/x.md"));
        assert!(v.covers("notebooks/0002-proj/notebook.yml"));
        assert!(!v.covers("notebooks/0002-proj/x.md"));
        assert!(v.moved_out("notebooks/0002-proj/x.md"));
        assert_eq!(
            v.to_local("notebooks/0002-proj/x.md").as_deref(),
            Some("notebooks/0002-proj/x.md")
        );
        assert_eq!(
            v.to_remote("notebooks/0001-a/x.md"),
            "notebooks/0001-a/x.md"
        );

        let n = Scope::Notebook {
            id: "0002-proj".into(),
            path: clean_path("/docs/"),
        };
        assert!(n.covers("notebooks/0002-proj/x.md"));
        assert!(!n.covers("notebooks/0002-proj/notebook.yml"));
        assert!(!n.covers("notebooks/0001-a/x.md"));
        assert_eq!(n.to_remote("notebooks/0002-proj/x.md"), "docs/x.md");
        assert_eq!(
            n.to_local("docs/x.md").as_deref(),
            Some("notebooks/0002-proj/x.md")
        );
        assert_eq!(n.to_local("docs/deep/x.md"), None);
        assert_eq!(n.to_local("docsx/x.md"), None);
        assert_eq!(n.to_local("README.md"), None);
        assert_eq!(n.to_local("docs/notebook.yml"), None);
        assert_eq!(n.to_local("docs/.hidden.md"), None);

        let root = Scope::Notebook {
            id: "0003-r".into(),
            path: String::new(),
        };
        assert_eq!(
            root.to_local("README.md").as_deref(),
            Some("notebooks/0003-r/README.md")
        );
        assert_eq!(root.to_local("src/a.md"), None);
        assert_eq!(root.to_remote("notebooks/0003-r/README.md"), "README.md");
    }

    #[test]
    fn synced_paths() {
        assert!(is_synced("notebooks/0001-a/x.md"));
        assert!(is_synced("notebooks/0001-a/notebook.yml"));
        assert!(!is_synced("notebooks/0001-a/cover.svg"));
        assert!(!is_synced("notebooks/0001-a/.x.md"));
        assert!(!is_synced("notebooks/x.md"));
        assert!(!is_synced("README.md"));
        assert!(!is_synced(".trash/notebooks/0001-a/x.md"));
        assert!(!is_synced("notebooks/0001-a/sub/x.md"));
    }

    #[test]
    fn git_blob_sha_matches_git() {
        // `printf 'hello\n' | git hash-object --stdin`
        assert_eq!(
            blob_sha(b"hello\n"),
            "ce013625030ba8dba906f756967f9e9ca394464a"
        );
    }

    #[test]
    fn plan_one_sided_changes() {
        let base = m(&[(A, "1"), (B, "1")]);
        // A edited here, B edited there.
        let p = plan(
            &base,
            &l(&[(A, Some("2")), (B, Some("1"))]),
            &m(&[(A, "1"), (B, "3")]),
            "s",
        );
        assert_eq!(
            p,
            vec![
                Action::Push { path: A.into() },
                Action::Pull {
                    path: B.into(),
                    sha: "3".into()
                }
            ]
        );
        // A deleted here, B deleted there.
        let p = plan(&base, &l(&[(B, Some("1"))]), &m(&[(A, "1")]), "s");
        assert_eq!(
            p,
            vec![
                Action::DeleteRemote { path: A.into() },
                Action::DeleteLocal { path: B.into() }
            ]
        );
        // Unchanged: nothing.
        assert!(plan(&base, &l(&[(A, Some("1")), (B, Some("1"))]), &base, "s").is_empty());
    }

    #[test]
    fn plan_conflicts_keep_both() {
        let base = m(&[(A, "1")]);
        let p = plan(
            &base,
            &l(&[(A, Some("2"))]),
            &m(&[(A, "3")]),
            "20261115-1000",
        );
        assert_eq!(
            p,
            vec![Action::Conflict {
                path: A.into(),
                sha: "3".into(),
                copy: "notebooks/0001-a/2026-11-15-a.conflict-20261115-1000.md".into()
            }]
        );
        // Edited here, deleted there → keep (push). Deleted here, edited there → keep (pull).
        assert_eq!(
            plan(&base, &l(&[(A, Some("2"))]), &m(&[]), "s"),
            vec![Action::Push { path: A.into() }]
        );
        assert_eq!(
            plan(&base, &l(&[]), &m(&[(A, "3")]), "s"),
            vec![Action::Pull {
                path: A.into(),
                sha: "3".into()
            }]
        );
    }

    #[test]
    fn plan_first_link_merges() {
        // No base: local-only pushes, remote-only pulls, same content is a no-op.
        let p = plan(
            &m(&[]),
            &l(&[(A, Some("1")), (B, Some("2"))]),
            &m(&[(B, "2"), ("notebooks/0002-b/x.md", "9")]),
            "s",
        );
        assert_eq!(
            p,
            vec![
                Action::Push { path: A.into() },
                Action::Pull {
                    path: "notebooks/0002-b/x.md".into(),
                    sha: "9".into()
                }
            ]
        );
    }

    #[test]
    fn placeholders_are_never_deletions() {
        let base = m(&[(A, "1")]);
        // Evicted locally, unchanged remotely: nothing (not a delete).
        assert!(plan(&base, &l(&[(A, None)]), &base, "s").is_empty());
        // Evicted locally, changed remotely: skip until downloaded.
        assert!(matches!(
            plan(&base, &l(&[(A, None)]), &m(&[(A, "2")]), "s")[0],
            Action::Skip { .. }
        ));
    }

    #[test]
    fn scan_and_mirror() {
        let v = tempfile::tempdir().unwrap();
        let d = tempfile::tempdir().unwrap();
        let nb = v.path().join("notebooks/0001-a");
        fs::create_dir_all(&nb).unwrap();
        fs::write(nb.join("x.md"), "x").unwrap();
        fs::write(nb.join("notebook.yml"), "title: A\n").unwrap();
        fs::write(nb.join("cover.svg"), "<svg/>").unwrap();
        fs::write(nb.join(".y.md.icloud"), "").unwrap();
        let s = scan_local(v.path()).unwrap();
        assert_eq!(s.len(), 3);
        assert_eq!(s["notebooks/0001-a/y.md"], Local::Placeholder);

        let r = mirror(v.path(), d.path()).unwrap();
        assert_eq!((r.copied, r.trashed), (2, 0));
        assert_eq!(mirror(v.path(), d.path()).unwrap().copied, 0, "idempotent");
        fs::remove_file(nb.join("x.md")).unwrap();
        let r = mirror(v.path(), d.path()).unwrap();
        assert_eq!(r.trashed, 1);
        assert!(!d.path().join("notebooks/0001-a/x.md").exists());
    }
}

/// End-to-end against a real repo branch. Opt-in:
/// `CAIRN_E2E_REPO=owner/name CAIRN_E2E_BRANCH=e2e GITHUB_TOKEN=… cargo test -- --ignored e2e`
#[cfg(test)]
mod e2e {
    use super::*;

    fn gh() -> Option<GitHub> {
        Some(GitHub::new(
            std::env::var("GITHUB_TOKEN").ok()?,
            std::env::var("CAIRN_E2E_REPO").ok()?,
            std::env::var("CAIRN_E2E_BRANCH").ok()?,
        ))
    }

    /// A notebook moves from the vault repo to a folder of its own (here a
    /// folder in the same test repo, standing in for a project repo).
    #[tokio::test]
    #[ignore]
    async fn e2e_notebook_scope() {
        let Some(gh) = gh() else { return };
        let vault = tempfile::tempdir().unwrap();
        let states = tempfile::tempdir().unwrap();
        let vstate = states.path().join("vault.json");
        let nstate = states.path().join("nb.json");
        let nb = vault.path().join("notebooks/0098-proj");
        fs::create_dir_all(&nb).unwrap();
        fs::write(nb.join("notebook.yml"), "title: Proj\n").unwrap();
        fs::write(nb.join("a.md"), "# A\n").unwrap();
        let folder = format!("e2e-docs-{}", std::process::id());
        let in_vault = Scope::Vault {
            own_repo: BTreeSet::new(),
        };
        let moved = Scope::Vault {
            own_repo: ["0098-proj".to_string()].into(),
        };
        let own = Scope::Notebook {
            id: "0098-proj".into(),
            path: folder.clone(),
        };
        let all = |t: &BTreeMap<String, Sha>| t.keys().cloned().collect::<Vec<_>>();

        // 1. In the vault repo, like any notebook.
        sync_once(&gh, &in_vault, vault.path(), &vstate, false)
            .await
            .unwrap();
        let (_, remote) = gh.snapshot(&in_vault).await.unwrap();
        assert!(
            remote.contains_key("notebooks/0098-proj/a.md"),
            "{:?}",
            all(&remote)
        );

        // 2. Linked to its own folder: the note goes there…
        let r = sync_once(&gh, &own, vault.path(), &nstate, false)
            .await
            .unwrap();
        assert!(r.first_link);
        assert_eq!(r.pushed, vec!["notebooks/0098-proj/a.md"]);
        let (_, remote) = gh.snapshot(&own).await.unwrap();
        assert_eq!(all(&remote), vec!["notebooks/0098-proj/a.md"]);

        // 3. …and the vault repo retires its copy, keeping notebook.yml.
        let r = sync_once(&gh, &moved, vault.path(), &vstate, false)
            .await
            .unwrap();
        assert_eq!(r.deleted_remote, vec!["notebooks/0098-proj/a.md"]);
        let (_, remote) = gh.snapshot(&in_vault).await.unwrap();
        assert!(!remote.contains_key("notebooks/0098-proj/a.md"));
        assert!(remote.contains_key("notebooks/0098-proj/notebook.yml"));
        assert!(nb.join("a.md").is_file(), "the local note stays");

        // 4. Someone adds a doc in the folder (and one deeper, which isn't a note).
        let (head, _) = gh.snapshot(&own).await.unwrap();
        gh.commit(
            &head,
            "e2e: docs from elsewhere",
            &[
                (format!("{folder}/b.md"), b"# B\n".to_vec()),
                (format!("{folder}/deep/c.md"), b"# C\n".to_vec()),
            ],
            &[],
        )
        .await
        .unwrap();
        let r = sync_once(&gh, &own, vault.path(), &nstate, false)
            .await
            .unwrap();
        assert_eq!(r.pulled, vec!["notebooks/0098-proj/b.md"]);
        assert!(nb.join("b.md").is_file());
        assert!(!nb.join("c.md").exists());
        // The vault repo leaves notes it never had alone.
        let r = sync_once(&gh, &moved, vault.path(), &vstate, true)
            .await
            .unwrap();
        assert!(
            r.pulled.is_empty() && r.pushed.is_empty() && r.deleted_remote.is_empty(),
            "{r:?}"
        );
    }

    #[tokio::test]
    #[ignore]
    async fn e2e_round_trip() {
        let Some(gh) = gh() else { return };
        let vault = tempfile::tempdir().unwrap();
        let state = vault.path().join("../state.json");
        let nb = vault.path().join("notebooks/0099-e2e");
        fs::create_dir_all(&nb).unwrap();
        fs::write(nb.join("notebook.yml"), "title: E2E\n").unwrap();
        fs::write(nb.join("a.md"), "# A\n").unwrap();

        // First link: our two files go up, whatever is on the branch comes down.
        let r = sync_once(
            &gh,
            &Scope::Vault {
                own_repo: BTreeSet::new(),
            },
            vault.path(),
            &state,
            false,
        )
        .await
        .unwrap();
        assert!(r.first_link);
        assert!(r.pushed.contains(&"notebooks/0099-e2e/a.md".to_string()));
        let again = sync_once(
            &gh,
            &Scope::Vault {
                own_repo: BTreeSet::new(),
            },
            vault.path(),
            &state,
            true,
        )
        .await
        .unwrap();
        assert!(
            !again.first_link && again.pushed.is_empty() && again.pulled.is_empty(),
            "{again:?}"
        );

        // Local edit → push.
        fs::write(nb.join("a.md"), "# A\n\nlocal edit\n").unwrap();
        let r = sync_once(
            &gh,
            &Scope::Vault {
                own_repo: BTreeSet::new(),
            },
            vault.path(),
            &state,
            false,
        )
        .await
        .unwrap();
        assert_eq!(r.pushed, vec!["notebooks/0099-e2e/a.md"]);

        // Remote edit (another machine) → pull.
        let (head, _) = gh
            .snapshot(&Scope::Vault {
                own_repo: BTreeSet::new(),
            })
            .await
            .unwrap();
        gh.commit(
            &head,
            "e2e: remote edit",
            &[(
                "notebooks/0099-e2e/b.md".into(),
                b"# B from elsewhere\n".to_vec(),
            )],
            &[],
        )
        .await
        .unwrap();
        let r = sync_once(
            &gh,
            &Scope::Vault {
                own_repo: BTreeSet::new(),
            },
            vault.path(),
            &state,
            false,
        )
        .await
        .unwrap();
        assert_eq!(r.pulled, vec!["notebooks/0099-e2e/b.md"]);
        assert_eq!(
            fs::read_to_string(nb.join("b.md")).unwrap(),
            "# B from elsewhere\n"
        );

        // Both sides edit a.md → conflict copy, both kept.
        let (head, _) = gh
            .snapshot(&Scope::Vault {
                own_repo: BTreeSet::new(),
            })
            .await
            .unwrap();
        gh.commit(
            &head,
            "e2e: their a",
            &[("notebooks/0099-e2e/a.md".into(), b"# A theirs\n".to_vec())],
            &[],
        )
        .await
        .unwrap();
        fs::write(nb.join("a.md"), "# A mine\n").unwrap();
        let r = sync_once(
            &gh,
            &Scope::Vault {
                own_repo: BTreeSet::new(),
            },
            vault.path(),
            &state,
            false,
        )
        .await
        .unwrap();
        assert_eq!(r.conflicts, vec!["notebooks/0099-e2e/a.md"]);
        assert_eq!(fs::read_to_string(nb.join("a.md")).unwrap(), "# A mine\n");
        let copy = fs::read_dir(&nb)
            .unwrap()
            .filter_map(|e| e.ok())
            .find(|e| e.file_name().to_string_lossy().contains(".conflict-"))
            .unwrap();
        assert_eq!(fs::read_to_string(copy.path()).unwrap(), "# A theirs\n");
        let (_, remote) = gh
            .snapshot(&Scope::Vault {
                own_repo: BTreeSet::new(),
            })
            .await
            .unwrap();
        assert_eq!(remote["notebooks/0099-e2e/a.md"], blob_sha(b"# A mine\n"));

        // Local delete → remote delete.
        fs::remove_file(nb.join("b.md")).unwrap();
        let r = sync_once(
            &gh,
            &Scope::Vault {
                own_repo: BTreeSet::new(),
            },
            vault.path(),
            &state,
            false,
        )
        .await
        .unwrap();
        assert_eq!(r.deleted_remote, vec!["notebooks/0099-e2e/b.md"]);
        let (_, remote) = gh
            .snapshot(&Scope::Vault {
                own_repo: BTreeSet::new(),
            })
            .await
            .unwrap();
        assert!(!remote.contains_key("notebooks/0099-e2e/b.md"));
    }
}
