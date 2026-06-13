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

function fixturePosition(page, selector = ".fixture.next") {
  return page.evaluate((fixtureSelector) => {
    const el = document.querySelector(fixtureSelector);
    const tabs = document.querySelector(".view-tabs");
    if (!el) return { exists: false };
    const rect = el.getBoundingClientRect();
    const tabsBottom = tabs?.getBoundingClientRect().bottom || 0;
    const usableTop = tabsBottom + 14;
    const usableBottom = innerHeight - 16;
    const usableCenter = usableTop + (usableBottom - usableTop) / 2;
    const elementCenter = rect.top + rect.height / 2;
    return {
      exists: true,
      topClearsTabs: rect.top >= tabsBottom,
      bottomInView: rect.bottom <= innerHeight,
      centered: Math.abs(elementCenter - usableCenter) < 40,
    };
  }, selector);
}

function espnEvent({ id, date, home, away, homeScore = "0", awayScore = "0", homeShootout, awayShootout, status = "notstarted", details = [] }) {
  const completed = status === "FT";
  return {
    id,
    date,
    season: { slug: "group-stage" },
    competitions: [{
      status: {
        displayClock: status,
        type: {
          state: completed ? "post" : status === "notstarted" ? "pre" : "in",
          completed,
          shortDetail: status,
        },
      },
      competitors: [{
        id: home.id,
        homeAway: "home",
        score: homeScore,
        ...(homeShootout === undefined ? {} : { shootoutScore: homeShootout }),
        team: { id: home.id, displayName: home.name },
      }, {
        id: away.id,
        homeAway: "away",
        score: awayScore,
        ...(awayShootout === undefined ? {} : { shootoutScore: awayShootout }),
        team: { id: away.id, displayName: away.name },
      }],
      details,
    }],
  };
}

const ESPN_MEX_RSA_FT = espnEvent({
  id: "760415",
  date: "2026-06-11T19:00Z",
  home: { id: "203", name: "Mexico" },
  away: { id: "467", name: "South Africa" },
  homeScore: "2",
  awayScore: "0",
  status: "FT",
});

// Live mode: module graph loads and the board renders even if the feed is down.
test("live mode renders standings", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#contenders tbody tr").first()).toBeVisible();
});

test("live standings update from finished ESPN games", async ({ page }) => {
  await page.route("**/site.api.espn.com/**", (route) => route.fulfill({
    json: { events: [ESPN_MEX_RSA_FT] },
  }));
  await page.goto("/#groups");

  await expect(page.locator("#group-a tbody tr").first()).toContainText("Mexico");
  await expect(page.locator("#group-a tbody tr").first().locator("td").nth(2)).toHaveText("1");
  await expect(page.locator("#group-a tbody tr").first().locator("td").nth(7)).toHaveText("3");

  await page.goto("/");
  const mexicoOwner = page.locator("#contenders tbody tr", { hasText: "T" }).first();
  await expect(mexicoOwner.locator("td").nth(2)).toHaveText("1");
  await expect(mexicoOwner.locator("td").nth(6)).toHaveText("3");
});

// The seed schedule is not strictly chronological (match 8, Qatar vs
// Switzerland, kicks off before match 5, Haiti vs Scotland), so ESPN data must
// land on the fixture for the teams playing rather than by feed/kickoff order.
test("live ESPN data lands on the seed fixture for the right teams", async ({ page }) => {
  await page.route("**/site.api.espn.com/**", (route) => route.fulfill({
    json: {
      events: [
        espnEvent({
          id: "900",
          date: "2026-06-13T16:00Z",
          home: { id: "QAT", name: "Qatar" },
          away: { id: "SUI", name: "Switzerland" },
          homeScore: "1",
          awayScore: "0",
          status: "62'",
        }),
        espnEvent({
          id: "901",
          date: "2026-06-14T01:00Z",
          home: { id: "HAI", name: "Haiti" },
          away: { id: "SCO", name: "Scotland" },
          status: "notstarted",
        }),
      ],
    },
  }));

  await page.goto("/#fixtures");

  // Seed match 8 is Qatar vs Switzerland: it owns the live state and score.
  await expect(page.locator("#fixture-8")).toHaveClass(/live/);
  await expect(page.locator("#fixture-8 .fixture-team strong")).toHaveText(["1", "0"]);
  // Seed match 5 (Haiti vs Scotland) must not inherit the earlier match's state.
  await expect(page.locator("#fixture-5")).not.toHaveClass(/live/);
});

// A match already underway is shown as live, not as the upcoming "next" match;
// the next highlight belongs on the following fixture still to kick off.
test("a live match is not highlighted as the next upcoming fixture", async ({ page }) => {
  await page.route("**/site.api.espn.com/**", (route) => route.fulfill({
    json: {
      events: [espnEvent({
        id: "900",
        date: "2026-06-13T19:00Z",
        home: { id: "QAT", name: "Qatar" },
        away: { id: "SUI", name: "Switzerland" },
        homeScore: "1",
        awayScore: "0",
        status: "36'",
      })],
    },
  }));

  await page.goto("/#fixtures");

  // Seed match 8 (Qatar vs Switzerland) is live and styled as such, not "next".
  await expect(page.locator("#fixture-8")).toHaveClass(/live/);
  await expect(page.locator("#fixture-8")).not.toHaveClass(/\bnext\b/);
  // The next highlight sits on the following match still to kick off (match 7).
  await expect(page.locator("#fixture-7")).toHaveClass(/\bnext\b/);
});

