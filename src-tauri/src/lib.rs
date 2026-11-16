pub mod search;
mod sync;
pub mod vault;

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, State};
use vault::{NoteMeta, Notebook, NotebookMeta, Result, Vault, VaultError};

/// App config persisted at `<app_config_dir>/config.json`.
#[derive(Default, Serialize, Deserialize)]
struct Config {
    vault_path: Option<PathBuf>,
    #[serde(default)]
    sync: SyncSettings,
    /// Copy notes to iCloud Drive/Cairn Backup (only when the vault isn't
    /// already in iCloud Drive).
    #[serde(default)]
    mirror: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
struct SyncSettings {
    enabled: bool,
    /// `owner/name` of the vault repo on GitHub.
    repo: String,
    branch: String,
    /// "gh" (GitHub CLI login) or "keychain" (a token pasted into Cairn).
    token_source: String,
}

impl Default for SyncSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            repo: String::new(),
            branch: "main".into(),
            token_source: "gh".into(),
        }
    }
}

const KEYCHAIN_SERVICE: &str = "dev.ry-ops.cairn";
const KEYCHAIN_USER: &str = "github-token";

#[derive(Default)]
struct AppState {
    vault: Mutex<Option<Vault>>,
    /// Window frame saved while the notebook sits on the desktop.
    desk: Mutex<Option<(tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>)>>,
    /// Full-text index, built on first search.
    search: Mutex<Option<search::SearchIndex>>,
}

fn config_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|d| d.join("config.json"))
}

