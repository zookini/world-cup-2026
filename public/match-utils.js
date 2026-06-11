// Match helpers shared by the live app (app.js) and the mock feed
// (mock-feed.js), which both consume the same worldcup26.ir game shape.

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

export function parseMatchDate(game) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}):(\d{2}))?/.exec(`${game?.local_date || ""}`.trim());
  if (!match) return null;
  const [, mm, dd, yyyy, hh = "0", min = "0"] = match;
  const offset = STADIUM_UTC_OFFSET_MINUTES[Number(game?.stadium_id)] ?? DEFAULT_UTC_OFFSET_MINUTES;
  const utcMs = Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min));
  return new Date(utcMs - offset * 60000);
}

// The API docs list "FT" as a time_elapsed value, while the 2022 edition used
// "finished" — accept both in case the finished flag lags.
export function isFinished(game) {
  const elapsed = `${game.time_elapsed}`.trim().toLowerCase();
  const status = `${game.status || game.match_status || game.game_status || ""}`.trim().toLowerCase();
  return `${game.finished}`.toUpperCase() === "TRUE"
    || ["finished", "ft", "full-time", "full time", "aet", "after extra time"].includes(elapsed)
    || ["finished", "ft", "full-time", "full time", "completed", "complete"].includes(status);
}

export function number(value) {
  return Number.parseInt(value, 10) || 0;
}
