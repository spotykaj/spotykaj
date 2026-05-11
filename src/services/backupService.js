const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const auditService = require('./auditService');
const accountSecurityService = require('./accountSecurityService');

const execFileAsync = promisify(execFile);
const appRoot = path.join(__dirname, '..', '..');
const publicRoot = path.join(appRoot, 'public');
const backupRoot = process.env.BACKUP_DIR || path.join(appRoot, 'backups');
const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS || 7);

const directories = {
  root: backupRoot,
  database: path.join(backupRoot, 'database'),
  uploads: path.join(backupRoot, 'uploads'),
  verification: path.join(backupRoot, 'verification'),
  media: path.join(backupRoot, 'media'),
  logs: path.join(backupRoot, 'logs'),
  tmp: path.join(backupRoot, 'tmp')
};

function ensureBackupDirectories() {
  Object.values(directories).forEach((dir) => fs.mkdirSync(dir, { recursive: true, mode: 0o750 }));
  const denyText = [
    'Require all denied',
    'Options -ExecCGI -Indexes',
    'RemoveHandler .php .phtml .phar .pl .py .cgi .sh .js',
    ''
  ].join('\n');
  for (const dir of Object.values(directories)) {
    const htaccess = path.join(dir, '.htaccess');
    if (!fs.existsSync(htaccess)) fs.writeFileSync(htaccess, denyText, { mode: 0o640 });
  }
  const nginxReadme = path.join(backupRoot, 'NGINX_BLOCKS_REQUIRED.md');
  if (!fs.existsSync(nginxReadme)) {
    fs.writeFileSync(nginxReadme, [
      '# Wymagane blokady Nginx',
      '',
      'Backupy nie powinny być serwowane publicznie. Jeżeli root Nginx wskazuje katalog projektu, dodaj blokady:',
      '',
      '```nginx',
      'location ~ /(?:\\.env|backups|logs|\\.git) {',
      '    deny all;',
      '    return 404;',
      '}',
      '```',
      ''
    ].join('\n'), { mode: 0o640 });
  }
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function databaseEngine() {
  const explicit = String(process.env.DB_ENGINE || '').toLowerCase();
  const url = String(process.env.DATABASE_URL || process.env.MYSQL_URL || '');
  if (explicit === 'mysql' || url.startsWith('mysql://') || url.startsWith('mysql2://')) return 'mysql';
  return 'sqlite';
}

function sqlitePath() {
  return process.env.SQLITE_DB_PATH || path.join(appRoot, 'data', 'market.db');
}

function mysqlConfig() {
  const url = process.env.DATABASE_URL || process.env.MYSQL_URL || '';
  if (url) {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parsed.port || '3306',
      user: decodeURIComponent(parsed.username || ''),
      password: decodeURIComponent(parsed.password || ''),
      database: parsed.pathname.replace(/^\//, '')
    };
  }
  return {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: process.env.MYSQL_PORT || '3306',
    user: process.env.MYSQL_USER || '',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || ''
  };
}

function logLine(message, data = {}) {
  ensureBackupDirectories();
  const payload = JSON.stringify({ timestamp: new Date().toISOString(), message, ...data });
  fs.appendFileSync(path.join(directories.logs, 'backup.log'), `${payload}\n`, { mode: 0o640 });
}

function humanSize(bytes) {
  const value = Number(bytes || 0);
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(2)} KB`;
  return `${value} B`;
}

function listBackups() {
  ensureBackupDirectories();
  return fs.readdirSync(directories.database)
    .filter((name) => /\.(sqlite|db|sql)$/.test(name))
    .map((name) => {
      const fullPath = path.join(directories.database, name);
      const stat = fs.statSync(fullPath);
      return {
        name,
        path: fullPath,
        size: stat.size,
        sizeText: humanSize(stat.size),
        createdAt: stat.mtime,
        createdText: stat.mtime.toLocaleString('pl-PL')
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

function pruneOldBackups() {
  const backups = listBackups();
  const keep = backups.slice(0, retentionDays);
  const remove = backups.slice(retentionDays);
  remove.forEach((backup) => fs.unlinkSync(backup.path));
  return { kept: keep.length, removed: remove.length };
}

function hasDatabaseBackupForToday() {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return listBackups().some((backup) => backup.name.includes(today));
}

async function createSqliteBackup() {
  const source = sqlitePath();
  if (!fs.existsSync(source)) throw new Error('Nie znaleziono pliku bazy SQLite.');
  const target = path.join(directories.database, `spotykaj-sqlite-${timestamp()}.db`);
  fs.copyFileSync(source, target);
  fs.chmodSync(target, 0o640);
  return target;
}

async function createMysqlBackup() {
  const config = mysqlConfig();
  if (!config.database || !config.user) throw new Error('Brakuje konfiguracji MySQL do wykonania backupu.');
  const target = path.join(directories.database, `spotykaj-mysql-${timestamp()}.sql`);
  const args = [
    `--host=${config.host}`,
    `--port=${config.port}`,
    `--user=${config.user}`,
    '--single-transaction',
    '--routines',
    '--triggers',
    config.database
  ];
  const env = { ...process.env, MYSQL_PWD: config.password || '' };
  const { stdout } = await execFileAsync('mysqldump', args, { env, maxBuffer: 1024 * 1024 * 512 });
  fs.writeFileSync(target, stdout, { mode: 0o640 });
  return target;
}

async function createDatabaseBackup({ actorId = null, manual = false } = {}) {
  ensureBackupDirectories();
  const engine = databaseEngine();
  try {
    const filePath = engine === 'mysql' ? await createMysqlBackup() : await createSqliteBackup();
    const stat = fs.statSync(filePath);
    const retention = pruneOldBackups();
    const result = {
      ok: true,
      engine,
      fileName: path.basename(filePath),
      filePath,
      size: stat.size,
      sizeText: humanSize(stat.size),
      retention
    };
    logLine('backup_success', result);
    if (manual && actorId) {
      await auditService.logAction({
        adminId: actorId,
        actionType: 'manual_database_backup',
        targetType: 'backup',
        targetId: result.fileName,
        metadata: { engine, size: stat.size }
      });
    }
    return result;
  } catch (error) {
    logLine('backup_failure', { engine, error: error.message });
    await accountSecurityService.notifyAdmins(
      'Błąd backupu bazy danych',
      `Automatyczny lub ręczny backup bazy danych nie powiódł się. Błąd: ${error.message}`
    ).catch(() => {});
    throw error;
  }
}

function ensureMediaBackupStructure() {
  ensureBackupDirectories();
  const sourceMap = [
    { name: 'uploads', source: path.join(publicRoot, 'uploads'), target: directories.uploads },
    { name: 'verification', source: path.join(publicRoot, 'uploads', 'verifications'), target: directories.verification },
    { name: 'media', source: path.join(publicRoot, 'media'), target: directories.media }
  ];
  sourceMap.forEach((item) => fs.mkdirSync(item.target, { recursive: true, mode: 0o750 }));
  return sourceMap.map((item) => ({
    name: item.name,
    source: item.source,
    target: item.target,
    sourceExists: fs.existsSync(item.source),
    targetWritable: isWritable(item.target)
  }));
}

function isWritable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch (error) {
    return false;
  }
}

async function getHealthStatus() {
  ensureBackupDirectories();
  const checks = {
    database: false,
    disk: null,
    pm2: null,
    uploadWritable: isWritable(path.join(publicRoot, 'uploads')),
    backupWritable: isWritable(directories.database)
  };
  try {
    checks.database = fs.existsSync(sqlitePath()) || databaseEngine() === 'mysql';
  } catch (error) {
    checks.database = false;
  }
  try {
    const { stdout } = await execFileAsync('df', ['-Pk', appRoot], { timeout: 5000 });
    const line = stdout.trim().split('\n')[1];
    const parts = line.trim().split(/\s+/);
    checks.disk = {
      filesystem: parts[0],
      totalKb: Number(parts[1]),
      usedKb: Number(parts[2]),
      availableKb: Number(parts[3]),
      usedPercent: parts[4],
      mount: parts[5]
    };
  } catch (error) {
    checks.disk = { error: 'Nie udało się odczytać miejsca na dysku.' };
  }
  try {
    const { stdout } = await execFileAsync('pm2', ['jlist'], { timeout: 5000, maxBuffer: 1024 * 1024 });
    const processes = JSON.parse(stdout);
    const current = processes.find((item) => item.pm2_env?.pm_cwd === appRoot) || processes[0];
    checks.pm2 = current ? {
      name: current.name,
      status: current.pm2_env?.status,
      restarts: current.pm2_env?.restart_time,
      pid: current.pid
    } : { status: 'brak procesu PM2' };
  } catch (error) {
    checks.pm2 = { error: 'Nie udało się odczytać statusu PM2.' };
  }
  checks.ok = Boolean(checks.database && checks.uploadWritable && checks.backupWritable && checks.pm2?.status === 'online');
  return checks;
}

function scheduleAutomatedBackups() {
  ensureMediaBackupStructure();
  const everyDay = 24 * 60 * 60 * 1000;
  let running = false;
  async function runBackup() {
    if (running) return;
    if (hasDatabaseBackupForToday()) return;
    running = true;
    try {
      await createDatabaseBackup({ manual: false });
    } catch (error) {
      // Błąd jest zapisany w backup.log.
    } finally {
      running = false;
    }
  }
  setTimeout(runBackup, 60 * 1000).unref();
  const interval = setInterval(runBackup, everyDay);
  interval.unref();
}

module.exports = {
  backupRoot,
  directories,
  createDatabaseBackup,
  databaseEngine,
  ensureBackupDirectories,
  ensureMediaBackupStructure,
  getHealthStatus,
  humanSize,
  listBackups,
  logLine,
  pruneOldBackups,
  scheduleAutomatedBackups
};
