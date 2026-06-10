// Regenerates the PWA icons in public/assets/icons/ from the title art.
// Uses headless Chromium as the image pipeline because it can decode WebP
// (no other image tooling is a dependency of this repo). Run with:
//   node tools/make-icons.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";

const SIZES = [512, 192, 180];
const MASKABLE_SIZES = [512, 192];
const SOURCE = "public/assets/degenerate-title.webp";
const OUT_DIR = "public/assets/icons";

const source = readFileSync(SOURCE).toString("base64");
mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
async function renderIcon(size, { maskable = false } = {}) {
  const dataUrl = await page.evaluate(async ({ source, size, maskable }) => {
    const img = new Image();
    img.src = `data:image/webp;base64,${source}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    // The art is portrait; cover-crop a square biased toward the top, where
    // the faces are.
    const side = Math.min(img.width, img.height);
    const sx = (img.width - side) / 2;
    const sy = (img.height - side) * 0.3;

    if (!maskable) {
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.clip();
    }

    ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
    return canvas.toDataURL("image/png");
  }, { source, size, maskable });
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

for (const size of SIZES) {
  const icon = await renderIcon(size);
  const file = `${OUT_DIR}/icon-${size}.png`;
  writeFileSync(file, icon);
  console.log(`wrote ${file}`);
}

for (const size of MASKABLE_SIZES) {
  const icon = await renderIcon(size, { maskable: true });
  const file = `${OUT_DIR}/icon-maskable-${size}.png`;
  writeFileSync(file, icon);
  console.log(`wrote ${file}`);
}
await browser.close();
