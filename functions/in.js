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

  // ===== ترقيم عالمي يزيد فقط عند "حظر جديد" =====
  async function nextSeq() {
    const key = "global:seq";
    let n = 0;
    const raw = await store.get(key);
    if (raw) {
      const parsed = parseInt(raw, 10);
      if (!Number.isNaN(parsed)) n = parsed;
    }
    n += 1;
    await store.put(key, String(n)); // بدون TTL (يبقى محفوظ دائمًا)
    return n;
  }

  // ==========================
  // 1) اليمن: حظر مباشر أسبوع + عداد + seq عند أول حظر فقط
  // ==========================
  if (country === "YE") {

    if (store) {
      const banKey = `ban:YE:${ip}`;
      const logKey = `log:YE:${ip}`;

      // هل هو محظور من قبل؟ (عشان ما نزيد seq كل مرة)
      const alreadyBanned = await store.get(banKey);

      let seq;
      if (!alreadyBanned) {
        seq = await nextSeq(); // حظر جديد -> رقم جديد
      }

      // ضع الحظر أسبوع (حتى لو كان موجود نحدث TTL)
      await store.put(banKey, "1", { expirationTtl: weekSeconds });

      // عداد المحاولات
      let data = { c: 0, t: now };
      const raw = await store.get(logKey);
      if (raw) {
        try { data = JSON.parse(raw); } catch {}
      }

      data.c = (data.c || 0) + 1;
      data.t = now;

      // خزّن seq فقط إذا كان هذا "حظر جديد"
      if (seq !== undefined) data.seq = seq;

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
  // 4) إذا محظور → زد العداد وأعد صفحة المنع (بدون seq)
  // ==========================
  const banned = await store.get(banKey);
  if (banned) {

    // زيادة عداد المحاولات أثناء الحظر
    let data = { c: 0, t: now };
    const raw = await store.get(countKey);
    if (raw) {
      try { data = JSON.parse(raw); } catch {}
    }

    data.c = (data.c || 0) + 1;
    data.t = now;

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

  if (data.c > MAX_ALLOWED) {
    // حظر جديد للسعودية -> seq جديد
    const seq = await nextSeq();

    await store.put(banKey, "1", { expirationTtl: weekSeconds });

    // نخزن نفس سجل العداد لكن نخليه يعيش أسبوع بعد الحظر + نضيف seq
    data.seq = seq;
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
