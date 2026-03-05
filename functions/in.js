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

  // ===== ترقيم عالمي =====
  async function nextSeq() {
    const key = "Global:seq"; // نفس اللي ظهر عندك
    let n = 0;
    const raw = await store.get(key);
    if (raw) {
      const parsed = parseInt(raw, 10);
      if (!Number.isNaN(parsed)) n = parsed;
    }
    n += 1;
    await store.put(key, String(n)); // بدون TTL
    return n;
  }

  // يضمن وجود seq داخل السجل (بدون تغيير c/t)
  async function ensureSeq(data) {
    if (data && data.seq !== undefined && data.seq !== null) return data;
    const seq = await nextSeq();
    return { ...(data || {}), seq };
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

      // عداد المحاولات
      let data = { c: 0, t: now };
      const raw = await store.get(logKey);
      if (raw) {
        try { data = JSON.parse(raw); } catch {}
      }

      data.c = (data.c || 0) + 1;
      data.t = now;

      // أضف seq لأول مرة فقط (أو إذا كان سجل قديم بدون seq)
      data = await ensureSeq(data);

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

    let data = { c: 0, t: now };
    const raw = await store.get(countKey);
    if (raw) {
      try { data = JSON.parse(raw); } catch {}
    }

    data.c = (data.c || 0) + 1;
    data.t = now;

    // أضف seq إن لم يكن موجود (لا يغيّر الحظر)
    data = await ensureSeq(data);

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

  data.c = (data.c || 0) + 1;

  // أضف seq لأول مرة فقط (أو لو سجل قديم بدون seq)
  data = await ensureSeq(data);

  if (data.c > MAX_ALLOWED) {
    await store.put(banKey, "1", { expirationTtl: weekSeconds });

    // بعد الحظر نخلي سجل العداد يعيش أسبوع
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

  return Response.redirect(LANDING_URL, 302);
}
