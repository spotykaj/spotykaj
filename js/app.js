const LS_SESSION = "spotykaj_session";
const LS_MY_ADS = "spotykaj_my_ads";
const LS_TOKENS = "spotykaj_tokens";
const LS_FAVS = "spotykaj_favs";

function readJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function getSession() {
  return readJSON(LS_SESSION, null);
}

function requireAuth() {
  if (document.body.dataset.requiresAuth !== "true") return;
  if (!getSession()) window.location.href = "login.html";
}

function logout() {
  localStorage.removeItem(LS_SESSION);
  window.location.href = "login.html";
}

function seedAdsIfEmpty() {
  const ads = readJSON(LS_MY_ADS, null);
  if (ads && ads.length) return;

  const demo = [
    { id: crypto.randomUUID(), title: "Ogłoszenie demo #1", category: "Budowlane", city: "Szczecin", woj: "Zachodniopomorskie", desc: "", phone: "", type: "Osoba prywatna" },
    { id: crypto.randomUUID(), title: "Ogłoszenie demo #2", category: "Transport", city: "Gdańsk", woj: "Pomorskie", desc: "", phone: "", type: "Firma" }
  ];
  writeJSON(LS_MY_ADS, demo);
}

function renderSidebar() {
  const user = getSession();
  if (user?.name) document.getElementById("userName").textContent = user.name;

  const tokens = localStorage.getItem(LS_TOKENS) || "0";
  document.getElementById("tokenCount").textContent = tokens;

  const favs = readJSON(LS_FAVS, []);
  const favEl = document.getElementById("countFav");
  if (favEl) favEl.textContent = favs.length;

  const offersEl = document.getElementById("countOffers");
  if (offersEl) offersEl.textContent = "0";
}

function renderAds() {
  const wrap = document.getElementById("myAds");
  if (!wrap) return;

  const ads = readJSON(LS_MY_ADS, []);
  document.getElementById("countAds").textContent = ads.length;

  if (!ads.length) {
    wrap.innerHTML = `<div class="box">Nie masz jeszcze ogłoszeń. Przejdź do „Dodaj ogłoszenie”.</div>`;
    return;
  }

  wrap.innerHTML = ads.map(a => `
    <div class="card">
      <div class="card-title">${escapeHtml(a.title)}</div>
      <div class="card-text small muted">${escapeHtml(a.category)} • ${escapeHtml(a.woj)} • ${escapeHtml(a.city)}</div>
      ${a.desc ? `<div class="card-text small">${escapeHtml(a.desc)}</div>` : ``}
      <div class="card-actions">
        <button class="btn btn-ghost" data-action="delete" data-id="${a.id}">Usuń</button>
      </div>
    </div>
  `).join("");

  wrap.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const next = readJSON(LS_MY_ADS, []).filter(x => x.id !== id);
      writeJSON(LS_MY_ADS, next);
      renderAds();
      renderSidebar();
    });
  });
}

function setupTabs() {
  const buttons = document.querySelectorAll(".menu-item");
  const tabs = document.querySelectorAll(".tab");

  const openTab = (name) => {
    buttons.forEach(b => b.classList.toggle("active", b.dataset.tab === name));
    tabs.forEach(t => t.classList.add("hidden"));
    document.getElementById("tab-" + name)?.classList.remove("hidden");
  };

  buttons.forEach(btn => {
    btn.addEventListener("click", () => openTab(btn.dataset.tab));
  });

  return { openTab };
}

function setupAddForm(openTab) {
  const form = document.getElementById("addAdForm");
  if (!form) return;

  const clear = () => {
    form.reset();
  };

  document.getElementById("clearFormBtn")?.addEventListener("click", clear);

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const ad = {
      id: crypto.randomUUID(),
      title: val("adTitle"),
      category: val("adCategory"),
      woj: val("adWoj"),
      city: val("adCity"),
      desc: val("adDesc"),
      phone: val("adPhone"),
      type: val("adAccountType"),
      createdAt: Date.now()
    };

    const ads = readJSON(LS_MY_ADS, []);
    ads.unshift(ad);
    writeJSON(LS_MY_ADS, ads);

    clear();
    renderAds();
    renderSidebar();
    openTab("ads"); // wracamy na listę
  });
}

function val(id) {
  const el = document.getElementById(id);
  return (el?.value ?? "").trim();
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

(function init(){
  requireAuth();
  seedAdsIfEmpty();

  const { openTab } = setupTabs();
  setupAddForm(openTab);

  renderSidebar();
  renderAds();

  document.getElementById("logoutBtn")?.addEventListener("click", logout);
})();