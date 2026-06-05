const API_BASE = "https://worldcup26.ir/get";
const PLAYER_ORDER = ["T", "Jane", "Colm", "Sharon", "Ivan", "Joey", "Chun", "Andy", "Kachun", "Kakei", "Vinny", "Boe"];

let selections = [];
let groups = [];
let games = [];
let teamById = new Map();
let teamByName = new Map();

const playersEl = document.querySelector("#players");
const groupsEl = document.querySelector("#groups");
const knockoutsEl = document.querySelector("#knockouts");
const syncStatusEl = document.querySelector("#sync-status");

async function init() {
  await loadSelections();
  render();
  await refreshData();
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
  const direct = await fetch(url, { mode: "cors" }).catch(() => null);
  if (direct?.ok) return direct.json();

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
  renderPlayers();
  renderGroups();
  renderKnockouts();
}

function renderPlayers() {
  const players = [...new Set([...PLAYER_ORDER, ...selections.map((team) => team.player)])];
  playersEl.innerHTML = players.map((player) => {
    const owned = selections.filter((team) => team.player === player);
    const alive = owned.filter((team) => teamStatus(team) !== "eliminated").length;
    return `
      <article class="player-token damage-${playerDamage(player)}" title="${player}: ${alive}/${owned.length} teams alive">
        ${avatarMarkup(player)}
        <span>${player}</span>
      </article>
    `;
  }).join("");
}

function renderGroups() {
  groupsEl.innerHTML = "";
  const sourceGroups = groups.length ? groups : fallbackGroups();
  sourceGroups.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach((group) => {
    const table = document.createElement("article");
    table.className = "group-table";
    const standings = groups.length ? standingsForGroup(group) : group.teams;
    const rows = standings.map((team, index) => {
      const selected = selections.find((item) => normalizeName(item.name) === normalizeName(team.name));
      const status = selected ? teamStatus(selected) : "neutral";
      return `
        <tr class="${status} ${selected ? "selected" : ""}">
          <td class="rank">${index + 1}</td>
          <td><div class="team-cell"><b>${team.code}</b><span>${team.name}</span>${ownerBadge(team.owner, status)}</div></td>
          <td>${team.mp}</td>
          <td>${team.w}</td>
          <td>${team.d}</td>
          <td>${team.l}</td>
          <td>${team.gd}</td>
          <td>${team.pts}</td>
        </tr>
      `;
    }).join("");
    table.innerHTML = `
      <h3>Group ${group.name}</h3>
      <table>
        <thead><tr><th>#</th><th>Team</th><th>MP</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>PTS</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
    groupsEl.append(table);
  });
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

function ownerBadge(owner, status) {
  if (!owner) return "";
  const damage = playerDamage(owner);
  return `
    <em class="owner-badge ${status} damage-${damage}" title="${owner}">
      ${avatarMarkup(owner)}
    </em>
  `;
}

function avatarMarkup(player) {
  return `<span class="mini-avatar avatar-${playerClass(player)}" aria-label="${player}" role="img"><i></i><b></b><small></small></span>`;
}

function playerClass(player) {
  return `${player}`.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function playerDamage(player) {
  const owned = selections.filter((team) => team.player === player);
  const eliminated = owned.filter((team) => teamStatus(team) === "eliminated").length;
  return Math.min(4, eliminated);
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
  return `${name}`.toLowerCase().replace(/czech republic/g, "czechia").replace(/turkey/g, "turkiye").replace(/[^a-z]/g, "");
}

function number(value) {
  return Number.parseInt(value, 10) || 0;
}

init().catch((error) => {
  syncStatusEl.textContent = error.message;
});
