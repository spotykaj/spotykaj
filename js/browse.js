const LS_MY_ADS = "spotykaj_my_ads";

function readJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}

function renderAds(list) {
  const wrap = document.getElementById("results");

  if (!list.length) {
    wrap.innerHTML = `<div class="box">Brak wyników</div>`;
    return;
  }

  wrap.innerHTML = list.map(a => `
    <div class="card">
      <div class="card-title">${a.title}</div>
      <div class="card-text small muted">
        ${a.category} • ${a.woj} • ${a.city}
      </div>
      <div class="card-text small">
        ${a.desc || ""}
      </div>
    </div>
  `).join("");
}

function search() {
  const woj = document.getElementById("filterWoj").value;
  const city = document.getElementById("filterCity").value.toLowerCase();

  let ads = readJSON(LS_MY_ADS, []);

  ads = ads.filter(a => {
    return (
      (!woj || a.woj === woj) &&
      (!city || a.city.toLowerCase().includes(city))
    );
  });

  renderAds(ads);
}

(function init(){
  const ads = readJSON(LS_MY_ADS, []);
  renderAds(ads);

  document.getElementById("searchBtn").addEventListener("click", search);
})();