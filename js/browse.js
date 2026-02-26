// Spotykaj — Browse demo (client-only)

const WOJ = {
  "Mazowieckie": ["Warszawa", "Radom", "Płock"],
  "Pomorskie": ["Gdańsk", "Gdynia", "Sopot"],
  "Zachodniopomorskie": ["Szczecin", "Koszalin", "Świnoujście"],
  "Wielkopolskie": ["Poznań", "Kalisz", "Konin"],
  "Małopolskie": ["Kraków", "Tarnów", "Nowy Sącz"],
};

const DEMO = [
  { id: 1, type: "private", woj: "Zachodniopomorskie", city: "Szczecin", title: "Profil prywatny — usługi lokalne", tags: ["Szczecin", "Usługi"], desc: "Szybko odpowiadam, dojazd w cenie. (demo)" },
  { id: 2, type: "business", woj: "Mazowieckie", city: "Warszawa", title: "Firma — zespół specjalistów", tags: ["Warszawa", "Firma"], desc: "Wiele branż, faktura VAT, terminy od ręki. (demo)" },
  { id: 3, type: "private", woj: "Pomorskie", city: "Gdańsk", title: "Prywatnie — oferta", tags: ["Gdańsk"], desc: "Opis przykładowy ogłoszenia. (demo)" },
  { id: 4, type: "business", woj: "Małopolskie", city: "Kraków", title: "Firma — oferta premium", tags: ["Kraków", "Premium"], desc: "Obsługa biznesu i klientów indywidualnych. (demo)" },
];

const wojEl = document.getElementById("woj");
const cityEl = document.getElementById("city");
const form = document.getElementById("searchForm");
const cards = document.getElementById("cards");
const resultCount = document.getElementById("resultCount");
const resultsHint = document.getElementById("resultsHint");
const toggleAdvanced = document.getElementById("toggleAdvanced");
const advanced = document.getElementById("advanced");

const catEl = document.getElementById("cat");
const typeEl = document.getElementById("type");
const qEl = document.getElementById("q");

function fillWoj() {
  wojEl.innerHTML = `<option value="">Wybierz…</option>` +
    Object.keys(WOJ).map(w => `<option>${w}</option>`).join("");
}

function fillCities(woj) {
  const list = WOJ[woj] || [];
  cityEl.innerHTML = `<option value="">Wybierz…</option>` +
    list.map(c => `<option>${c}</option>`).join("");
}

function badge(type) {
  return type === "business"
    ? `<span class="badge badge-biz">Firma</span>`
    : `<span class="badge badge-private">Prywatne</span>`;
}

function render(items) {
  cards.innerHTML = items.map(x => `
    <article class="card listing">
      <div class="listing-top">
        ${badge(x.type)}
        <span class="muted small">${x.woj} • ${x.city}</span>
      </div>
      <h3 class="listing-title">${x.title}</h3>
      <p class="muted">${x.desc}</p>
      <div class="tagrow">
        ${x.tags.map(t => `<span class="tag">${t}</span>`).join("")}
      </div>
      <div class="listing-actions">
        <a class="btn btn-ghost" href="app.html">Podgląd (demo)</a>
        <button class="btn btn-primary" type="button" onclick="alert('MVP: tu będzie formularz zapytania')">Wyślij zapytanie</button>
      </div>
    </article>
  `).join("");

  resultCount.textContent = String(items.length);
  resultsHint.textContent = items.length ? "Kliknij w kartę albo wyślij zapytanie (MVP)." : "Brak wyników dla wybranych filtrów.";
}

toggleAdvanced?.addEventListener("click", () => {
  advanced.classList.toggle("hidden");
  toggleAdvanced.textContent = advanced.classList.contains("hidden") ? "Pokaż filtry" : "Ukryj filtry";
});

wojEl?.addEventListener("change", () => fillCities(wojEl.value));

form?.addEventListener("submit", (e) => {
  e.preventDefault();

  const woj = wojEl.value;
  const city = cityEl.value;
  const type = typeEl?.value || "";
  const q = (qEl?.value || "").toLowerCase().trim();

  let items = DEMO.slice();

  if (woj) items = items.filter(x => x.woj === woj);
  if (city) items = items.filter(x => x.city === city);
  if (type) items = items.filter(x => x.type === type);
  if (q) items = items.filter(x =>
    (x.title + " " + x.desc + " " + x.tags.join(" ")).toLowerCase().includes(q)
  );

  render(items);
});

// init
fillWoj();
fillCities("");
render([]); // start empty