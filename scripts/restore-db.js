#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const backupService = require('../src/services/backupService');

const appRoot = path.join(__dirname, '..');
const targetSqlite = process.env.SQLITE_DB_PATH || path.join(appRoot, 'data', 'market.db');

function usage() {
  console.error('Użycie: node scripts/restore-db.js /pełna/ścieżka/do/backupu.db');
}

function restoreSqlite(source) {
  if (!fs.existsSync(source)) throw new Error('Plik backupu nie istnieje.');
  if (!/\.(db|sqlite)$/i.test(source)) throw new Error('Dla SQLite podaj plik .db albo .sqlite.');
  fs.mkdirSync(path.dirname(targetSqlite), { recursive: true });
  const before = `${targetSqlite}.before-restore-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`;
  if (fs.existsSync(targetSqlite)) fs.copyFileSync(targetSqlite, before);
  fs.copyFileSync(source, targetSqlite);
  fs.chmodSync(targetSqlite, 0o640);
  return { target: targetSqlite, previousCopy: fs.existsSync(before) ? before : null };
}

function restoreMysql(source) {
  if (!fs.existsSync(source)) throw new Error('Plik backupu nie istnieje.');
  if (!/\.sql$/i.test(source)) throw new Error('Dla MySQL podaj plik .sql.');
  const url = process.env.DATABASE_URL || process.env.MYSQL_URL || '';
  const parsed = url ? new URL(url) : null;
  const database = parsed ? parsed.pathname.replace(/^\//, '') : process.env.MYSQL_DATABASE;
  const user = parsed ? decodeURIComponent(parsed.username || '') : process.env.MYSQL_USER;
  const password = parsed ? decodeURIComponent(parsed.password || '') : process.env.MYSQL_PASSWORD;
  const host = parsed ? parsed.hostname : process.env.MYSQL_HOST || '127.0.0.1';
  const port = parsed ? parsed.port || '3306' : process.env.MYSQL_PORT || '3306';
  if (!database || !user) throw new Error('Brakuje konfiguracji MySQL do odtworzenia bazy.');
  execFileSync('mysql', [`--host=${host}`, `--port=${port}`, `--user=${user}`, database], {
    input: fs.readFileSync(source),
    env: { ...process.env, MYSQL_PWD: password || '' },
    stdio: ['pipe', 'inherit', 'inherit']
  });
  return { target: database, previousCopy: null };
}

(async () => {
  const source = process.argv[2];
  if (!source) {
    usage();
    process.exit(1);
  }
  const engine = backupService.databaseEngine();
  backupService.logLine('restore_attempt', { engine, source });
  const result = engine === 'mysql' ? restoreMysql(source) : restoreSqlite(source);
  backupService.logLine('restore_success', { engine, source, ...result });
  console.log(`Odtwarzanie bazy zakończone: ${result.target}`);
  if (result.previousCopy) console.log(`Poprzednia baza zachowana jako: ${result.previousCopy}`);
})().catch((error) => {
  backupService.logLine('restore_failure', { error: error.message, script: 'restore-db' });
  console.error(`Nie udało się odtworzyć bazy: ${error.message}`);
  process.exit(1);
});
