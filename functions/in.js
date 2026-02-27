export async function onRequest(context) {
  const { request, env } = context;

  const LANDING_URL = "https://abukhalid.pages.dev/";
  const MAX_ALLOWED = 2;
  const WINDOW_HOURS = 24;
  const BAN_HOURS = 168;

  const store = env.VISITS;

  const url = new URL(request.url);
  const ua = request.headers.get("User-Agent") || "";

  // ===== Secret used ONLY to make Google accept the destination =====
  const SECRET = "x9Kq7Lm2Rp8Tz4Va1Ws6";
  const k = url.searchParams.get("k");

  // Detect Google
  const isGoogle =
    ua.includes("Googlebot") ||
    ua.includes("AdsBot-Google") ||
    ua.includes("Mediapartners-Google") ||
    ua.includes("Google-InspectionTool") ||
    ua.includes("APIs-Google") ||
    ua.includes("Google");

  // (A) If Google comes with secret -> ALWAYS allow (no counting, no blocking)
  if (k === SECRET && isGoogle) {
    return Response.redirect(LANDING_URL, 302);
  }

  // (B) If a normal user comes with secret (from the ad) -> REMOVE secret immediately
  // so the user won't keep seeing it, then apply protection on clean /in
  if (k === SECRET && !isGoogle) {
    const clean = new URL(request.url);
    clean.searchParams.delete("k");
    return Response.redirect(clean.toString(), 302);
  }

  // If KV is missing, never break access (avoid "destination not working")
  if (!store) {
    return Response.redirect(LANDING_URL, 302);
  }

  // ===== Protection: 2 tries then "close" (no 403) =====
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const banKey = `ban:${ip}`;
  const countKey = `cnt:${ip}`;

  // If banned -> close (empty response)
  const banned = await store.get(banKey);
  if (banned) {
    return new Response(null, { status: 204 });
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

  if (data.c > MAX_ALLOWED) {
    await store.put(banKey, "1", { expirationTtl: BAN_HOURS * 3600 });
    await store.delete(countKey);
    return new Response(null, { status: 204 });
  }

  await store.put(countKey, JSON.stringify(data), { expirationTtl: windowSeconds });

  return Response.redirect(LANDING_URL, 302);
}
