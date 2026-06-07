const API_BASE = "https://worldcup26.ir/get";
const PLAYER_ORDER = ["T", "Jane", "Colm", "Sharon", "Ivan", "Joey", "Chun", "Andy", "Kachun", "Kakei", "Vinny", "Boe"];
const FLAG_CODES = {
  ALG: "DZ",
  ARG: "AR",
  AUT: "AT",
  AUS: "AU",
  BEL: "BE",
  BIH: "BA",
  BRA: "BR",
  CAN: "CA",
  CIV: "CI",
  COD: "CD",
  COL: "CO",
  CPV: "CV",
  CRO: "HR",
  CUW: "CW",
  CZE: "CZ",
  ECU: "EC",
  EGY: "EG",
  ENG: "GB-ENG",
  ESP: "ES",
  FRA: "FR",
  GER: "DE",
  GHA: "GH",
  HAI: "HT",
  IRN: "IR",
  IRQ: "IQ",
  JOR: "JO",
  JPN: "JP",
  KOR: "KR",
  KSA: "SA",
  MAR: "MA",
  MEX: "MX",
  NED: "NL",
  NOR: "NO",
  NZL: "NZ",
  PAN: "PA",
  PAR: "PY",
  POR: "PT",
  QAT: "QA",
  RSA: "ZA",
  SCO: "GB-SCT",
  SEN: "SN",
  SUI: "CH",
  SWE: "SE",
  TUN: "TN",
  TUR: "TR",
  URU: "UY",
  USA: "US",
  UZB: "UZ",
};

let selections = [];
let groups = [];
let games = [];
let teamById = new Map();
let teamByName = new Map();

const contendersEl = document.querySelector("#contenders");
const groupsEl = document.querySelector("#groups");
const knockoutsEl = document.querySelector("#knockouts");
const fixturesEl = document.querySelector("#fixtures");
const syncStatusEl = document.querySelector("#sync-status");
const viewButtons = document.querySelectorAll("[data-view]");
const viewPanels = document.querySelectorAll("[data-panel]");

async function init() {
  bindViewTabs();
  await loadSelections();
  render();
  await refreshData();
}

function bindViewTabs() {
  viewButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const view = button.dataset.view;
      viewButtons.forEach((item) => item.classList.toggle("active", item === button));
      viewPanels.forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === view));
      if (view === "fixtures") scrollFixturesToNext();
    });
  });
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

async function refreshData() {
  syncStatusEl.textContent = "Fetching live World Cup groups and matches...";
  try {
    const [groupPayload, gamePayload] = await Promise.all([
      fetchJson(`${API_BASE}/groups`),
      fetchJson(`${API_BASE}/games`),
    ]);
    groups = groupPayload.groups || groupPayload.data || [];
    games = gamePayload.games || gamePayload.data || [];
    indexTeams();
    render();
    syncStatusEl.textContent = `Results updated from worldcup26.ir. ${finishedGames().length} finished matches currently reflected.`;
  } catch (error) {
    render();
    syncStatusEl.textContent = `Could not fetch live results: ${error.message}. The board is showing the selected teams from selections.csv only.`;
  }
}