fn load_config(app: &AppHandle) -> Config {
    config_path(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_config(app: &AppHandle, cfg: &Config) -> Result<()> {
    if let Some(p) = config_path(app) {
        if let Some(d) = p.parent() {
            fs::create_dir_all(d)?;
        }
        fs::write(p, serde_json::to_string_pretty(cfg).unwrap_or_default())?;
    }
    Ok(())
}

fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

/// Run `f` against the open vault, or fail with `NoVault`.
fn with_vault<T>(state: &State<AppState>, f: impl FnOnce(&Vault) -> Result<T>) -> Result<T> {
    let guard = state.vault.lock().unwrap_or_else(|e| e.into_inner());
    match guard.as_ref() {
        Some(v) => f(v),
        None => Err(VaultError::NoVault),
    }
}

#[tauri::command]
fn get_vault(state: State<AppState>) -> Option<String> {
    let guard = state.vault.lock().unwrap_or_else(|e| e.into_inner());
    guard.as_ref().map(|v| v.root().display().to_string())
}

#[tauri::command]
fn set_vault(app: AppHandle, state: State<AppState>, path: String) -> Result<String> {
    // An empty folder becomes a new vault with a starter notebook.
    let blank = Vault::is_blank(std::path::Path::new(&path));
    let v = Vault::open(&path)?;
    if blank {
        v.seed(&today())?;
    }
    let root = v.root().to_path_buf();
    *state.vault.lock().unwrap_or_else(|e| e.into_inner()) = Some(v);
    let mut cfg = load_config(&app);
    cfg.vault_path = Some(root.clone());
    save_config(&app, &cfg)?;
    Ok(root.display().to_string())
}

#[tauri::command]
fn list_notebooks(state: State<AppState>) -> Result<Vec<Notebook>> {
    with_vault(&state, |v| v.list_notebooks())
}

#[tauri::command]
fn create_notebook(
    state: State<AppState>,
    title: String,
    color: String,
    paper: String,
) -> Result<Notebook> {
    with_vault(&state, |v| {
        v.create_notebook(&title, &color, &paper, &today())
    })
}

#[tauri::command]
fn update_notebook(state: State<AppState>, id: String, meta: NotebookMeta) -> Result<()> {
    with_vault(&state, |v| v.update_notebook(&id, &meta))
}

#[tauri::command]
fn list_notes(state: State<AppState>, notebook: String) -> Result<Vec<NoteMeta>> {
    with_vault(&state, |v| v.list_notes(&notebook))
}

#[tauri::command]
fn read_note(state: State<AppState>, notebook: String, file: String) -> Result<String> {
    with_vault(&state, |v| v.read_note(&notebook, &file))
}

#[tauri::command]
fn write_note(
    state: State<AppState>,
    notebook: String,
    file: String,
    contents: String,
) -> Result<()> {
    with_vault(&state, |v| v.write_note(&notebook, &file, &contents))
}

#[tauri::command]
fn create_note(state: State<AppState>, notebook: String, title: String) -> Result<NoteMeta> {
    with_vault(&state, |v| v.create_note(&notebook, &title, &today()))
}

#[tauri::command]
fn trash_notebook(state: State<AppState>, id: String) -> Result<()> {
    with_vault(&state, |v| v.trash_notebook(&id))
}

#[tauri::command]
fn trash_note(state: State<AppState>, notebook: String, file: String) -> Result<()> {
    with_vault(&state, |v| v.trash_note(&notebook, &file))
}

#[tauri::command]
fn read_cover(state: State<AppState>, notebook: String) -> Result<Option<String>> {
    with_vault(&state, |v| v.read_cover(&notebook))
}

#[tauri::command]
fn read_button(state: State<AppState>, notebook: String) -> Result<Option<String>> {
    with_vault(&state, |v| v.read_button(&notebook))
}

#[tauri::command]
fn list_library(state: State<AppState>) -> Result<Vec<String>> {
    with_vault(&state, |v| v.list_library())
}

#[tauri::command]
fn read_library(state: State<AppState>, name: String) -> Result<Option<String>> {
    with_vault(&state, |v| v.read_library(&name))
}

#[tauri::command]
fn set_shelf_order(state: State<AppState>, order: Vec<String>) -> Result<()> {
    with_vault(&state, |v| v.write_shelf(&order))
}

#[tauri::command]
fn read_badges(state: State<AppState>) -> Result<std::collections::BTreeMap<String, String>> {
    with_vault(&state, |v| v.read_badges())
}

#[tauri::command]
fn write_badges(
    state: State<AppState>,
    earned: std::collections::BTreeMap<String, String>,
) -> Result<()> {
    with_vault(&state, |v| v.write_badges(&earned))
}

#[tauri::command]
fn list_stickers(state: State<AppState>) -> Result<Vec<(String, String)>> {
    with_vault(&state, |v| v.list_stickers())
}

#[tauri::command]
fn all_notes(state: State<AppState>) -> Result<Vec<vault::NoteText>> {
    with_vault(&state, |v| v.all_notes())
}

/// Search every note. Brings the index up to date first (only changed files
/// are re-read).
#[tauri::command]
fn search(
    state: State<AppState>,
    query: String,
    limit: Option<usize>,
) -> std::result::Result<Vec<search::Hit>, String> {
    let vault = state.vault.lock().unwrap_or_else(|e| e.into_inner());
    let vault = vault.as_ref().ok_or("no vault selected")?;
    let mut ix = state.search.lock().unwrap_or_else(|e| e.into_inner());
    if ix.is_none() {
        *ix = Some(search::SearchIndex::new().map_err(|e| e.to_string())?);
    }
    let ix = ix.as_mut().expect("just set");
    ix.refresh(vault)?;
    ix.search(&query, limit.unwrap_or(40).min(200))
}

#[tauri::command]
fn save_to_library(state: State<AppState>, notebook: String, name: String) -> Result<String> {
    with_vault(&state, |v| v.save_to_library(&notebook, &name))
}

// ---------------------------------------------------------------- sync

/// Find the `gh` CLI: GUI apps get a minimal PATH, so check the usual spots.
fn gh_path() -> Option<PathBuf> {
    ["/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/usr/bin/gh"]
        .iter()
        .map(PathBuf::from)
        .find(|p| p.is_file())
}

fn token_for(settings: &SyncSettings) -> std::result::Result<String, String> {
    if settings.token_source == "keychain" {
        return keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER)
            .and_then(|e| e.get_password())
            .map_err(|_| {
                "No GitHub token saved in the Keychain. Paste one in Sync settings.".to_string()
            });
    }
    let gh = gh_path().ok_or("GitHub CLI (gh) not found. Install it or paste a token instead.")?;
    let out = std::process::Command::new(gh)
        .args(["auth", "token"])
        .output()
        .map_err(|e| e.to_string())?;
    let token = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if !out.status.success() || token.is_empty() {
        return Err("GitHub CLI isn't logged in. Run `gh auth login`, or paste a token.".into());
    }
    Ok(token)
}

/// Where the last-sync state for this vault lives (outside the vault).
fn state_path(app: &AppHandle, vault: &std::path::Path) -> std::result::Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let key = sync::blob_sha(vault.display().to_string().as_bytes());
    Ok(dir.join("sync").join(format!("{}.json", &key[..16])))
}

