# World Cup 2026

Static HTML/CSS/JS app (in `public/`) served with Cloudflare Pages Functions
(in `functions/api/`). Deployment and caching are covered in
[Hosting and caching](#hosting-and-caching-cloudflare-pages) below.

## Local development

```bash
npm install   # once
npm run dev
```

Open the URL wrangler prints. Use the `127.0.0.1` form — wrangler doesn't
listen on IPv6 `localhost`.

### Mock mode

Append `?mock=match-<id>` to the URL to simulate the tournament up to and including that match —
e.g. `/?mock=match-40` for a partial group stage, `/?mock=match-72` for the
complete group stage, `/?mock=match-104` for a fully played tournament. Mock data is derived from
`public/mock-seed.tsv` and never calls ESPN.

## Live data and shootouts

Live mode uses `public/mock-seed.tsv` as the canonical schedule, group, stage,
team, and match-number source. ESPN's FIFA World Cup scoreboard is overlaid for
live status, scores, and scorers via `/api/espn-games`.

Current handling (`loserId`/`penaltyScore` in `public/app.js`):

- A finished knockout game with level scores eliminates nobody and adds a
  warning to the visible status line.
- `home_`/`away_` `penalty|penalties|pen|pens|penalty_score` fields are used
  if a feed exposes them, and scores then render as "1 (4)".

When the first shootout happens, inspect that ESPN event in the raw
`/api/espn-games` response and adapt `penaltyScore` if ESPN encodes it under a
new field.

## Verifying changes

```bash
npx playwright install chromium   # first run, and again after Playwright upgrades
npm run verify
```

Runs the Playwright Test suite in `e2e/`: it starts the app (`webServer` in
`playwright.config.js`) and drives it in headless Chromium at iPhone viewport
size. Each test is printed as it passes or fails; failures leave a trace in
`test-results/` — open it with `npx playwright show-trace <path-to-trace.zip>`.

For quicker UI iteration, `npm run verify:smoke` runs a small render/assets
subset. Use the full `npm run verify` before committing UI or behavior changes.

## Hosting and caching (Cloudflare Pages)

The proxy in `functions/api/` exists so the browser can call ESPN through the
same origin and all visitors can share one cached response.

Cloudflare Pages publishes the output directory set in `wrangler.toml` to its
global CDN and runs the proxy as Pages Functions from `functions/`. Every push
to the main branch redeploys automatically; `npx wrangler pages deploy`
deploys by hand.

The proxy caches at Cloudflare's edge in two tiers: a short fresh TTL so all
visitors share one cached copy of the feed, plus a day-long last-known-good
copy that masks upstream errors and slow refreshes. The header comment in
`functions/api/_proxy.js` documents the exact behavior and TTLs.
