export async function onRequest(context) {
  const { request, env } = context;

  const LANDING_URL = "https://abukhalid.pages.dev/";
  const MAX_ALLOWED = 2;      // يسمح بنقرتين، والثالثة حظر
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
    else if (page === "process") target = LANDING_URL + "process";
    else if (page === "contact") target = LANDING_URL + "contact";

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

  async function logWorkerAttempt(ip, statusText) {
    if (!db || !ip) return;
    try {
      await db.prepare(`
        UPDATE ip_logs
        SET last_push_status = ?
        WHERE ip = ?
      `).bind(statusText, ip).run();
    } catch (err) {
      console.log("logWorkerAttempt failed", String(err));
    }
  }

  function sendIpToWorkerInBackground(ip, country) {
    const workerUrl = env.WORKER_URL;
    const sharedSecret = env.WORKER_SHARED_SECRET;

    if (!workerUrl || !sharedSecret) {
      console.log("Worker config missing", {
        hasWorkerUrl: !!workerUrl,
        hasSharedSecret: !!sharedSecret,
        ip,
        country,
      });

      context.waitUntil(logWorkerAttempt(ip, "worker_config_missing"));
      return;
    }

    const payload = JSON.stringify({ ip, country, ts: now });

    context.waitUntil((async () => {
      try {
        const res = await fetch(workerUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-worker-secret": sharedSecret,
          },
          body: payload,
        });

        const text = await res.text();

        console.log("Worker response", {
          status: res.status,
          ok: res.ok,
          body: text,
          ip,
          country,
        });

        await logWorkerAttempt(ip, `worker_http_${res.status}: ${String(text).slice(0, 200)}`);
      } catch (err) {
        const msg = String(err?.message || err || "unknown worker fetch error");
        console.log("Worker fetch failed", { ip, country, error: msg });
        await logWorkerAttempt(ip, `worker_fetch_failed: ${msg.slice(0, 200)}`);
      }
    })());
  }

  // إزالة k ثم إعادة التوجيه
  // هذا السلوك يبقي منطقك كما هو
  if (url.searchParams.has("k")) {
    url.searchParams.delete("k");
    return Response.redirect(url.toString(), 302);
  }

  if (!db) {
    console.log("DB binding missing in Pages Function");

    if (country === "YE") {
      sendIpToWorkerInBackground(ip, "YE");
      return unavailableHtml("خدمة غير متاحة", "خدمة غير متاحة", 403);
    }

    return Response.redirect(getTargetUrl(), 302);
  }

  let row = null;
  try {
    row = await db.prepare(`SELECT * FROM ip_logs WHERE ip = ?`).bind(ip).first();
  } catch (err) {
    console.log("Failed to read ip_logs", { ip, error: String(err) });
    return new Response("Database read error", { status: 500 });
  }

  // اليمن: حظر مباشر
  if (country === "YE") {
    const shouldSend = !row || Number(row.pushed_to_ads || 0) !== 1;

    try {
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
    } catch (err) {
      console.log("Failed to write YE log", { ip, error: String(err) });
      return new Response("Database write error", { status: 500 });
    }

    if (shouldSend) {
      sendIpToWorkerInBackground(ip, "YE");
    }

    return unavailableHtml("خدمة غير متاحة", "خدمة غير متاحة", 403);
  }

  // غير السعودية
  if (country !== "SA") {
    try {
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
    } catch (err) {
      console.log("Failed to write non-SA log", { ip, error: String(err) });
      return new Response("Database write error", { status: 500 });
    }

    return Response.redirect(getTargetUrl(), 302);
  }

  // السعودية: أول مرة
  if (!row) {
    try {
      await db.prepare(`
        INSERT INTO ip_logs (
          ip, country, clicks, banned, banned_until,
          first_seen, last_seen, last_action, pushed_to_ads, last_push_status
        ) VALUES (?, ?, 1, 0, 0, ?, ?, 'allow_sa', 0, NULL)
      `).bind(ip, country, now, now).run();
    } catch (err) {
      console.log("Failed to insert first SA visit", { ip, error: String(err) });
      return new Response("Database write error", { status: 500 });
    }

    return Response.redirect(getTargetUrl(), 302);
  }

  // محظور مسبقًا
  if (Number(row.banned || 0) === 1 && Number(row.banned_until || 0) > now) {
    try {
      await db.prepare(`
        UPDATE ip_logs
        SET clicks = clicks + 1,
            last_seen = ?,
            last_action = 'blocked_existing'
        WHERE ip = ?
      `).bind(now, ip).run();
    } catch (err) {
      console.log("Failed to update existing blocked SA", { ip, error: String(err) });
    }

    return unavailableHtml("غير متاح", "غير متاح", 200);
  }

  let clicks = Number(row.clicks || 0);
  let firstSeen = Number(row.first_seen || now);
  const pushedToAds = Number(row.pushed_to_ads || 0);

  if ((now - firstSeen) > windowSeconds) {
    clicks = 0;
    firstSeen = now;
  }

  clicks += 1;

  // الثالثة = حظر + إرسال للـ Worker
  if (clicks > MAX_ALLOWED) {
    try {
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
    } catch (err) {
      console.log("Failed to update SA block third", { ip, error: String(err) });
      return new Response("Database write error", { status: 500 });
    }

    if (pushedToAds !== 1) {
      sendIpToWorkerInBackground(ip, "SA");
    }

    return unavailableHtml("غير متاح", "غير متاح", 200);
  }

  // ما زال مسموحًا
  try {
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
  } catch (err) {
    console.log("Failed to update allowed SA", { ip, error: String(err) });
    return new Response("Database write error", { status: 500 });
  }

  return Response.redirect(getTargetUrl(), 302);
}
