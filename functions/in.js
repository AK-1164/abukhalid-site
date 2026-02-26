export async function onRequest(context) {
  const { request, env } = context;

  // ====== SETTINGS (edit here if you want) ======
  const LANDING_URL = "https://abukhalid.pages.dev/"; // your real site
  const MAX_ALLOWED = 2;      // allow 2 ad entries
  const WINDOW_HOURS = 24;    // counting window
  const BAN_HOURS = 168;      // ban duration

  const url = new URL(request.url);

  // Detect real ad clicks (Auto-tagging adds gclid)
  const gclid = url.searchParams.get("gclid");
  const utmSource = (url.searchParams.get("utm_source") || "").toLowerCase();
  const utmMedium = (url.searchParams.get("utm_medium") || "").toLowerCase();

  const isAdClick =
    !!gclid ||
    (utmSource === "google" && (utmMedium === "cpc" || utmMedium === "ppc" || utmMedium === "paidsearch"));

  // IMPORTANT:
  // If it's NOT an ad click (e.g., Google review tools, random visitors, previews),
  // do NOT block. Just redirect to the site.
  if (!isAdClick) {
    return Response.redirect(LANDING_URL, 302);
  }

  // ====== From here: protection applies ONLY to real ad clicks ======

  // Block non-Saudi IPs (helps against VPN outside SA)
  const country = (request.headers.get("CF-IPCountry") || "").toUpperCase();
  if (country && country !== "SA") {
    return new Response(null, { status: 403 });
  }

  // Strong identity: IP only
  const ip = request.headers.get("CF-Connecting-IP") || "";
  if (!ip) return new Response(null, { status: 403 });

  const store = env.VISITS; // KV binding name must be VISITS
  if (!store) return new Response(null, { status: 403 });

  const banKey = `ban:${ip}`;
  const countKey = `cnt:${ip}`;

  // If banned -> block silently
  const banned = await store.get(banKey);
  if (banned) return new Response(null, { status: 403 });

  const now = Math.floor(Date.now() / 1000);
  const windowSeconds = WINDOW_HOURS * 3600;

  let data = { c: 0, t: now };
  const raw = await store.get(countKey);
  if (raw) {
    try { data = JSON.parse(raw); } catch {}
  }

  // Reset after window
  if (!data.t || (now - data.t) > windowSeconds) {
    data = { c: 0, t: now };
  }

  data.c += 1;

  // Third time -> ban + block silently
  if (data.c > MAX_ALLOWED) {
    await store.put(banKey, "1", { expirationTtl: BAN_HOURS * 3600 });
    await store.delete(countKey);
    return new Response(null, { status: 403 });
  }

  await store.put(countKey, JSON.stringify(data), {
    expirationTtl: windowSeconds
  });

  return Response.redirect(LANDING_URL, 302);
}
