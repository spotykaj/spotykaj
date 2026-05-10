const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { initDb, run, get } = require('../src/db');

const regions = [
  ['Dolnośląskie', ['Wrocław', 'Legnica', 'Wałbrzych']],
  ['Kujawsko-pomorskie', ['Bydgoszcz', 'Toruń', 'Włocławek']],
  ['Lubelskie', ['Lublin', 'Zamość', 'Chełm']],
  ['Lubuskie', ['Zielona Góra', 'Gorzów Wielkopolski']],
  ['Łódzkie', ['Łódź', 'Piotrków Trybunalski', 'Pabianice']],
  ['Małopolskie', ['Kraków', 'Tarnów', 'Nowy Sącz']],
  ['Mazowieckie', ['Warszawa', 'Radom', 'Płock']],
  ['Opolskie', ['Opole', 'Kędzierzyn-Koźle']],
  ['Podkarpackie', ['Rzeszów', 'Przemyśl', 'Mielec']],
  ['Podlaskie', ['Białystok', 'Łomża', 'Suwałki']],
  ['Pomorskie', ['Gdańsk', 'Gdynia', 'Sopot']],
  ['Śląskie', ['Katowice', 'Gliwice', 'Częstochowa']],
  ['Świętokrzyskie', ['Kielce', 'Ostrowiec Świętokrzyski']],
  ['Warmińsko-mazurskie', ['Olsztyn', 'Elbląg', 'Ełk']],
  ['Wielkopolskie', ['Poznań', 'Kalisz', 'Gniezno']],
  ['Zachodniopomorskie', ['Szczecin', 'Koszalin', 'Gryfice']]
];

const categories = ['Panie', 'Panowie', 'Kluby', 'Pary', 'Trans', 'Masaż', 'BDSM', 'Onlyfans', 'Pokazy/Sex telefon', 'Gej/Les', 'Filmy'];
const preferences = ['69', 'Dyskrecja', 'Gra wstępna', 'Handjob', 'Finał na ciało', 'Finał w buzi', 'Masaż relaksacyjny', 'Dominacja', 'Eksperymenty', 'Duet z koleżanką', 'Fetysz stóp', 'Dwa zbliżenia w godzinie', 'Cuckold', 'Facesitting', 'Dziki seks', 'Francuz w zabezpieczeniu'];
const languages = ['Polski', 'Angielski', 'Niemiecki', 'Ukraiński', 'Rosyjski', 'Czeski', 'Francuski', 'Hiszpański', 'Włoski'];
const femaleNames = ['Lena', 'Maja', 'Nadia', 'Oliwia', 'Laura', 'Klaudia', 'Wiktoria', 'Sandra', 'Julia', 'Natalia', 'Monika', 'Patrycja'];
const maleNames = ['Adam', 'Maks', 'Kamil', 'Tomek', 'Daniel', 'Michał', 'Bartek', 'Patryk'];
const clubNames = ['Club Velvet', 'Pink Room', 'Noir Club', 'Studio Venus', 'Apartament Luna'];

function pick(list, index, offset = 0) {
  return list[(index + offset) % list.length];
}

function sample(list, index, count) {
  return Array.from({ length: count }, (_, itemIndex) => pick(list, index * 3, itemIndex * 2));
}

function toSqlDate(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

async function createUser(name, email, password, role = 'user') {
  const existing = await get('SELECT id FROM users WHERE email = ?', [email]);
  if (existing) return existing.id;
  const passwordHash = await bcrypt.hash(password, 10);
  const username = email.split('@')[0].replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 30);
  const result = await run(
    'INSERT INTO users (name, username, account_type, email, password_hash, role, coins) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [name, username, 'prywatne', email, passwordHash, role, 500]
  );
  return result.lastID;
}

