# Deploying (Cloudflare Pages)

The app is static HTML/CSS/JS plus a tiny proxy. The proxy exists because the
`worldcup26.ir` feed sends no CORS header, so the browser can't call it directly.

Cloudflare Pages publishes the output directory set in `wrangler.toml` to its
global CDN and runs the proxy as Pages Functions from `functions/`. Every push
to the main branch redeploys automatically.

## Caching

`functions/api/_proxy.js` caches at Cloudflare's edge in two tiers:

- **Fresh** — served for a short TTL so all visitors share one cached copy
  instead of each hitting the `.ir` box (protects against its rate limit and
  flakiness).
- **Last-known-good** — refreshed on every success; if the upstream errors, the
  proxy serves the most recent good payload (response carries an `X-Cache:
  stale-last-known-good` header) instead of a blank board.

Tune `FRESH_TTL` in `_proxy.js` to make scores refresh faster or slower.
