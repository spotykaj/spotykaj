// Spotykaj MVP Auth Demo (Client-only)
// Speichert User + Session im localStorage.
// NICHT für Produktion. Später ersetzen wir das durch echtes Backend (z.B. Supabase).

const LS_USERS = "spotykaj_users";
const LS_SESSION = "spotykaj_session";

function loadUsers() {
  try { return JSON.parse(localStorage.getItem(LS_USERS) || "[]"); }
  catch { return []; }
}
function saveUsers(users) {
  localStorage.setItem(LS_USERS, JSON.stringify(users));
}
function getSession() {
  try { return JSON.parse(localStorage.getItem(LS_SESSION) || "null"); }
  catch { return null; }
}
function setSession(session) {
  localStorage.setItem(LS_SESSION, JSON.stringify(session));
}
function clearSession() {
  localStorage.removeItem(LS_SESSION);
}

function byId(id) { return document.getElementById(id); }

function redirectIfAuth() {
  const s = getSession();
  if (s?.user?.email) window.location.href = "app.html";
}
function requireAuth() {
  const s = getSession();
  if (!s?.user?.email) window.location.href = "login.html";
}

function showMsg(text, ok = false) {
  const el = byId("msg");
  if (!el) return;
  el.textContent = text;
  el.className = "msg " + (ok ? "ok" : "err");
}

function hashLike(pw) {
  // Mini-Hash für Demo (kein Security!). Nur damit nicht klartext.
  let h = 0;
  for (let i = 0; i < pw.length; i++) h = (h * 31 + pw.charCodeAt(i)) >>> 0;
  return String(h);
}

// --- Bootstrapping je Seite ---
document.addEventListener("DOMContentLoaded", () => {
  const body = document.body;

  if (body.dataset.redirectIfAuth === "true") redirectIfAuth();
  if (body.dataset.requiresAuth === "true") requireAuth();

  const loginForm = byId("loginForm");
  const registerForm = byId("registerForm");

  if (registerForm) {
    registerForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = byId("name").value.trim();
      const email = byId("email").value.trim().toLowerCase();
      const password = byId("password").value;

      if (!name || !email || !password) return showMsg("Bitte alle Felder ausfüllen.");

      const users = loadUsers();
      if (users.some(u => u.email === email)) return showMsg("Diese E-Mail ist schon registriert.");

      const user = {
        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
        name,
        email,
        pw: hashLike(password),
        coins: 0,
        createdAt: new Date().toISOString()
      };

      users.push(user);
      saveUsers(users);

      setSession({ user: { id: user.id, name: user.name, email: user.email } });
      showMsg("Account erstellt. Weiterleitung…", true);
      setTimeout(() => (window.location.href = "app.html"), 600);
    });
  }

  if (loginForm) {
    loginForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const email = byId("email").value.trim().toLowerCase();
      const password = byId("password").value;

      const users = loadUsers();
      const user = users.find(u => u.email === email);

      if (!user) return showMsg("User nicht gefunden.");
      if (user.pw !== hashLike(password)) return showMsg("Passwort falsch.");

      setSession({ user: { id: user.id, name: user.name, email: user.email } });
      showMsg("Login OK. Weiterleitung…", true);
      setTimeout(() => (window.location.href = "app.html"), 400);
    });
  }

  // App-Seite
  const logoutBtn = byId("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      clearSession();
      window.location.href = "login.html";
    });
  }

  const userName = byId("userName");
  if (userName) {
    const s = getSession();
    userName.textContent = s?.user?.name || "User";
  }

  const coinsEl = byId("coins");
  const addCoinBtn = byId("addCoinBtn");
  if (coinsEl && addCoinBtn) {
    const s = getSession();
    const users = loadUsers();
    const idx = users.findIndex(u => u.id === s?.user?.id);
    if (idx >= 0) coinsEl.textContent = String(users[idx].coins || 0);

    addCoinBtn.addEventListener("click", () => {
      const s2 = getSession();
      const users2 = loadUsers();
      const i2 = users2.findIndex(u => u.id === s2?.user?.id);
      if (i2 < 0) return;
      users2[i2].coins = (users2[i2].coins || 0) + 1;
      saveUsers(users2);
      coinsEl.textContent = String(users2[i2].coins);
    });
  }
});