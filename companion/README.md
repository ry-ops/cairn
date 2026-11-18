# Cairn companion

Read, search and jot notes from any browser, phone included. It reads the vault from its GitHub repo, the one Cairn syncs to (`VAULT_REPO` in `wrangler.toml`). It only shows what has synced, so turn on sync in the app first.

- **Hosting:** one Cloudflare Worker with static assets: the page in `public/` (static, no third-party scripts) and the API in `src/worker.ts`.
- **`GET /api/vault`:** every notebook and note at the branch head. It costs one tarball download per commit, cached, so it fits the free plan's subrequest limit at any vault size.
- **`POST /api/capture`:** a new note as one signed `createCommitOnBranch` commit, the same way the app's sync commits. The app picks it up on its next sync.
- **Two locks:**
  - Cloudflare Access guards every hostname (for example, a policy that allows only your email, with a one-time PIN or TOTP).
  - Each API call also verifies the Access JWT (signature, AUD, issuer, expiry, and optionally the email) in `src/access.ts`. A hostname missing from the Access app still can't serve notes.
- **Safe before it's set up:** until `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are set, every API call is refused with *Sign in required (Access isn't configured)*. A fresh deploy shows the page and no notes.
- **Headers:** a strict CSP, `noindex`, `no-referrer` and `no-store`, on the page (`public/_headers`) and on every API response.

## Deploy with the button

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ry-ops/cairn/tree/main/companion)

1. **Click the button** and sign in to Cloudflare and GitHub. It copies the companion into a new repo in your GitHub account and deploys it as a Worker named `cairn-companion` on your Cloudflare account. Every push to that repo redeploys it.
2. **Fill in what it asks for:**
   - `VAULT_REPO`: the repo Cairn syncs your vault to, as `owner/name`.
   - `GITHUB_TOKEN`: a [fine-grained token](https://github.com/settings/personal-access-tokens/new) with **Contents: read and write** on the vault repo only.
   - Leave `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` empty for now.
3. **Open it** at `https://cairn-companion.<your-subdomain>.workers.dev`. The page loads, but it shows no notes: Access isn't set up yet, so the API refuses every call.
4. **Put Cloudflare Access in front of it.** In the Cloudflare dashboard, under **Zero Trust → Access → Applications**, add a **self-hosted** application:
   - destination `cairn-companion.<your-subdomain>.workers.dev` (and your own hostname later, if you add one);
   - a policy that allows only you, for example your email with a one-time PIN.

   Copy the application's **AUD tag** from its settings. Your team domain is under **Zero Trust → Settings**: `<team>.cloudflareaccess.com`.
5. **Tell the companion about Access.** In **Workers & Pages → cairn-companion → Settings → Variables and Secrets**, set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`, and optionally `ALLOWED_EMAILS`. They survive redeploys (`keep_vars` in `wrangler.toml`).
6. **Check it:** in a private window the companion should send you to the Access login, and once you're signed in your notebooks appear.

The Access app is the one step the button can't do for you, which is why the companion guards itself until it's done.

## Deploy by hand

1. Set `VAULT_REPO` in `wrangler.toml`.
2. `npm install`, then `npx wrangler secret put GITHUB_TOKEN` (the same fine-grained token as above).
3. `npm run deploy`.
4. Add Cloudflare Access and set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`, as in steps 4 and 5 above. You can also put them in `wrangler.toml` and deploy again.
5. Optionally, add your own hostname under the Worker's **Settings → Domains & Routes**. Add it to the Access application first.

## Develop

```sh
npm install
printf 'GITHUB_TOKEN=%s\nDEV_BYPASS_ACCESS=1\nVAULT_BRANCH=<a scratch branch>\n' "$(gh auth token)" > .dev.vars   # gitignored
npm run dev     # http://localhost:8788; the bypass only works on localhost
npm test        # tar/vault parsing, capture template, Access token checks, the Worker's routing
```

