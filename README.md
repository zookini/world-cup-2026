# World Cup 2026

Static HTML/CSS/JS app (in `public/`) served with Cloudflare Pages Functions
(in `functions/api/`). See `DEPLOY.md` for deployment and caching.

## Local development

```bash
npm install   # once
npm run dev
```

Open the URL wrangler prints. Use the `127.0.0.1` form — wrangler doesn't
listen on IPv6 `localhost`.

### Mock mode

The live feed has no results until matches finish. Append `?mock=match-<id>`
to the URL to simulate the tournament up to and including that match —
e.g. `/?mock=match-72` for most of the group stage, `/?mock=match-104` for a
fully played tournament. Mock data is derived from
`public/mock-seed.tsv` and never calls the live feed.

## Shootouts (knockout stage, from Jun 28)

The feed's Game schema has **no penalty/shootout fields** — confirmed against
its OpenAPI spec (<https://worldcup26.ir/api-docs/>) and Mongoose model
(<https://github.com/rezarahiminia/worldcup2026>). Its score-update process is
not in that repo, so how a shootout gets encoded is unknown until one happens.

Current handling (`loserId`/`penaltyScore` in `public/app.js`):

- A finished knockout game with level scores eliminates nobody and adds a
  warning to the visible status line.
- `home_`/`away_` `penalty|penalties|pen|pens|penalty_score` fields are used
  if the feed ever grows them, and scores then render as "1 (4)".

When the first shootout happens, inspect that match in the raw `/api/games`
response and adapt `penaltyScore` — or parse `home_scorers`/`away_scorers` if
the result lands in those strings.

## Verifying changes

```bash
npx playwright install chromium   # once
npm run verify
```

Starts the app and drives it in headless Chromium at iPhone viewport size;
each check it runs is printed as it passes or fails.
