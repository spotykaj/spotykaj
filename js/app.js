// Spotykaj MVP (client-only) — LocalStorage demo
const LS_USERS = "spotykaj_users";
const LS_SESSION = "spotykaj_session";
const LS_COINS = "spotykaj_coins";
const LS_MY_ADS = "spotykaj_my_ads";

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
  const needs = document.body?.dataset?.requiresAuth === "true";
  if (!needs) return;
  const s = getSession();
  if (!s) window.location.href = "login.html";
}

function logout() {
  localStorage.removeItem(LS_SESSION);
  window.location.href = "login.html";
}

function seedMyAdsIfEmpty() {
  const ads = readJSON(LS_MY_ADS, null);
  if (ads && ads.length) return;

  const demo = [
    { id: "A1", title: "Ogłoszenie demo #1", status: "Aktywne", city: "Szczecin", woj: "Zachodniopomorskie" },
    { id: "A2", title: "Ogłoszenie demo #2", status: "Wersja robocza", city: "Gdańsk", woj: "Pomorskie" },
  ];
  writeJSON(LS_MY_ADS, demo);
}

function renderMyAds() {
  const wrap = document.getElementById("myAds");
  if (!wrap) return;

  const ads = readJSON(LS_MY_ADS, []);
  if (!ads.length) {
    wrap.innerHTML = `<div class="card"><div class="card-title">Brak ogłoszeń</div><div class="card-text muted">Dodaj pierwsze ogłoszenie.</div></div>`;
    return;
  }

  wrap.innerHTML = ads.map(a => `
    <div class="card">
      <div class="card-title">${a.title}</div>
      <div class="card-text small muted">${a.woj} • ${a.city}</div>
      <div class="card-text"><b>Status:</b> ${a.status}</div>
      <div style="margin-top:10px; display:flex; gap:8px;">
        <button class="btn btn-ghost" disabled>Edytuj</button>
        <button class="btn btn-ghost" disabled>Usuń</button>
      </div>
    </div>
  `).join("");
}

function setupTabs() {
  const buttons = Array.from(document.querySelectorAll(".menu-item"));
  const tabs = {
    ads: document.getElementById("tab-ads"),
    add: document.getElementById("tab-add"),
    settings: document.getElementById("tab-settings"),
  };

  function activate(name) {
    buttons.forEach(b => b.classList.toggle("active", b.dataset.tab === name));
    Object.entries(tabs).forEach(([k, el]) => {
      if (!el) return;
      el.classList.toggle("hidden", k !== name);
    });
  }

  buttons.forEach(btn => {
    btn.addEventListener("click", () => activate(btn.dataset.tab));
  });

  activate("ads");
}

function setupCoins() {
  const coinsEl = document.getElementById("coins");
  const addBtn = document.getElementById("addCoinBtn");
  if (!coinsEl || !addBtn) return;

  let coins = Number(localStorage.getItem(LS_COINS) || "0");
  coinsEl.textContent = String(coins);

  addBtn.addEventListener("click", () => {
    coins += 1;
    localStorage.setItem(LS_COINS, String(coins));
    coinsEl.textContent = String(coins);
  });
}

(function init(){
  requireAuth();

  const s = getSession();
  const userNameEl = document.getElementById("userName");
  if (userNameEl && s?.name) userNameEl.textContent = s.name;

  document.getElementById("logoutBtn")?.addEventListener("click", logout);

  seedMyAdsIfEmpty();
  setupTabs();
  renderMyAds();
  setupCoins();
})();