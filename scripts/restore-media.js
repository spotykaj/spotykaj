#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const backupService = require('../src/services/backupService');

const appRoot = path.join(__dirname, '..');
const publicRoot = path.join(appRoot, 'public');

const mappings = {
  uploads: path.join(publicRoot, 'uploads'),
  verification: path.join(publicRoot, 'uploads', 'verifications'),
  media: path.join(publicRoot, 'media')
};

function copyRecursive(source, target) {
  if (!fs.existsSync(source)) throw new Error(`Katalog źródłowy nie istnieje: ${source}`);
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(from, to);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
    }
  }
}

function usage() {
  console.error('Użycie: node scripts/restore-media.js uploads|verification|media /pełna/ścieżka/do/katalogu_backupu');
}

(async () => {
  const type = process.argv[2];
  const source = process.argv[3];
  if (!type || !source || !mappings[type]) {
    usage();
    process.exit(1);
  }
  const target = mappings[type];
  backupService.logLine('restore_attempt', { type, source, target, script: 'restore-media' });
  copyRecursive(source, target);
  backupService.logLine('restore_success', { type, source, target, script: 'restore-media' });
  console.log(`Odtwarzanie plików zakończone: ${target}`);
})().catch((error) => {
  backupService.logLine('restore_failure', { error: error.message, script: 'restore-media' });
  console.error(`Nie udało się odtworzyć plików: ${error.message}`);
  process.exit(1);
});
