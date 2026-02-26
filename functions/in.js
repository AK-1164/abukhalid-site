// functions/in.js

export async function onRequest(context) {
  const { request, env } = context;

  // ====== (1) إعدادات سهلة للتعديل ======
  const LANDING_URL = "https://abukhalid.pages.dev/"; // <-- (غيّر الرابط هنا فقط إذا تبغى صفحة ثانية)
  const MAX_ALLOWED = 2;            // <-- (غيّر العدد هنا)
  const WINDOW_HOURS = 24;          // <-- (غيّر نافذة العد هنا بالساعات)
  const BAN_HOURS = 168;            // <-- (غيّر مدة الحظر هنا بالساعات) 168=7 أيام

  // ====== (2) حظر أي زائر خارج السعودية ======
  const country = (request.headers.get("CF-IPCountry") || "").toUpperCase();
  if (country && country !== "SA") {
    return new Response("Access denied.", { status: 403 });
  }

  // ====== (3) هوية الزائر: IP فقط (أقوى منع عملي) ======
  const ip = request.headers.get("CF-Connecting-IP") || "";
  if (!ip) return new Response("Forbidden.", { status: 403 });

  const store = env.VISITS; // لازم تربط KV باسم VISITS
  if (!store) return new Response("Server not configured (VISITS).", { status: 500 });

  const banKey = `ban:${ip}`;
  const countKey = `cnt:${ip}`;

  // ====== (4) إذا محظور: امنعه فورًا ======
  const banned = await store.get(banKey);
  if (banned) {
    return new Response("تم حظر الدخول.", { status: 403 });
  }

  // ====== (5) عدّاد مرتين فقط خلال WINDOW_HOURS ======
  const nowSec = Math.floor(Date.now() / 1000);
  const windowSec = WINDOW_HOURS * 3600;

  let data = { c: 0, t: nowSec };
  const raw = await store.get(countKey);
  if (raw) {
    try { data = JSON.parse(raw); } catch {}
  }

  // لو انتهت نافذة العد، نبدأ من جديد
  if (!data.t || (nowSec - data.t) > windowSec) {
    data = { c: 0, t: nowSec };
  }

  data.c += 1;

  // ====== (6) تجاوز الحد؟ حظر لمدة BAN_HOURS ثم منع ======
  if (data.c > MAX_ALLOWED) {
    await store.put(banKey, "1", { expirationTtl: BAN_HOURS * 3600 });
    await store.delete(countKey);
    return new Response("تم حظر الدخول بسبب تكرار الدخول.", { status: 403 });
  }

  // خزّن العداد حتى نهاية نافذة العد
  await store.put(countKey, JSON.stringify(data), { expirationTtl: windowSec });

  // ====== (7) السماح والتحويل للموقع ======
  return Response.redirect(LANDING_URL, 302);
}
