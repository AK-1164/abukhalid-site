export async function onRequest(context) {
  const { request, env } = context;

  const LANDING_URL = "https://abukhalid.pages.dev/";
  const MAX_ALLOWED = 2;      // مرتين فقط للسعودية، والثالثة حظر
  const WINDOW_HOURS = 24;    // خلال 24 ساعة
  const BAN_HOURS = 168;      // حظر أسبوع

  const db = env.DB;
  const url = new URL(request.url);

  const country = request.headers.get("CF-IPCountry") || "XX";
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";

  const now = Math.floor(Date.now() / 1000);
  const weekSeconds = BAN_HOURS * 3600;
  const windowSeconds = WINDOW_HOURS * 3600;

  function getTargetUrl() {
    const page = url.searchParams.get("p");

    let target = LANDING_URL;

    if (page === "services") target = LANDING_URL + "services";
    if (page === "process") target = LANDING_URL + "process";
    if (page === "contact") target = LANDING_URL + "contact";

    return target;
  }

  function unavailableHtml(title, message, status = 200) {
    return new Response(`<!doctype html>
<html lang="ar">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
</head>
<body style="font-family:system-ui;padding:24px">
<h2>${message}</h2>
</body>
</html>`, {
      status,
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }

  // إرسال خلفي سريع إلى worker بدون تعطيل العميل
  function sendIpToWorkerInBackground(ip, country) {
    const workerUrl = env.WORKER_URL;
    const sharedSecret = env.WORKER_SHARED_SECRET;

    if (!workerUrl || !sharedSecret) return;

    const payload = JSON.stringify({ ip, country, ts: now });

    context.waitUntil(
      fetch(workerUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-worker-secret": sharedSecret,
        },
        body: payload,
      }).catch(() => {})
    );
  }

  // تنظيف k أولًا
  if (url.searchParams.has("k")) {
    url.searchParams.delete("k");
    return Response.redirect(url.toString(), 302);
  }

  // إذا لم يكن DB موجودًا لا نكسر الموقع
  if (!db) {
    if (country === "YE") {
      sendIpToWorkerInBackground(ip, "YE");
      return unavailableHtml("خدمة غير متاحة", "خدمة غير متاحة", 403);
    }
    return Response.redirect(getTargetUrl(), 302);
  }

  // اجلب السجل الحالي إن وجد
  const row = await db
    .prepare(`SELECT * FROM ip_logs WHERE ip = ?`)
    .bind(ip)
    .first();

  // اليمن: حظر مباشر دائمًا
  if (country === "YE") {
    const shouldSend = !row || Number(row.pushed_to_ads || 0) !== 1;

    if (!row) {
      await db.prepare(`
        INSERT INTO ip_logs (
          ip, country, clicks, banned, banned_until,
          first_seen, last_seen, last_action, pushed_to_ads, last_push_status
        ) VALUES (?, ?, 1, 1, ?, ?, ?, 'ye_block', 0, 'pending')
      `).bind(ip, country, now + weekSeconds, now, now).run();
    } else {
      await db.prepare(`
        UPDATE ip_logs
        SET country = ?,
            clicks = clicks + 1,
            banned = 1,
            banned_until = ?,
            last_seen = ?,
            last_action = 'ye_block',
            last_push_status = CASE
              WHEN pushed_to_ads = 1 THEN last_push_status
              ELSE 'pending'
            END
        WHERE ip = ?
      `).bind(country, now + weekSeconds, now, ip).run();
    }

    if (shouldSend) {
      sendIpToWorkerInBackground(ip, "YE");
    }

    return unavailableHtml("خدمة غير متاحة", "خدمة غير متاحة", 403);
  }

  // غير السعودية: دخول عادي مع تسجيل بسيط
  if (country !== "SA") {
    if (!row) {
      await db.prepare(`
        INSERT INTO ip_logs (
          ip, country, clicks, banned, banned_until,
          first_seen, last_seen, last_action, pushed_to_ads, last_push_status
        ) VALUES (?, ?, 1, 0, 0, ?, ?, 'allow_non_sa', 0, NULL)
      `).bind(ip, country, now, now).run();
    } else {
      await db.prepare(`
        UPDATE ip_logs
        SET country = ?,
            clicks = clicks + 1,
            last_seen = ?,
            last_action = 'allow_non_sa'
        WHERE ip = ?
      `).bind(country, now, ip).run();
    }

    return Response.redirect(getTargetUrl(), 302);
  }

  // السعودية
  if (!row) {
    await db.prepare(`
      INSERT INTO ip_logs (
        ip, country, clicks, banned, banned_until,
        first_seen, last_seen, last_action, pushed_to_ads, last_push_status
      ) VALUES (?, ?, 1, 0, 0, ?, ?, 'allow_sa', 0, NULL)
    `).bind(ip, country, now, now).run();

    return Response.redirect(getTargetUrl(), 302);
  }

  // إذا محظور مسبقًا وما زال الحظر ساريًا
  if (Number(row.banned || 0) === 1 && Number(row.banned_until || 0) > now) {
    await db.prepare(`
      UPDATE ip_logs
      SET clicks = clicks + 1,
          last_seen = ?,
          last_action = 'blocked_existing'
      WHERE ip = ?
    `).bind(now, ip).run();

    return unavailableHtml("غير متاح", "غير متاح", 200);
  }

  // إذا انتهت نافذة الـ 24 ساعة، نعيد العداد
  let clicks = Number(row.clicks || 0);
  let firstSeen = Number(row.first_seen || now);
  let pushedToAds = Number(row.pushed_to_ads || 0);

  if ((now - firstSeen) > windowSeconds) {
    clicks = 0;
    firstSeen = now;
  }

  clicks += 1;

  // الثالثة = حظر مباشر
  if (clicks > MAX_ALLOWED) {
    await db.prepare(`
      UPDATE ip_logs
      SET country = ?,
          clicks = ?,
          banned = 1,
          banned_until = ?,
          first_seen = ?,
          last_seen = ?,
          last_action = 'sa_block_third',
          last_push_status = CASE
            WHEN pushed_to_ads = 1 THEN last_push_status
            ELSE 'pending'
          END
      WHERE ip = ?
    `).bind(country, clicks, now + weekSeconds, firstSeen, now, ip).run();

    if (pushedToAds !== 1) {
      sendIpToWorkerInBackground(ip, "SA");
    }

    return unavailableHtml("غير متاح", "غير متاح", 200);
  }

  // ما زال مسموحًا
  await db.prepare(`
    UPDATE ip_logs
    SET country = ?,
        clicks = ?,
        banned = 0,
        banned_until = 0,
        first_seen = ?,
        last_seen = ?,
        last_action = 'allow_sa'
    WHERE ip = ?
  `).bind(country, clicks, firstSeen, now, ip).run();

  return Response.redirect(getTargetUrl(), 302);
}
