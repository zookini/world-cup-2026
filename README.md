# World Cup 2026

Static HTML/CSS/JS app (in `public/`) hosted on Cloudflare Pages. Deployment
is covered in [Hosting](#hosting-cloudflare-pages) below.

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
live status, scores, and scorers, fetched directly from `site.api.espn.com` in
the browser (the API sends `Access-Control-Allow-Origin: *`, so no proxy is
needed).

Shootouts: ESPN puts a numeric `shootoutScore` on each competitor (verified
against the 2022 final, ESPN event 633850), which is mapped to
`home_`/`away_penalty` and rendered as "1 (4)". A finished knockout game that
is still level with no shootout data eliminates nobody and adds a warning to
the visible status line (`unresolvedKnockoutWarnings` in `public/app.js`).

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

## Hosting (Cloudflare Pages)

Cloudflare Pages publishes the output directory set in `wrangler.toml` to its
global CDN. Every push to the main branch redeploys automatically;
`npx wrangler pages deploy` deploys by hand.
