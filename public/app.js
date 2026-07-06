import { parseMatchDate, isFinished, number } from "./match-utils.js";
import { parseSeedTsv } from "./seed-data.js";
import { thirdPlaceAllocation } from "./third-place-allocation.js";

const PLAYER_ORDER = ["Boe", "Colm", "Ivan", "T", "Sharon", "Andy", "Joey", "Vinny", "Kachun", "Chun", "Kakei", "Janey"];

let selections = [];
let groups = [];
let games = [];
let teamById = new Map();
let teamByCode = new Map();
let espnNameByCode = new Map();
let dataStatus = "";
let initialDataLoaded = false;
let loadingMessage = "";
let pendingFixtureScroll = false;
let pendingGroupScroll = false;

const contendersEl = document.querySelector("#contenders");
const lastPlaceEl = document.querySelector("#last-place");
const groupsEl = document.querySelector("#groups");
const fixturesEl = document.querySelector("#fixtures");
const bracketEl = document.querySelector("#bracket");
const roundsEl = document.querySelector("#rounds");
const syncStatusEl = document.querySelector("#sync-status");
const viewButtons = document.querySelectorAll("[data-view]");
const viewPanels = document.querySelectorAll("[data-panel]");

const VIEWS = ["standings", "losers", "fixtures", "groups", "bracket", "rounds"];
let activeView = "standings";
const KNOCKOUT_TYPES = ["r32", "r16", "qf", "sf", "third", "final"];
let activeRound = null;

// ESPN's scoreboard API sends Access-Control-Allow-Origin: *, so the browser
// can call it directly without a same-origin proxy.
const ESPN_SCOREBOARD_URL =
  "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?limit=200&dates=20260611-20260719";

async function init() {
  bindViewTabs();
  bindShareButtons(fixturesEl, shareFixture);
  bindShareButtons(roundsEl, shareFixture);
  bindShareButtons(groupsEl, shareGroup);
  bindRoundSwitcher();
  applyHashRoute();
  window.addEventListener("hashchange", applyHashRoute);
  await loadSelections();
  await refreshData();
  startAutoRefresh();
}

// Keep scores moving without manual reloads: re-pull the feed once a minute
// while the tab is visible, and immediately when the user returns to it.
// Mock data never changes, so mock mode skips this entirely.
const REFRESH_INTERVAL_MS = globalThis.__REFRESH_INTERVAL_MS ?? 60000;

function startAutoRefresh() {
  if (hasMockParam(location.search)) return;
  setInterval(() => {
    if (!document.hidden) refreshData();
  }, REFRESH_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshData();
  });
}

function bindViewTabs() {
  viewButtons.forEach((button) => {
    button.addEventListener("click", () => {
      // Drive navigation through the hash so the URL stays shareable and the
      // hashchange handler remains the single source of truth.
      const hash = `#${button.dataset.view}`;
      if (location.hash === hash) {
        applyHashRoute();
      } else {
        location.hash = button.dataset.view;
      }
    });
  });
}

// One delegated listener per panel for its share buttons — survives the
// innerHTML rebuilds in the render functions because it lives on the parent.
function bindShareButtons(container, handler) {
  container.addEventListener("click", (event) => {
    const button = event.target.closest(".fixture-share");
    if (button) handler(button.dataset.share, button);
  });
}

// Hand the user a deep link. On phones this opens the native share sheet
// (Messages/WhatsApp/Copy); elsewhere it copies the link to the clipboard.
async function share(anchor, label, button) {
  const url = `${location.origin}${location.pathname}#${anchor}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: "Degenerate Cup 2026", text: label, url });
    } catch (error) {
      // User dismissed the share sheet — nothing to do.
    }
    return;
  }
  copyShareLink(url, button);
}

function matchLabel(id, fallback) {
  const game = games.find((entry) => `${entry.id}` === id);
  return game ? `${fixtureTeam(game, "home").name} vs ${fixtureTeam(game, "away").name}` : fallback;
}

function shareFixture(id, button) {
  return share(`fixtures/match-${id}`, matchLabel(id, "this match"), button);
}

function shareGroup(group, button) {
  return share(`groups/${groupSlug(group)}`, `Group ${group}`, button);
}

async function copyShareLink(url, button) {
  try {
    await navigator.clipboard.writeText(url);
    button.classList.add("copied");
    setTimeout(() => button.classList.remove("copied"), 1400);
  } catch (error) {
    window.prompt("Copy this link to share:", url);
  }
}

// Toggle the active button/panel for a view without touching the URL.
function activateView(view) {
  activeView = view;
  viewButtons.forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  viewPanels.forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === view));
}

// Split the URL hash into its `[view, anchor]` parts (e.g. `#fixtures/match-1`).
function parseHash() {
  return location.hash.replace(/^#/, "").split("/");
}

// Read `#<view>` or `#<view>/<anchor>` from the URL and reflect it in the UI.
// Unknown/empty hashes fall back to the first view.
function applyHashRoute() {
  const [view, anchor] = parseHash();
  const resolved = VIEWS.includes(view) ? view : VIEWS[0];
  activateView(resolved);
  renderActiveView();
  if (!anchor) {
    if (resolved === "fixtures") {
      requestFixtureScroll();
      return;
    }
    if (resolved === "groups") {
      requestGroupScroll();
      return;
    }
    scrollToTop();
    return;
  }
  if (resolved === "fixtures") requestFixtureScroll();
  if (resolved === "groups") scrollToGroup(hashGroupTarget());
}

// The element a `#<view>/<anchor>` hash points at, or null when the hash isn't
// a deep link for that view or the target hasn't rendered yet. The anchor's
// `<anchorPrefix>-` is optional (the bare id/slug is also accepted).
function hashTarget(view, elementPrefix, anchorPrefix) {
  const [hashView, anchor] = parseHash();
  if (hashView !== view || !anchor) return null;
  const id = anchor.startsWith(`${anchorPrefix}-`) ? anchor.slice(anchorPrefix.length + 1) : anchor;
  return document.getElementById(`${elementPrefix}-${id}`);
}

function hashFixtureTarget() {
  return hashTarget("fixtures", "fixture", "match");
}

function hashGroupTarget() {
  return hashTarget("groups", "group", "group");
}

// A monotonic token so only the most recently scheduled scroll runs. Switching
// views (or scheduling another scroll) supersedes a scroll still waiting on
// layout, so a scroll meant for a view you've left can't yank the page after
// you've moved on.
let scrollToken = 0;

// Run fn once the freshly shown panel has been laid out (two frames), unless a
// newer scroll has superseded this one. The position is applied instantly:
// switching tabs should land at the right spot, not animate there from
// wherever the previous view happened to be scrolled.
function afterLayout(fn) {
  const token = ++scrollToken;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (token === scrollToken) fn();
  }));
}

function scrollToTop() {
  afterLayout(() => window.scrollTo({ top: 0, behavior: "auto" }));
}

