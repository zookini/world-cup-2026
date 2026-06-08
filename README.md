# World Cup 2026

Static HTML/CSS/JS app served with Cloudflare Pages Functions.

## Local Development

Run the app locally with the Cloudflare Pages runtime:

```bash
npx wrangler pages dev
```

`wrangler.toml` sets `pages_build_output_dir = "public"`, so the static files in
`public/` are served and the Pages Functions under `functions/api/` run alongside
them — no path argument needed.

## Deploy

Production deploys are handled by Cloudflare Pages when changes are pushed to the main branch.
