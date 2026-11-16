// Sync a notebook with its own GitHub repo instead of the vault repo: a
// project's docs/ folder, a repo of meeting notes, anything with markdown.
// Preview first (what comes down, what goes up), then link. Unlinking hands
// the notes back to the vault repo; nothing is deleted on either side.
import { useState } from "react";
import { type Notebook, type RepoLink, type SyncReport, store } from "../store";

interface Props {
  notebook: Notebook;
  /** Save unsaved edits first, so the preview matches what's on screen. */
  flush: () => Promise<void>;
  onDone: (r: SyncReport | null) => void;
  onClose: () => void;
}

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** `https://github.com/owner/name(.git)` or `owner/name` → `owner/name`. */
function normRepo(v: string): string {
  return v.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/+$/, "");
}

export function RepoSheet({ notebook, flush, onDone, onClose }: Props) {
  const m = notebook.meta;
  const linked = !!m.repo;
  const [repo, setRepo] = useState(m.repo ?? "");
  const [branch, setBranch] = useState(m.repo_branch ?? "");
  const [path, setPath] = useState(m.repo_path ?? "");
  const [preview, setPreview] = useState<SyncReport | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const link: RepoLink = { repo: normRepo(repo), branch: branch.trim(), path: path.trim().replace(/^\/+|\/+$/g, "") };
  const valid = REPO.test(link.repo);
  const changed = link.repo !== (m.repo ?? "") || link.branch !== (m.repo_branch ?? "") || link.path !== (m.repo_path ?? "");
  const where = `${link.repo}${link.path ? `/${link.path}` : ""}${link.branch ? ` @ ${link.branch}` : ""}`;

  async function run(what: "preview" | "link" | "unlink") {
    setError(null);
    setBusy(what === "preview" ? "Looking at the repo…" : what === "link" ? "Linking and syncing…" : "Unlinking…");
    try {
      await flush();
      if (what === "preview") setPreview(await store.linkNotebookRepo(notebook.id, link, true));
      else onDone(await store.linkNotebookRepo(notebook.id, what === "link" ? link : null, false));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  const n = (xs: string[]) => xs.length;
  const names = (xs: string[]) => xs.map((p) => p.split("/").pop()).join(", ");

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="sheet repo-sheet" role="dialog" aria-label={`Sync ${m.title} with a repo`} onKeyDown={(e) => e.key === "Escape" && !busy && onClose()}>
        <h3>Sync “{m.title}” with a repo</h3>
        <p className="hint">
          This notebook's notes sync with a GitHub repo of their own instead of your vault repo: a project's <code>docs/</code> folder,
          a repo of notes, anything with markdown. The top-level <code>.md</code> files in the folder are the notes; subfolders are left alone.
          Its cover and settings stay in the vault.
        </p>
        <div className="publish-grid">
          <label className="wide">
            <span>Repository</span>
            <input autoFocus value={repo} onChange={(e) => { setRepo(e.target.value); setPreview(null); }} placeholder="owner/name" spellCheck={false} />
          </label>
          <label>
            <span>Folder <small>(optional)</small></span>
            <input value={path} onChange={(e) => { setPath(e.target.value); setPreview(null); }} placeholder="repo root" spellCheck={false} />
          </label>
          <label>
            <span>Branch <small>(optional)</small></span>
            <input value={branch} onChange={(e) => { setBranch(e.target.value); setPreview(null); }} placeholder="default branch" spellCheck={false} />
          </label>
        </div>

        {preview && (
          <section className="repo-preview">
            <div className="picker-label">First sync with {where}</div>
            <ul>
              <li><b>{n(preview.pulled)}</b> {n(preview.pulled) === 1 ? "note comes" : "notes come"} down{n(preview.pulled) ? <span className="hint"> · {names(preview.pulled)}</span> : null}</li>
              <li><b>{n(preview.pushed)}</b> {n(preview.pushed) === 1 ? "note goes" : "notes go"} up{n(preview.pushed) ? <span className="hint"> · {names(preview.pushed)}</span> : null}</li>
              {n(preview.conflicts) > 0 && (
                <li><b>{n(preview.conflicts)}</b> differ on both sides: yours are kept, and theirs are saved beside them as <code>.conflict</code> copies</li>
              )}
            </ul>
            <p className="hint">
              Commits go straight to the branch, signed by GitHub. Your vault repo stops carrying these notes: they're removed from it at the next sync
              and stay in its history.
            </p>
          </section>
        )}
        {linked && !changed && !preview && (
          <p className="hint">Linked to <b>{where}</b>. Unlink to hand the notes back to your vault repo (nothing is deleted).</p>
        )}
        {error && <p className="error">{error}</p>}

        <div className="sheet-actions">
          {busy && <span className="hint">{busy}</span>}
          {linked && <button className="btn repo-unlink" disabled={!!busy} onClick={() => void run("unlink")}>Unlink</button>}
          <button className="btn" disabled={!!busy} onClick={onClose}>Cancel</button>
          {!preview && <button className="btn" disabled={!!busy || !valid || (linked && !changed)} onClick={() => void run("preview")}>Preview</button>}
          {preview && <button className="btn primary" disabled={!!busy || !valid} onClick={() => void run("link")}>{linked ? "Change link" : "Link and sync"}</button>}
        </div>
      </div>
    </div>
  );
}
