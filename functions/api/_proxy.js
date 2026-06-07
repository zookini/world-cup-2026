// Shared proxy for the worldcup26.ir feed, used by the Cloudflare Pages
// Functions at /api/groups and /api/games. The upstream sends no CORS header,
// so the browser cannot call it directly — every deploy target must proxy it.
//
// Two cache tiers, both at Cloudflare's edge:
//   - "fresh": served for FRESH_TTL seconds so friends share one cached copy
//     instead of each hitting (and rate-limiting) the .ir box.
//   - "last-known-good": refreshed on every success, served if the upstream
//     errors so a brief outage shows recent scores instead of a blank board.
const FRESH_TTL = 45; // seconds
const LKG_TTL = 60 * 60 * 24; // 1 day

export async function proxyUpstream(context, upstream) {
  const cache = caches.default;
  const url = new URL(context.request.url);
  const freshKey = new Request(url.toString());
  const lkgKey = new Request(`${url.toString()}${url.search ? "&" : "?"}_lkg=1`);

  const fresh = await cache.match(freshKey);
  if (fresh) return fresh;

  try {
    const upstreamResponse = await fetch(upstream);
    const body = await upstreamResponse.text();
    if (!upstreamResponse.ok) throw new Error(`upstream HTTP ${upstreamResponse.status}`);

    const freshResponse = jsonResponse(body, `public, max-age=${FRESH_TTL}`);
    const lkgResponse = jsonResponse(body, `public, max-age=${LKG_TTL}`);
    context.waitUntil(
      Promise.all([cache.put(freshKey, freshResponse.clone()), cache.put(lkgKey, lkgResponse)])
    );
    return freshResponse;
  } catch (error) {
    const stale = await cache.match(lkgKey);
    if (stale) {
      const headers = new Headers(stale.headers);
      headers.set("X-Cache", "stale-last-known-good");
      headers.set("X-Upstream-Error", `${error.message}`.slice(0, 120));
      return new Response(stale.body, { status: 200, headers });
    }
    return new Response(JSON.stringify({ error: error.message }), {
      status: 502,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
}

function jsonResponse(body, cacheControl) {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheControl,
    },
  });
}
