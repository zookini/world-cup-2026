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
- **Last-known-good** — refreshed on every success. If the fresh cache has
  expired, the proxy serves the most recent good payload immediately (response
  carries an `X-Cache: stale-refreshing` header) and refreshes the edge cache in
  the background instead of making visitors wait on the live feed. It is also
  kept as the fallback payload if the upstream errors. Cache keys ignore the
  browser's old `_fresh` cache-busting parameter so stale data remains available
  across page refreshes.

Tune `FRESH_TTL` in `_proxy.js` to make scores refresh faster or slower.
