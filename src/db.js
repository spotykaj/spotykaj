const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

const dbPath = process.env.SQLITE_DB_PATH || path.join(__dirname, '..', 'data', 'market.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
let db;
let transactionDepth = 0;

async function openDb() {
  if (db) return db;
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file)
  });
  if (fs.existsSync(dbPath)) {
    db = new SQL.Database(fs.readFileSync(dbPath));
  } else {
    db = new SQL.Database();
    saveDb();
  }
  return db;
}

function saveDb() {
  if (!db) return;
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
}

function run(sql, params = []) {
  const database = db;
  const command = sql.trim().split(/\s+/)[0].toUpperCase();
  database.run(sql, params);
  const lastID = database.exec('SELECT last_insert_rowid() AS id')[0]?.values[0]?.[0] || 0;
  const changes = database.exec('SELECT changes() AS count')[0]?.values[0]?.[0] || 0;

  if (command === 'BEGIN') {
    transactionDepth += 1;
  } else if (command === 'COMMIT') {
    transactionDepth = Math.max(0, transactionDepth - 1);
    saveDb();
  } else if (command === 'ROLLBACK') {
    transactionDepth = Math.max(0, transactionDepth - 1);
    saveDb();
  } else if (transactionDepth === 0) {
    saveDb();
  }

  return Promise.resolve({ lastID, changes });
}

function get(sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    if (!stmt.step()) return Promise.resolve(undefined);
    return Promise.resolve(stmt.getAsObject());
  } finally {
    stmt.free();
  }
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  const rows = [];
  try {
    stmt.bind(params);
    while (stmt.step()) rows.push(stmt.getAsObject());
    return Promise.resolve(rows);
  } finally {
    stmt.free();
  }
}

function isInTransaction() {
  return transactionDepth > 0;
}

async function columnExists(tableName, columnName) {
  const columns = await all(`PRAGMA table_info(${tableName})`);
  return columns.some((column) => column.name === columnName);
}

function normalizeUsernameBase(value, fallback) {
  const base = String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return base.length >= 3 ? base : fallback;
}

async function ensureUserPublicFields() {
  if (!(await columnExists('users', 'username'))) {
    await run('ALTER TABLE users ADD COLUMN username TEXT');
  }
  if (!(await columnExists('users', 'account_type'))) {
    await run("ALTER TABLE users ADD COLUMN account_type TEXT NOT NULL DEFAULT 'prywatne'");
  }

  const users = await all('SELECT id, name, username, account_type FROM users ORDER BY id ASC');
  const used = new Set();
  for (const user of users) {
    let username = normalizeUsernameBase(user.username || user.name, `user-${user.id}`);
    if (used.has(username.toLowerCase())) username = normalizeUsernameBase('', `user-${user.id}`);
    while (used.has(username.toLowerCase())) username = `${username.slice(0, 24)}-${user.id}`;
    used.add(username.toLowerCase());

    const accountType = ['prywatne', 'agencja', 'salon_masazu'].includes(user.account_type) ? user.account_type : 'prywatne';
    if (user.username !== username || user.account_type !== accountType) {
      await run('UPDATE users SET username = ?, account_type = ? WHERE id = ?', [username, accountType, user.id]);
    }
  }
  await run('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique ON users (lower(username)) WHERE username IS NOT NULL');
}

