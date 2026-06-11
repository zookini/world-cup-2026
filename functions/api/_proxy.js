// Shared proxy for the worldcup26.ir feed, used by the Cloudflare Pages
// Functions at /api/groups and /api/games. The upstream sends no CORS header,
// so the browser cannot call it directly — every deploy target must proxy it.
//
// Two cache tiers, both at Cloudflare's edge:
//   - "fresh": served for FRESH_TTL seconds so friends share one cached copy
//     instead of each hitting (and rate-limiting) the .ir box.
//   - "last-known-good": refreshed on every success. When the fresh cache has
//     expired, it is served immediately while the edge refreshes in the
//     background; it is also served if the upstream errors.
const FRESH_TTL = 45; // seconds
const LKG_TTL = 60 * 60 * 24; // 1 day

export async function proxyUpstream(context, upstream) {
  const cache = caches.default;
  const url = new URL(context.request.url);
  url.searchParams.delete("_fresh");
  const freshKey = new Request(url.toString());
  url.searchParams.set("_lkg", "1");
  const lkgKey = new Request(url.toString());

  const fresh = await cache.match(freshKey);
  if (fresh) return fresh;

  const stale = await cache.match(lkgKey);
  if (stale) {
    context.waitUntil(refreshCache(cache, freshKey, lkgKey, upstream));
    const headers = new Headers(stale.headers);
    headers.set("X-Cache", "stale-refreshing");
    return new Response(stale.body, { status: 200, headers });
  }

  try {
    return await refreshCache(cache, freshKey, lkgKey, upstream);
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 502,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
}

async function refreshCache(cache, freshKey, lkgKey, upstream) {
  const upstreamResponse = await fetch(upstream);
  const body = await upstreamResponse.text();
  if (!upstreamResponse.ok) throw new Error(`upstream HTTP ${upstreamResponse.status}`);

  const freshResponse = jsonResponse(body, `public, max-age=${FRESH_TTL}`);
  const lkgResponse = jsonResponse(body, `public, max-age=${LKG_TTL}`);
  await Promise.all([cache.put(freshKey, freshResponse.clone()), cache.put(lkgKey, lkgResponse)]);
  return freshResponse;
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
