# Cairn companion

Read, search and jot notes from any browser, phone included. It reads the vault from its GitHub repo, the one Cairn syncs to (`VAULT_REPO` in `wrangler.toml`). It only shows what has synced, so turn on sync in the app first.

- **Hosting:** Cloudflare Pages (`public/`, static, no third-party scripts) plus Pages Functions (`functions/api/`).
- **`GET /api/vault`:** every notebook and note at the branch head. It costs one tarball download per commit, cached, so it fits the free plan's subrequest limit at any vault size.
- **`POST /api/capture`:** a new note as one signed `createCommitOnBranch` commit, the same way the app's sync commits. The app picks it up on its next sync.
- **Two locks:**
  - Cloudflare Access guards every hostname (for example, a policy that allows only your email, with a one-time PIN or TOTP).
  - Each API call also verifies the Access JWT (signature, AUD, issuer, expiry, and optionally the email) in `functions/_lib/access.ts`. A hostname missing from the Access app still can't serve notes.
- **Headers:** a strict CSP, `noindex`, `no-referrer` and `no-store`.

## Develop

```sh
npm install
printf 'GITHUB_TOKEN=%s\nACCESS_AUD=x\nDEV_BYPASS_ACCESS=1\nVAULT_BRANCH=<a scratch branch>\n' "$(gh auth token)" > .dev.vars   # gitignored
npm run dev     # http://localhost:8788; the bypass only works on localhost
npm test        # tar/vault parsing, capture template, Access token checks
```

## Deploy (once)

Do these in order, so the hostname is never reachable without Access. `notes.example.com` stands for your own hostname.

0. Set `VAULT_REPO` and `ACCESS_TEAM_DOMAIN` (your Zero Trust team, `<team>.cloudflareaccess.com`) in `wrangler.toml`.

1. Create the Pages project: `npx wrangler pages project create cairn-notes --production-branch main`.
2. Create the Access app **first**: self-hosted, destinations `notes.example.com`, `cairn-notes.pages.dev` and `*.cairn-notes.pages.dev`, with a policy that allows only you. Note its AUD tag.
3. Add secrets:
   - `npx wrangler pages secret put GITHUB_TOKEN --project-name cairn-notes`: a fine-grained token with **Contents: read and write** on the vault repo only.
   - `npx wrangler pages secret put ACCESS_AUD --project-name cairn-notes`.
   - Optionally `ALLOWED_EMAILS`.
4. Deploy: `npm run deploy`.
5. Add your custom domain to the Pages project (this creates the DNS record).
6. Check it: without a login, `/` should redirect to Access and `/api/vault` should return 302 or 401.

