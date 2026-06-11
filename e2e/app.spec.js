import { test as base, expect } from "@playwright/test";

// Simulated tournament covering most of the group stage (see README mock mode).
const MOCK = "/?mock=match-72";

// Every test fails on uncaught exceptions and app-emitted console errors.
// Resource-load errors from a down live feed are expected offline and ignored.
const test = base.extend({
  pageErrors: [
    async ({ page }, use) => {
      const errors = [];
      page.on("console", (msg) => {
        if (msg.type() === "error" && !msg.text().includes("Failed to load resource")) {
          errors.push(`console: ${msg.text()}`);
        }
      });
      page.on("pageerror", (error) => errors.push(`pageerror: ${error}`));
      await use(errors);
      expect(errors).toEqual([]);
    },
    { auto: true },
  ],
});

function rendered(page, view) {
  return expect.poll(() => page.locator(`#${view} > *`).count()).toBeGreaterThan(0);
}

function deepLinkTarget(page, id) {
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

// Live mode: module graph loads and the board renders even if the feed is down.
test("live mode renders standings", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#contenders tbody tr").first()).toBeVisible();
});

test("live standings update from finished games when group tables lag", async ({ page }) => {
  const groups = {
    groups: [{
      name: "A",
      teams: [
        { team_id: "1", mp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 },
        { team_id: "2", mp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 },
        { team_id: "3", mp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 },
        { team_id: "4", mp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 },
      ],
    }],
  };
  const games = {
    games: [{
      id: "1",
      home_team_id: "1",
      away_team_id: "2",
      group: "A",
      local_date: "06/11/2026 13:00",
      stadium_id: "1",
      type: "group",
      home_team_name_en: "Mexico",
      away_team_name_en: "South Africa",
      home_score: "2",
      away_score: "0",
      time_elapsed: "FT",
    }, {
      id: "2",
      home_team_id: "3",
      away_team_id: "4",
      group: "A",
      local_date: "06/11/2026 20:00",
      stadium_id: "2",
      type: "group",
      home_team_name_en: "South Korea",
      away_team_name_en: "Czech Republic",
      home_score: "0",
      away_score: "0",
      time_elapsed: "notstarted",
    }],
  };

  await page.route("**/api/groups", (route) => route.fulfill({ json: groups }));
  await page.route("**/api/games", (route) => route.fulfill({ json: games }));
  await page.goto("/#groups");

  await expect(page.locator("#group-a tbody tr").first()).toContainText("Mexico");
  await expect(page.locator("#group-a tbody tr").first().locator("td").nth(2)).toHaveText("1");
  await expect(page.locator("#group-a tbody tr").first().locator("td").nth(7)).toHaveText("3");

  await page.goto("/");
  const mexicoOwner = page.locator("#contenders tbody tr", { hasText: "T" }).first();
  await expect(mexicoOwner.locator("td").nth(2)).toHaveText("1");
  await expect(mexicoOwner.locator("td").nth(6)).toHaveText("3");
});

test("fixture cards show scorers from live game data", async ({ page }) => {
  await page.route("**/api/groups", (route) => route.fulfill({
    json: {
      groups: [{
        name: "A",
        teams: [
          { team_id: "1", mp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 },
          { team_id: "2", mp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 },
        ],
      }],
    },
  }));
  await page.route("**/api/games", (route) => route.fulfill({
    json: {
      games: [{
        id: "1",
        home_team_id: "1",
        away_team_id: "2",
        group: "A",
        local_date: "06/11/2026 13:00",
        stadium_id: "1",
        type: "group",
        home_team_name_en: "Mexico",
        away_team_name_en: "South Africa",
        home_score: "2",
        away_score: "0",
        home_scorers: "{“J. Quiñones 9'”,”R. Jiménez 67'”}",
        away_scorers: "null",
        finished: "TRUE",
        time_elapsed: "finished",
      }],
    },
  }));

  await page.goto("/#fixtures");

  await expect(page.locator("#fixture-1 .fixture-scorers")).toHaveText("J. Quiñones 9', R. Jiménez 67'");
});