function groupSlug(group) {
  return `${group}`.trim().toLowerCase().replace(/^group\s+/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function loadSelections() {
  const response = await fetch("selections.csv");
  if (!response.ok) throw new Error(`Could not load selections.csv: HTTP ${response.status}`);
  const rows = parseCsv(await response.text());
  const headers = rows[0].map((header) => header.trim());

  selections = rows.slice(1).map((row) => {
    const item = Object.fromEntries(headers.map((header, index) => [header, row[index] || ""]));
    return {
      player: item.player,
      code: item.teamCode,
      name: item.teamName,
      group: item.group,
    };
  }).filter((team) => team.player && team.code);
}

let refreshing = false;

async function refreshData() {
  if (refreshing) return;
  refreshing = true;
  const feed = await feedForUrl(location.search);
  if (!initialDataLoaded) {
    loadingMessage = feed.loadingMessage;
    renderLoadingState();
    syncStatusEl.textContent = feed.loadingMessage;
    syncStatusEl.classList.add("loading");
  }
  try {
    const dataSet = await feed.load();
    groups = dataSet.groups;
    games = dataSet.games;
    dataStatus = dataSet.status || "";
    initialDataLoaded = true;
    indexTeams();
    resolveKnownBracketTeams();
    // Bracket resolution fills in the teams (and FIFA codes) of knockout
    // fixtures that the feed's first overlay couldn't match while they were
    // still placeholders, so overlay again to pick up their live scores. Each
    // knockout round only learns its teams once the round feeding it has both
    // finished and had its scores overlaid, so alternate overlay/resolve passes
    // to carry winners forward (R32 → R16 → QF → SF → final) until the bracket
    // stops changing.
    if (dataSet.overlayLive) {
      let pass = 0;
      do {
        games = dataSet.overlayLive(games);
        indexTeams();
      } while (resolveKnownBracketTeams() && ++pass < 8);
    }
    indexTeams();
    renderActiveView();
    syncStatusEl.textContent = statusLine();
    syncStatusEl.classList.remove("loading");
  } catch (error) {
    renderActiveView();
    // A failed auto-refresh keeps the last good data on screen, so report it
    // as staleness rather than discarding the board.
    syncStatusEl.textContent = games.length
      ? `${statusLine()} Refresh failed: ${error.message}.`
      : `Could not load ${feed.name}: ${error.message}. The board is showing the selected teams from selections.csv only.`;
    syncStatusEl.classList.remove("loading");
  } finally {
    refreshing = false;
  }
}

function statusLine() {
  return [
    dataStatus,
    `Updated ${timeLabel(new Date())}.`,
    ...unresolvedKnockoutWarnings(),
  ].filter(Boolean).join(" ");
}

function renderLoadingState() {
  contendersEl.innerHTML = "";
  lastPlaceEl.innerHTML = "";
  fixturesEl.innerHTML = "";
  groupsEl.innerHTML = "";
  bracketEl.innerHTML = "";
  roundsEl.innerHTML = "";
}

// A finished knockout game that is still level means the feed didn't encode
// the shootout result anywhere we can read, so eliminations would silently
// stall — say it out loud instead.
function unresolvedKnockoutWarnings() {
  return games
    .filter((game) => game.type !== "group" && isFinished(game) && !loserId(game))
    .map((game) =>
      `Match ${game.id} (${fixtureTeam(game, "home").name} vs ${fixtureTeam(game, "away").name}) ` +
      "ended level with no shootout result in the feed; eliminations may be incomplete.");
}

async function feedForUrl(search) {
  if (!hasMockParam(search)) return liveFeed();
  const { feed } = await import("./mock-feed.js");
  return feed({ search });
}

function liveFeed() {
  return {
    name: "live World Cup feed",
    loadingMessage: "Fetching live World Cup groups and matches...",
    async load() {
      const [seed, espnPayload] = await Promise.all([
        loadSeedData(),
        optionalFetchJson(ESPN_SCOREBOARD_URL),
      ]);
      // A knockout fixture only learns its teams (and thus their FIFA codes)
      // once the feeding groups finish, which happens in resolveKnownBracketTeams
      // after this load. Expose the overlay so refreshData can re-run it on the
      // resolved fixtures and land their live ESPN scores too.
      const overlayLive = (games) => (espnPayload ? mergeEspnGames(games, espnPayload) : games);
      return {
        groups: seed.groups,
        games: overlayLive(seed.games),
        overlayLive,
        status: espnPayload ? "" : "ESPN live scores unavailable; showing local schedule only.",
      };
    },
  };
}

function hasMockParam(search) {
  return /^match-\d+$/.test(new URLSearchParams(search).get("mock") || "");
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json();
}

async function loadSeedData() {
  const response = await fetch("tournament-seed.tsv");
  if (!response.ok) throw new Error(`tournament-seed.tsv returned HTTP ${response.status}`);
  return parseSeedTsv(await response.text());
}

async function optionalFetchJson(path) {
  try {
    return await fetchJson(path);
  } catch (error) {
    console.warn(`${path} unavailable: ${error.message}`);
    return null;
  }
}

// Overlay ESPN status/scores onto the seed fixtures by the teams playing, not
// by feed order: the seed's match numbers are the canonical schedule but are
// not strictly chronological, so aligning ESPN's date-sorted events to seed ids
// by position drops live data onto the wrong fixture (e.g. an early kickoff's
// score landing on a later same-day match).
//
// Match on the teams' FIFA codes, the one identifier the seed (its `code`
// column) and ESPN (team.abbreviation) share exactly. That sidesteps every
// spelling difference between the two sources ("Côte d'Ivoire" vs "Ivory
// Coast", "Cabo Verde" vs "Cape Verde", ...) with no name normalization or
// fuzzy scoring: each fixture finds its event by an unordered code pair, and the
// matched event's names overlay the seed so the board shows ESPN's spelling.
function mergeEspnGames(seedGames, payload) {
  espnNameByCode = new Map();
  const espnByPair = new Map();
  (payload.events || []).forEach((event) => {
    const espnGame = mapEspnEvent(event);
    if (!espnGame) return;
    rememberEspnName(espnGame.home_team_code, espnGame.home_team_name_en);
    rememberEspnName(espnGame.away_team_code, espnGame.away_team_name_en);
    const key = teamPairKey(espnGame.home_team_code, espnGame.away_team_code);
    if (!key) return;
    if (!espnByPair.has(key)) espnByPair.set(key, []);
    espnByPair.get(key).push(espnGame);
  });
  return seedGames.map((game) => {
    const key = teamPairKey(game.home_team_code, game.away_team_code);
    const candidates = key ? espnByPair.get(key) : null;
    const espnGame = candidates ? closestByDate(game, candidates) : null;
    return espnGame ? overlayEspnGame(game, espnGame) : game;
  });
}

// FIFA codes arrive from the seed, selections.csv, and ESPN with inconsistent
// casing, so compare them in one canonical form.
function upperCode(code) {
  return `${code || ""}`.toUpperCase();
}

// Unordered key of the two FIFA codes so a seed fixture and its ESPN event match
// regardless of which side the feed lists as home. A game with a missing code
// (knockout seed rows are placeholders until teams advance) yields no key and so
// never matches.
function teamPairKey(homeCode, awayCode) {
  const home = upperCode(homeCode);
  const away = upperCode(awayCode);
  if (!home || !away) return "";
  return [home, away].sort().join("|");
}

// The same code pair can recur (a group fixture and a later knockout rematch),
// so pick the ESPN event whose kickoff is closest to the seed fixture's.
function closestByDate(seedGame, candidates) {
  if (candidates.length === 1) return candidates[0];
  const seedDate = parseMatchDate(seedGame);
  if (!seedDate) return candidates[0];
  return candidates.reduce((best, candidate) => {
    const bestDate = parseMatchDate(best);
    const candidateDate = parseMatchDate(candidate);
    if (!candidateDate) return best;
    if (!bestDate) return candidate;
    return Math.abs(candidateDate - seedDate) < Math.abs(bestDate - seedDate) ? candidate : best;
  });
}

// The board shows ESPN's spelling of each team: remember the feed's name per
// FIFA code so every fixture and standings row for that team renders it
// (teamDisplayName), regardless of which games the feed covers.
function rememberEspnName(code, name) {
  const key = upperCode(code);
  if (key && name) espnNameByCode.set(key, name);
}

// The seed is canonical for which team is home, so flip ESPN's per-side fields
// when the feed lists the teams in the opposite order (decided by code).
function overlayEspnGame(seedGame, espnGame) {
  const seedHome = upperCode(seedGame.home_team_code);
  const flipped = seedHome !== "" && seedHome === upperCode(espnGame.away_team_code);
  const home = flipped ? "away" : "home";
  const away = flipped ? "home" : "away";
  return {
    ...seedGame,
    espn_id: espnGame.espn_id,
    home_score: espnGame[`${home}_score`],
    away_score: espnGame[`${away}_score`],
    home_penalty: espnGame[`${home}_penalty`],
    away_penalty: espnGame[`${away}_penalty`],
    home_scorers: espnGame[`${home}_scorers`],
    away_scorers: espnGame[`${away}_scorers`],
    finished: espnGame.finished,
    time_elapsed: espnGame.time_elapsed,
  };
}

function mapEspnEvent(event) {
  const competition = event.competitions?.[0];
  const home = competition?.competitors?.find((team) => team.homeAway === "home");
  const away = competition?.competitors?.find((team) => team.homeAway === "away");
  if (!competition || !home || !away) return null;
  const status = competition.status || event.status || {};
  const statusType = status.type || {};
  const base = {
    espn_id: event.id,
    home_team_id: home.team?.id || home.id,
    away_team_id: away.team?.id || away.id,
    home_team_code: espnTeamCode(home),
    away_team_code: espnTeamCode(away),
    home_team_name_en: espnTeamName(home),
    away_team_name_en: espnTeamName(away),
    utc_date: event.date || competition.date || "",
  };
  return {
    ...base,
    home_score: Number(home.score) || 0,
    away_score: Number(away.score) || 0,
    home_penalty: home.shootoutScore ?? null,
    away_penalty: away.shootoutScore ?? null,
    home_scorers: espnIncidents(competition, home),
    away_scorers: espnIncidents(competition, away),
    finished: statusType.completed === true,
    time_elapsed: espnElapsed(status),
  };
}

function espnTeamName(competitor) {
  return competitor.team?.displayName || competitor.team?.name || competitor.team?.location || "";
}

// ESPN's national-team abbreviation is the FIFA 3-letter code, the stable
// identifier matched against the seed's `code` column.
function espnTeamCode(competitor) {
  return competitor.team?.abbreviation || "";
}

function espnIncidents(competition, competitor) {
  const teamId = `${competitor.team?.id || competitor.id}`;
  return (competition.details || [])
    .filter((detail) => !detail.shootout && `${detail.team?.id}` === teamId && (detail.scoringPlay || isRedCard(detail)))
    .map((detail) => {
      const athlete = detail.athletesInvolved?.[0];
      const kind = isRedCard(detail) ? "red-card" : "goal";
      const name = athlete?.shortName || athlete?.displayName || (kind === "goal" ? "Goal" : "Red card");
      const minute = detail.clock?.displayValue || "";
      return { kind, name, minute };
    });
}

function isRedCard(detail) {
  if (detail.redCard === true) return true;
  const cardType = `${detail.cardType || detail.card?.type || ""}`.toLowerCase();
  const typeText = `${detail.type?.id || detail.type?.text || detail.type?.description || detail.type || ""}`.toLowerCase();
  return cardType === "red" || cardType === "red-card" || typeText.includes("red card");
}

function espnElapsed(status) {
  const type = status.type || {};
  if (type.completed) return type.shortDetail || type.detail || "FT";
  if (type.state === "in") return status.displayClock || type.shortDetail || type.detail || "Live";
  return "notstarted";
}

function indexTeams() {
  teamById = new Map();
  teamByCode = new Map();

  games.forEach((game) => {
    addTeam(game.home_team_id, game.home_team_code, game.home_team_name_en, game.group);
    addTeam(game.away_team_id, game.away_team_code, game.away_team_name_en, game.group);
  });

  selections.forEach((selection) => {
    const indexed = teamByCode.get(upperCode(selection.code));
    if (indexed) {
      indexed.owner = selection.player;
      indexed.group = selection.group || indexed.group;
    }
  });
}

function addTeam(id, code, name, group) {
  if (!id || !name || name.toLowerCase().includes("winner") || name.toLowerCase().includes("runner")) return;
  const upper = upperCode(code);
  const existing = teamByCode.get(upper) || {};
  const selection = selectionByCode(upper);
  const team = {
    id: `${id}`,
    name,
    code: upper || existing.code || codeFromName(name),
    owner: selection?.player || existing.owner || "",
    group: selection?.group || group || existing.group || "",
  };
  teamById.set(`${id}`, team);
  if (team.code) teamByCode.set(team.code, team);
}

function selectionByCode(code) {
  const upper = upperCode(code);
  return upper ? selections.find((team) => upperCode(team.code) === upper) : undefined;
}

function codeFromName(name) {
  const words = name.replace(/[^A-Za-z ]/g, "").split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.map((word) => word[0]).join("") : name.slice(0, 3)).slice(0, 3).toUpperCase();
}

function standingsForGroup(group) {
  const rows = groupRowsWithResults(group);
  return rows.map((row) => {
    const id = rowTeamId(row);
    const team = teamById.get(id) || {};
    return {
      id,
      name: team.name || row.team_name_en || row.name || `Team ${id}`,
      code: team.code || `T${id}`,
      owner: team.owner || selectionByCode(team.code)?.player || "",
      group: group.name,
      mp: number(row.mp),
      w: number(row.w),
      d: number(row.d),
      l: number(row.l),
      gf: number(row.gf),
      ga: number(row.ga),
      gd: number(row.gd),
      pts: number(row.pts),
    };
  }).sort(sortStandings);
}

function groupRowsWithResults(group) {
  const groupGames = games.filter((game) => game.type === "group" && game.group === group.name);
  const resultGames = groupGames.filter(countsInGroupTable);
  if (!resultGames.length) return group.teams;

  const rows = new Map();
  group.teams.forEach((row) => {
    const id = rowTeamId(row);
    rows.set(id, {
      ...row,
      team_id: id,
      mp: 0,
      w: 0,
      d: 0,
      l: 0,
      gf: 0,
      ga: 0,
      gd: 0,
      pts: 0,
    });
  });
  resultGames.forEach((game) => applyGroupGame(rows, game));
  return [...rows.values()];
}

function rowTeamId(row) {
  return `${row.team_id ?? row.id ?? row._id ?? ""}`;
}

function applyGroupGame(rows, game) {
  const home = ensureGroupRow(rows, game.home_team_id, game.home_team_name_en);
  const away = ensureGroupRow(rows, game.away_team_id, game.away_team_name_en);
  const homeScore = game.home_score;
  const awayScore = game.away_score;

  home.mp += 1;
  away.mp += 1;
  home.gf += homeScore;
  home.ga += awayScore;
  away.gf += awayScore;
  away.ga += homeScore;
  home.gd = home.gf - home.ga;
  away.gd = away.gf - away.ga;

  if (homeScore > awayScore) {
    home.w += 1;
    home.pts += 3;
    away.l += 1;
  } else if (awayScore > homeScore) {
    away.w += 1;
    away.pts += 3;
    home.l += 1;
  } else {
    home.d += 1;
    away.d += 1;
    home.pts += 1;
    away.pts += 1;
  }
}

function ensureGroupRow(rows, id, name) {
  const key = `${id}`;
  if (!rows.has(key)) rows.set(key, { team_id: key, team_name_en: name, mp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 });
  return rows.get(key);
}

function sortStandings(a, b) {
  return b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.name.localeCompare(b.name);
}

function teamStatus(selection) {
  const apiTeam = teamByCode.get(upperCode(selection.code));
  const teamId = apiTeam?.id;
  const knockoutLoss = hasKnockoutLoss(teamId);
  if (knockoutLoss) return "eliminated";

  return groupStageStatus(selection, teamId);
}

function teamEliminatedAt(selection) {
  const apiTeam = teamByCode.get(upperCode(selection.code));
  const teamId = apiTeam?.id;
  if (!teamId || teamStatus(selection) !== "eliminated") return null;

  const knockoutLoss = games
    .filter((game) => game.type !== "group" && isFinished(game))
    .find((game) => {
      const homeId = `${game.home_team_id}`;
      const awayId = `${game.away_team_id}`;
      return (homeId === teamId || awayId === teamId) && loserId(game) === teamId;
    });
  if (knockoutLoss) return knockoutLoss;

  const groupGames = games
    .filter((game) => game.type === "group" && game.group === selection.group && isFinished(game))
    .sort(compareGames);
  return groupGames[groupGames.length - 1] || null;
}

function groupStageStatus(selection, teamId, throughGame = null) {
  const group = groups.find((item) => item.name === selection.group);
  if (!group) return "alive";
  const groupComplete = groupGamesComplete(group.name, throughGame);
  if (!groupComplete) return "alive";

  const standings = standingsForGroup(group);
  const rank = standings.findIndex((team) => team.id === teamId) + 1;
  if (rank > 0 && rank <= 2) return "alive";
  if (rank > 0 && rank === 3 && bestThirdPlaceIds(throughGame).has(teamId)) return "alive";
  return "eliminated";
}

function teamStatusAtMatch(selection, game) {
  const apiTeam = teamByCode.get(upperCode(selection.code));
  const teamId = apiTeam?.id;
  if (!teamId) return "alive";
  if (isThirdPlaceGame(game) && teamInGame(teamId, game)) {
    return isFinished(game) && loserId(game) === teamId ? "eliminated" : "alive";
  }
  if (game.type !== "group" && hasKnockoutLoss(teamId, game)) return "eliminated";
  return groupStageStatus(selection, teamId, game);
}

function isThirdPlaceGame(game) {
  return game?.type === "third" || game?.type === "third_place";
}

function teamInGame(teamId, game) {
  return `${game.home_team_id}` === teamId || `${game.away_team_id}` === teamId;
}

function hasKnockoutLoss(teamId, throughGame = null) {
  return games.some((game) => {
    if (game.type === "group" || !isFinished(game)) return false;
    if (throughGame && compareGames(game, throughGame) > 0) return false;
    const homeId = `${game.home_team_id}`;
    const awayId = `${game.away_team_id}`;
    if (homeId !== teamId && awayId !== teamId) return false;
    return loserId(game) === teamId;
  });
}

function bestThirdPlaceIds(throughGame = null) {
  const thirds = groups.map((group) => {
    const complete = groupGamesComplete(group.name, throughGame);
    if (!complete) return null;
    return standingsForGroup(group)[2];
  }).filter(Boolean).sort(sortStandings);
  return new Set(thirds.slice(0, 8).map((team) => team.id));
}

// Returns whether any fixture gained a newly-resolved side, so refreshData can
// keep alternating overlay/resolve passes while the bracket is still settling.
function resolveKnownBracketTeams() {
  const groupSeeds = bracketGroupSeeds();
  const thirdByWinnerGroup = officialThirdPlaceSeeds();
  const matchWinners = new Map();
  const matchLosers = new Map();
  let changed = false;

  // Walk knockout fixtures in kickoff order so each finished game's winner (and
  // loser, for the third-place playoff) is recorded before the later fixtures
  // that name it as "Winner Match N" / "Loser Match N" are resolved.
  sortedGames().filter((game) => game.type !== "group").forEach((game) => {
    if (assignResolvedBracketTeam(game, "home", resolveBracketSide(game, "home", groupSeeds, thirdByWinnerGroup, matchWinners, matchLosers))) changed = true;
    if (assignResolvedBracketTeam(game, "away", resolveBracketSide(game, "away", groupSeeds, thirdByWinnerGroup, matchWinners, matchLosers))) changed = true;
    recordKnockoutOutcome(game, matchWinners, matchLosers);
  });
  return changed;
}

// Once a knockout game's teams are known and it has a decided result, remember
// who advanced (and who dropped out) so the next round's "Winner Match N" /
// "Loser Match N" slots resolve. winnerId/loserId return "" while a finished
// game is still level with no shootout in the feed, leaving those slots as
// placeholders rather than guessing.
function recordKnockoutOutcome(game, matchWinners, matchLosers) {
  if (!isFinished(game)) return;
  const winner = teamById.get(winnerId(game));
  const loser = teamById.get(loserId(game));
  if (winner) matchWinners.set(`${game.id}`, winner);
  if (loser) matchLosers.set(`${game.id}`, loser);
}

function resolveBracketSide(game, side, groupSeeds, thirdByWinnerGroup, matchWinners, matchLosers) {
  const label = game[`${side}_team_label`];
  if (!label) return null;

  const winnerMatch = /^Winner Match (\d+)$/.exec(label);
  if (winnerMatch) return matchWinners.get(winnerMatch[1]) || null;
  const loserMatch = /^Loser Match (\d+)$/.exec(label);
  if (loserMatch) return matchLosers.get(loserMatch[1]) || null;

  if (/^3rd Group /.test(label)) {
    // Once every group is played, which third-placed team each winner faces is
    // fixed by FIFA's Annexe C table (see officialThirdPlaceSeeds), keyed off the
    // winner sharing this fixture. Fall through to the single-candidate logic
    // below while the table is still indeterminate (groups mid-play).
    const winnerGroup = pairedWinnerGroup(game, side);
    const officialTeam = winnerGroup && thirdByWinnerGroup.get(winnerGroup);
    if (officialTeam) return officialTeam;
  }
  return resolveGroupBracketLabel(label, groupSeeds);
}

// The group winner sharing a round-of-32 fixture with a "3rd Group ..." slot is
// the other side's "Winner Group X" label; that winner is what Annexe C keys on.
function pairedWinnerGroup(game, side) {
  const otherLabel = game[`${side === "home" ? "away" : "home"}_team_label`];
  return /^Winner Group ([A-L])$/.exec(otherLabel || "")?.[1] || null;
}

// Maps each group winner (A, B, D, E, G, I, K, L) to the actual third-placed team
// it faces in the round of 32, but only once all twelve groups are complete and
// the eight best thirds are settled — the point at which Annexe C's allocation is
// determinable. Returns an empty map before then.
function officialThirdPlaceSeeds() {
  const byWinnerGroup = new Map();
  if (!groups.every((group) => groupGamesComplete(group.name))) return byWinnerGroup;

  const bestThirdIds = bestThirdPlaceIds();
  const qualifyingGroups = [];
  const thirdTeamByGroup = new Map();
  groups.forEach((group) => {
    const third = standingsForGroup(group)[2];
    if (third && bestThirdIds.has(third.id)) {
      qualifyingGroups.push(group.name);
      thirdTeamByGroup.set(group.name, third);
    }
  });

  const allocation = thirdPlaceAllocation(qualifyingGroups);
  if (!allocation) return byWinnerGroup;
  allocation.forEach((thirdGroup, winnerGroup) => {
    const team = thirdTeamByGroup.get(thirdGroup);
    if (team) byWinnerGroup.set(winnerGroup, team);
  });
  return byWinnerGroup;
}

function bracketGroupSeeds() {
  const seeds = new Map();
  const thirdPlaceRows = [];

  groups.forEach((group) => {
    if (!groupGamesComplete(group.name)) return;
    const standings = standingsForGroup(group);
    seeds.set(`Winner Group ${group.name}`, standings[0]);
    seeds.set(`Runner-up Group ${group.name}`, standings[1]);
    if (standings[2]) thirdPlaceRows.push({ group: group.name, team: standings[2] });
  });

  const bestThirdIds = bestThirdPlaceIds();
  thirdPlaceRows
    .filter(({ team }) => bestThirdIds.has(team.id))
    .forEach(({ group, team }) => seeds.set(`3rd Group ${group}`, team));

  return seeds;
}

function resolveGroupBracketLabel(label, groupSeeds) {
  if (!label) return null;

  const thirdChoice = /^3rd Group (.+)$/.exec(label);
  if (thirdChoice) {
    const candidates = thirdChoice[1].split("/")
      .map((group) => groupSeeds.get(`3rd Group ${group}`))
      .filter(Boolean);
    return candidates.length === 1 ? candidates[0] : null;
  }

  return groupSeeds.get(label) || null;
}

// Returns whether this side gained (or changed) a resolved team, so a resolve
// pass can report progress without looping forever once the bracket is stable.
function assignResolvedBracketTeam(game, side, team) {
  if (!team || game[`${side}_team_id`] === team.id) return false;
  game[`${side}_team_id`] = team.id;
  game[`${side}_team_name_en`] = team.name;
  game[`${side}_team_code`] = team.code;
  return true;
}

function groupGamesComplete(groupName, throughGame = null) {
  return games
    .filter((game) => game.type === "group" && game.group === groupName)
    .every((game) => isFinished(game) && kickedOffBy(game, throughGame));
}

// A group's final two games kick off simultaneously, so as of either one the
// group is already decided. Treat games sharing throughGame's kickoff as within
// the window (the isFinished check above still gates on them actually being
// played), rather than letting compareGames' id tiebreak push the later id out.
function kickedOffBy(game, throughGame) {
  if (!throughGame) return true;
  const at = parseMatchDate(game)?.getTime();
  const through = parseMatchDate(throughGame)?.getTime();
  if (at != null && through != null) return at <= through;
  return compareGames(game, throughGame) <= 0;
}

function loserId(game) {
  const homeScore = game.home_score;
  const awayScore = game.away_score;
  if (homeScore !== awayScore) return homeScore < awayScore ? `${game.home_team_id}` : `${game.away_team_id}`;
  const homePens = penaltyScore(game, "home");
  const awayPens = penaltyScore(game, "away");
  if (homePens === null || awayPens === null || homePens === awayPens) return "";
  return homePens < awayPens ? `${game.home_team_id}` : `${game.away_team_id}`;
}

function winnerId(game) {
  const homeScore = game.home_score;
  const awayScore = game.away_score;
  if (homeScore !== awayScore) return homeScore > awayScore ? `${game.home_team_id}` : `${game.away_team_id}`;
  const homePens = penaltyScore(game, "home");
  const awayPens = penaltyScore(game, "away");
  if (homePens === null || awayPens === null || homePens === awayPens) return "";
  return homePens > awayPens ? `${game.home_team_id}` : `${game.away_team_id}`;
}

// ESPN reports shootouts as a numeric shootoutScore per competitor (verified
// against the 2022 final); mapEspnEvent copies it into home_/away_penalty.
// Null means no shootout data (distinct from a real 0 — a side can lose 3-0).
function penaltyScore(game, side) {
  return game[`${side}_penalty`] ?? null;
}

function scoreText(game, side) {
  const pens = penaltyScore(game, side);
  const score = game[`${side}_score`];
  return pens === null ? `${score}` : `${score} (${pens})`;
}

function liveGames() {
  return games.filter((game) => matchState(game) === "live");
}

function countsInGroupTable(game) {
  return isFinished(game) || matchState(game) === "live";
}

function liveTeamScore(teamId) {
  return liveTeamMeta(teamId)?.score || "";
}

function liveTeamMeta(teamId) {
  const game = liveGames().find((item) => `${item.home_team_id}` === `${teamId}` || `${item.away_team_id}` === `${teamId}`);
  if (!game) return null;
  const side = `${game.home_team_id}` === `${teamId}` ? "home" : "away";
  const index = sortedGames().filter((item) => matchState(item) === "live").findIndex((item) => item === game);
  return {
    score: scoreText(game, side),
    pairClass: `live-pair-${(Math.max(0, index) % 4) + 1}`,
  };
}

function renderActiveView() {
  if (!selections.length) return;
  if (!initialDataLoaded && loadingMessage) {
    renderLoadingState();
    return;
  }
  if (activeView === "fixtures") {
    renderFixtures();
  } else if (activeView === "groups") {
    renderGroups();
  } else if (activeView === "losers") {
    renderLastPlace();
  } else if (activeView === "bracket") {
    renderBracket();
  } else if (activeView === "rounds") {
    renderRounds();
  } else {
    renderContenders();
  }
}

function renderContenders() {
  const players = [...new Set([...PLAYER_ORDER, ...selections.map((team) => team.player)])];
  const showSurvivors = knockoutStageActive();
  const rows = players.map(playerSummary).sort((a, b) => sortPlayerSummaries(a, b, showSurvivors));
  if (showSurvivors) {
    renderSurvivors(rows);
    return;
  }

  contendersEl.innerHTML = `
    <table>
      <thead>
        <tr>
          <th><span class="rank-heading">#</span></th>
          <th>Gambler</th>
          <th>Teams</th>
          <th>P</th>
          <th>W</th>
          <th>L</th>
          <th>D</th>
          <th>GD</th>
          <th>Pts</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(({ player, owned, played, w, l, d, gd, pts }, index) => {
          const rank = rankForPlayerSummary(rows, index, false);
          return `
            <tr class="contender-row">
              <td>${rankBadge(rank)}</td>
              <th scope="row">
                <span class="gambler-name">${player}</span>
              </th>
              <td>
                <div class="flag-strip">
                  ${owned.map((team) => flagMarkup(team)).join("")}
                </div>
              </td>
              <td>${played}</td>
              <td>${w}</td>
              <td>${l}</td>
              <td>${d}</td>
              <td>${gd}</td>
              <td><strong>${pts}</strong></td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;
}

function playerSummary(player) {
  const owned = selections.filter((team) => team.player === player);
  const summary = owned.reduce((summary, team) => {
    const record = teamGroupRecord(team);
    const eliminatedAt = teamEliminatedAt(team);
    if (eliminatedAt) {
      summary.eliminations.push(eliminatedAt);
    } else {
      summary.alive += 1;
    }
    summary.played += record.played;
    summary.w += record.w;
    summary.l += record.l;
    summary.d += record.d;
    summary.gd += record.gd;
    summary.pts += record.pts;
    return summary;
  }, { player, owned, alive: 0, eliminated: false, eliminations: [], lastEliminatedGame: null, played: 0, w: 0, l: 0, d: 0, gd: 0, pts: 0 });

  summary.eliminated = owned.length > 0 && summary.alive === 0;
  if (summary.eliminated) {
    summary.lastEliminatedGame = summary.eliminations.slice().sort(compareGames).pop() || null;
  }
  return summary;
}

function sortPlayerSummaries(a, b, survivalMode = survivalSortingActive()) {
  if (survivalMode) {
    const rankDifference = compareSurvivalRank(a, b);
    if (rankDifference) return rankDifference;
    return PLAYER_ORDER.indexOf(a.player) - PLAYER_ORDER.indexOf(b.player);
  }
  const rankDifference = compareGroupRank(a, b);
  if (rankDifference) return rankDifference;
  return PLAYER_ORDER.indexOf(a.player) - PLAYER_ORDER.indexOf(b.player);
}

function comparePlayerRank(a, b, survivalMode = survivalSortingActive()) {
  return survivalMode ? compareSurvivalRank(a, b) : compareGroupRank(a, b);
}

function compareGroupRank(a, b) {
  return b.pts - a.pts || b.gd - a.gd || b.w - a.w || a.l - b.l;
}

function compareSurvivalRank(a, b) {
  const aliveDifference = b.alive - a.alive;
  if (aliveDifference) return aliveDifference;
  if (a.eliminated !== b.eliminated) return Number(a.eliminated) - Number(b.eliminated);
  if (a.eliminated && b.eliminated) {
    const eliminatedDifference = compareGames(b.lastEliminatedGame, a.lastEliminatedGame);
    if (eliminatedDifference) return eliminatedDifference;
  }
  return 0;
}

function rankForPlayerSummary(rows, index, survivalMode = survivalSortingActive()) {
  if (index === 0) return 1;
  return comparePlayerRank(rows[index], rows[index - 1], survivalMode) === 0
    ? rankForPlayerSummary(rows, index - 1, survivalMode)
    : index + 1;
}

function rankBadge(rank) {
  const medalClass = medalClassForRank(rank);
  return `<span class="rank-number${medalClass ? ` rank-badge ${medalClass}` : ""}">${rank}</span>`;
}

function medalClassForRank(rank) {
  if (rank === 1 && stageComplete("final")) return "rank-1";
  if (rank === 2 && stageComplete("final")) return "rank-2";
  if (rank === 3 && stageComplete("third", "third_place")) return "rank-3";
  return "";
}

function stageComplete(...types) {
  return games.some((game) => types.includes(game.type) && isFinished(game));
}

function survivalSortingActive() {
  return selections.some((team) => teamStatus(team) === "eliminated");
}

function knockoutStageActive() {
  return groupStageComplete() || games.some((game) => game.type !== "group" && matchState(game) !== "upcoming");
}

function groupStageComplete() {
  const groupGames = games.filter((game) => game.type === "group");
  return groupGames.length > 0 && groupGames.every(isFinished);
}

function teamGroupRecord(selection) {
  const group = groups.find((item) => item.name === selection.group);
  if (!group) return { played: 0, w: 0, l: 0, d: 0, gd: 0, pts: 0 };
  const team = standingsForGroup(group).find((item) => upperCode(item.code) === upperCode(selection.code));
  if (!team) return { played: 0, w: 0, l: 0, d: 0, gd: 0, pts: 0 };
  return { played: team.mp, w: team.w, l: team.l, d: team.d, gd: team.gd, pts: team.pts };
}

function flagMarkup(team) {
  const status = teamStatus(team);
  const apiTeam = teamByCode.get(upperCode(team.code));
  const live = apiTeam ? liveTeamMeta(apiTeam.id) : null;
  return `
    <span class="team-flag ${status} ${live ? `playing ${live.pairClass}` : ""}" title="${team.name}">
      ${flagImage(team)}
      ${live ? `<span class="flag-live-score">${live.score}</span>` : ""}
      <small class="visually-hidden">${team.code}</small>
    </span>
  `;
}

// Flag files are named by the FIFA code used in selections.csv (e.g. arg.png).
function flagUrl(team) {
  return `assets/flags/${team.code.toLowerCase()}.png`;
}

function flagImage(team, className = "") {
  const classAttribute = className ? ` class="${className}"` : "";
  return `<img${classAttribute} src="${flagUrl(team)}" alt="${team.name} flag" loading="lazy" decoding="async" />`;
}

function renderLastPlace() {
  const rows = selections.map(lastPlaceRow).sort(sortLastPlaceRows).slice(0, 10);
  lastPlaceEl.innerHTML = `
    <table>
      <thead>
        <tr>
          <th><span class="rank-heading">#</span></th>
          <th>Gambler</th>
          <th>Team</th>
          <th>P</th>
          <th>W</th>
          <th>L</th>
          <th>D</th>
          <th>GD</th>
          <th>Pts</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row, index) => `
          <tr class="${row.status} selected ${row.liveScore ? `playing ${row.livePairClass}` : ""}">
            <td>${lastPlaceRankBadge(rankForLastPlace(rows, index))}</td>
            <td>${ownerBadge(row.owner, row.status)}</td>
            <td><div class="team-cell">${tableFlagMarkup(row)}<span class="team-name">${teamDisplayName(row)}</span>${row.liveScore ? `<span class="score-badge">${row.liveScore}</span>` : ""}</div></td>
            <td>${row.mp}</td>
            <td>${row.w}</td>
            <td>${row.l}</td>
            <td>${row.d}</td>
            <td>${row.gd}</td>
            <td><strong>${row.pts}</strong></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function lastPlaceRow(selection) {
  const apiTeam = teamByCode.get(upperCode(selection.code)) || {};
  const live = apiTeam.id ? liveTeamMeta(apiTeam.id) : null;
  const group = groups.find((item) => item.name === selection.group);
  const record = group
    ? standingsForGroup(group).find((item) => upperCode(item.code) === upperCode(selection.code))
    : null;
  const team = record || { ...selection, id: apiTeam.id || selection.code, mp: 0, w: 0, l: 0, d: 0, gf: 0, ga: 0, gd: 0, pts: 0 };
  return {
    ...team,
    id: team.id || apiTeam.id || selection.code,
    code: selection.code,
    name: team.name || selection.name,
    owner: selection.player,
    group: selection.group,
    status: teamStatus(selection),
    liveScore: live?.score || "",
    livePairClass: live?.pairClass || "",
  };
}

function sortLastPlaceRows(a, b) {
  return compareLastPlaceRank(a, b) || a.name.localeCompare(b.name);
}

// Worst record first, by the same criteria FIFA uses to rank group-stage
// casualties. Excludes the name tiebreaker so truly tied teams share a rank.
function compareLastPlaceRank(a, b) {
  return a.pts - b.pts || a.gd - b.gd || a.gf - b.gf || b.ga - a.ga;
}

function lastPlaceRankBadge(rank) {
  return `<span class="rank-number">${rank === 1 ? "💩" : rank}</span>`;
}

function rankForLastPlace(rows, index) {
  if (index === 0) return 1;
  const previous = rows[index - 1];
  const current = rows[index];
  return compareLastPlaceRank(current, previous) === 0 ? rankForLastPlace(rows, index - 1) : index + 1;
}

function renderGroups() {
  groupsEl.innerHTML = "";
  const sourceGroups = groups.length ? groups : fallbackGroups();
  const activeGroupNames = nextGroupNames();
  sourceGroups.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach((group) => {
    const table = document.createElement("article");
    const activeGroup = activeGroupNames.has(group.name);
    table.className = `group-table${activeGroup ? " active-group" : ""}`;
    table.id = `group-${groupSlug(group.name)}`;
    const standings = groups.length ? standingsForGroup(group) : group.teams;
    const rows = standings.map((team, index) => {
      const selected = selectionByCode(team.code);
      const status = selected ? groupStageStatus(selected, team.id) : "neutral";
      const displayName = teamDisplayName(team);
      const live = liveTeamMeta(team.id);
      const liveScore = live?.score || "";
      return `
        <tr class="${status} ${selected ? "selected" : ""} ${liveScore ? `playing ${live.pairClass}` : ""}">
          <td><span class="rank-number">${index + 1}</span></td>
          <td>${ownerBadge(team.owner, status)}</td>
          <td><div class="team-cell">${tableFlagMarkup(team)}<span class="team-name">${displayName}</span>${liveScore ? `<span class="score-badge">${liveScore}</span>` : ""}</div></td>
          <td>${team.mp}</td>
          <td>${team.w}</td>
          <td>${team.l}</td>
          <td>${team.d}</td>
          <td>${team.gd}</td>
          <td><strong>${team.pts}</strong></td>
        </tr>
      `;
    }).join("");
    table.innerHTML = `
      <div class="card-context">
        <h3>Group ${group.name}</h3>
      </div>
      <table>
        <thead><tr><th><span class="rank-heading">#</span></th><th>Gambler</th><th>Team</th><th>P</th><th>W</th><th>L</th><th>D</th><th>GD</th><th>Pts</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
    groupsEl.append(table);
  });
  markDeepLinkedElement(hashGroupTarget());
  if (document.querySelector('[data-panel="groups"]')?.classList.contains("active")) {
    settleGroupScroll();
  }
}

function tableFlagMarkup(team) {
  return flagImage(team, "table-flag");
}

// Prefer ESPN's spelling for the team (by code); fall back to the seed name
// offline/in mock.
function teamDisplayName(team) {
  return espnNameByCode.get(upperCode(team.code)) || team.name;
}

function fallbackGroups() {
  return Object.values(selections.reduce((collection, team) => {
    collection[team.group] ||= { name: team.group, teams: [] };
    collection[team.group].teams.push({ ...team, mp: 0, w: 0, d: 0, l: 0, gd: 0, pts: 0, owner: team.player });
    return collection;
  }, {}));
}

const STAGE_LABELS = {
  group: "Group",
  round_of_32: "Round of 32",
  round_of_16: "Round of 16",
  quarter_final: "Quarter-final",
  semi_final: "Semi-final",
  third_place: "Third Place",
  r32: "Round of 32",
  r16: "Round of 16",
  qf: "Quarter-final",
  sf: "Semi-final",
  third: "Third Place",
  final: "Final",
};

function renderFixtures() {
  const ordered = sortedGames();
  if (!ordered.length) {
    fixturesEl.innerHTML = `<p class="fixtures-empty">No fixtures available yet.</p>`;
    return;
  }

  const nextGames = nextFixtures(ordered);
  let currentDay = "";
  fixturesEl.innerHTML = ordered.map((game) => {
    const date = parseMatchDate(game);
    const dayLabel = dayHeading(date);
    let header = "";
    if (dayLabel !== currentDay) {
      currentDay = dayLabel;
      header = `<div class="fixture-day">${dayLabel}</div>`;
    }
    return header + fixtureRow(game, nextGames.has(game));
  }).join("");

  markDeepLinkedElement(hashFixtureTarget());
  settleFixtureScroll();
}

// iOS-style share/upload glyph; inherits colour from the button via currentColor.
const SHARE_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">' +
  '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
  'd="M12 3v12M8 7l4-4 4 4M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7"/></svg>';

function matchMeta(game, state, date) {
  if (state === "finished") return `<span class="fixture-ft">Full time</span>`;
  if (state === "live") return `<span class="fixture-live">${liveLabel(game)}</span>`;
  return `<time>${date ? timeLabel(date) : "TBD"}</time>`;
}

function fixtureRow(game, isNext, idPrefix = "fixture") {
  const home = fixtureTeam(game, "home", game);
  const away = fixtureTeam(game, "away", game);
  const state = matchState(game);
  const started = state !== "upcoming";
  const stage = game.type === "group" ? `Group ${game.group}` : STAGE_LABELS[game.type] || "Match";
  const date = parseMatchDate(game);
  return `
    <div id="${idPrefix}-${game.id}" class="fixture ${state} ${isNext ? "next" : ""}">
      <div class="card-context">
        <h3>${stage}</h3>
        <span class="fixture-foot-end">
          ${matchMeta(game, state, date)}
          <button type="button" class="fixture-share" data-share="${game.id}" aria-label="Share this match" title="Share match">${SHARE_ICON}</button>
        </span>
      </div>
      ${fixtureTeamLine(home, started ? scoreText(game, "home") : "")}
      ${fixtureTeamLine(away, started ? scoreText(game, "away") : "")}
    </div>
  `;
}

// The R32 seed labels ("Winner Group A", "3rd Group ...") carry no match
// number, so the bracket tree only extends through fixtures whose home/away
// label names a previous match — i.e. every round from R16 up to the final.
function matchReference(game, side) {
  const label = game[`${side}_team_label`] || "";
  const refMatch = /^(Winner|Loser) Match (\d+)$/.exec(label);
  return refMatch ? { kind: refMatch[1].toLowerCase(), id: refMatch[2] } : null;
}

// Walks the bracket backwards from the final so each round's matches come out
// in true left-to-right bracket order (which R16 pairs feed which QF, etc.) —
// the tsv's own id order interleaves those pairings and can't be used directly.
function orderedBracketRounds() {
  const final = games.find((game) => game.type === "final");
  if (!final) return null;
  const byId = new Map(games.map((game) => [`${game.id}`, game]));
  const rounds = { final: [final] };
  let current = [final];
  ["sf", "qf", "r16", "r32"].forEach((type) => {
    const next = [];
    current.forEach((game) => {
      ["home", "away"].forEach((side) => {
        const ref = matchReference(game, side);
        if (ref?.kind === "winner" && byId.has(ref.id)) next.push(byId.get(ref.id));
      });
    });
    rounds[type] = next;
    current = next;
  });
  const third = games.find((game) => game.type === "third");
  if (third) rounds.third = [third];
  return rounds;
}

function renderBracket() {
  const rounds = orderedBracketRounds();
  if (!rounds) {
    bracketEl.innerHTML = `<p class="fixtures-empty">Bracket not available yet.</p>`;
    return;
  }
  bracketEl.innerHTML = `
    <div class="bracket-scroll">
      ${["r32", "r16", "qf", "sf", "final"].map((type) => bracketColumn(type, rounds[type])).join("")}
      ${rounds.third ? bracketColumn("third", rounds.third) : ""}
    </div>
  `;
}

function bracketColumn(type, matches) {
  return `
    <div class="bracket-round bracket-round-${type}">
      <h3 class="bracket-round-title">${STAGE_LABELS[type]}</h3>
      <div class="bracket-round-matches">
        ${matches.map((game) => bracketMatch(game)).join("")}
      </div>
    </div>
  `;
}

function bracketMatch(game) {
  const home = fixtureTeam(game, "home", game);
  const away = fixtureTeam(game, "away", game);
  const state = matchState(game);
  const started = state !== "upcoming";
  return `
    <div id="bracket-${game.id}" class="bracket-match ${state}">
      ${fixtureTeamLine(home, started ? scoreText(game, "home") : "")}
      ${fixtureTeamLine(away, started ? scoreText(game, "away") : "")}
    </div>
  `;
}

function defaultRound() {
  const present = KNOCKOUT_TYPES.filter((type) => games.some((game) => game.type === type));
  const unfinished = present.find((type) => games.some((game) => game.type === type && !isFinished(game)));
  return unfinished || present[present.length - 1] || "r32";
}

function renderRounds() {
  const present = KNOCKOUT_TYPES.filter((type) => games.some((game) => game.type === type));
  if (!present.length) {
    roundsEl.innerHTML = `<p class="fixtures-empty">No knockout fixtures available yet.</p>`;
    return;
  }
  if (!activeRound || !present.includes(activeRound)) activeRound = defaultRound();
  const list = games.filter((game) => game.type === activeRound).sort(compareGames);
  roundsEl.innerHTML = `
    <div class="round-switcher" role="tablist">
      ${present.map((type) => `
        <button type="button" role="tab" class="${type === activeRound ? "active" : ""}" aria-selected="${type === activeRound}" data-round="${type}">${STAGE_LABELS[type]}</button>
      `).join("")}
    </div>
    <div class="round-list">
      ${list.map((game) => fixtureRow(game, false, "round-fixture")).join("")}
    </div>
  `;
}

function bindRoundSwitcher() {
  roundsEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-round]");
    if (!button) return;
    activeRound = button.dataset.round;
    renderRounds();
  });
}

function renderSurvivors(rows) {
  contendersEl.innerHTML = `
    <table>
      <thead>
        <tr>
          <th><span class="rank-heading">#</span></th>
          <th>Gambler</th>
          <th>Teams</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(({ player, owned, eliminated }, index) => {
          const rank = rankForPlayerSummary(rows, index, true);
          return `
            <tr class="contender-row ${eliminated ? "eliminated" : ""}">
              <td>${rankBadge(rank)}</td>
              <th scope="row">
                <span class="gambler-name ${eliminated ? "eliminated" : ""}">${player}</span>
              </th>
              <td>
                <div class="flag-strip">
                  ${owned.map((team) => flagMarkup(team)).join("")}
                </div>
              </td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;
}

function fixtureTeamLine(team, score) {
  return `
    <div class="fixture-team ${team.status} ${team.selected ? "selected" : ""} ${team.placeholder ? "placeholder" : ""}">
      <span class="fixture-gambler">${ownerBadge(team.owner, team.ownerStatus)}</span>
      ${fixtureFlag(team)}
      <span class="fixture-team-copy">
        <span class="team-name">${team.name}</span>
        ${scorerMarkup(team.scorers)}
      </span>
      <strong>${score}</strong>
    </div>
  `;
}

function scorerMarkup(scorers) {
  if (!scorers?.length) return "";
  const grouped = scorers.reduce((groups, scorer) => {
    const incident = typeof scorer === "string" ? { kind: "goal", label: scorer } : scorer;
    const kind = incident.kind === "red-card" ? "red-card" : "goal";
    const label = incident.label || `${incident.name}${incident.minute ? ` ${incident.minute}` : ""}`;
    groups[kind].push(label);
    return groups;
  }, { goal: [], "red-card": [] });

  const incidents = ["goal", "red-card"].filter((kind) => grouped[kind].length).map((kind) => {
    const iconLabel = kind === "red-card" ? "Red card" : "Goal";
    const labels = grouped[kind].map((label) => `<span class="fixture-incident-label">${label}</span>`).join(`<span class="fixture-incident-separator">, </span>`);
    return `<span class="fixture-incident ${kind}"><span class="fixture-incident-icon" aria-hidden="true" title="${iconLabel}"></span><span>${labels}</span></span>`;
  }).join(" ");

  return `<span class="fixture-scorers">${incidents}</span>`;
}

function matchState(game) {
  if (isFinished(game)) return "finished";
  const elapsed = game.time_elapsed.trim().toLowerCase();
  if (elapsed && elapsed !== "notstarted") return "live";
  return "upcoming";
}

function liveLabel(game) {
  const elapsed = game.time_elapsed.trim();
  if (!elapsed || elapsed.toLowerCase() === "notstarted") return "Live";
  return /^\d+$/.test(elapsed) ? `${elapsed}'` : elapsed;
}

function fixtureTeam(game, side, statusGame = null) {
  const id = `${game[`${side}_team_id`]}`;
  const fallbackName = game[`${side}_team_name_en`] || game[`${side}_team_label`] || "TBD";
  const team = teamById.get(id) || { name: fallbackName, code: "TBD" };
  const selection = selectionByCode(team.code);
  const placeholder = !selection && (!team.code || team.code === "TBD");
  const status = selection ? teamStatusAtMatch(selection, statusGame || game) : "neutral";
  return {
    name: teamDisplayName(team),
    code: team.code,
    owner: selection?.player || team.owner || "",
    selected: Boolean(selection),
    status,
    ownerStatus: selection && playerEliminatedAtMatch(selection.player, statusGame || game) ? "eliminated" : "alive",
    placeholder,
    scorers: game[`${side}_scorers`],
  };
}

function playerEliminatedAtMatch(player, game) {
  return selections
    .filter((team) => team.player === player)
    .every((team) => teamStatusAtMatch(team, game) === "eliminated");
}

function fixtureFlag(team) {
  if (!team.code || team.code === "TBD") {
    return `<span class="table-flag placeholder" aria-hidden="true"></span>`;
  }
  return flagImage(team, "table-flag");
}

function sortedGames() {
  return games.slice().sort(compareGames);
}

function compareGames(a, b) {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    const dateA = parseMatchDate(a);
    const dateB = parseMatchDate(b);
    if (dateA && dateB && dateA.getTime() !== dateB.getTime()) return dateA - dateB;
    if (dateA && !dateB) return -1;
    if (!dateA && dateB) return 1;
    return number(a.id) - number(b.id);
}

// While a match is in progress it carries the highlight; otherwise the next
// fixture still to kick off does. Finished matches are never highlighted.
function nextFixtures(ordered) {
  const game = ordered.find((item) => matchState(item) === "live")
    || ordered.find((item) => matchState(item) === "upcoming")
    || null;
  if (!game) return new Set();
  const state = matchState(game);
  const kickoff = parseMatchDate(game)?.getTime();
  return new Set(ordered.filter((item) => {
    if (matchState(item) !== state) return false;
    if (!kickoff) return item === game;
    return parseMatchDate(item)?.getTime() === kickoff;
  }));
}

// The groups the Groups view highlights and focuses: groups with matches in
// progress, or—failing that—groups in the next group-stage kickoff window.
// Mirrors nextFixtures so simultaneous group finales stay visible together.
function nextGroupNames() {
  const groupGames = sortedGames().filter((game) => game.type === "group");
  const game = groupGames.find((g) => matchState(g) === "live")
    || groupGames.find((g) => matchState(g) === "upcoming");
  if (!game) return new Set();
  const state = matchState(game);
  const kickoff = parseMatchDate(game)?.getTime();
  return new Set(groupGames
    .filter((item) => matchState(item) === state && (!kickoff || parseMatchDate(item)?.getTime() === kickoff))
    .map((item) => item.group));
}

function requestFixtureScroll() {
  pendingFixtureScroll = true;
  settleFixtureScroll();
}

function requestGroupScroll() {
  pendingGroupScroll = true;
  settleGroupScroll();
}

function settleFixtureScroll() {
  if (!pendingFixtureScroll || activeView !== "fixtures" || !fixturesEl.children.length) return;
  pendingFixtureScroll = false;
  scrollToFixture(hashFixtureTarget());
}

function settleGroupScroll() {
  if (!pendingGroupScroll || activeView !== "groups" || !groupsEl.children.length) return;
  pendingGroupScroll = false;
  const target = hashGroupTarget() || activeGroupTarget();
  if (target) scrollToGroup(target);
  else scrollToTop();
}

// Center a fixture in the usable viewport below the sticky tabs. Passing null
// targets the next unfinished match (or the last one); the router passes a
// specific element when the hash points at one (e.g. `#fixtures/match-1234`).
function scrollToFixture(target) {
  afterLayout(() => {
    if (activeView !== "fixtures") return;
    const el = target || fixturesEl.querySelector(".fixture.next") || fixturesEl.querySelector(".fixture:last-child");
    if (el) scrollElementToUsableCenter(el);
  });
}

function scrollToGroup(target) {
  afterLayout(() => {
    if (target && activeView === "groups") scrollElementToUsableCenter(target);
  });
}

function scrollElementToUsableCenter(target) {
  const rect = target.getBoundingClientRect();
  const usableTop = stickyTabsBottom() + 14;
  const usableHeight = Math.max(0, window.innerHeight - usableTop - 16);
  const centerOffset = Math.max(0, (usableHeight - rect.height) / 2);
  const top = window.scrollY + rect.top - usableTop - centerOffset;
  window.scrollTo({ top: Math.max(0, top), behavior: "auto" });
}

function stickyTabsBottom() {
  const tabs = document.querySelector(".view-tabs");
  return tabs?.getBoundingClientRect().bottom || parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--tabs-height")) || 44;
}

function activeGroupTarget() {
  return groupsEl.querySelector(".group-table.active-group");
}

function markDeepLinkedElement(target) {
  document.querySelectorAll(".deep-linked").forEach((element) => element.classList.remove("deep-linked"));
  if (target) target.classList.add("deep-linked");
}

function dayHeading(date) {
  if (!date) return "Date TBD";
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function timeLabel(date) {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function ownerBadge(owner, status) {
  if (!owner) return "";
  return `<span class="gambler-name ${status}" title="${owner}">${owner}</span>`;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(value);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  row.push(value);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

init().catch((error) => {
  syncStatusEl.textContent = error.message;
});
