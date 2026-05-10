const regiony = [
  'Dolnośląskie', 'Kujawsko-pomorskie', 'Lubelskie', 'Lubuskie', 'Łódzkie', 'Małopolskie',
  'Mazowieckie', 'Opolskie', 'Podkarpackie', 'Podlaskie', 'Pomorskie', 'Śląskie',
  'Świętokrzyskie', 'Warmińsko-mazurskie', 'Wielkopolskie', 'Zachodniopomorskie'
];

const kategorie = [
  'Towarzyskie', 'Masaż', 'Spotkania prywatne', 'Online', 'Kluby i wydarzenia',
  'Relacje', 'Dyskretne usługi', 'Inne'
];

const promotionOptions = [
  { days: 0, label: 'Brak promocji', price: 0 },
  { days: 7, label: '7 dni', price: 35 },
  { days: 14, label: '14 dni', price: 60 },
  { days: 30, label: '30 dni', price: 95 }
];

module.exports = {
  appName: 'Spotykaj',
  promotionOptions,
  regiony,
  kategorie
};
