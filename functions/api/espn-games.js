import { proxyUpstream } from "./_proxy.js";

export const onRequest = (context) =>
  proxyUpstream(context, "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?limit=200&dates=20260611-20260719");