fn vault_root(state: &State<AppState>) -> std::result::Result<PathBuf, String> {
    let guard = state.vault.lock().unwrap_or_else(|e| e.into_inner());
    guard
        .as_ref()
        .map(|v| v.root().to_path_buf())
        .ok_or_else(|| "no vault selected".into())
}

#[derive(Serialize)]
struct SyncInfo {
    settings: SyncSettings,
    mirror: bool,
    gh_available: bool,
    keychain_has_token: bool,
    vault_in_icloud: bool,
    icloud_available: bool,
    last_sync: Option<String>,
}

#[tauri::command]
fn get_sync(app: AppHandle, state: State<AppState>) -> SyncInfo {
    let cfg = load_config(&app);
    let root = vault_root(&state).ok();
    let last_sync = root
        .as_ref()
        .and_then(|r| state_path(&app, r).ok())
        .map(|p| sync::SyncState::load(&p))
        .filter(|s| s.repo == cfg.sync.repo && s.branch == cfg.sync.branch)
        .and_then(|s| s.at);
    SyncInfo {
        gh_available: gh_path().is_some(),
        keychain_has_token: keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER)
            .and_then(|e| e.get_password())
            .is_ok(),
        vault_in_icloud: root.as_deref().is_some_and(sync::in_icloud),
        icloud_available: sync::icloud_drive().is_some(),
        settings: cfg.sync,
        mirror: cfg.mirror,
        last_sync,
    }
}

#[tauri::command]
fn set_sync(
    app: AppHandle,
    settings: SyncSettings,
    mirror: bool,
) -> std::result::Result<(), String> {
    let repo = settings.repo.trim();
    if settings.enabled && (repo.split('/').count() != 2 || repo.contains(char::is_whitespace)) {
        return Err("Repository should look like owner/name.".into());
    }
    let mut cfg = load_config(&app);
    cfg.sync = SyncSettings {
        repo: repo.to_string(),
        ..settings
    };
    cfg.mirror = mirror;
    save_config(&app, &cfg).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_token(token: String) -> std::result::Result<(), String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER).map_err(|e| e.to_string())?;
    if token.trim().is_empty() {
        let _ = entry.delete_credential();
        return Ok(());
    }
    entry.set_password(token.trim()).map_err(|e| e.to_string())
}

#[derive(Serialize)]
struct VaultRepo {
    /// The repo exists and this sign-in can see it.
    exists: bool,
    /// The signed-in GitHub account.
    login: String,
}

/// Does the vault repo in these (maybe unsaved) settings exist yet?
#[tauri::command]
async fn check_vault_repo(settings: SyncSettings) -> std::result::Result<VaultRepo, String> {
    let repo = settings.repo.trim().to_string();
    if !valid_repo(&repo) {
        return Err("Repository should look like owner/name.".into());
    }
    let gh = sync::GitHub::new(token_for(&settings)?, repo.clone(), String::new());
    let me = gh
        .rest(reqwest::Method::GET, "user", None)
        .await
        .map_err(|e| e.to_string())?
        .ok_or("GitHub didn't recognize this sign-in.")?;
    let exists = gh
        .rest(reqwest::Method::GET, &format!("repos/{repo}"), None)
        .await
        .map_err(|e| e.to_string())?
        .is_some();
    Ok(VaultRepo {
        exists,
        login: me["login"].as_str().unwrap_or_default().to_string(),
    })
}

