const LS_MY_ADS = "spotykaj_my_ads";

function readJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}

function getIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id");
}

function renderAd() {
  const id = getIdFromUrl();
  const ads = readJSON(LS_MY_ADS, []);
  const ad = ads.find(x => x.id === id);
  const wrap = document.getElementById("adDetail");

  if (!ad) {
    wrap.innerHTML = `<h1>Ogłoszenie nie zostało znalezione</h1>`;
    return;
  }

  wrap.innerHTML = `
    <h1>${ad.title}</h1>
    <p class="muted">${ad.category} • ${ad.woj} • ${ad.city}</p>

    <div class="grid2" style="margin-top:20px;">
      <div class="card">
        <div class="card-title">Typ konta</div>
        <div class="card-text">${ad.type || "Brak danych"}</div>
      </div>

      <div class="card">
        <div class="card-title">Telefon</div>
        <div class="card-text">${ad.phone || "Nie podano"}</div>
      </div>
    </div>

    <div class="card" style="margin-top:20px;">
      <div class="card-title">Opis</div>
      <div class="card-text">${ad.desc || "Brak opisu"}</div>
    </div>

    <div style="margin-top:20px;">
      <a href="przegladaj.html" class="btn btn-primary">Powrót do ogłoszeń</a>
    </div>
  `;
}

renderAd();