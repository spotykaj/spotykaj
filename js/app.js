const LS_SESSION = "spotykaj_session";
const LS_MY_ADS = "spotykaj_my_ads";
const LS_TOKENS = "spotykaj_tokens";

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
    { title: "Ogłoszenie demo #1", city: "Szczecin", woj: "Zachodniopomorskie" },
    { title: "Ogłoszenie demo #2", city: "Gdańsk", woj: "Pomorskie" }
  ];

  writeJSON(LS_MY_ADS, demo);
}

function renderAds() {
  const wrap = document.getElementById("myAds");
  if (!wrap) return;

  const ads = readJSON(LS_MY_ADS, []);
  wrap.innerHTML = ads.map(a => `
    <div class="card">
      <div class="card-title">${a.title}</div>
      <div class="card-text small muted">${a.woj} • ${a.city}</div>
    </div>
  `).join("");

  document.getElementById("countAds").textContent = ads.length;
}

function renderSidebar() {
  const user = getSession();
  if (user?.name) {
    document.getElementById("userName").textContent = user.name;
  }

  const tokens = localStorage.getItem(LS_TOKENS) || "0";
  document.getElementById("tokenCount").textContent = tokens;
}

function setupTabs() {
  const buttons = document.querySelectorAll(".menu-item");
  const tabs = document.querySelectorAll(".tab");

  buttons.forEach(btn => {
    btn.addEventListener("click", () => {

      buttons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      tabs.forEach(t => t.classList.add("hidden"));
      document.getElementById("tab-" + btn.dataset.tab)
        .classList.remove("hidden");

    });
  });
}

(function init(){
  requireAuth();
  seedAdsIfEmpty();
  renderSidebar();
  renderAds();
  setupTabs();
  document.getElementById("logoutBtn")
    ?.addEventListener("click", logout);
})();