/// Create the vault repo: private, with a README, so it has a first commit
/// (and branch) for sync to build on. Under the signed-in account, or under
/// an organization the account can create repos in. Returns its branch.
#[tauri::command]
async fn create_vault_repo(settings: SyncSettings) -> std::result::Result<String, String> {
    let repo = settings.repo.trim().to_string();
    if !valid_repo(&repo) {
        return Err("Repository should look like owner/name.".into());
    }
    let (owner, name) = repo.split_once('/').unwrap_or_default();
    let gh = sync::GitHub::new(token_for(&settings)?, repo.clone(), String::new());
    let me = gh
        .rest(reqwest::Method::GET, "user", None)
        .await
        .map_err(|e| e.to_string())?
        .ok_or("GitHub didn't recognize this sign-in.")?;
    let path = if me["login"]
        .as_str()
        .is_some_and(|l| l.eq_ignore_ascii_case(owner))
    {
        "user/repos".to_string()
    } else {
        format!("orgs/{owner}/repos")
    };
    let body = serde_json::json!({
        "name": name,
        "private": true,
        "auto_init": true,
        "description": "My Cairn vault: notebooks and notes, synced from Cairn.",
        "has_issues": false,
        "has_projects": false,
        "has_wiki": false,
    });
    let made = gh
        .rest(reqwest::Method::POST, &path, Some(body))
        .await
        .map_err(|e| {
            let e = e.to_string();
            if e.contains("403") || e.contains("Resource not accessible") {
                format!("This sign-in can't create repositories in {owner}. Create a private repo named {name} on GitHub (with a README), or sign in with the GitHub CLI.")
            } else if e.contains("422") && e.contains("already exists") {
                format!("{repo} already exists.")
            } else {
                e
            }
        })?
        .ok_or_else(|| format!("{owner} isn't your account or an organization you belong to."))?;
    Ok(made["default_branch"]
        .as_str()
        .unwrap_or("main")
        .to_string())
}

/// Where a notebook's notes sync, when not with the vault repo.
#[derive(Debug, Clone, Deserialize, Serialize)]
struct RepoLink {
    repo: String,
    #[serde(default)]
    branch: String,
    #[serde(default)]
    path: String,
}

fn notebook_state_path(
    app: &AppHandle,
    vault: &std::path::Path,
    id: &str,
) -> std::result::Result<PathBuf, String> {
    let p = state_path(app, vault)?;
    let stem = p
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("vault")
        .to_string();
    Ok(p.with_file_name(format!("{stem}-{id}.json")))
}

/// Is `owner/name` shaped like a GitHub repo?
fn valid_repo(r: &str) -> bool {
    let ok = |s: &str| {
        !s.is_empty()
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
    };
    matches!(r.split_once('/'), Some((o, n)) if ok(o) && ok(n) && !n.contains('/'))
}

/// One notebook's notes ↔ its own repo.
async fn sync_notebook(
    app: &AppHandle,
    root: &std::path::Path,
    token: &str,
    id: &str,
    link: &RepoLink,
    dry_run: bool,
) -> std::result::Result<sync::Report, String> {
    if !valid_repo(&link.repo) {
        return Err(format!("“{}” isn't a repo (use owner/name)", link.repo));
    }
    let mut gh = sync::GitHub::new(token.to_string(), link.repo.clone(), link.branch.clone());
    if gh.branch.is_empty() {
        gh.branch = gh.default_branch().await.map_err(|e| e.to_string())?;
    }
    let scope = sync::Scope::Notebook {
        id: id.to_string(),
        path: sync::clean_path(&link.path),
    };
    let state_file = notebook_state_path(app, root, id)?;
    match sync::sync_once(&gh, &scope, root, &state_file, dry_run).await {
        Err(sync::SyncError::HeadMoved) => {
            sync::sync_once(&gh, &scope, root, &state_file, dry_run).await
        }
        r => r,
    }
    .map_err(|e| e.to_string())
}

fn merge_report(into: &mut sync::Report, r: sync::Report) {
    into.pushed.extend(r.pushed);
    into.pulled.extend(r.pulled);
    into.deleted_remote.extend(r.deleted_remote);
    into.deleted_local.extend(r.deleted_local);
    into.conflicts.extend(r.conflicts);
    into.skipped.extend(r.skipped);
    into.errors.extend(r.errors);
}

