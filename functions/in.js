export async function onRequest(context) {
  const { request, env } = context;

  const LANDING_URL = "https://abukhalid.pages.dev/";
  const MAX_ALLOWED = 2;
  const WINDOW_HOURS = 24;
  const BAN_HOURS = 168;

  // If KV is not configured, never break Google Ads checks
  const store = env.VISITS;

  // Always allow Google (and never block even if KV fails)
  const ua = request.headers.get("User-Agent") || "";
  const isGoogle =
    ua.includes("Googlebot") ||
    ua.includes("AdsBot-Google") ||
    ua.includes("Mediapartners-Google") ||
    ua.includes("Google-InspectionTool") ||
    ua.includes("APIs-Google") ||
    ua.includes("Google");

  if (isGoogle || !store) {
    return Response.redirect(LANDING_URL, 302);
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";

  const banKey = `ban:${ip}`;
  const countKey = `cnt:${ip}`;

  // If banned: DO NOT return 403. Just redirect silently.
  const banned = await store.get(banKey);
  if (banned) {
    return Response.redirect(LANDING_URL, 302);
  }

  const now = Math.floor(Date.now() / 1000);
  const windowSeconds = WINDOW_HOURS * 3600;

  let data = { c: 0, t: now };
  const raw = await store.get(countKey);
  if (raw) {
    try { data = JSON.parse(raw); } catch {}
  }

  if (!data.t || (now - data.t) > windowSeconds) {
    data = { c: 0, t: now };
  }

  data.c += 1;

  // If exceeded: set ban, but still redirect (no 403).
  if (data.c > MAX_ALLOWED) {
    await store.put(banKey, "1", { expirationTtl: BAN_HOURS * 3600 });
    await store.delete(countKey);
    return Response.redirect(LANDING_URL, 302);
  }

  await store.put(countKey, JSON.stringify(data), { expirationTtl: windowSeconds });

  return Response.redirect(LANDING_URL, 302);
}