test("fixture cards show goals and red cards from ESPN game data", async ({ page }) => {
  await page.route("**/site.api.espn.com/**", (route) => route.fulfill({
    json: {
      events: [espnEvent({
        id: "760415",
        date: "2026-06-11T19:00Z",
        home: { id: "203", name: "Mexico" },
        away: { id: "467", name: "South Africa" },
        homeScore: "2",
        awayScore: "0",
        status: "FT",
        details: [{
            scoringPlay: true,
            shootout: false,
            team: { id: "203" },
            clock: { displayValue: "9'" },
            athletesInvolved: [{ shortName: "J. Quiñones" }],
          }, {
            scoringPlay: true,
            shootout: false,
            team: { id: "203" },
            clock: { displayValue: "67'" },
            athletesInvolved: [{ shortName: "R. Jiménez" }],
          }, {
            scoringPlay: false,
            shootout: false,
            team: { id: "467" },
            clock: { displayValue: "84'" },
            type: { text: "Red Card" },
            athletesInvolved: [{ shortName: "T. Mokoena" }],
          }],
      })],
    },
  }));

  await page.goto("/#fixtures");

  await expect(page.locator("#fixture-1 .fixture-scorers").first()).toHaveText("J. Quiñones 9', R. Jiménez 67'");
  await expect(page.locator("#fixture-1 .fixture-scorers").last()).toHaveText("T. Mokoena 84'");
  await expect(page.locator("#fixture-1 .fixture-incident.goal")).toHaveCount(1);
  await expect(page.locator("#fixture-1 .fixture-incident.red-card")).toHaveCount(1);
});

test("ESPN shootout scores render as a bracketed penalty tally", async ({ page }) => {
  await page.route("**/site.api.espn.com/**", (route) => route.fulfill({
    json: {
      events: [espnEvent({
        id: "760415",
        date: "2026-06-11T19:00Z",
        home: { id: "203", name: "Mexico" },
        away: { id: "467", name: "South Africa" },
        homeScore: "1",
        awayScore: "1",
        homeShootout: 4,
        awayShootout: 2,
        status: "FT",
      })],
    },
  }));

  await page.goto("/#fixtures");

  await expect(page.locator("#fixture-1 .fixture-team strong")).toHaveText(["1 (4)", "1 (2)"]);
});

test("live fixtures use ESPN status with local schedule metadata", async ({ page }) => {
  await page.route("**/site.api.espn.com/**", (route) => route.fulfill({
    json: {
      events: [{
        id: "760415",
        date: "2026-06-11T19:00Z",
        season: { slug: "group-stage" },
        competitions: [{
          status: {
            displayClock: "FT",
            type: { state: "post", completed: true, shortDetail: "FT" },
          },
          competitors: [{
            id: "203",
            homeAway: "home",
            score: "2",
            team: { id: "203", displayName: "Mexico" },
          }, {
            id: "467",
            homeAway: "away",
            score: "0",
            team: { id: "467", displayName: "South Africa" },
          }],
        }],
      }, {
        id: "760414",
        date: "2026-06-12T02:00Z",
        season: { slug: "group-stage" },
        competitions: [{
          status: {
            displayClock: "37'",
            type: { state: "in", completed: false, shortDetail: "37'" },
          },
          competitors: [{
            id: "451",
            homeAway: "home",
            score: "1",
            team: { id: "451", displayName: "South Korea" },
          }, {
            id: "450",
            homeAway: "away",
            score: "0",
            team: { id: "450", displayName: "Czechia" },
          }],
          details: [{
            scoringPlay: true,
            shootout: false,
            team: { id: "451" },
            clock: { displayValue: "12'" },
            athletesInvolved: [{ shortName: "S. Son" }],
          }],
        }],
      }],
    },
  }));

  await page.goto("/#fixtures");

  await expect(page.locator("#sync-status")).toContainText(/Updated .+/);
  await expect(page.locator("#fixture-2")).toHaveClass(/live/);
  await expect(page.locator("#fixture-2 .fixture-live")).toHaveText("37'");
  await expect(page.locator("#fixture-2 .fixture-team strong")).toHaveText(["1", "0"]);
  await expect(page.locator("#fixture-2 .fixture-scorers")).toHaveText("S. Son 12'");
});