/// Link a notebook to its own repo (or, with `link: None`, back to the vault
/// repo). With `dry_run`, only previews the first sync; otherwise saves the
/// link in `notebook.yml` and syncs the notebook now.
#[tauri::command]
async fn link_notebook_repo(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    link: Option<RepoLink>,
    dry_run: bool,
) -> std::result::Result<sync::Report, String> {
    use std::sync::atomic::Ordering;
    let cfg = load_config(&app);
    if !cfg.sync.enabled || cfg.sync.repo.is_empty() {
        return Err("Set up GitHub sync first (vault card → Sync settings); notebooks use the same sign-in.".into());
    }
    let root = vault_root(&state)?;
    let link = link.map(|l| RepoLink {
        repo: l.repo.trim().to_string(),
        branch: l.branch.trim().to_string(),
        path: sync::clean_path(&l.path),
    });
    if let Some(l) = &link
        && !valid_repo(&l.repo)
    {
        return Err(format!("“{}” isn't a repo (use owner/name)", l.repo));
    }
    if dry_run {
        let Some(l) = &link else {
            return Ok(sync::Report {
                dry_run: true,
                ..Default::default()
            });
        };
        // Preview against a throwaway state, as a first link would be.
        let token = token_for(&cfg.sync)?;
        let tmp =
            std::env::temp_dir().join(format!("cairn-preview-{}-{}.json", std::process::id(), id));
        let mut gh = sync::GitHub::new(token, l.repo.clone(), l.branch.clone());
        if gh.branch.is_empty() {
            gh.branch = gh.default_branch().await.map_err(|e| e.to_string())?;
        }
        let scope = sync::Scope::Notebook {
            id: id.clone(),
            path: l.path.clone(),
        };
        let r = sync::sync_once(&gh, &scope, &root, &tmp, true)
            .await
            .map_err(|e| e.to_string());
        let _ = std::fs::remove_file(tmp);
        return r;
    }
    with_vault(&state, |v| {
        let mut meta = v
            .list_notebooks()?
            .into_iter()
            .find(|b| b.id == id)
            .ok_or_else(|| vault::VaultError::NotFound(id.clone()))?
            .meta;
        meta.repo = link.as_ref().map(|l| l.repo.clone()).unwrap_or_default();
        meta.repo_branch = link.as_ref().map(|l| l.branch.clone()).unwrap_or_default();
        meta.repo_path = link.as_ref().map(|l| l.path.clone()).unwrap_or_default();
        v.update_notebook(&id, &meta)
    })
    .map_err(|e| e.to_string())?;
    if SYNCING.swap(true, Ordering::SeqCst) {
        return Ok(sync::Report::default()); // the running sync will pick it up next round
    }
    let r = match &link {
        Some(l) => match token_for(&cfg.sync) {
            Ok(t) => sync_notebook(&app, &root, &t, &id, l, false).await,
            Err(e) => Err(e),
        },
        None => Ok(sync::Report::default()),
    };
    SYNCING.store(false, Ordering::SeqCst);
    r
}

