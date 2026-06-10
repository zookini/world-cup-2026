import { parseMatchDate, isFinished, number } from "./match-utils.js";

const PLAYER_ORDER = ["Boe", "Colm", "Ivan", "T", "Sharon", "Andy", "Joey", "Vinny", "Kachun", "Chun", "Kakei", "Janey"];

let selections = [];
let groups = [];
let games = [];
let teamById = new Map();
let teamByName = new Map();
let dataStatus = "";

const contendersEl = document.querySelector("#contenders");
const groupsEl = document.querySelector("#groups");
const fixturesEl = document.querySelector("#fixtures");
const syncStatusEl = document.querySelector("#sync-status");
const viewButtons = document.querySelectorAll("[data-view]");
const viewPanels = document.querySelectorAll("[data-panel]");

const VIEWS = ["standings", "fixtures", "groups"];
let activeView = "standings";

async function init() {
  bindViewTabs();
  bindShareButtons(fixturesEl, shareFixture);
  bindShareButtons(groupsEl, shareGroup);
  applyHashRoute();
  window.addEventListener("hashchange", applyHashRoute);
  await loadSelections();
  renderActiveView();
  await refreshData();
  startAutoRefresh();
}

// Keep scores moving without manual reloads: re-pull the feed once a minute
// while the tab is visible, and immediately when the user returns to it.
// Mock data never changes, so mock mode skips this entirely.
const REFRESH_INTERVAL_MS = 60000;

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
      location.hash = button.dataset.view;
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
  const [view] = parseHash();
  const resolved = VIEWS.includes(view) ? view : VIEWS[0];
  activateView(resolved);
  renderActiveView();
  if (resolved === "fixtures") scrollToFixture(hashFixtureTarget());
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
  if (!games.length) syncStatusEl.textContent = feed.loadingMessage;
  try {
    const dataSet = await feed.load();
    groups = dataSet.groups;
    games = dataSet.games;
    dataStatus = dataSet.status || "";
    indexTeams();
    renderActiveView();
    syncStatusEl.textContent = statusLine();
  } catch (error) {
    renderActiveView();
    // A failed auto-refresh keeps the last good data on screen, so report it
    // as staleness rather than discarding the board.
    syncStatusEl.textContent = games.length
      ? `${statusLine()} Refresh failed: ${error.message}.`
      : `Could not load ${feed.name}: ${error.message}. The board is showing the selected teams from selections.csv only.`;
  } finally {
    refreshing = false;
  }
}

function statusLine() {
  return [dataStatus, `Updated ${timeLabel(new Date())}.`, ...unresolvedKnockoutWarnings()].filter(Boolean).join(" ");
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
      const [groupPayload, gamePayload] = await Promise.all([
        fetchJson("/api/groups"),
        fetchJson("/api/games"),
      ]);
      return {
        groups: groupPayload.groups || groupPayload.data || [],
        games: gamePayload.games || gamePayload.data || [],
      };
    },
  };
}

function hasMockParam(search) {
  return /^match-\d+$/.test(new URLSearchParams(search).get("mock") || "");
}

// worldcup26.ir sends no CORS header, so we always go through the same-origin
// proxy (Pages Functions, served locally via `npx wrangler pages dev`).
async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json();
}

function indexTeams() {
  teamById = new Map();
  teamByName = new Map();

  games.forEach((game) => {
    addTeam(game.home_team_id, game.home_team_name_en, game.group);
    addTeam(game.away_team_id, game.away_team_name_en, game.group);
  });

  selections.forEach((team) => {
    const indexed = teamByName.get(normalizeName(team.name));
    if (indexed) {
      indexed.code = team.code;
      indexed.owner = team.player;
      indexed.group = team.group || indexed.group;
    }
  });
}

function addTeam(id, name, group) {
  if (!id || !name || name.toLowerCase().includes("winner") || name.toLowerCase().includes("runner")) return;
  const normalized = normalizeName(name);
  const existing = teamByName.get(normalized) || {};
  const selection = selectionForName(name);
  const team = {
    id: `${id}`,
    name,
    code: selection?.code || existing.code || codeFromName(name),
    owner: selection?.player || existing.owner || "",
    group: selection?.group || group || existing.group || "",
  };
  teamById.set(`${id}`, team);
  teamByName.set(normalized, team);
}

function selectionForName(name) {
  return selections.find((team) => normalizeName(team.name) === normalizeName(name));
}

function codeFromName(name) {
  const words = name.replace(/[^A-Za-z ]/g, "").split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.map((word) => word[0]).join("") : name.slice(0, 3)).slice(0, 3).toUpperCase();
}