async function fetchJson(url) {
  // worldcup26.ir sends no CORS header, so we always go through the same-origin
  // proxy (server.mjs locally, Pages Functions in production).
  const proxiedPath = url.endsWith("/groups") ? "/api/groups" : "/api/games";
  const proxied = await fetch(proxiedPath);
  if (!proxied.ok) throw new Error(`${proxiedPath} returned HTTP ${proxied.status}`);
  return proxied.json();
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
  const team = {
    id: `${id}`,
    name,
    code: selectionForName(name)?.code || existing.code || codeFromName(name),
    owner: selectionForName(name)?.player || existing.owner || "",
    group: selectionForName(name)?.group || group || existing.group || "",
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
  const knockoutLoss = games.some((game) => {
    if (game.type === "group" || !isFinished(game)) return false;
    const homeId = `${game.home_team_id}`;
    const awayId = `${game.away_team_id}`;
    if (homeId !== teamId && awayId !== teamId) return false;
    return loserId(game) === teamId;
  });
  if (knockoutLoss) return "eliminated";

  const group = groups.find((item) => item.name === selection.group);
  if (!group) return "alive";
  const groupComplete = games.filter((game) => game.type === "group" && game.group === selection.group).every(isFinished);
  if (!groupComplete) return "alive";

  const standings = standingsForGroup(group);
  const rank = standings.findIndex((team) => team.id === teamId) + 1;
  if (rank > 0 && rank <= 2) return "alive";
  if (rank > 0 && rank === 3 && bestThirdPlaceIds().has(teamId)) return "alive";
  return "eliminated";
}

function bestThirdPlaceIds() {
  const thirds = groups.map((group) => {
    const complete = games.filter((game) => game.type === "group" && game.group === group.name).every(isFinished);
    if (!complete) return null;
    return standingsForGroup(group)[2];
  }).filter(Boolean).sort(sortStandings);
  return new Set(thirds.slice(0, 8).map((team) => team.id));
}

function isFinished(game) {
  return `${game.finished}`.toUpperCase() === "TRUE" || `${game.time_elapsed}`.toLowerCase() === "finished";
}

function finishedGames() {
  return games.filter(isFinished);
}

function loserId(game) {
  const homeScore = number(game.home_score);
  const awayScore = number(game.away_score);
  if (homeScore === awayScore) return "";
  return homeScore < awayScore ? `${game.home_team_id}` : `${game.away_team_id}`;
}

function render() {
  renderContenders();
  renderGroups();
  renderKnockouts();
  renderFixtures();
}

function renderContenders() {
  const players = [...new Set([...PLAYER_ORDER, ...selections.map((team) => team.player)])];
  const rows = players.map(playerSummary).sort(sortPlayerSummaries);
  contendersEl.innerHTML = `
    <table>
      <thead>
        <tr>
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
        ${rows.map(({ player, owned, played, w, l, d, pts }) => {
          return `
            <tr class="contender-row">
              <th scope="row">
                <span class="gambler-name">${player}</span>
              </th>
              <td>
                <div class="flag-strip">
                  ${owned.sort(sortOwnedTeams).map((team) => flagMarkup(team)).join("")}
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
  return owned.reduce((summary, team) => {
    const record = teamGroupRecord(team);
    if (teamStatus(team) !== "eliminated") summary.alive += 1;
    summary.played += record.played;
    summary.w += record.w;
    summary.l += record.l;
    summary.d += record.d;
    summary.pts += record.pts;
    return summary;
  }, { player, owned, alive: 0, played: 0, w: 0, l: 0, d: 0, pts: 0 });
}

function sortPlayerSummaries(a, b) {
  if (survivalSortingActive()) {
    const aliveDifference = b.alive - a.alive;
    if (aliveDifference) return aliveDifference;
  }
  return b.pts - a.pts || b.w - a.w || a.l - b.l || PLAYER_ORDER.indexOf(a.player) - PLAYER_ORDER.indexOf(b.player);
}

function survivalSortingActive() {
  return selections.some((team) => teamStatus(team) === "eliminated");
}

function teamGroupRecord(selection) {
  const group = groups.find((item) => item.name === selection.group);
  if (!group) return { played: 0, w: 0, l: 0, d: 0, pts: 0 };
  const team = standingsForGroup(group).find((item) => normalizeName(item.name) === normalizeName(selection.name));
  if (!team) return { played: 0, w: 0, l: 0, d: 0, pts: 0 };
  return { played: team.mp, w: team.w, l: team.l, d: team.d, pts: team.pts };
}

function sortOwnedTeams(a, b) {
  const aEliminated = teamStatus(a) === "eliminated";
  const bEliminated = teamStatus(b) === "eliminated";
  return Number(aEliminated) - Number(bEliminated);
}

function flagMarkup(team) {
  const status = teamStatus(team);
  return `
    <span class="team-flag ${status}" title="${team.name}">
      <img src="${flagUrl(team)}" alt="${team.name} flag" />
      <small>${team.code}</small>
    </span>
  `;
}

function flagUrl(team) {
  const code = FLAG_CODES[team.code] || team.code;
  return `assets/flags/${code.toLowerCase()}.png`;
}

function renderGroups() {
  groupsEl.innerHTML = "";
  const sourceGroups = groups.length ? groups : fallbackGroups();
  sourceGroups.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach((group) => {
    const table = document.createElement("article");
    table.className = "group-table";
    const standings = groups.length ? standingsForGroup(group) : group.teams;
    const rows = standings.map((team) => {
      const selected = selections.find((item) => normalizeName(item.name) === normalizeName(team.name));
      const status = selected ? teamStatus(selected) : "neutral";
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
      <h3>Group ${group.name}</h3>
      <table>
        <thead><tr><th>Gambler</th><th>Team</th><th>P</th><th>W</th><th>L</th><th>D</th><th>GD</th><th>Pts</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
    groupsEl.append(table);
  });
}

function tableFlagMarkup(team) {
  return `<img class="table-flag" src="${flagUrl(team)}" alt="${team.name} flag" />`;
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

function renderKnockouts() {
  knockoutsEl.innerHTML = "";
  const knockoutGames = games.filter((game) => game.type !== "group");
  const rounds = ["round_of_32", "round_of_16", "quarter_final", "semi_final", "third_place", "final"];
  const labels = {
    round_of_32: "Round of 32",
    round_of_16: "Round of 16",
    quarter_final: "Quarter-finals",
    semi_final: "Semi-finals",
    third_place: "Third Place",
    final: "Final",
  };

  rounds.forEach((round) => {
    const matches = knockoutGames.filter((game) => game.type === round);
    const column = document.createElement("section");
    column.className = "round-column";
    column.innerHTML = `<h3>${labels[round]}</h3>`;
    if (!matches.length) {
      column.innerHTML += `<article class="match-card empty">Awaiting qualifiers</article>`;
    }
    matches.forEach((game) => {
      column.append(renderMatch(game));
    });
    knockoutsEl.append(column);
  });
}

function renderMatch(game) {
  const home = teamById.get(`${game.home_team_id}`) || { name: game.home_team_name_en || "TBD", code: "TBD" };
  const away = teamById.get(`${game.away_team_id}`) || { name: game.away_team_name_en || "TBD", code: "TBD" };
  if (home.code === "TBD" && away.code === "TBD") {
    const empty = document.createElement("article");
    empty.className = "match-card empty";
    empty.textContent = "Awaiting qualifiers";
    return empty;
  }
  const homeSelection = selectionForName(home.name);
  const awaySelection = selectionForName(away.name);
  const homeStatus = homeSelection ? teamStatus(homeSelection) : "neutral";
  const awayStatus = awaySelection ? teamStatus(awaySelection) : "neutral";
  const card = document.createElement("article");
  card.className = `match-card ${isFinished(game) ? "finished" : ""}`;
  card.innerHTML = `
    <div class="${homeStatus} ${homeSelection ? "selected" : ""}"><b>${home.code}</b><span>${home.name}</span>${ownerBadge(homeSelection?.player, homeStatus)}<strong>${game.home_score}</strong></div>
    <div class="${awayStatus} ${awaySelection ? "selected" : ""}"><b>${away.code}</b><span>${away.name}</span>${ownerBadge(awaySelection?.player, awayStatus)}<strong>${game.away_score}</strong></div>
    <time>${game.local_date || "TBD"}</time>
  `;
  return card;
}

const STAGE_LABELS = {
  group: "Group",
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

  if (document.querySelector('[data-panel="fixtures"]')?.classList.contains("active")) {
    scrollFixturesToNext();
  }
}

function fixtureRow(game, isNext) {
  const home = fixtureTeam(game, "home");
  const away = fixtureTeam(game, "away");
  const state = matchState(game);
  const started = state !== "upcoming";
  const stage = game.type === "group" ? `Group ${game.group}` : STAGE_LABELS[game.type] || "Match";
  const date = parseMatchDate(game);
  const meta = state === "finished"
    ? `<span class="fixture-ft">Full time</span>`
    : state === "live"
    ? `<span class="fixture-live">${liveLabel(game)}</span>`
    : `<time>${date ? timeLabel(date) : "TBD"}</time>`;
  return `
    <div class="fixture ${state} ${isNext ? "next" : ""}">
      ${fixtureTeamLine(home, started ? number(game.home_score) : "")}
      ${fixtureTeamLine(away, started ? number(game.away_score) : "")}
      <div class="fixture-foot">
        <span class="fixture-stage">${stage}</span>
        ${meta}
      </div>
    </div>
  `;
}

function fixtureTeamLine(team, score) {
  return `
    <div class="fixture-team ${team.status} ${team.selected ? "selected" : ""}">
      <span class="fixture-gambler">${ownerBadge(team.owner, team.status)}</span>
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

function fixtureTeam(game, side) {
  const id = `${game[`${side}_team_id`]}`;
  const fallbackName = game[`${side}_team_name_en`] || game[`${side}_team_label`] || "TBD";
  const team = teamById.get(id) || { name: fallbackName, code: "TBD" };
  const selection = selectionForName(team.name);
  return {
    name: teamDisplayName(team),
    code: team.code,
    owner: selection?.player || team.owner || "",
    selected: Boolean(selection),
    status: selection ? teamStatus(selection) : "neutral",
  };
}

function fixtureFlag(team) {
  if (!team.code || team.code === "TBD") {
    return `<span class="table-flag placeholder" aria-hidden="true"></span>`;
  }
  return `<img class="table-flag" src="${flagUrl(team)}" alt="${team.name} flag" />`;
}

function sortedGames() {
  return games.slice().sort((a, b) => {
    const dateA = parseMatchDate(a);
    const dateB = parseMatchDate(b);
    if (dateA && dateB && dateA.getTime() !== dateB.getTime()) return dateA - dateB;
    if (dateA && !dateB) return -1;
    if (!dateA && dateB) return 1;
    return number(a.id) - number(b.id);
  });
}

function nextFixtureId(ordered) {
  return ordered.find((game) => !isFinished(game)) || ordered[ordered.length - 1];
}

function scrollFixturesToNext() {
  requestAnimationFrame(() => {
    const target = fixturesEl.querySelector(".fixture.next") || fixturesEl.querySelector(".fixture:last-child");
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const top = window.scrollY + rect.bottom - window.innerHeight + 16;
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  });
}

// The feed lists each kickoff in its venue's own local wall-clock, so we resolve
// the true instant per stadium and then render in the viewer's local timezone.
// The tournament (Jun 11 - Jul 19, 2026) sits entirely within one DST state, so
// fixed offsets are exact: US/Canada venues are on summer time, while Mexico has
// observed no DST since 2022. Offsets are the venue zone's minutes from UTC.
const STADIUM_UTC_OFFSET_MINUTES = {
  1: -360, 2: -360, 3: -360, // Mexico City, Guadalajara, Monterrey — UTC-6 (no DST)
  4: -300, 5: -300, 6: -300, // Dallas, Houston, Kansas City — Central (CDT) UTC-5
  7: -240, 8: -240, 9: -240, 10: -240, 11: -240, 12: -240, // Atlanta, Miami, Boston, Philadelphia, NY/NJ, Toronto — Eastern (EDT) UTC-4
  13: -420, 14: -420, 15: -420, 16: -420, // Vancouver, Seattle, SF Bay Area, Los Angeles — Pacific (PDT) UTC-7
};
const DEFAULT_UTC_OFFSET_MINUTES = -240; // fall back to Eastern if a stadium is unknown

function parseMatchDate(game) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}):(\d{2}))?/.exec(`${game?.local_date || ""}`.trim());
  if (!match) return null;
  const [, mm, dd, yyyy, hh = "0", min = "0"] = match;
  const offset = STADIUM_UTC_OFFSET_MINUTES[Number(game?.stadium_id)] ?? DEFAULT_UTC_OFFSET_MINUTES;
  const utcMs = Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min));
  return new Date(utcMs - offset * 60000);
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

function number(value) {
  return Number.parseInt(value, 10) || 0;
}

init().catch((error) => {
  syncStatusEl.textContent = error.message;
});