test("stale proxy responses trigger a quick fresh sync", async ({ page }) => {
  const groups = {
    groups: [{
      name: "A",
      teams: [
        { team_id: "1", mp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 },
        { team_id: "2", mp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 },
      ],
    }],
  };
  const staleGames = {
    games: [{
      id: "1",
      home_team_id: "1",
      away_team_id: "2",
      group: "A",
      local_date: "06/11/2026 13:00",
      stadium_id: "1",
      type: "group",
      home_team_name_en: "Mexico",
      away_team_name_en: "South Africa",
      home_score: "0",
      away_score: "0",
      time_elapsed: "notstarted",
    }, {
      id: "2",
      home_team_id: "3",
      away_team_id: "4",
      group: "A",
      local_date: "06/11/2026 20:00",
      stadium_id: "2",
      type: "group",
      home_team_name_en: "South Korea",
      away_team_name_en: "Czech Republic",
      home_score: "0",
      away_score: "0",
      time_elapsed: "notstarted",
    }],
  };
  const freshGames = {
    games: staleGames.games.map((game) => game.id === "1"
      ? { ...game, home_score: "2", away_score: "0", finished: "TRUE", time_elapsed: "finished" }
      : game),
  };
  let groupRequests = 0;
  let gameRequests = 0;
  await page.route("**/api/groups**", (route) => {
    groupRequests += 1;
    route.fulfill({
      json: groups,
      headers: groupRequests === 1 ? { "X-Cache": "stale-refreshing" } : {},
    });
  });
  await page.route("**/api/games**", (route) => {
    gameRequests += 1;
    route.fulfill({
      json: gameRequests === 1 ? staleGames : freshGames,
      headers: gameRequests === 1 ? { "X-Cache": "stale-refreshing" } : {},
    });
  });

  await page.goto("/");
  const mexicoOwner = page.locator("#contenders tbody tr", { hasText: "T" }).first();
  await expect(mexicoOwner.locator("td").nth(6)).toHaveText("0");
  await expect.poll(() => gameRequests, { timeout: 6000 }).toBeGreaterThanOrEqual(2);
  await expect(mexicoOwner.locator("td").nth(6)).toHaveText("3", { timeout: 6000 });
});

test("live mode does not show zero standings before feed data loads", async ({ page }) => {
  let releaseGames;
  const gamesReady = new Promise((resolve) => {
    releaseGames = resolve;
  });
  await page.route("**/api/groups**", (route) => route.fulfill({
    json: {
      groups: [{
        name: "A",
        teams: [
          { team_id: "1", mp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 },
          { team_id: "2", mp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 },
        ],
      }],
    },
  }));
  await page.route("**/api/games**", async (route) => {
    await gamesReady;
    await route.fulfill({
      json: {
        games: [{
          id: "1",
          home_team_id: "1",
          away_team_id: "2",
          group: "A",
          local_date: "06/11/2026 13:00",
          stadium_id: "1",
          type: "group",
          home_team_name_en: "Mexico",
          away_team_name_en: "South Africa",
          home_score: "2",
          away_score: "0",
          finished: "TRUE",
          time_elapsed: "finished",
        }, {
          id: "2",
          home_team_id: "3",
          away_team_id: "4",
          group: "A",
          local_date: "06/11/2026 20:00",
          stadium_id: "2",
          type: "group",
          home_team_name_en: "South Korea",
          away_team_name_en: "Czech Republic",
          home_score: "0",
          away_score: "0",
          finished: "FALSE",
          time_elapsed: "notstarted",
        }],
      },
    });
  });

  const loading = page.goto("/");
  await expect(page.locator("#sync-status")).toContainText("Fetching live World Cup groups and matches");
  await expect(page.locator("#sync-status")).toHaveClass(/loading/);
  await expect(page.locator("#contenders tbody tr")).toHaveCount(0);
  releaseGames();
  await loading;

  await expect(page.locator("#contenders tbody tr").first()).toContainText("T");
  await expect(page.locator("#contenders tbody tr").first().locator("td").nth(6)).toHaveText("3");
});