function standingsForGroup(group) {
  return group.teams.map((row) => {
    const team = teamById.get(`${row.team_id}`) || {};
    return {
      id: `${row.team_id}`,
      name: team.name || `Team ${row.team_id}`,
      code: team.code || `T${row.team_id}`,
      owner: team.owner || selectionForName(team.name)?.player || "",
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

function sortStandings(a, b) {
  return b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.name.localeCompare(b.name);
}

function teamStatus(selection) {
  const apiTeam = teamByName.get(normalizeName(selection.name));
  const teamId = apiTeam?.id;
  const knockoutLoss = hasKnockoutLoss(teamId);
  if (knockoutLoss) return "eliminated";

  return groupStageStatus(selection, teamId);
}

function teamEliminatedAt(selection) {
  const apiTeam = teamByName.get(normalizeName(selection.name));
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
  const apiTeam = teamByName.get(normalizeName(selection.name));
  const teamId = apiTeam?.id;
  if (!teamId) return "alive";
  if (game.type !== "group" && hasKnockoutLoss(teamId, game)) return "eliminated";
  return groupStageStatus(selection, teamId, game);
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

function groupGamesComplete(groupName, throughGame = null) {
  return games
    .filter((game) => game.type === "group" && game.group === groupName)
    .every((game) => isFinished(game) && (!throughGame || compareGames(game, throughGame) <= 0));
}

function loserId(game) {
  const homeScore = number(game.home_score);
  const awayScore = number(game.away_score);
  if (homeScore !== awayScore) return homeScore < awayScore ? `${game.home_team_id}` : `${game.away_team_id}`;
  const homePens = penaltyScore(game, "home");
  const awayPens = penaltyScore(game, "away");
  if (homePens === null || awayPens === null || homePens === awayPens) return "";
  return homePens < awayPens ? `${game.home_team_id}` : `${game.away_team_id}`;
}

// The pre-tournament feed had no penalty fields at all, so we can't know what a
// shootout will be called — probe the plausible names. Null means the feed gave
// us nothing (distinct from a real 0).
function penaltyScore(game, side) {
  for (const field of ["penalty", "penalties", "pen", "pens", "penalty_score"]) {
    const value = game[`${side}_${field}`];
    if (value === undefined || value === null) continue;
    const text = `${value}`.trim();
    if (text && text.toLowerCase() !== "null") return number(text);
  }
  return null;
}

function scoreText(game, side) {
  const pens = penaltyScore(game, side);
  const score = number(game[`${side}_score`]);
  return pens === null ? `${score}` : `${score} (${pens})`;
}

function renderActiveView() {
  if (!selections.length) return;
  if (activeView === "fixtures") {
    renderFixtures();
  } else if (activeView === "groups") {
    renderGroups();
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
          <th>#</th>
          <th>Gambler</th>
          <th>Teams</th>
          <th>P</th>
          <th>W</th>
          <th>L</th>
          <th>D</th>
          <th>Pts</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(({ player, owned, played, w, l, d, pts }, index) => {
          const rank = rankForPlayerSummary(rows, index, false);
          return `
            <tr class="contender-row">
              <td>${rank}</td>
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
    summary.pts += record.pts;
    return summary;
  }, { player, owned, alive: 0, eliminated: false, eliminations: [], lastEliminatedGame: null, played: 0, w: 0, l: 0, d: 0, pts: 0 });

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
  return b.pts - a.pts || b.w - a.w || a.l - b.l;
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
  if (!group) return { played: 0, w: 0, l: 0, d: 0, pts: 0 };
  const team = standingsForGroup(group).find((item) => normalizeName(item.name) === normalizeName(selection.name));
  if (!team) return { played: 0, w: 0, l: 0, d: 0, pts: 0 };
  return { played: team.mp, w: team.w, l: team.l, d: team.d, pts: team.pts };
}

function flagMarkup(team) {
  const status = teamStatus(team);
  return `
    <span class="team-flag ${status}" title="${team.name}">
      ${flagImage(team)}
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

function renderGroups() {
  groupsEl.innerHTML = "";
  const sourceGroups = groups.length ? groups : fallbackGroups();
  sourceGroups.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach((group) => {
    const table = document.createElement("article");
    table.className = "group-table";
    table.id = `group-${groupSlug(group.name)}`;
    const standings = groups.length ? standingsForGroup(group) : group.teams;
    const rows = standings.map((team) => {
      const selected = selections.find((item) => normalizeName(item.name) === normalizeName(team.name));
      const status = selected ? groupStageStatus(selected, team.id) : "neutral";
      const displayName = teamDisplayName(team);
      return `
        <tr class="${status} ${selected ? "selected" : ""}">
          <td>${ownerBadge(team.owner, status)}</td>
          <td><div class="team-cell">${tableFlagMarkup(team)}<span class="team-name" title="${team.name}">${displayName}</span></div></td>
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
        <button type="button" class="fixture-share" data-share="${group.name}" aria-label="Share Group ${group.name}" title="Share group">${SHARE_ICON}</button>
      </div>
      <table>
        <thead><tr><th>Gambler</th><th>Team</th><th>P</th><th>W</th><th>L</th><th>D</th><th>GD</th><th>Pts</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
    groupsEl.append(table);
  });
  markDeepLinkedElement(hashGroupTarget());
  if (document.querySelector('[data-panel="groups"]')?.classList.contains("active")) {
    scrollToGroup(hashGroupTarget());
  }
}

function tableFlagMarkup(team) {
  return flagImage(team, "table-flag");
}

function teamDisplayName(team) {
  if (team.code === "COD") return "DR Congo";
  return team.name;
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

  const nextGame = nextFixtureId(ordered);
  let currentDay = "";
  fixturesEl.innerHTML = ordered.map((game) => {
    const date = parseMatchDate(game);
    const dayLabel = dayHeading(date);
    let header = "";
    if (dayLabel !== currentDay) {
      currentDay = dayLabel;
      header = `<div class="fixture-day">${dayLabel}</div>`;
    }
    return header + fixtureRow(game, game === nextGame);
  }).join("");

  // On (re)render, settle the scroll if Fixtures is showing: honour a deep-linked
  // match from the hash, otherwise fall back to the next unfinished match. This
  // also resolves a hash that pointed at a fixture before the data had loaded.
  if (document.querySelector('[data-panel="fixtures"]')?.classList.contains("active")) {
    scrollToFixture(hashFixtureTarget());
  }
  markDeepLinkedElement(hashFixtureTarget());
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

function fixtureRow(game, isNext) {
  const home = fixtureTeam(game, "home", game);
  const away = fixtureTeam(game, "away", game);
  const state = matchState(game);
  const started = state !== "upcoming";
  const stage = game.type === "group" ? `Group ${game.group}` : STAGE_LABELS[game.type] || "Match";
  const date = parseMatchDate(game);
  return `
    <div id="fixture-${game.id}" class="fixture ${state} ${isNext ? "next" : ""}">
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

function renderSurvivors(rows) {
  contendersEl.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Gambler</th>
          <th>Teams</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(({ player, owned, eliminated }, index) => {
          const rank = rankForPlayerSummary(rows, index, true);
          return `
            <tr class="contender-row ${eliminated ? "eliminated" : ""}">
              <td>${rank}</td>
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
      <span class="team-name" title="${team.name}">${team.name}</span>
      <strong>${score}</strong>
    </div>
  `;
}

function matchState(game) {
  if (isFinished(game)) return "finished";
  const elapsed = `${game.time_elapsed}`.trim().toLowerCase();
  if (elapsed && elapsed !== "notstarted" && elapsed !== "null") return "live";
  return "upcoming";
}

function liveLabel(game) {
  const elapsed = `${game.time_elapsed}`.trim();
  if (!elapsed || elapsed.toLowerCase() === "notstarted") return "Live";
  return /^\d+$/.test(elapsed) ? `${elapsed}'` : elapsed;
}

function fixtureTeam(game, side, statusGame = null) {
  const id = `${game[`${side}_team_id`]}`;
  const fallbackName = game[`${side}_team_name_en`] || game[`${side}_team_label`] || "TBD";
  const team = teamById.get(id) || { name: fallbackName, code: "TBD" };
  const selection = selectionForName(team.name);
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

function nextFixtureId(ordered) {
  return ordered.find((game) => !isFinished(game)) || ordered[ordered.length - 1];
}

// Bottom-align a fixture in the viewport. Passing null targets the next
// unfinished match (or the last one); the router passes a specific element when
// the hash points at one (e.g. `#fixtures/match-1234`). Runs after a frame so
// the panel has been shown and laid out before we measure.
function scrollToFixture(target) {
  requestAnimationFrame(() => {
    const el = target || fixturesEl.querySelector(".fixture.next") || fixturesEl.querySelector(".fixture:last-child");
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const top = window.scrollY + rect.bottom - window.innerHeight + 16;
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  });
}

function scrollToGroup(target) {
  requestAnimationFrame(() => {
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  });
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

function normalizeName(name) {
  return `${name}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/democratic republic of the congo/g, "dr congo")
    .replace(/democratic republic of congo/g, "dr congo")
    .replace(/czech republic/g, "czechia")
    .replace(/turkey/g, "turkiye")
    .replace(/[^a-z]/g, "");
}

init().catch((error) => {
  syncStatusEl.textContent = error.message;
});
