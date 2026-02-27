export async function onRequest(context) {
  const { request, env } = context;

  // ====== SETTINGS (edit if you want) ======
  const LANDING_URL = "https://abukhalid.pages.dev/";
  const MAX_ALLOWED = 2;      // allow 2 visits
  const WINDOW_HOURS = 24;    // counting window
  const BAN_HOURS = 168;      // ban duration

  const ua = request.headers.get("User-Agent") || "";

  // ====== FULL ACCESS FOR GOOGLE (no counting, no blocking) ======
  const isGoogle =
    ua.includes("Googlebot") ||
    ua.includes("AdsBot-Google") ||
    ua.includes("Mediapartners-Google") ||
    ua.includes("Google-InspectionTool") ||
    ua.includes("APIs-Google") ||
    ua.includes("Google");

  if (isGoogle) {
    return Response.redirect(LANDING_URL, 302);
  }

  // ====== PROTECTION (IP only) ======
  const ip = request.headers.get("CF-Connecting-IP") || "";
  if (!ip) return new Response(null, { status: 403 });

  const store = env.VISITS; // KV binding name must be VISITS
  if (!store) return new Response(null, { status: 403 });

  const banKey = `ban:${ip}`;
  const countKey = `cnt:${ip}`;

  // if banned -> block silently
  const banned = await store.get(banKey);
  if (banned) return new Response(null, { status: 403 });

  const now = Math.floor(Date.now() / 1000);
  const windowSeconds = WINDOW_HOURS * 3600;

  let data = { c: 0, t: now };
  const raw = await store.get(countKey);
  if (raw) {
    try { data = JSON.parse(raw); } catch {}
  }

  // reset after window
  if (!data.t || (now - data.t) > windowSeconds) {
    data = { c: 0, t: now };
  }

  data.c += 1;

  // third time -> ban + block silently
  if (data.c > MAX_ALLOWED) {
    await store.put(banKey, "1", { expirationTtl: BAN_HOURS * 3600 });
    await store.delete(countKey);
    return new Response(null, { status: 403 });
  }

  await store.put(countKey, JSON.stringify(data), { expirationTtl: windowSeconds });

  return Response.redirect(LANDING_URL, 302);
}