function ensureDemoImages() {
  const dir = path.join(__dirname, '..', 'public', 'uploads', 'demo-profiles');
  fs.mkdirSync(dir, { recursive: true });
  const palettes = [
    ['#4c1235', '#e0187a', '#f27a35'],
    ['#26162d', '#8f315f', '#e66aa2'],
    ['#2c0f1f', '#b41462', '#ff9b55'],
    ['#35142b', '#642141', '#d8a15f']
  ];
  for (let index = 1; index <= 24; index += 1) {
    const [dark, pink, orange] = palettes[index % palettes.length];
    const label = String(index).padStart(2, '0');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="720" viewBox="0 0 480 720">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="${dark}"/>
      <stop offset="0.55" stop-color="${pink}"/>
      <stop offset="1" stop-color="${orange}"/>
    </linearGradient>
    <radialGradient id="light" cx="50%" cy="28%" r="55%">
      <stop offset="0" stop-color="#fff" stop-opacity=".45"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="480" height="720" rx="34" fill="url(#bg)"/>
  <rect width="480" height="720" fill="url(#light)"/>
  <circle cx="240" cy="220" r="82" fill="#fff" opacity=".82"/>
  <path d="M106 586c20-128 94-206 134-206s114 78 134 206" fill="#fff" opacity=".78"/>
  <path d="M78 646c50-54 104-82 162-82s112 28 162 82" fill="#1c0d18" opacity=".24"/>
  <text x="240" y="680" text-anchor="middle" font-family="Arial, sans-serif" font-size="36" font-weight="700" fill="#fff" opacity=".78">Spotykaj ${label}</text>
</svg>`;
    fs.writeFileSync(path.join(dir, `profile-${label}.svg`), svg);
  }
}

function titleFor(category, index) {
  if (category === 'Kluby') return pick(clubNames, index);
  if (category === 'Panowie' || category === 'Gej/Les') return pick(maleNames, index);
  if (category === 'Pary') return `${pick(femaleNames, index)} i ${pick(maleNames, index, 1)}`;
  return pick(femaleNames, index);
}

async function createListing(userId, index) {
  const [region, cities] = regions[index % regions.length];
  const city = pick(cities, index, Math.floor(index / regions.length));
  const category = pick(categories, index, Math.floor(index / 7));
  const title = titleFor(category, index);
  const age = 20 + ((index * 7) % 36);
  const verified = index % 3 !== 0;
  const promoted = index % 4 === 0 || index < 18;
  const pref = sample(preferences, index, 1 + (index % 4));
  const lang = sample(languages, index, 1 + (index % 3));
  const image = `/uploads/demo-profiles/profile-${String((index % 24) + 1).padStart(2, '0')}.svg`;
  const createdAt = toSqlDate(new Date(Date.now() - index * 2 * 60 * 60 * 1000));
  const promotedUntil = promoted ? toSqlDate(new Date(Date.now() + (3 + (index % 20)) * 24 * 60 * 60 * 1000)) : null;
  const price = 250 + ((index * 35) % 900);
  const description = [
    `Wiek: ${age}`,
    `Preferencje: ${pref.join(', ')}`,
    `Języki: ${lang.join(', ')}`,
    `Weryfikacja: ${verified ? 'Tak' : 'Nie'}`,
    `Opis: Demo profil Spotykaj dla dorosłych użytkowników. Dyskretna prezentacja profilu w kategorii ${category}.`
  ].join('\n');

  const result = await run(`
    INSERT INTO listings (
      user_id, title, description, price, city, region, category, status,
      promoted_until, face_blur, tattoo_removal_count, create_options_cost, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, 0, 0, ?)
  `, [userId, title, description, price, city, region, category, promotedUntil, verified ? 1 : 0, createdAt]);
  await run('INSERT INTO listing_images (listing_id, image_path, created_at) VALUES (?, ?, ?)', [result.lastID, image, createdAt]);
}

async function main() {
  await initDb();
  ensureDemoImages();

  const adminId = await createUser('Administrator', 'admin@spotykaj.pl', 'admin123', 'admin');
  const demoUserId = await createUser('Demo Spotykaj', 'demo@spotykaj.pl', 'haslo123');

  await run('DELETE FROM listing_images');
  await run('DELETE FROM listings');

  for (let index = 0; index < 100; index += 1) {
    await createListing(index % 5 === 0 ? adminId : demoUserId, index);
  }

  console.log('Utworzono 100 nowych demo ogłoszeń Spotykaj.');
  console.log('Usunięto stare demo ogłoszenia i ich zdjęcia.');
  console.log('Admin: admin@spotykaj.pl / admin123');
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