test("auto refresh picks up newly finished games", async ({ page }) => {
  await page.addInitScript(() => {
    window.__REFRESH_INTERVAL_MS = 500;
  });
  let espnRequests = 0;
  await page.route("**/site.api.espn.com/**", (route) => {
    espnRequests += 1;
    route.fulfill({
      json: { events: espnRequests === 1 ? [] : [ESPN_MEX_RSA_FT] },
    });
  });

  await page.goto("/");
  const mexicoOwner = page.locator("#contenders tbody tr", { hasText: "T" }).first();
  await expect(mexicoOwner.locator("td").nth(6)).toHaveText("0");
  await expect.poll(() => espnRequests, { timeout: 6000 }).toBeGreaterThanOrEqual(2);
  await expect(mexicoOwner.locator("td").nth(6)).toHaveText("3", { timeout: 6000 });
});

test("fixture refresh does not steal manual scroll", async ({ page }) => {
  await page.addInitScript(() => {
    window.__REFRESH_INTERVAL_MS = 500;
  });
  let espnRequests = 0;
  await page.route("**/site.api.espn.com/**", (route) => {
    espnRequests += 1;
    route.fulfill({ json: { events: [] } });
  });

  await page.goto("/#fixtures");
  await rendered(page, "fixtures");
  await expect
    .poll(async () => {
      const position = await fixturePosition(page);
      return position.topClearsTabs && position.bottomInView;
    })
    .toBe(true);
  await page.waitForTimeout(300);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const manualScroll = await page.evaluate(() => window.scrollY);

  await expect.poll(() => espnRequests, { timeout: 6000 }).toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(200);

  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(manualScroll - 50);
});

test("live mode does not show zero standings before feed data loads", async ({ page }) => {
  let releaseEspn;
  const espnReady = new Promise((resolve) => {
    releaseEspn = resolve;
  });
  await page.route("**/site.api.espn.com/**", async (route) => {
    await espnReady;
    await route.fulfill({
      json: { events: [ESPN_MEX_RSA_FT] },
    });
  });

  const loading = page.goto("/");
  await expect(page.locator("#sync-status")).toContainText("Fetching live World Cup groups and matches");
  await expect(page.locator("#sync-status")).toHaveClass(/loading/);
  await expect(page.locator("#contenders tbody tr")).toHaveCount(0);
  releaseEspn();
  await loading;

  await expect(page.locator("#contenders tbody tr").first()).toContainText("T");
  await expect(page.locator("#contenders tbody tr").first().locator("td").nth(6)).toHaveText("3");
});

test("loading state is consistent across tabs while feed data loads", async ({ page }) => {
  let releaseFeed;
  const feedReady = new Promise((resolve) => {
    releaseFeed = resolve;
  });
  await page.route("**/site.api.espn.com/**", async (route) => {
    await feedReady;
    await route.fulfill({ json: { events: [] } });
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
  const feedRequests = [];
  page.on("request", (request) => {
    if (request.url().includes("espn.com")) feedRequests.push(request.url());
  });
  await page.goto(MOCK, { waitUntil: "networkidle" });
  await expect(page.locator("#sync-status")).toContainText("mock data");
  expect(feedRequests).toEqual([]);
});

test("mock live state updates group tables as the score stands", async ({ page }) => {
  await page.goto("/?mock=match-40&state=live#groups/h");

  await expect(page.locator("#sync-status")).toContainText("with target match live");
  await expect(page.locator("#group-h")).toHaveClass(/active-group/);
  await expect(page.locator("#group-h tbody tr.playing")).toHaveCount(2);
  await expect(page.locator("#group-h tbody tr.playing .score-badge")).toHaveText(["3", "0"]);

  const uruguay = page.locator("#group-h tbody tr", { hasText: "Uruguay" });
  await expect(uruguay.locator("td").nth(2)).toHaveText("2");
  await expect(uruguay.locator("td").nth(7)).toHaveText("6");
});

test("pool standings mark the active owned team flag", async ({ page }) => {
  await page.goto("/?mock=match-40&state=live");

  const chun = page.locator("#contenders tbody tr", { hasText: "Chun" });
  await expect(chun.locator(".team-flag.playing")).toHaveCount(1);
  await expect(chun.locator(".team-flag.playing .flag-live-score")).toHaveText("3");

  const sharon = page.locator("#contenders tbody tr", { hasText: "Sharon" });
  await expect(sharon.locator(".team-flag.playing")).toHaveCount(1);
  await expect(sharon.locator(".team-flag.playing .flag-live-score")).toHaveText("0");
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
    .poll(async () => {
      const position = await fixturePosition(page);
      return position.centered && position.bottomInView;
    })
    .toBe(true);
});

test("groups tab returns to active group", async ({ page }) => {
  await page.goto("/?mock=match-40&state=live");
  await page.click('[data-view="groups"]');
  await rendered(page, "groups");
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.click('[data-view="groups"]');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const el = document.querySelector(".group-table.active-group");
        const tabs = document.querySelector(".view-tabs");
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const tabsBottom = tabs?.getBoundingClientRect().bottom || 0;
        const usableTop = tabsBottom + 14;
        const usableBottom = innerHeight - 16;
        const usableCenter = usableTop + (usableBottom - usableTop) / 2;
        const elementCenter = rect.top + rect.height / 2;
        return Math.abs(elementCenter - usableCenter) < 40 && rect.bottom > 0;
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
    if (response.status() >= 400 && !response.url().includes("espn.com")) {
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
