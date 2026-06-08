# Deploying (Cloudflare Pages)

The app is static HTML/CSS/JS plus a tiny proxy. The proxy exists because the
`worldcup26.ir` feed sends no CORS header, so the browser can't call it directly.

- **Local dev:** `npx wrangler pages dev .` — serves files and runs Pages
  Functions (`/api/*`) locally.
- **Production:** Cloudflare Pages serves the files from its global CDN and runs
  the proxy as Pages Functions in `functions/api/`.

Every `git push` to the main branch redeploys automatically.

## Caching

`functions/api/_proxy.js` caches at Cloudflare's edge:

- **45s fresh** — all visitors share one cached copy, so the `.ir` box isn't hit
  on every page load (protects against its rate limit and flakiness).
- **Last-known-good** — refreshed on every success; if the upstream errors, the
  proxy serves the most recent good payload (response carries an `X-Cache:
  stale-last-known-good` header) instead of a blank board.

Tune `FRESH_TTL` in `_proxy.js` if you want scores to refresh faster or slower.
