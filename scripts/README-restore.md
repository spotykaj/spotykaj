# Odtwarzanie po awarii

Backupy są przechowywane poza katalogiem `public`, w katalogu `backups/`.

## Backup bazy

```bash
node scripts/backup-db.js
```

System automatycznie wykrywa silnik bazy:
- SQLite: kopiuje plik `data/market.db` albo `SQLITE_DB_PATH`.
- MySQL: używa `mysqldump`, gdy `DB_ENGINE=mysql` albo `DATABASE_URL` / `MYSQL_URL` wskazuje MySQL.

Przechowywanych jest 7 najnowszych backupów bazy. Starsze pliki są usuwane automatycznie.

## Odtwarzanie bazy

Przed odtworzeniem zatrzymaj aplikację albo przełącz ją w tryb serwisowy.

```bash
node scripts/restore-db.js /var/www/codex-test/backups/database/plik-backupu.db
```

Dla SQLite obecna baza jest zachowywana jako kopia `*.before-restore-*`.
Dla MySQL wymagany jest klient `mysql` oraz poprawne zmienne środowiskowe.

## Odtwarzanie plików

```bash
node scripts/restore-media.js uploads /ścieżka/do/backupu/uploads
node scripts/restore-media.js verification /ścieżka/do/backupu/verification
node scripts/restore-media.js media /ścieżka/do/backupu/media
```

## Logi

Zdarzenia backupu i odtwarzania są zapisywane w:

```text
backups/logs/backup.log
```
