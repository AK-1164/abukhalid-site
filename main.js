// ==========================
// WhatsApp configuration
// ==========================
// ضع رقم الواتساب بصيغة دولية بدون + أو مسافات
// مثال: 9665XXXXXXXX
const WHATSAPP_NUMBER = "966501728829"; // <-- غيّر الرقم هنا

const defaultMsg = encodeURIComponent(
  "السلام عليكم، أحتاج خدمة من مكتب أبو خالد.\n" +
  "نوع الخدمة: \n" +
  "داخل/خارج المملكة: \n" +
  "المدينة: \n" +
  "ملاحظة:"
);

function waLink(msg){
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${msg || defaultMsg}`;
}

// ==========================
// Google Ads conversion tracking (WhatsApp)
// ==========================
// ✅ استبدل REPLACE_WITH_LABEL بالـ label الذي سيظهر لك في Event snippet داخل Google Ads
// مثال: "AW-17529333980/AbCdEfGhIjKlMnOpQr"
const ADS_SEND_TO = "AW-17529333980/oLGfCJD_poAcENzR0aZB";

function trackWhatsAppConversion(){
  try {
    if (typeof gtag === "function" && ADS_SEND_TO.includes("/")) {
      gtag("event", "conversion", { send_to: ADS_SEND_TO });
    }
  } catch (e) {}
}

// ربط تتبع التحويل على كل أزرار الواتساب الموجودة في الصفحة
function bindWhatsAppTracking(){
  const ids = ["waHero","waOffer","waServices","waContact","waQuote","waFloat"];
  ids.forEach(id=>{
    const el = document.getElementById(id);
    if(!el) return;
    el.addEventListener("click", () => {
      trackWhatsAppConversion();
    });
  });
}

// ==========================
// Bind WhatsApp buttons
// ==========================
// ربط كل أزرار الواتساب الموجودة في الصفحة
function bindWhatsAppButtons(){
  const ids = ["waHero","waOffer","waServices","waContact","waQuote","waFloat"];
  ids.forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.href = waLink();
  });
}

// ==========================
// Drawer controls
// ==========================
function setupDrawer(){
  const body = document.body;
  const openDrawer = document.getElementById("openDrawer");
  const closeDrawer = document.getElementById("closeDrawer");
  const backdrop = document.getElementById("drawerBackdrop");

  if(!openDrawer || !closeDrawer || !backdrop) return;

  function openMenu(){ body.classList.add("drawerOpen"); }
  function closeMenu(){ body.classList.remove("drawerOpen"); }
  window.closeMenu = closeMenu;

  openDrawer.addEventListener("click", openMenu);
  closeDrawer.addEventListener("click", closeMenu);
  backdrop.addEventListener("click", closeMenu);
}

// ==========================
// Contact form -> WhatsApp
// ==========================
function setupContactForm(){
  const form = document.getElementById("serviceForm");
  const fillExample = document.getElementById("fillExample");
  if(!form) return;

  function buildMsg(){
    const name = document.getElementById("name").value.trim();
    const city = document.getElementById("city").value.trim();
    const service = document.getElementById("service").value;
    const where = document.getElementById("where").value;
    const note = document.getElementById("note").value.trim();

    const msg =
`السلام عليكم، أنا ${name}.
أحتاج خدمة من مكتب أبو خالد.

• نوع الخدمة: ${service}
• داخل/خارج المملكة: ${where}
• المدينة: ${city}
• ملاحظات: ${note || "لا يوجد"}

(أرغب في استشارة مجانية + طلب عرض سعر، وخصم 25% إن أمكن)`;

    return encodeURIComponent(msg);
  }

  form.addEventListener("submit", (e)=>{
    e.preventDefault();

    const name = document.getElementById("name").value.trim();
    const city = document.getElementById("city").value.trim();
    const service = document.getElementById("service").value;
    const where = document.getElementById("where").value;

    if(!name || !city || !service || !where){
      alert("فضلاً عبّئ الاسم والمدينة ونوع الخدمة وداخل/خارج المملكة.");
      return;
    }

    // ✅ سجل تحويل واتساب عند إرسال النموذج أيضاً
    trackWhatsAppConversion();

    window.open(waLink(buildMsg()), "_blank", "noopener");
  });

  if(fillExample){
    fillExample.addEventListener("click", ()=>{
      document.getElementById("name").value = "محمد";
      document.getElementById("city").value = "الرياض";
      document.getElementById("service").value = "انجاز اجراءات زواج (سعودي من أجنبية)";
      document.getElementById("where").value = "داخل المملكة";
      document.getElementById("note").value = "أحتاج معرفة المتطلبات وطريقة التقديم والمتابعة.";
    });
  }
}

// Year
function setYear(){
  const y = document.getElementById("year");
  if(y) y.textContent = new Date().getFullYear();
}

document.addEventListener("DOMContentLoaded", ()=>{
  bindWhatsAppButtons();
  bindWhatsAppTracking(); // ✅ جديد
  setupDrawer();
  setupContactForm();
  setYear();
});