export async function onRequest(context) {
  const { request, env } = context;

  const LANDING_URL = "https://abukhalid.pages.dev/";
  const MAX_ALLOWED = 2;      // مرتين فقط
  const WINDOW_HOURS = 24;    // خلال اليوم
  const BAN_HOURS = 168;      // حظر أسبوع

  const store = env.VISITS;
  const url = new URL(request.url);

  // (1) تنظيف k للجميع (تبقي رابط Ads كما هو)
  if (url.searchParams.has("k")) {
    url.searchParams.delete("k");
    return Response.redirect(url.toString(), 302);
  }

  // (2) لا تكسر الوجهة إذا KV غير موجود
  if (!store) return Response.redirect(LANDING_URL, 302);

  // (اختياري) تقييد الحماية على السعودية فقط
  // إذا تريدها على كل الدول: احذف هذا الشرط بالكامل
  const country = request.headers.get("CF-IPCountry") || "XX";
  if (country !== "SA") {
    return Response.redirect(LANDING_URL, 302);
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const banKey = `ban:${country}:${ip}`;
  const countKey = `cnt:${country}:${ip}`;

  // (3) إذا محظور أسبوع -> صفحة 200 ثابتة (بدون 204)
  const banned = await store.get(banKey);
  if (banned) {
    return new Response(`<!doctype html>
<html lang="ar"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>تم تقييد الزيارة</title>
</head><body style="font-family:system-ui;padding:24px">
<h2>تم تقييد الزيارة</h2>
<p>تم استلام زيارتك.</p>
</body></html>`, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // (4) عدّ خلال 24 ساعة
  const now = Math.floor(Date.now() / 1000);
  const windowSeconds = WINDOW_HOURS * 3600;

  let data = { c: 0, t: now };
  const raw = await store.get(countKey);
  if (raw) {
    try { data = JSON.parse(raw); } catch {}
  }

  // إعادة ضبط العداد بعد 24 ساعة
  if (!data.t || (now - data.t) > windowSeconds) {
    data = { c: 0, t: now };
  }

  data.c += 1;

  // (5) إذا تعدّى مرتين -> حظر أسبوع + صفحة 200
  if (data.c > MAX_ALLOWED) {
    await store.put(banKey, "1", { expirationTtl: BAN_HOURS * 3600 });
    await store.delete(countKey);

    return new Response(`<!doctype html>
<html lang="ar"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>تم تقييد الزيارة</title>
</head><body style="font-family:system-ui;padding:24px">

<p>تم استلام زيارتك.</p>
</body></html>`, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // خزّن العداد بمدة 24 ساعة
  await store.put(countKey, JSON.stringify(data), { expirationTtl: windowSeconds });

  // (6) أول مرتين: تحويل للموقع
  return Response.redirect(LANDING_URL, 302);
}
