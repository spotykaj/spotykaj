// js/app.js — Spotykaj Auth-Demo (Frontend only)
// Speichert "Login" in localStorage. KEIN echtes Backend / keine echte Sicherheit.

const AUTH_KEY = "spotykaj_auth_v1";

function getAuth() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY) || "null");
  } catch {
    return null;
  }
}

function setAuth(authObj) {
  localStorage.setItem(AUTH_KEY, JSON.stringify(authObj));
}

function clearAuth() {
  localStorage.removeItem(AUTH_KEY);
}

function isLoggedIn() {
  const a = getAuth();
  return !!(a && a.loggedIn && a.email);
}

function $(id) {
  return document.getElementById(id);
}

/**
 * Page Guard:
 * - Setze <body data-requires-auth="true"> auf Seiten die Login brauchen (z.B. dashboard.html)
 * - Setze <body data-redirect-if-auth="true"> auf login/register (wenn schon eingeloggt -> dashboard)
 */
function applyGuards() {
  const body = document.body;
  const requiresAuth = body.dataset.requiresAuth === "true";
  const redirectIfAuth = body.dataset.redirectIfAuth === "true";

  if (requiresAuth && !isLoggedIn()) {
    // Merken wo man hinwollte
    sessionStorage.setItem("spotykaj_return_to", location.pathname.split("/").pop() || "index.html");
    location.replace("login.html");
    return;
  }

  if (redirectIfAuth && isLoggedIn()) {
    location.replace("dashboard.html");
    return;
  }
}

function renderNavbarState() {
  // Optional: Bereiche in HTML per ID steuern
  // <span id="navUser"></span> / <a id="navLogout" ...>
  const navUser = $("navUser");
  const navLogout = $("navLogout");
  const navLogin = $("navLogin");
  const navRegister = $("navRegister");

  const a = getAuth();

  if (isLoggedIn()) {
    if (navUser) navUser.textContent = a.email;
    if (navLogout) navLogout.style.display = "inline-block";
    if (navLogin) navLogin.style.display = "none";
    if (navRegister) navRegister.style.display = "none";
  } else {
    if (navUser) navUser.textContent = "";
    if (navLogout) navLogout.style.display = "none";
    if (navLogin) navLogin.style.display = "inline-block";
    if (navRegister) navRegister.style.display = "inline-block";
  }
}

function wireLogout() {
  const btn = $("navLogout");
  if (!btn) return;

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    clearAuth();
    location.replace("index.html");
  });
}

function wireLoginForm() {
  // Erwartet Form:
  // <form id="loginForm">
  //  <input id="loginEmail">
  //  <input id="loginPassword">
  // </form>
  const form = $("loginForm");
  if (!form) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const email = ($("loginEmail")?.value || "").trim().toLowerCase();
    const pass = $("loginPassword")?.value || "";

    const err = $("loginError");
    if (err) err.textContent = "";

    if (!email || !pass) {
      if (err) err.textContent = "Bitte E-Mail und Passwort eingeben.";
      return;
    }

    // Demo: "erfolgreich" einloggen (wir prüfen nix echt)
    setAuth({
      loggedIn: true,
      email,
      loginAt: new Date().toISOString(),
    });

    const returnTo = sessionStorage.getItem("spotykaj_return_to") || "dashboard.html";
    sessionStorage.removeItem("spotykaj_return_to");

    location.replace(returnTo);
  });
}

function wireRegisterForm() {
  // Erwartet Form:
  // <form id="registerForm">
  //  <input id="regEmail">
  //  <input id="regPassword">
  //  <input id="regPassword2">
  // </form>
  const form = $("registerForm");
  if (!form) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const email = ($("regEmail")?.value || "").trim().toLowerCase();
    const p1 = $("regPassword")?.value || "";
    const p2 = $("regPassword2")?.value || "";

    const err = $("registerError");
    if (err) err.textContent = "";

    if (!email || !p1 || !p2) {
      if (err) err.textContent = "Bitte alle Felder ausfüllen.";
      return;
    }
    if (p1.length < 6) {
      if (err) err.textContent = "Passwort muss mind. 6 Zeichen haben (Demo-Regel).";
      return;
    }
    if (p1 !== p2) {
      if (err) err.textContent = "Passwörter stimmen nicht überein.";
      return;
    }

    // Demo: wir "registrieren" nicht wirklich, wir loggen direkt ein
    setAuth({
      loggedIn: true,
      email,
      signupAt: new Date().toISOString(),
    });

    location.replace("dashboard.html");
  });
}

document.addEventListener("DOMContentLoaded", () => {
  applyGuards();
  renderNavbarState();
  wireLogout();
  wireLoginForm();
  wireRegisterForm();
});