async function initDb() {
  await openDb();
  await run('PRAGMA foreign_keys = ON');
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      username TEXT UNIQUE,
      account_type TEXT NOT NULL DEFAULT 'prywatne',
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      coins INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS launch_subscribers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      ip TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  if (!(await columnExists('users', 'coins'))) {
    await run('ALTER TABLE users ADD COLUMN coins INTEGER NOT NULL DEFAULT 0');
  }
  if (!(await columnExists('users', 'profile_verified'))) {
    await run('ALTER TABLE users ADD COLUMN profile_verified INTEGER NOT NULL DEFAULT 0');
  }
  if (!(await columnExists('users', 'deleted_at'))) {
    await run('ALTER TABLE users ADD COLUMN deleted_at TEXT');
  }
  if (!(await columnExists('users', 'session_version'))) {
    await run('ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0');
  }
  if (!(await columnExists('users', 'first_name'))) {
    await run('ALTER TABLE users ADD COLUMN first_name TEXT');
  }
  if (!(await columnExists('users', 'last_name'))) {
    await run('ALTER TABLE users ADD COLUMN last_name TEXT');
  }
  await ensureUserPublicFields();
  await run(`
    CREATE TABLE IF NOT EXISTS verification_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      document_image_path TEXT NOT NULL,
      selfie_image_path TEXT NOT NULL,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      reviewer_id INTEGER,
      reviewer_note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS listings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      price REAL NOT NULL,
      city TEXT NOT NULL,
      region TEXT NOT NULL,
      category TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      moderation_reason TEXT,
      created_ip TEXT,
      deleted_at TEXT,
      promoted_until TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  if (!(await columnExists('listings', 'promoted_until'))) {
    await run('ALTER TABLE listings ADD COLUMN promoted_until TEXT');
  }
  if (!(await columnExists('listings', 'moderation_reason'))) {
    await run('ALTER TABLE listings ADD COLUMN moderation_reason TEXT');
  }
  if (!(await columnExists('listings', 'deleted_at'))) {
    await run('ALTER TABLE listings ADD COLUMN deleted_at TEXT');
  }
  if (!(await columnExists('listings', 'created_ip'))) {
    await run('ALTER TABLE listings ADD COLUMN created_ip TEXT');
  }
  await run("UPDATE listings SET status = 'approved' WHERE status = 'active'");
  if (!(await columnExists('listings', 'video_path'))) {
    await run('ALTER TABLE listings ADD COLUMN video_path TEXT');
  }
  if (!(await columnExists('listings', 'face_blur'))) {
    await run('ALTER TABLE listings ADD COLUMN face_blur INTEGER NOT NULL DEFAULT 0');
  }
  if (!(await columnExists('listings', 'tattoo_removal_count'))) {
    await run('ALTER TABLE listings ADD COLUMN tattoo_removal_count INTEGER NOT NULL DEFAULT 0');
  }
  if (!(await columnExists('listings', 'create_options_cost'))) {
    await run('ALTER TABLE listings ADD COLUMN create_options_cost INTEGER NOT NULL DEFAULT 0');
  }
  if (!(await columnExists('listings', 'verified'))) {
    await run("ALTER TABLE listings ADD COLUMN verified INTEGER NOT NULL DEFAULT 0");
    await run(`
      UPDATE listings
      SET verified = 1
      WHERE lower(description) LIKE '%weryfikacja: tak%'
        OR lower(description) LIKE '%zweryfikowana: tak%'
        OR lower(description) LIKE '%zweryfikowany: tak%'
    `);
  }
  await run(`
    CREATE TABLE IF NOT EXISTS listing_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      listing_id INTEGER NOT NULL,
      image_path TEXT NOT NULL,
      thumbnail_path TEXT,
      medium_path TEXT,
      large_path TEXT,
      original_path TEXT,
      file_hash TEXT,
      file_size INTEGER,
      hidden INTEGER NOT NULL DEFAULT 0,
      nsfw_severity TEXT NOT NULL DEFAULT 'standard',
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE
    )
  `);
  const listingImageColumns = [
    ['thumbnail_path', 'TEXT'],
    ['medium_path', 'TEXT'],
    ['large_path', 'TEXT'],
    ['original_path', 'TEXT'],
    ['file_hash', 'TEXT'],
    ['file_size', 'INTEGER'],
    ['hidden', 'INTEGER NOT NULL DEFAULT 0'],
    ['nsfw_severity', "TEXT NOT NULL DEFAULT 'standard'"],
    ['processing_warning', 'TEXT'],
    ['deleted_at', 'TEXT']
  ];
  for (const [column, definition] of listingImageColumns) {
    if (!(await columnExists('listing_images', column))) {
      await run(`ALTER TABLE listing_images ADD COLUMN ${column} ${definition}`);
    }
  }
  await run(`
    CREATE TABLE IF NOT EXISTS media_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      listing_id INTEGER,
      kind TEXT NOT NULL,
      original_path TEXT,
      thumbnail_path TEXT,
      medium_path TEXT,
      large_path TEXT,
      file_hash TEXT,
      file_size INTEGER NOT NULL DEFAULT 0,
      mime_type TEXT,
      duplicate_of INTEGER,
      processing_warning TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE SET NULL,
      FOREIGN KEY (duplicate_of) REFERENCES media_assets(id) ON DELETE SET NULL
    )
  `);
  if (!(await columnExists('media_assets', 'processing_warning'))) {
    await run('ALTER TABLE media_assets ADD COLUMN processing_warning TEXT');
  }
  await run(`
    CREATE TABLE IF NOT EXISTS coin_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      admin_id INTEGER,
      amount INTEGER NOT NULL,
      balance_before INTEGER,
      balance_after INTEGER NOT NULL,
      ledger_index INTEGER,
      transaction_type TEXT NOT NULL DEFAULT 'adjustment',
      reference_type TEXT,
      reference_id TEXT,
      previous_hash TEXT,
      hash TEXT,
      metadata TEXT,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS spotycoin_purchase_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      package_eur INTEGER NOT NULL,
      package_spotycoins INTEGER NOT NULL,
      crypto_code TEXT NOT NULL UNIQUE,
      voucher_email TEXT,
      ltc_txid TEXT,
      user_note TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      admin_id INTEGER,
      admin_note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);
  const purchaseRequestColumns = [
    ['voucher_email', 'TEXT'],
    ['ltc_txid', 'TEXT'],
    ['user_note', 'TEXT']
  ];
  for (const [column, definition] of purchaseRequestColumns) {
    if (!(await columnExists('spotycoin_purchase_requests', column))) {
      await run(`ALTER TABLE spotycoin_purchase_requests ADD COLUMN ${column} ${definition}`);
    }
  }
  await run('CREATE UNIQUE INDEX IF NOT EXISTS idx_spotycoin_purchase_requests_ltc_txid ON spotycoin_purchase_requests(ltc_txid) WHERE ltc_txid IS NOT NULL AND ltc_txid != ""');
  const ledgerColumns = [
    ['balance_before', 'INTEGER'],
    ['ledger_index', 'INTEGER'],
    ['transaction_type', "TEXT NOT NULL DEFAULT 'adjustment'"],
    ['reference_type', 'TEXT'],
    ['reference_id', 'TEXT'],
    ['previous_hash', 'TEXT'],
    ['hash', 'TEXT'],
    ['metadata', 'TEXT']
  ];
  for (const [column, definition] of ledgerColumns) {
    if (!(await columnExists('coin_transactions', column))) {
      await run(`ALTER TABLE coin_transactions ADD COLUMN ${column} ${definition}`);
    }
  }
  await run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      listing_id INTEGER NOT NULL,
      sender_id INTEGER NOT NULL,
      receiver_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      cost_spotycoins INTEGER NOT NULL DEFAULT 5,
      is_read INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  if (!(await columnExists('messages', 'deleted_at'))) {
    await run('ALTER TABLE messages ADD COLUMN deleted_at TEXT');
  }
  await run(`
    CREATE TABLE IF NOT EXISTS listing_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      listing_id INTEGER NOT NULL,
      reporter_id INTEGER,
      reason TEXT NOT NULL,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      reviewer_id INTEGER,
      reviewer_note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TEXT,
      FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE,
      FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS admin_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER,
      action_type TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      metadata TEXT,
      timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS suspicious_activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      ip TEXT,
      event_type TEXT NOT NULL,
      score INTEGER NOT NULL DEFAULT 1,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS user_favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      listing_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, listing_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS tips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      listing_id INTEGER NOT NULL,
      sender_id INTEGER NOT NULL,
      receiver_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await run('CREATE INDEX IF NOT EXISTS idx_listings_status_deleted ON listings(status, deleted_at, created_at)');
  await run('CREATE INDEX IF NOT EXISTS idx_listings_city_status ON listings(city, status, deleted_at)');
  await run('CREATE INDEX IF NOT EXISTS idx_listings_category_status ON listings(category, status, deleted_at)');
  await run('CREATE INDEX IF NOT EXISTS idx_listing_images_listing_visible ON listing_images(listing_id, hidden, deleted_at)');
  await run('CREATE INDEX IF NOT EXISTS idx_media_assets_user_created ON media_assets(user_id, created_at)');
  await run('CREATE INDEX IF NOT EXISTS idx_media_assets_hash ON media_assets(file_hash)');
  await run('CREATE INDEX IF NOT EXISTS idx_reports_status ON listing_reports(status, created_at)');
  await run('CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON admin_audit_log(timestamp)');
  await run('CREATE INDEX IF NOT EXISTS idx_favorites_user ON user_favorites(user_id, created_at)');
  await run('CREATE INDEX IF NOT EXISTS idx_tips_sender ON tips(sender_id, created_at)');
  await run('CREATE INDEX IF NOT EXISTS idx_tips_receiver ON tips(receiver_id, created_at)');
}

module.exports = {
  run,
  get,
  all,
  initDb,
  isInTransaction
};
