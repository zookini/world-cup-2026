(function () {
  const TEAM_STRENGTH = {
    Spain: 96, France: 95, Argentina: 94, England: 93, Brazil: 92, Portugal: 91, Germany: 90,
    Netherlands: 88, Belgium: 86, Croatia: 85, Uruguay: 84, Colombia: 83, Morocco: 82,
    Switzerland: 81, Mexico: 80, "United States": 79, Japan: 78, Senegal: 77, Austria: 76,
    Norway: 75, Ecuador: 74, Turkey: 73, Sweden: 72, "South Korea": 71, "Ivory Coast": 70,
    Paraguay: 69, Canada: 68, Egypt: 67, Ghana: 66, Algeria: 65, Australia: 64,
    "Bosnia and Herzegovina": 63, Czechia: 62, Iran: 61, Scotland: 60, Tunisia: 59,
    "South Africa": 58, Qatar: 57, Panama: 56, "Saudi Arabia": 55, Uzbekistan: 54,
    "DR Congo": 53, "Democratic Republic of the Congo": 53, Iraq: 52, Jordan: 51,
    "New Zealand": 50, "Cape Verde": 49, Haiti: 48, "Curaçao": 47,
  };

  const STADIUM_UTC_OFFSET_MINUTES = {
    1: -360, 2: -360, 3: -360,
    4: -300, 5: -300, 6: -300,
    7: -240, 8: -240, 9: -240, 10: -240, 11: -240, 12: -240,
    13: -420, 14: -420, 15: -420, 16: -420,
  };
  const DEFAULT_UTC_OFFSET_MINUTES = -240;

  function fromUrl({ groups, games, search }) {
    const targetMatch = mockTargetMatch(new URLSearchParams(search).get("mock") || "");
    if (!targetMatch) return null;

    const mock = buildMatchDayData({ groups, games, targetMatch });
    if (!mock) return null;

    return {
      ...mock,
      status: `Showing mock data up to match ${targetMatch}. ${finishedGames(mock.games).length} simulated finished matches are reflected.`,
    };
  }

  function mockTargetMatch(value) {
    const match = /^match-(\d+)$/.exec(value);
    return match ? number(match[1]) : 0;
  }

  function buildMatchDayData({ groups, games, targetMatch }) {
    if (!games.length || !groups.length) return null;

    const projectedGames = games.map((game) => ({ ...game }));
    const targetGame = projectedGames.find((game) => number(game.id) === targetMatch);
    if (!targetGame) return null;

    const teamById = indexTeams(projectedGames);
    const projectedGroups = groups.map((group) => ({
      ...group,
      teams: group.teams.map((team) => ({ ...team, mp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 })),
    }));
    const groupRows = new Map();
    projectedGroups.forEach((group) => group.teams.forEach((team) => groupRows.set(`${team.team_id}`, team)));

    projectedGames.filter((game) => game.type === "group").forEach((game) => {
      if (shouldFinishMockGame(game, targetGame)) {
        applyPredictedScore(game, teamById, { allowDraw: true });
        applyGroupResult(groupRows.get(`${game.home_team_id}`), groupRows.get(`${game.away_team_id}`), game);
      } else {
        resetGame(game);
      }
    });

    projectedGroups.forEach((group) => group.teams.sort((a, b) => {
      const aTeam = teamById.get(`${a.team_id}`);
      const bTeam = teamById.get(`${b.team_id}`);
      return number(b.pts) - number(a.pts) || number(b.gd) - number(a.gd) || number(b.gf) - number(a.gf) || teamStrength(bTeam?.name) - teamStrength(aTeam?.name);
    }));

    if (targetGame.type === "group") return { games: projectedGames, groups: projectedGroups };

    const seeds = bracketSeeds(projectedGroups, teamById);
    const winners = new Map();
    const losers = new Map();
    const usedThirdPlaceGroups = new Set();
    const usedFirstRoundTeams = new Set();

    projectedGames.filter((game) => game.type !== "group").sort((a, b) => number(a.id) - number(b.id)).forEach((game) => {
      const home = resolveBracketTeam(game.home_team_label, seeds, winners, losers, usedThirdPlaceGroups, usedFirstRoundTeams, game.type);
      if (game.type === "r32" && home) usedFirstRoundTeams.add(home.id);
      const away = resolveBracketTeam(game.away_team_label, seeds, winners, losers, usedThirdPlaceGroups, usedFirstRoundTeams, game.type);
      if (game.type === "r32" && away) usedFirstRoundTeams.add(away.id);
      assignBracketTeam(game, "home", home);
      assignBracketTeam(game, "away", away);

      if (shouldFinishMockGame(game, targetGame)) {
        applyPredictedScore(game, teamById, { allowDraw: false });
        winners.set(`${game.id}`, winnerTeam(game, teamById));
        losers.set(`${game.id}`, loserTeam(game, teamById));
      } else {
        resetGame(game);
      }
    });

    return { games: projectedGames, groups: projectedGroups };
  }

  function indexTeams(games) {
    const teamById = new Map();
    games.forEach((game) => {
      addTeam(teamById, game.home_team_id, game.home_team_name_en);
      addTeam(teamById, game.away_team_id, game.away_team_name_en);
    });
    return teamById;
  }

  function addTeam(teamById, id, name) {
    if (!id || !name || name.toLowerCase().includes("winner") || name.toLowerCase().includes("runner")) return;
    teamById.set(`${id}`, { id: `${id}`, name });
  }

  function shouldFinishMockGame(game, targetGame) {
    const gameDate = parseMatchDate(game);
    const targetDate = parseMatchDate(targetGame);
    if (!gameDate || !targetDate) return number(game.id) < number(targetGame.id);
    if (gameDate.getTime() !== targetDate.getTime()) return gameDate < targetDate;
    if (targetGame.type === "final") return number(game.id) <= number(targetGame.id);
    return number(game.id) < number(targetGame.id);
  }

  function bracketSeeds(projectedGroups, teamById) {
    const seeds = {};
    const thirds = [];
    projectedGroups.forEach((group) => {
      const name = group.name;
      seeds[`Winner Group ${name}`] = teamById.get(`${group.teams[0]?.team_id}`);
      seeds[`Runner-up Group ${name}`] = teamById.get(`${group.teams[1]?.team_id}`);
      thirds.push({ group: name, team: teamById.get(`${group.teams[2]?.team_id}`), row: group.teams[2] });
    });
    thirds.sort((a, b) => sortStandingsRow(b.row, a.row) || teamStrength(b.team?.name) - teamStrength(a.team?.name));
    thirds.slice(0, 8).forEach(({ group, team }) => {
      seeds[`3rd Group ${group}`] = team;
    });
    return seeds;
  }

  function sortStandingsRow(a, b) {
    return number(a.pts) - number(b.pts) || number(a.gd) - number(b.gd) || number(a.gf) - number(b.gf);
  }

  function resolveBracketTeam(label, seeds, winners, losers, usedThirdPlaceGroups, usedFirstRoundTeams, round) {
    if (!label) return null;
    const winnerMatch = /^Winner Match (\d+)$/.exec(label);
    if (winnerMatch) return winners.get(winnerMatch[1]);
    const loserMatch = /^Loser Match (\d+)$/.exec(label);
    if (loserMatch) return losers.get(loserMatch[1]);
    const thirdChoice = /^3rd Group (.+)$/.exec(label);
    if (thirdChoice) {
      const eligible = thirdChoice[1].split("/")
        .filter((group) => !usedThirdPlaceGroups.has(group))
        .map((group) => ({ group, team: seeds[`3rd Group ${group}`] }))
        .filter((item) => item.team)
        .filter((item) => round !== "r32" || !usedFirstRoundTeams.has(item.team.id))
        .sort((a, b) => teamStrength(b.team.name) - teamStrength(a.team.name));
      const fallback = Object.entries(seeds)
        .filter(([key]) => key.startsWith("3rd Group "))
        .map(([key, team]) => ({ group: key.replace("3rd Group ", ""), team }))
        .filter((item) => !usedThirdPlaceGroups.has(item.group))
        .filter((item) => round !== "r32" || !usedFirstRoundTeams.has(item.team.id))
        .sort((a, b) => teamStrength(b.team.name) - teamStrength(a.team.name));
      const choice = eligible[0] || fallback[0];
      if (choice) usedThirdPlaceGroups.add(choice.group);
      return choice?.team || null;
    }
    return seeds[label] || null;
  }

  function assignBracketTeam(game, side, team) {
    if (!team) return;
    game[`${side}_team_id`] = team.id;
    game[`${side}_team_name_en`] = team.name;
  }

  function applyPredictedScore(game, teamById, { allowDraw }) {
    const home = teamById.get(`${game.home_team_id}`) || { name: game.home_team_name_en };
    const away = teamById.get(`${game.away_team_id}`) || { name: game.away_team_name_en };
    const diff = teamStrength(home.name) - teamStrength(away.name);
    const homeScore = diff >= 18 ? 3 : diff >= 6 ? 2 : diff >= -4 ? 1 : 0;
    const awayScore = diff <= -18 ? 3 : diff <= -6 ? 2 : diff <= 4 ? 1 : 0;
    game.home_score = `${homeScore}`;
    game.away_score = `${awayScore}`;
    if (!allowDraw && homeScore === awayScore) {
      if (diff >= 0) game.home_score = `${homeScore + 1}`;
      else game.away_score = `${awayScore + 1}`;
    }
    game.finished = "TRUE";
    game.time_elapsed = "finished";
  }

  function resetGame(game) {
    game.finished = "FALSE";
    game.time_elapsed = "notstarted";
    game.home_score = "0";
    game.away_score = "0";
  }

  function applyGroupResult(home, away, game) {
    const homeScore = number(game.home_score);
    const awayScore = number(game.away_score);
    home.mp += 1; away.mp += 1;
    home.gf += homeScore; home.ga += awayScore; home.gd = home.gf - home.ga;
    away.gf += awayScore; away.ga += homeScore; away.gd = away.gf - away.ga;
    if (homeScore > awayScore) {
      home.w += 1; home.pts += 3; away.l += 1;
    } else if (awayScore > homeScore) {
      away.w += 1; away.pts += 3; home.l += 1;
    } else {
      home.d += 1; away.d += 1; home.pts += 1; away.pts += 1;
    }
  }

  function winnerTeam(game, teamById) {
    return number(game.home_score) > number(game.away_score)
      ? teamById.get(`${game.home_team_id}`)
      : teamById.get(`${game.away_team_id}`);
  }

  function loserTeam(game, teamById) {
    return number(game.home_score) < number(game.away_score)
      ? teamById.get(`${game.home_team_id}`)
      : teamById.get(`${game.away_team_id}`);
  }

  function teamStrength(name) {
    return TEAM_STRENGTH[name] ?? TEAM_STRENGTH[displayName(name)] ?? 40;
  }

  function displayName(name) {
    if (name === "Democratic Republic of the Congo") return "DR Congo";
    return name;
  }

  function finishedGames(games) {
    return games.filter((game) => `${game.finished}`.toUpperCase() === "TRUE" || `${game.time_elapsed}`.toLowerCase() === "finished");
  }

  function parseMatchDate(game) {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}):(\d{2}))?/.exec(`${game?.local_date || ""}`.trim());
    if (!match) return null;
    const [, mm, dd, yyyy, hh = "0", min = "0"] = match;
    const offset = STADIUM_UTC_OFFSET_MINUTES[Number(game?.stadium_id)] ?? DEFAULT_UTC_OFFSET_MINUTES;
    const utcMs = Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min));
    return new Date(utcMs - offset * 60000);
  }

  function number(value) {
    return Number.parseInt(value, 10) || 0;
  }

  window.WorldCupMockFeed = { fromUrl };
})();