test("loading state is consistent across tabs while feed data loads", async ({ page }) => {
  let releaseFeed;
  const feedReady = new Promise((resolve) => {
    releaseFeed = resolve;
  });
  await page.route("**/api/groups**", async (route) => {
    await feedReady;
    await route.fulfill({ json: { groups: [] } });
  });
  await page.route("**/api/games**", async (route) => {
    await feedReady;
    await route.fulfill({ json: { games: [] } });
  });

  const loading = page.goto("/");
  await expect(page.locator("#sync-status")).toContainText("Fetching live World Cup groups and matches");
  await expect(page.locator("#sync-status")).toHaveClass(/loading/);
  await expect(page.locator("#contenders table")).toHaveCount(0);
  await expect.poll(() => page.locator("#contenders").evaluate((el) => getComputedStyle(el).boxShadow)).toBe("none");

  await page.click('[data-view="fixtures"]');
  await expect(page.locator('[data-panel="fixtures"]')).toHaveClass(/active/);
  await expect(page.locator("#fixtures > *")).toHaveCount(0);
  await expect(page.locator("#sync-status")).toContainText("Fetching live World Cup groups and matches");

  await page.click('[data-view="groups"]');
  await expect(page.locator('[data-panel="groups"]')).toHaveClass(/active/);
  await expect(page.locator("#groups > *")).toHaveCount(0);
  await expect(page.locator("#sync-status")).toContainText("Fetching live World Cup groups and matches");

  releaseFeed();
  await loading;
  await expect(page.locator("#sync-status")).not.toHaveClass(/loading/);
});

test("tabs render and route", async ({ page }) => {
  await page.goto("/");
  for (const view of ["fixtures", "groups"]) {
    await page.click(`[data-view="${view}"]`);
    await expect(page).toHaveURL(new RegExp(`#${view}$`));
    await rendered(page, view);
  }
});

test("plain tab switch resets scroll", async ({ page }) => {
  await page.goto("/");
  await page.click('[data-view="fixtures"]');
  await rendered(page, "fixtures");
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
  await page.click('[data-view="groups"]');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

test("mock mode loads and stays offline", async ({ page }) => {
  const apiRequests = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/")) apiRequests.push(request.url());
  });
  await page.goto(MOCK, { waitUntil: "networkidle" });
  await expect(page.locator("#sync-status")).toContainText("mock data");
  expect(apiRequests).toEqual([]);
});

test("medal badges appear only when each podium place is settled", async ({ page }) => {
  await page.goto("/?mock=match-102");
  await expect(page.locator(".rank-badge")).toHaveCount(0);

  await page.goto("/?mock=match-103");
  await expect(page.locator(".rank-3")).toHaveCount(1);
  await expect(page.locator(".rank-1, .rank-2")).toHaveCount(0);

  await page.goto("/?mock=match-104");
  await expect(page.locator(".rank-1")).toHaveCount(1);
  await expect(page.locator(".rank-2")).toHaveCount(1);
  await expect(page.locator(".rank-3")).toHaveCount(1);
});

test("third-place fixture teams stay active until the match is settled", async ({ page }) => {
  await page.goto("/?mock=match-102#fixtures/match-103");
  await expect(page.locator("#fixture-103 .fixture-team.eliminated")).toHaveCount(0);

  await page.goto("/?mock=match-103#fixtures/match-103");
  await expect(page.locator("#fixture-103 .fixture-team.eliminated")).toHaveCount(1);
});

