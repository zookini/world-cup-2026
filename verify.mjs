// Browser verification: starts the app via wrangler and drives it in headless
// Chromium at iPhone viewport size (see AGENTS.md). Run with `npm run verify`.
import { spawn, spawnSync } from "node:child_process";
import { chromium } from "playwright";

const PORT = 8901 + Math.floor(Math.random() * 50);
const BASE = `http://127.0.0.1:${PORT}`; // wrangler doesn't listen on IPv6 localhost

const failures = [];
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
}

async function startServer() {
  const server = spawn(`npx wrangler pages dev --port ${PORT}`, { shell: true, stdio: "ignore" });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await fetch(`${BASE}/`);
      return server;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error(`wrangler did not become ready on ${BASE}`);
}

function stopServer(server) {
  // shell:true wraps wrangler in a shell on Windows, so kill the whole tree.
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", `${server.pid}`, "/T", "/F"]);
  else server.kill();
}

async function newPage(context, { trackErrors } = {}) {
  const page = await context.newPage();
  if (trackErrors) {
    // Resource-load console errors from a down live feed are expected offline;
    // only uncaught exceptions and app-emitted console errors should fail.
    page.on("console", (msg) => {
      if (msg.type() === "error" && !msg.text().includes("Failed to load resource")) {
        trackErrors.push(`console: ${msg.text()}`);
      }
    });
    page.on("pageerror", (error) => trackErrors.push(`pageerror: ${error}`));
  }
  return page;
}

async function settle(page, url) {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(600); // scroll/highlight runs a frame after render
}

async function deepLinkTarget(page, id) {
  return page.evaluate((elementId) => {
    const el = document.getElementById(elementId);
    if (!el) return { exists: false };
    const rect = el.getBoundingClientRect();
    return {
      exists: true,
      highlighted: el.classList.contains("deep-linked"),
      inView: rect.top < innerHeight && rect.bottom > 0,
    };
  }, id);
}

const server = await startServer();
const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const errors = [];
  const badResponses = [];
  context.on("response", (response) => {
    // Ignore the live feed (offline-friendly); any other 4xx/5xx is a broken asset.
    if (response.status() >= 400 && !response.url().includes("/api/")) {
      badResponses.push(`${response.status()} ${response.url()}`);
    }
  });
  const page = await newPage(context, { trackErrors: errors });

  // Live mode: module graph loads and the board renders even if the feed is down.
  await settle(page, `${BASE}/`);
  const liveRows = await page.locator("#contenders tbody tr").count();
  check("live mode renders standings", liveRows > 0, `${liveRows} rows`);

  for (const view of ["fixtures", "groups"]) {
    await page.click(`[data-view="${view}"]`);
    await page.waitForTimeout(400);
    const children = await page.locator(`#${view} > *`).count();
    const hash = await page.evaluate(() => location.hash);
    check(`${view} tab renders and routes`, children > 0 && hash === `#${view}`, `${children} elements, hash=${hash}`);
  }

  // Mock mode must not call the live feed.
  const apiRequests = [];
  page.on("request", (request) => { if (request.url().includes("/api/")) apiRequests.push(request.url()); });
  await settle(page, `${BASE}/?mock=match-72`);
  const mockStatus = (await page.locator("#sync-status").textContent()).trim();
  check("mock mode loads", mockStatus.includes("mock data"), mockStatus.slice(0, 80));
  check("mock mode stays offline", apiRequests.length === 0, `${apiRequests.length} /api calls`);

  // Deep links highlight and scroll, including the bare-slug anchor form.
  await settle(page, `${BASE}/?mock=match-72#fixtures/match-5`);
  let target = await deepLinkTarget(page, "fixture-5");
  check("fixture deep link", target.highlighted && target.inView, JSON.stringify(target));

  await settle(page, `${BASE}/?mock=match-72#groups/c`);
  target = await deepLinkTarget(page, "group-c");
  check("group deep link (bare slug)", target.highlighted && target.inView, JSON.stringify(target));

  // Unknown hash falls back to standings.
  await settle(page, `${BASE}/#bogus/whatever`);
  const fallback = await page.evaluate(() => document.querySelector(".view-panel.active")?.dataset.panel);
  check("garbage hash falls back", fallback === "standings", `panel=${fallback}`);

  // Share, native path: capture what navigator.share receives.
  const shareContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const sharePage = await newPage(shareContext);
  await sharePage.addInitScript(() => {
    navigator.share = (data) => { window.__shared = data; return Promise.resolve(); };
  });
  await settle(sharePage, `${BASE}/?mock=match-72#fixtures`);
  await sharePage.locator(".fixture .fixture-share").first().click();
  const shared = await sharePage.evaluate(() => window.__shared);
  check("share via navigator.share", /#fixtures\/match-\d+$/.test(shared?.url || "") && /vs/.test(shared?.text || ""), JSON.stringify(shared));
  await shareContext.close();

  // Share, clipboard fallback (browsers without navigator.share).
  const clipContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const clipPage = await newPage(clipContext);
  await clipPage.addInitScript(() => { delete Navigator.prototype.share; });
  await settle(clipPage, `${BASE}/?mock=match-72#fixtures`);
  await clipPage.locator(".fixture .fixture-share").first().click();
  await clipPage.waitForTimeout(300);
  const copied = await clipPage.evaluate(() => !!document.querySelector(".fixture-share.copied"));
  const clipboard = await clipPage.evaluate(() => navigator.clipboard.readText().catch(() => ""));
  check("share clipboard fallback", copied && clipboard.includes("#fixtures/match-"), `badge=${copied}, clipboard=${clipboard}`);
  await clipContext.close();

  // Asset health: flags and title art actually decoded on the standings view.
  await settle(page, `${BASE}/?mock=match-72`);
  const brokenImages = await page.evaluate(() =>
    [...document.querySelectorAll("img")].filter((img) => !(img.complete && img.naturalWidth > 0)).map((img) => img.src)
  );
  check("all images decode", brokenImages.length === 0, brokenImages.join(", "));
  check("no failed asset requests", badResponses.length === 0, badResponses.join(", "));

  // The status line is real UI now (not visually-hidden) and shows update time.
  const statusText = (await page.locator("#sync-status").textContent()).trim();
  const statusVisible = await page.locator("#sync-status").isVisible();
  check("status line visible with update time", statusVisible && /Updated .+/.test(statusText), statusText.slice(0, 100));

  // PWA assets resolve.
  const manifest = await fetch(`${BASE}/manifest.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const iconResponses = await Promise.all(
    ["icon-192.png", "icon-512.png", "icon-180.png"].map((icon) => fetch(`${BASE}/assets/icons/${icon}`))
  );
  check("manifest and icons load", Boolean(manifest?.icons?.length) && iconResponses.every((r) => r.ok),
    `manifest icons=${manifest?.icons?.length}, fetched=${iconResponses.filter((r) => r.ok).length}/3`);

  // Tabs stay pinned while the fixture list scrolls.
  await settle(page, `${BASE}/?mock=match-72#fixtures`);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
  await page.waitForTimeout(300);
  const tabsTop = await page.evaluate(() => document.querySelector(".view-tabs").getBoundingClientRect().top);
  check("tabs stick while scrolling", tabsTop === 0, `tabs top=${tabsTop}`);

  check("no page errors", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
  stopServer(server);
}

console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nAll checks passed");
process.exit(failures.length ? 1 : 0);
