# Deploying (Cloudflare Pages)

The app is static HTML/CSS/JS plus a tiny proxy. The proxy exists because the
`worldcup26.ir` feed sends no CORS header, so the browser can't call it directly.

- **Local dev:** `npx wrangler pages dev` — serves the `public/` folder and runs
  Pages Functions (`/api/*`) locally. (`wrangler.toml` sets
  `pages_build_output_dir = "public"`, so no path argument is needed.)
- **Production:** Cloudflare Pages serves the `public/` folder from its global CDN
  and runs the proxy as Pages Functions in `functions/api/`. Only `public/` is
  published — the repo-root docs (`README.md`, `AGENTS.md`, etc.) are not served.

Every `git push` to the main branch redeploys automatically.

## Caching

`functions/api/_proxy.js` caches at Cloudflare's edge:

- **45s fresh** — all visitors share one cached copy, so the `.ir` box isn't hit
  on every page load (protects against its rate limit and flakiness).
- **Last-known-good** — refreshed on every success; if the upstream errors, the
  proxy serves the most recent good payload (response carries an `X-Cache:
  stale-last-known-good` header) instead of a blank board.

Tune `FRESH_TTL` in `_proxy.js` if you want scores to refresh faster or slower.
