# World Cup 2026

Static HTML/CSS/JS app served with Cloudflare Pages Functions.

## Local Development

Run the app locally with the Cloudflare Pages runtime:

```bash
npx wrangler pages dev .
```

This serves the static files and runs the Pages Functions under `functions/api/`.

## Deploy

Production deploys are handled by Cloudflare Pages when changes are pushed to the main branch.
