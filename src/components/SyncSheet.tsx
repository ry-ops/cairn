// Sync settings: GitHub (primary copy) and the optional iCloud backup copy.
// The first sync with a repository is always previewed and confirmed: it
// merges both ways, and the user should see what's about to move.
import { useEffect, useState } from "react";
import type { SyncInfo, SyncReport, SyncSettings } from "../store";
import { store } from "../store";

interface Props {
  info: SyncInfo;
  onSaved: () => void;
  onSynced: (r: SyncReport) => void;
  onClose: () => void;
}

const short = (path: string) => path.replace(/^notebooks\//, "");

export function SyncSheet({ info, onSaved, onSynced, onClose }: Props) {
  const [s, setS] = useState<SyncSettings>(info.settings);
  const [mirror, setMirror] = useState(info.mirror);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<SyncReport | null>(null);
  const [tokenSaved, setTokenSaved] = useState(info.keychain_has_token);
  /** The repo doesn't exist yet: offer to create it. */
  const [missing, setMissing] = useState<{ login: string } | null>(null);

  useEffect(() => {
    setPreview(null);
    setMissing(null);
  }, [s.repo, s.branch, s.enabled, s.token_source]);

  async function save(settings = s) {
    await store.setSync(settings, mirror);
    onSaved();
  }

  async function run(dryRun: boolean, settings = s) {
    setError(null);
    setMissing(null);
    setBusy(dryRun ? "Checking GitHub…" : "Syncing…");
    try {
      await save(settings);
      const r = await store.syncNow(dryRun);
      if (dryRun) setPreview(r);
      else {
        setPreview(null);
        onSynced(r);
      }
    } catch (e) {
      // No such repo yet? Offer to make it rather than show a 404.
      const check = dryRun ? await store.checkVaultRepo(settings).catch(() => null) : null;
      if (check && !check.exists) setMissing({ login: check.login });
      else setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function createRepo() {
    setError(null);
    setBusy(`Creating ${s.repo}…`);
    try {
      const branch = await store.createVaultRepo(s);
      const next = { ...s, branch };
      setS(next);
      setMissing(null);
      await run(true, next);
    } catch (e) {
      setError(String(e));
      setBusy(null);
    }
  }

  const owner = s.repo.split("/")[0] ?? "";

  const changes = preview
    ? preview.pushed.length + preview.pulled.length + preview.deleted_remote.length + preview.deleted_local.length + preview.conflicts.length
    : 0;

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet sync-sheet" role="dialog" aria-label="Sync" onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <h3>Sync</h3>

        <section>
          <label className="check">
            <input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} />
            Sync this vault with GitHub
          </label>
          <p className="hint">Notes, notebook settings and cover art, the shelf order, badges, your stickers and the cover library. Each sync is one signed commit, made through the GitHub API, so no git runs on this Mac.</p>
          <div className="sync-grid">
            <label>
              <span>Repository</span>
              <input value={s.repo} onChange={(e) => setS({ ...s, repo: e.target.value })} placeholder="owner/my-vault" disabled={!s.enabled} />
            </label>
            <label>
              <span>Branch</span>
              <input value={s.branch} onChange={(e) => setS({ ...s, branch: e.target.value })} disabled={!s.enabled} />
            </label>
          </div>
          <fieldset disabled={!s.enabled}>
            <legend>Sign in with</legend>
            <label className="check">
              <input type="radio" name="tok" checked={s.token_source === "gh"} onChange={() => setS({ ...s, token_source: "gh" })} />
              GitHub CLI login {info.gh_available ? <span className="ok">gh found</span> : <span className="bad">gh not found</span>}
            </label>
            <label className="check">
              <input type="radio" name="tok" checked={s.token_source === "keychain"} onChange={() => setS({ ...s, token_source: "keychain" })} />
              A token saved in the Keychain {tokenSaved && <span className="ok">saved</span>}
            </label>
            {s.token_source === "keychain" && (
              <form
                className="token-row"
                onSubmit={async (e) => {
                  e.preventDefault();
                  await store.setToken(token);
                  setTokenSaved(!!token.trim());
                  setToken("");
                }}
              >
                <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Fine-grained token with Contents: read and write" aria-label="GitHub token" />
                <button className="btn" type="submit">{token.trim() ? "Save token" : "Remove token"}</button>
              </form>
            )}
          </fieldset>
          <p className="hint">
            No repo yet? Type a new name, such as <code>{missing?.login || "you"}/cairn-vault</code>, then <i>Preview</i>: Cairn offers to create it as a
            private repo.
          </p>
          <p className="hint">{info.last_sync ? `Last synced ${new Date(info.last_sync).toLocaleString()}.` : "Not synced with this repository yet."}</p>
        </section>

        {missing && (
          <section className="preview">
            <p className="warn">
              <b>{s.repo}</b> doesn't exist yet{owner.toLowerCase() === missing.login.toLowerCase() ? "" : `, or ${missing.login} can't see it`}. Create it as a
              private repository {owner.toLowerCase() === missing.login.toLowerCase() ? "in your account" : `in ${owner}`}? It starts with a README, and
              the first sync adds your notebooks.
            </p>
            <button type="button" className="btn primary" disabled={!!busy} onClick={() => void createRepo()}>
              Create private repo
            </button>
          </section>
        )}

        {preview && (
          <section className="preview">
            {preview.first_link && (
              <p className="warn">
                First sync with <b>{s.repo}</b>. Notes only on this Mac go up, notes only on GitHub come down, and anything that differs keeps both versions.
              </p>
            )}
            {changes === 0 && !preview.skipped.length ? (
              <p>Everything is already in sync.</p>
            ) : (
              <ul className="plan">
                <PlanRow label="Upload" items={preview.pushed} />
                <PlanRow label="Download" items={preview.pulled} />
                <PlanRow label="Delete on GitHub" items={preview.deleted_remote} />
                <PlanRow label="Move to .trash here" items={preview.deleted_local} />
                <PlanRow label="Changed on both (keep both)" items={preview.conflicts} />
                <PlanRow label="Waiting on iCloud download" items={preview.skipped} />
              </ul>
            )}
          </section>
        )}

        <section>
          <div className="picker-label">iCloud</div>
          {info.vault_in_icloud ? (
            <p className="hint">This vault is in iCloud Drive, so iCloud already backs it up.</p>
          ) : (
            <label className="check">
              <input type="checkbox" checked={mirror} disabled={!info.icloud_available} onChange={(e) => setMirror(e.target.checked)} />
              Keep a backup copy of notes in iCloud Drive/Cairn Backup
              {!info.icloud_available && <span className="bad">iCloud Drive is off</span>}
            </label>
          )}
        </section>

        {error && <p className="error">{error}</p>}
        <div className="sheet-actions">
          {busy && <span className="hint">{busy}</span>}
          <button type="button" className="btn" onClick={async () => { await save(); onClose(); }}>Done</button>
          {s.enabled && (
            <button type="button" className="btn" disabled={!!busy || !s.repo} onClick={() => run(true)}>Preview</button>
          )}
          {s.enabled && preview && (
            <button type="button" className="btn primary" disabled={!!busy} onClick={() => run(false)}>
              {preview.first_link ? "Link and sync" : "Sync now"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function PlanRow({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <li>
      <details>
        <summary><b>{items.length}</b> · {label}</summary>
        <ul>{items.slice(0, 50).map((p) => <li key={p}><code>{short(p)}</code></li>)}</ul>
        {items.length > 50 && <span className="hint">…and {items.length - 50} more</span>}
      </details>
    </li>
  );
}
