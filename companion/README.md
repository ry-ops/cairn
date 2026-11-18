# Cairn companion

Read, search and jot notes from any browser, phone included. It reads the vault from its GitHub repo, the one Cairn syncs to (`VAULT_REPO` in `wrangler.toml`). It only shows what has synced, so turn on sync in the app first.

- **Hosting:** one Cloudflare Worker with static assets: the page in `public/` (static, no third-party scripts) and the API in `src/worker.ts`.
- **`GET /api/vault`:** every notebook and note at the branch head. It costs one tarball download per commit, cached, so it fits the free plan's subrequest limit at any vault size.
- **`POST /api/capture`:** a new note as one signed `createCommitOnBranch` commit, the same way the app's sync commits. The app picks it up on its next sync.
- **Two locks:**
  - Cloudflare Access guards every hostname (for example, a policy that allows only your email, with a one-time PIN or TOTP).
  - Each API call also verifies the Access JWT (signature, AUD, issuer, expiry, and optionally the email) in `src/access.ts`. A hostname missing from the Access app still can't serve notes.
- **Safe before it's set up:** until `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are set (empty or `unset` counts as not set), every API call is refused with *Sign in required (Access isn't configured)*. A fresh deploy shows the page and no notes.
- **Headers:** a strict CSP, `noindex`, `no-referrer` and `no-store`, on the page (`public/_headers`) and on every API response.

## Deploy with the button

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ry-ops/cairn/tree/main/companion)

1. **Click the button** and sign in to Cloudflare and GitHub. If you've never opened **Zero Trust** in the Cloudflare dashboard, open it once first and pick a team name (the free plan is enough): that's your Access team.
2. **Fill in the form:**
   - **Git account:** where your copy of the companion goes. Tick **Create private Git repository**, since your settings live in it. Every push to it redeploys.
   - `VAULT_REPO`: the repo Cairn syncs your vault to, as `owner/name`.
   - `GITHUB_TOKEN`: a [fine-grained token](https://github.com/settings/personal-access-tokens/new) with **Contents: read and write** on the vault repo only. If the repo belongs to an organization, the org may have to approve the token.
   - `ACCESS_TEAM_DOMAIN`: your team domain, `<team>.cloudflareaccess.com` (**Zero Trust → Settings**).
   - `ACCESS_AUD`: type `unset` for now. The form won't take an empty value, and the companion treats `unset` as not set.
   - **Protect with Cloudflare Access:** on, scope **All traffic**, with a policy that allows only you (for example your email). This creates the Access application for you.
   - **Enable Preview builds:** off. The companion has no preview URLs.
3. **Deploy.** The companion is at `https://cairn-companion.<your-subdomain>.workers.dev`, and it already sends everyone to the Access login. Signed in, the page says *Access isn't configured*: it doesn't know the AUD yet, so it serves no notes.
4. **Copy the AUD tag** from the Worker's **Access** tab, under **Application values**.
5. **Put it in `wrangler.toml`** in your new repo (`ACCESS_AUD = "…"`) and commit. The push redeploys. Change variables in `wrangler.toml`, not in the dashboard: every deploy sets them from the file.
6. **Check it:** in a private window the companion should send you to the Access login, and once you're signed in your notebooks appear.

If the page says *GitHub: 401*, the token is wrong. Replace it under the Worker's **Settings → Variables and Secrets → `GITHUB_TOKEN` → Rotate**, and choose **Deploy**. Secrets aren't in `wrangler.toml`, so the dashboard is the place for them.

## Deploy by hand

1. Set `VAULT_REPO` in `wrangler.toml`.
2. `npm install`, then `npx wrangler secret put GITHUB_TOKEN` (the same fine-grained token as above).
3. `npm run deploy`.
4. Protect the Worker with Access from its **Access** tab, copy the **AUD tag** from the same tab, set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` in `wrangler.toml`, and deploy again.
5. Optionally, serve it on your own hostname: add `routes = [{ pattern = "notes.example.com", custom_domain = true }]` to `wrangler.toml` and deploy, so Cloudflare creates the DNS record and certificate. Delete any existing record for that name first; a CNAME to `workers.dev` doesn't work (it gives a 522). Access set to **All traffic** on the Worker covers the new hostname too.

## Develop

```sh
npm install
printf 'GITHUB_TOKEN=%s\nDEV_BYPASS_ACCESS=1\nVAULT_BRANCH=<a scratch branch>\n' "$(gh auth token)" > .dev.vars   # gitignored
npm run dev     # http://localhost:8788; the bypass only works on localhost
npm test        # tar/vault parsing, capture template, Access token checks, the Worker's routing
```