static SYNCING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Sync with GitHub (or, with `dry_run`, just report what would change).
/// The first sync with a repo should be previewed and confirmed in the UI.
#[tauri::command]
async fn sync_now(
    app: AppHandle,
    state: State<'_, AppState>,
    dry_run: bool,
) -> std::result::Result<sync::Report, String> {
    use std::sync::atomic::Ordering;
    let cfg = load_config(&app);
    if !cfg.sync.enabled || cfg.sync.repo.is_empty() {
        return Err("Sync is off.".into());
    }
    let root = vault_root(&state)?;
    let state_file = state_path(&app, &root)?;
    if !dry_run && SYNCING.swap(true, Ordering::SeqCst) {
        return Err("A sync is already running.".into());
    }
    let result = async {
        let token = token_for(&cfg.sync)?;
        let books = with_vault(&state, |v| v.list_notebooks()).map_err(|e| e.to_string())?;
        let own_repo = books
            .iter()
            .filter(|b| !b.meta.repo.is_empty())
            .map(|b| b.id.clone())
            .collect();
        let gh = sync::GitHub::new(
            token.clone(),
            cfg.sync.repo.clone(),
            cfg.sync.branch.clone(),
        );
        let scope = sync::Scope::Vault { own_repo };
        let mut rep = match sync::sync_once(&gh, &scope, &root, &state_file, dry_run).await {
            // Someone pushed mid-sync: take one more lap.
            Err(sync::SyncError::HeadMoved) => {
                sync::sync_once(&gh, &scope, &root, &state_file, dry_run).await
            }
            r => r,
        }
        .map_err(|e| e.to_string())?;
        // Then each notebook that has a repo of its own. One failing doesn't
        // stop the others; it's reported in `errors`.
        for b in books.iter().filter(|b| !b.meta.repo.is_empty()) {
            let link = RepoLink {
                repo: b.meta.repo.clone(),
                branch: b.meta.repo_branch.clone(),
                path: b.meta.repo_path.clone(),
            };
            match sync_notebook(&app, &root, &token, &b.id, &link, dry_run).await {
                Ok(r) => merge_report(&mut rep, r),
                Err(e) => rep.errors.push(format!("{}: {e}", b.meta.title)),
            }
        }
        Ok::<_, String>(rep)
    }
    .await;
    if !dry_run {
        SYNCING.store(false, Ordering::SeqCst);
    }
    let rep = result?;
    if !dry_run && cfg.mirror && !sync::in_icloud(&root) {
        let _ = mirror_into_icloud(&root);
    }
    Ok(rep)
}

fn mirror_into_icloud(root: &std::path::Path) -> std::result::Result<sync::MirrorReport, String> {
    let drive = sync::icloud_drive().ok_or("iCloud Drive isn't available on this Mac.")?;
    sync::mirror(root, &drive.join("Cairn Backup")).map_err(|e| e.to_string())
}

/// Copy notes into iCloud Drive/Cairn Backup (one way).
#[tauri::command]
fn mirror_now(
    app: AppHandle,
    state: State<AppState>,
) -> std::result::Result<Option<sync::MirrorReport>, String> {
    let root = vault_root(&state)?;
    if !load_config(&app).mirror || sync::in_icloud(&root) {
        return Ok(None);
    }
    mirror_into_icloud(&root).map(Some)
}

/// Opaque window background for normal use (the native title bar needs it,
/// since the window is created transparent for notebook mode).
const WINDOW_BG: tauri::window::Color = tauri::window::Color(231, 220, 200, 255);
const CLEAR: tauri::window::Color = tauri::window::Color(0, 0, 0, 0);

/// Notebook mode on the desktop: a borderless, transparent window just big
/// enough for the open notebook, centered, so the desktop shows around it.
/// `"book"` turns it on; `"off"` restores the normal window exactly where it
/// was.
#[tauri::command]
fn desk_mode(
    app: AppHandle,
    state: State<AppState>,
    mode: &str,
) -> std::result::Result<(), String> {
    let w = app.get_webview_window("main").ok_or("no main window")?;
    let e = |x: tauri::Error| x.to_string();
    let mut saved = state.desk.lock().unwrap_or_else(|p| p.into_inner());
    if mode == "book" {
        if saved.is_none() {
            if w.is_fullscreen().map_err(e)? {
                w.set_fullscreen(false).map_err(e)?;
            }
            *saved = Some((w.outer_position().map_err(e)?, w.outer_size().map_err(e)?));
        }
        let m = w.current_monitor().map_err(e)?.ok_or("no monitor")?;
        let scale = m.scale_factor();
        let area = m.work_area().size.to_logical::<f64>(scale);
        let origin = m.work_area().position.to_logical::<f64>(scale);
        // Two 4.75 × 7.5 pages side by side, plus room for the shadow.
        let pad = 36.0;
        let page_h = (area.height * 0.92 - 2.0 * pad).min(980.0);
        let page_w = page_h * 4.75 / 7.5;
        let width = (2.0 * page_w + 2.0 * pad + 24.0).min(area.width * 0.98);
        let height = page_h + 2.0 * pad;
        w.set_background_color(Some(CLEAR)).map_err(e)?;
        w.set_decorations(false).map_err(e)?;
        w.set_shadow(false).map_err(e)?;
        w.set_size(LogicalSize::new(width, height)).map_err(e)?;
        // Center in the usable area ourselves: `center()` can run before the
        // new size lands and leave the notebook off to one side.
        w.set_position(tauri::LogicalPosition::new(
            origin.x + (area.width - width) / 2.0,
            origin.y + (area.height - height) / 2.0,
        ))
        .map_err(e)?;
    } else {
        w.set_decorations(true).map_err(e)?;
        w.set_shadow(true).map_err(e)?;
        w.set_background_color(Some(WINDOW_BG)).map_err(e)?;
        if let Some((pos, size)) = saved.take() {
            w.set_size(size).map_err(e)?;
            w.set_position(pos).map_err(e)?;
        }
    }
    w.set_focus().map_err(e)
}