test("fixtures tab returns to next match", async ({ page }) => {
  await page.goto(MOCK);
  await page.click('[data-view="fixtures"]');
  await rendered(page, "fixtures");
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.click('[data-view="fixtures"]');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const el = document.querySelector(".fixture.next");
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        return rect.top < innerHeight && rect.bottom > 0;
      })
    )
    .toBe(true);
});

// Deep links highlight and scroll, including the bare-slug anchor form.
test("fixture deep link highlights and scrolls", async ({ page }) => {
  await page.goto(`${MOCK}#fixtures/match-5`);
  await expect
    .poll(async () => {
      const target = await deepLinkTarget(page, "fixture-5");
      return target.highlighted && target.inView;
    })
    .toBe(true);
});

test("group deep link accepts a bare slug", async ({ page }) => {
  await page.goto(`${MOCK}#groups/c`);
  await expect
    .poll(async () => {
      const target = await deepLinkTarget(page, "group-c");
      return target.highlighted && target.inView;
    })
    .toBe(true);
});

test("garbage hash falls back to standings", async ({ page }) => {
  await page.goto("/#bogus/whatever");
  await expect
    .poll(() => page.evaluate(() => document.querySelector(".view-panel.active")?.dataset.panel))
    .toBe("standings");
});

test("share uses navigator.share when available", async ({ page }) => {
  // Headless Chromium's native share is a silent no-op; stub it to capture the payload.
  await page.addInitScript(() => {
    navigator.share = (data) => {
      window.__shared = data;
      return Promise.resolve();
    };
  });
  await page.goto(`${MOCK}#fixtures`);
  await page.locator(".fixture .fixture-share").first().click();
  await expect.poll(() => page.evaluate(() => window.__shared?.url ?? "")).toMatch(/#fixtures\/match-\d+$/);
  expect(await page.evaluate(() => window.__shared.text)).toMatch(/vs/);
});

test("share falls back to clipboard without navigator.share", async ({ page }) => {
  await page.addInitScript(() => {
    delete Navigator.prototype.share;
  });
  await page.goto(`${MOCK}#fixtures`);
  await page.locator(".fixture .fixture-share").first().click();
  await expect(page.locator(".fixture-share.copied")).toBeVisible();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText().catch(() => ""));
  expect(clipboard).toContain("#fixtures/match-");
});

// Asset health: flags and title art actually decoded on the standings view.
test("all images decode and no asset request fails", async ({ page }) => {
  const badResponses = [];
  page.on("response", (response) => {
    // Ignore the live feed (offline-friendly); any other 4xx/5xx is a broken asset.
    if (response.status() >= 400 && !response.url().includes("/api/")) {
      badResponses.push(`${response.status()} ${response.url()}`);
    }
  });
  await page.goto(MOCK, { waitUntil: "networkidle" });
  const brokenImages = await page.evaluate(() =>
    [...document.querySelectorAll("img")]
      .filter((img) => !(img.complete && img.naturalWidth > 0))
      .map((img) => img.src)
  );
  expect(brokenImages).toEqual([]);
  expect(badResponses).toEqual([]);
});

test("status line is visible with update time", async ({ page }) => {
  await page.goto(MOCK);
  await expect(page.locator("#sync-status")).toBeVisible();
  await expect(page.locator("#sync-status")).toContainText(/Updated .+/);
});

test("manifest and icons load", async ({ request }) => {
  const manifest = await request.get("/manifest.json");
  expect(manifest.ok()).toBe(true);
  expect((await manifest.json()).icons?.length).toBeGreaterThan(0);
  for (const icon of ["icon-192.png", "icon-512.png", "icon-180.png"]) {
    const response = await request.get(`/assets/icons/${icon}`);
    expect(response.ok(), icon).toBe(true);
  }
});

test("tabs stick while scrolling", async ({ page }) => {
  await page.goto(`${MOCK}#fixtures`);
  await rendered(page, "fixtures");
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
  await expect
    .poll(() => page.evaluate(() => document.querySelector(".view-tabs").getBoundingClientRect().top))
    .toBe(0);
});
