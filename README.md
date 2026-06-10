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

## Verifying changes

```bash
npx playwright install chromium   # once
npm run verify
```

Starts the app and drives it in headless Chromium at iPhone viewport size;
each check it runs is printed as it passes or fails.
