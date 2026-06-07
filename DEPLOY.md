# Deploying (Cloudflare Pages)

The app is static HTML/CSS/JS plus a tiny proxy. The proxy exists because the
`worldcup26.ir` feed sends no CORS header, so the browser can't call it directly.

- **Local dev:** `node server.mjs` → http://127.0.0.1:4173 (serves files *and*
  proxies `/api/*`). Unchanged.
- **Production:** Cloudflare Pages serves the files from its global CDN and runs
  the proxy as Pages Functions in `functions/api/`.

## One-time setup

1. Push this repo to GitHub.
2. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git**, pick the repo.
3. Build settings:
   - **Framework preset:** None
   - **Build command:** *(leave empty)*
   - **Build output directory:** `/`
4. Deploy. Cloudflare auto-detects `functions/` and wires up `/api/groups` and
   `/api/games`. Share the `*.pages.dev` URL with friends (or add a custom domain
   under the project's **Custom domains** tab).

Every `git push` to the main branch redeploys automatically.

## Caching

`functions/api/_proxy.js` caches at Cloudflare's edge:

- **45s fresh** — all visitors share one cached copy, so the `.ir` box isn't hit
  on every page load (protects against its rate limit and flakiness).
- **Last-known-good** — refreshed on every success; if the upstream errors, the
  proxy serves the most recent good payload (response carries an `X-Cache:
  stale-last-known-good` header) instead of a blank board.

Tune `FRESH_TTL` in `_proxy.js` if you want scores to refresh faster or slower.

## Local testing of the Functions (optional)

`node server.mjs` covers local dev. To exercise the actual Pages Functions +
edge cache locally, use Wrangler: `npx wrangler pages dev .`
