#!/usr/bin/env node
const { initDb } = require('../src/db');
const backupService = require('../src/services/backupService');

(async () => {
  await initDb();
  backupService.ensureMediaBackupStructure();
  const backup = await backupService.createDatabaseBackup({ manual: false });
  console.log(`Backup bazy utworzony: ${backup.filePath}`);
  console.log(`Rozmiar: ${backup.sizeText}`);
})().catch((error) => {
  backupService.logLine('backup_failure', { error: error.message, script: 'backup-db' });
  console.error(`Nie udało się utworzyć backupu bazy: ${error.message}`);
  process.exit(1);
});
