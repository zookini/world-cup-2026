import { number } from "./match-utils.js";

export function parseSeedTsv(text) {
  const sections = splitSeedSections(text);
  const groupRows = parseTsv(sections.groups || "");
  const gameRows = parseTsv(sections.games || "");
  const groups = seedGroups(groupRows);
  const codesById = teamCodesById(groups);
  return {
    groups,
    games: rowsToObjects(gameRows).map((row) => seedGame(row, codesById)),
  };
}

// FIFA 3-letter code per seed team_id, the stable identifier shared with ESPN
// (its team.abbreviation), so a fixture matches its live event even when the
// feed spells a side differently ("Côte d'Ivoire" vs "Ivory Coast").
function teamCodesById(groups) {
  const codes = new Map();
  groups.forEach((group) => group.teams.forEach((team) => {
    if (team.code) codes.set(`${team.team_id}`, team.code);
  }));
  return codes;
}

function splitSeedSections(text) {
  const sections = {};
  let current = "";
  text.split(/\r?\n/).forEach((line) => {
    const heading = /^#\s*(groups|games)\s*$/i.exec(line);
    if (heading) {
      current = heading[1].toLowerCase();
      sections[current] = "";
    } else if (current) {
      sections[current] += `${line}\n`;
    }
  });
  return sections;
}

function parseTsv(text) {
  return text.trim().split(/\r?\n/).filter(Boolean).map((line) => line.split("\t"));
}

function rowsToObjects(rows) {
  const headers = rows[0] || [];
  return rows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] || ""])));
}

function seedGroups(rows) {
  const groups = new Map();
  rowsToObjects(rows).forEach((row) => {
    if (!groups.has(row.group)) groups.set(row.group, { name: row.group, teams: [] });
    groups.get(row.group).teams.push({
      team_id: row.team_id,
      team_name_en: row.team_name_en,
      code: row.code,
      mp: number(row.mp),
      w: number(row.w),
      d: number(row.d),
      l: number(row.l),
      gf: number(row.gf),
      ga: number(row.ga),
      gd: number(row.gd),
      pts: number(row.pts),
    });
  });
  return Array.from(groups.values());
}

function seedGame(row, codesById) {
  return {
    ...row,
    home_team_code: codesById.get(`${row.home_team_id}`) || "",
    away_team_code: codesById.get(`${row.away_team_id}`) || "",
    home_score: 0,
    away_score: 0,
    finished: false,
    time_elapsed: "notstarted",
  };
}
