// Regenerates the PWA icons in public/assets/icons/ from the title art.
// Uses headless Chromium as the image pipeline because it can decode WebP
// (no other image tooling is a dependency of this repo). Run with:
//   node tools/make-icons.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";

const SIZES = [512, 192, 180];
const SOURCE = "public/assets/degenerate-title.webp";
const OUT_DIR = "public/assets/icons";

const source = readFileSync(SOURCE).toString("base64");
mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of SIZES) {
  const dataUrl = await page.evaluate(async ({ source, size }) => {
    const img = new Image();
    img.src = `data:image/webp;base64,${source}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffd400"; // marquee yellow, in case the crop underflows
    ctx.fillRect(0, 0, size, size);
    // The art is portrait; cover-crop a square biased toward the top, where
    // the faces are.
    const side = Math.min(img.width, img.height);
    const sx = (img.width - side) / 2;
    const sy = (img.height - side) * 0.3;
    ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
    return canvas.toDataURL("image/png");
  }, { source, size });
  const file = `${OUT_DIR}/icon-${size}.png`;
  writeFileSync(file, Buffer.from(dataUrl.split(",")[1], "base64"));
  console.log(`wrote ${file}`);
}
await browser.close();
