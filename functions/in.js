export async function onRequest(context) {
  const { request, env } = context;

  const LANDING_URL = "https://abukhalid.pages.dev/";
  const MAX_ALLOWED = 2;      // مرتين فقط للسعودية
  const WINDOW_HOURS = 24;    // خلال 24 ساعة
  const BAN_HOURS = 168;      // حظر أسبوع

  const store = env.VISITS;
  const url = new URL(request.url);

  const country = request.headers.get("CF-IPCountry") || "XX";
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";

  const now = Math.floor(Date.now() / 1000);
  const weekSeconds = BAN_HOURS * 3600;

  // ===== إضافة فقط: وقت مقروء (توقيت السعودية UTC+3) =====
  function pad(n) { 
    return String(n).padStart(2, "0"); 
  }

  function ksaTsFromNowSec(nowSec) {
    const d = new Date((nowSec + 3 * 3600) * 1000);

    const day = pad(d.getUTCDate());
    const month = pad(d.getUTCMonth() + 1);
    const hh = pad(d.getUTCHours());
    const mm = pad(d.getUTCMinutes());
    const ss = pad(d.getUTCSeconds());

    return `${day}/${month} ${hh}:${mm}:${ss} KSA`;
  }

  // ===== إضافة فقط: تجهيز IP للإرسال إلى Google Ads عبر Worker =====
  async function pushToAds(ip, country) {
    if (!store) return;
    const key = `push:${now}:${country}:${ip}`;
    await store.put(key, "1", { expirationTtl: weekSeconds });
  }

  // ==========================
  // 1) اليمن: حظر مباشر أسبوع + عداد
  // ==========================
  if (country === "YE") {

    if (store) {
      const banKey = `ban:YE:${ip}`;
      const logKey = `log:YE:${ip}`;

      // ضع الحظر أسبوع
      await store.put(banKey, "1", { expirationTtl: weekSeconds });

      // إضافة فقط: إرسال IP إلى قائمة الاستبعاد
      await pushToAds(ip, "YE");

      // عداد المحاولات
      let data = { c: 0, t: now };
      const raw = await store.get(logKey);
      if (raw) {
        try { data = JSON.parse(raw); } catch {}
      }

      data.c += 1;
      data.t = now;
      data.ts = ksaTsFromNowSec(now);

      await store.put(logKey, JSON.stringify(data), { expirationTtl: weekSeconds });
    }

    return new Response(`<!doctype html>
<html lang="ar">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>خدمة غير متاحة</title>
</head>
<body style="font-family:system-ui;padding:24px">
<h2>خدمة غير متاحة</h2>
</body>
</html>`, {
      status: 403,
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }

  // ==========================
  // 2) تنظيف k
  // ==========================
  if (url.searchParams.has("k")) {
    url.searchParams.delete("k");
    return Response.redirect(url.toString(), 302);
  }

  if (!store) {
    return Response.redirect(LANDING_URL, 302);
  }

  // ==========================
  // 3) غير السعودية: تحويل طبيعي
  // ==========================
  if (country !== "SA") {
    return Response.redirect(LANDING_URL, 302);
  }

  const banKey = `ban:SA:${ip}`;
  const countKey = `cnt:SA:${ip}`;

  // ==========================
  // 4) إذا محظور → زد العداد وأعد صفحة المنع
  // ==========================
  const banned = await store.get(banKey);
  if (banned) {

    // زيادة عداد المحاولات أثناء الحظر
    let data = { c: 0, t: now };
    const raw = await store.get(countKey);
    if (raw) {
      try { data = JSON.parse(raw); } catch {}
    }

    data.c += 1;
    data.t = now;
    data.ts = ksaTsFromNowSec(now);

    await store.put(countKey, JSON.stringify(data), { expirationTtl: weekSeconds });

    return new Response(`<!doctype html>
<html lang="ar">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>غير متاح</title>
</head>
<body style="font-family:system-ui;padding:24px">
<h2>غير متاح</h2>
</body>
</html>`, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }

  // ==========================
  // 5) عداد 24 ساعة للسعودية
  // ==========================
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
  data.ts = ksaTsFromNowSec(now);

  if (data.c > MAX_ALLOWED) {

    await store.put(banKey, "1", { expirationTtl: weekSeconds });

    // إضافة فقط: إرسال IP إلى قائمة الاستبعاد
    await pushToAds(ip, "SA");

    await store.put(countKey, JSON.stringify(data), { expirationTtl: weekSeconds });

    return new Response(`<!doctype html>
<html lang="ar">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>غير متاح</title>
</head>
<body style="font-family:system-ui;padding:24px">
<h2>غير متاح</h2>
</body>
</html>`, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }

  await store.put(countKey, JSON.stringify(data), { expirationTtl: windowSeconds });

  // تحديد الصفحة المطلوبة
const page = url.searchParams.get("p");

let target = LANDING_URL;

if (page === "services") target = LANDING_URL + "services";
if (page === "process") target = LANDING_URL + "process";
if (page === "contact") target = LANDING_URL + "contact";

return Response.redirect(target, 302);
}
