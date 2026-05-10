# Spotykaj

Spotykaj to nowoczesna, dyskretna platforma ogłoszeniowa dla dorosłych użytkowników w Polsce. Projekt działa na Node.js, Express, EJS i SQLite.

## Funkcje

- rejestracja i logowanie użytkowników,
- panel użytkownika z własnymi ogłoszeniami,
- dodawanie ogłoszeń z polami: tytuł, opis, cena, miasto, region, kategoria,
- obsługa wielu zdjęć dla jednego ogłoszenia,
- publiczna strona główna z wyszukiwarką i filtrami,
- publiczna strona szczegółów ogłoszenia,
- panel administratora do zarządzania użytkownikami i ogłoszeniami,
- responsywny, nowoczesny interfejs,
- baza SQLite i dane demo.

## Uruchomienie

```bash
npm install
npm run seed
npm start
```

Aplikacja będzie dostępna pod adresem:

```text
http://localhost:3000
```

## Dane demo

```text
Administrator: admin@spotykaj.pl / admin123
Użytkownik: anna@example.pl / haslo123
Użytkownik: marek@example.pl / haslo123
```

## Tryb deweloperski

```bash
npm run dev
```

Plik bazy danych powstaje lokalnie w `data/market.db`.
