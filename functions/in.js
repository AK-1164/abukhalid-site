export async function onRequest(context) {
  const { request, env } = context;

  const LANDING_URL = "https://abukhalid.pages.dev/";
  const store = env.VISITS;
  const url = new URL(request.url);

  const country = request.headers.get("CF-IPCountry") || "XX";
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";

  const now = Math.floor(Date.now() / 1000);
  const weekSeconds = 7 * 24 * 3600;

  function getTargetUrl() {
    const page = url.searchParams.get("p");

    let target = LANDING_URL;

    if (page === "services") target = LANDING_URL + "services";
    if (page === "process") target = LANDING_URL + "process";
    if (page === "contact") target = LANDING_URL + "contact";

    return target;
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
      })
        .then(async (res) => {
          // إذا فشل worker أو رفض الطلب، خزّن push احتياطيًا في KV إن كان متاحًا
          if (!res.ok && store) {
            const key = `push:${now}:${country}:${ip}`;
            await store.put(key, "1", { expirationTtl: weekSeconds });
          }
        })
        .catch(async () => {
          // إذا فشل الاتصال نهائيًا، خزّن push احتياطيًا في KV إن كان متاحًا
          if (store) {
            const key = `push:${now}:${country}:${ip}`;
            await store.put(key, "1", { expirationTtl: weekSeconds });
          }
        })
    );
  }

  // فحص IP عبر Durable Object
  async function checkIpWithDurableObject() {
    const doWorkerUrl = env.DO_WORKER_URL;
    const sharedSecret = env.WORKER_SHARED_SECRET;

    if (!doWorkerUrl || !sharedSecret) return null;

    try {
      const res = await fetch(`${doWorkerUrl}/do-check`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-worker-secret": sharedSecret,
        },
        body: JSON.stringify({ ip, country }),
      });

      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  // تنظيف k أولًا
  if (url.searchParams.has("k")) {
    url.searchParams.delete("k");
    return Response.redirect(url.toString(), 302);
  }

  // القرار الأساسي من Durable Object
  const doResult = await checkIpWithDurableObject();

  // إذا تعذر Durable Object، لا نكسر الموقع
  if (!doResult) {
    return Response.redirect(getTargetUrl(), 302);
  }

  // اليمن: حظر مباشر + استبعاد
  if (doResult.action === "ban" && doResult.reason === "YE") {
    sendIpToWorkerInBackground(ip, "YE");

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

  // غير السعودية: دخول عادي
  if (country !== "SA" && doResult.action === "allow") {
    return Response.redirect(getTargetUrl(), 302);
  }

  // السعودية: محظور مسبقًا
  if (doResult.action === "ban" && doResult.reason === "already_banned") {
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

  // السعودية: تجاوز الحد
  if (doResult.action === "ban" && doResult.reason === "too_many_clicks") {
    sendIpToWorkerInBackground(ip, "SA");

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

  // الباقي: دخول عادي
  return Response.redirect(getTargetUrl(), 302);
}