/// Menu items whose accelerators drive app views. Native menu shortcuts fire
/// even when the web view doesn't have keyboard focus; the frontend listens
/// for the `menu` event.
const MENU_NOTEBOOK: &str = "notebook-mode";
const MENU_ALL_NOTEBOOKS: &str = "all-notebooks";
const MENU_SEARCH: &str = "search";

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::default(app)?;
    let notebook = MenuItem::with_id(
        app,
        MENU_NOTEBOOK,
        "Notebook Mode",
        true,
        Some("CmdOrCtrl+Shift+F"),
    )?;
    let all = MenuItem::with_id(
        app,
        MENU_ALL_NOTEBOOKS,
        "All Notebooks",
        true,
        Some("CmdOrCtrl+0"),
    )?;
    let find = MenuItem::with_id(
        app,
        MENU_SEARCH,
        "Search All Notes…",
        true,
        Some("CmdOrCtrl+K"),
    )?;
    let sep = PredefinedMenuItem::separator(app)?;
    let view = menu
        .items()?
        .into_iter()
        .filter_map(|i| i.as_submenu().cloned())
        .find(|s| s.text().map(|t| t == "View").unwrap_or(false));
    match view {
        Some(v) => v.prepend_items(&[&find, &all, &notebook, &sep])?,
        None => menu.append(&Submenu::with_items(
            app,
            "View",
            true,
            &[&find, &all, &notebook],
        )?)?,
    }
    Ok(menu)
}

/// Default to 1280×820, but never larger than the screen's usable area
/// (menu bar and Dock excluded), then center.
fn create_main_window(app: &AppHandle) -> tauri::Result<()> {
    // Size it for this screen at creation. Resizing a transparent window
    // right after launch leaves the page drawn at the old size, spilling
    // past the window's edges (macOS), so the first size has to be right.
    let (width, height) = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| {
            let area = m.work_area().size.to_logical::<f64>(m.scale_factor());
            (
                1280f64.min(area.width * 0.94),
                820f64.min(area.height * 0.94),
            )
        })
        .unwrap_or((1100.0, 720.0));
    tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::default())
        .title("Cairn")
        .inner_size(width, height)
        .min_inner_size(640.0, 420.0)
        .center()
        // Transparent so notebook mode can show the desktop; opaque paint
        // for everyday use so the title bar stays solid.
        .transparent(true)
        .background_color(WINDOW_BG)
        .build()?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .setup(|app| {
            // Reopen the last vault, if it still exists.
            let handle = app.handle().clone();
            if let Some(p) = load_config(&handle).vault_path
                && let Ok(v) = Vault::open(p)
            {
                *app.state::<AppState>().vault.lock().unwrap() = Some(v);
            }
            app.set_menu(build_menu(&handle)?)?;
            create_main_window(&handle)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if id == MENU_NOTEBOOK || id == MENU_ALL_NOTEBOOKS || id == MENU_SEARCH {
                let _ = app.emit("menu", id);
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_vault,
            set_vault,
            list_notebooks,
            create_notebook,
            update_notebook,
            list_notes,
            read_note,
            write_note,
            create_note,
            trash_note,
            read_cover,
            read_button,
            list_library,
            read_library,
            save_to_library,
            all_notes,
            list_stickers,
            read_badges,
            set_shelf_order,
            link_notebook_repo,
            check_vault_repo,
            create_vault_repo,
            trash_notebook,
            write_badges,
            search,
            get_sync,
            set_sync,
            set_token,
            sync_now,
            mirror_now,
            desk_mode,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Cairn");
}
