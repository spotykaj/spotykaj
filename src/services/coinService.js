const crypto = require('crypto');
const { run, get, all, isInTransaction } = require('../db');

const GENESIS_HASH = '0'.repeat(64);

function normalizeMetadata(metadata) {
  if (!metadata) return null;
  if (typeof metadata === 'string') return metadata;
  return JSON.stringify(metadata, Object.keys(metadata).sort());
}

function canonicalTransaction(row) {
  return JSON.stringify({
    ledger_index: Number(row.ledger_index || 0),
    user_id: Number(row.user_id),
    admin_id: row.admin_id === null || row.admin_id === undefined || row.admin_id === '' ? null : Number(row.admin_id),
    amount: Number(row.amount),
    balance_before: Number(row.balance_before || 0),
    balance_after: Number(row.balance_after),
    transaction_type: row.transaction_type || 'adjustment',
    reference_type: row.reference_type || null,
    reference_id: row.reference_id || null,
    metadata: row.metadata || null,
    note: row.note || null,
    created_at: row.created_at,
    previous_hash: row.previous_hash || GENESIS_HASH
  });
}

function hashTransaction(row) {
  return crypto.createHash('sha256').update(canonicalTransaction(row)).digest('hex');
}

async function ensureLedgerIntegrityFields() {
  const rows = await all('SELECT * FROM coin_transactions ORDER BY id ASC');
  let previousHash = GENESIS_HASH;
  let changed = false;
  const usersWithTransactions = new Set();
  const latestBalances = new Map();
  const runningBalances = new Map();

  for (let index = 0; index < rows.length; index += 1) {
    const userId = Number(rows[index].user_id);
    const balanceBefore = Number(runningBalances.get(userId) || 0);
    const row = {
      ...rows[index],
      ledger_index: index + 1,
      balance_before: rows[index].balance_before === null || rows[index].balance_before === undefined || rows[index].balance_before === ''
        ? balanceBefore
        : Number(rows[index].balance_before),
      transaction_type: rows[index].transaction_type || 'adjustment',
      previous_hash: previousHash,
      metadata: rows[index].metadata || null
    };
    const hash = hashTransaction(row);
    const needsLegacyBackfill = rows[index].balance_before === null
      || rows[index].balance_before === undefined
      || rows[index].balance_before === ''
      || !rows[index].ledger_index
      || !rows[index].previous_hash
      || !rows[index].hash
      || !rows[index].transaction_type;
    if (needsLegacyBackfill) {
      await run(`
        UPDATE coin_transactions
        SET balance_before = ?, ledger_index = ?, transaction_type = ?, previous_hash = ?, hash = ?, metadata = ?
        WHERE id = ?
      `, [row.balance_before, row.ledger_index, row.transaction_type, previousHash, hash, row.metadata, row.id]);
      changed = true;
    }
    usersWithTransactions.add(userId);
    latestBalances.set(userId, Number(row.balance_after || 0));
    runningBalances.set(userId, Number(row.balance_after || 0));
    previousHash = hash;
  }

  const users = await all('SELECT id, coins FROM users ORDER BY id ASC');
  let ledgerIndex = rows.length;
  for (const user of users) {
    const userId = Number(user.id);
    const cachedBalance = Number(user.coins || 0);
    if (usersWithTransactions.has(userId) || cachedBalance === 0) continue;

    ledgerIndex += 1;
    const createdAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const row = {
      ledger_index: ledgerIndex,
      user_id: userId,
      admin_id: null,
      amount: cachedBalance,
      balance_before: 0,
      balance_after: cachedBalance,
      transaction_type: 'legacy_balance_import',
      reference_type: 'migration',
      reference_id: 'users.coins',
      previous_hash: previousHash,
      metadata: JSON.stringify({ source: 'users.coins' }),
      note: 'Migracja salda do zabezpieczonej księgi Spotycoin',
      created_at: createdAt
    };
    const hash = hashTransaction(row);
    await run(`
      INSERT INTO coin_transactions (
        user_id, admin_id, amount, balance_after, ledger_index, transaction_type,
        balance_before, reference_type, reference_id, previous_hash, hash, metadata, note, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      row.user_id,
      row.admin_id,
      row.amount,
      row.balance_after,
      row.ledger_index,
      row.transaction_type,
      row.balance_before,
      row.reference_type,
      row.reference_id,
      row.previous_hash,
      hash,
      row.metadata,
      row.note,
      row.created_at
    ]);
    usersWithTransactions.add(userId);
    latestBalances.set(userId, cachedBalance);
    previousHash = hash;
    changed = true;
  }

  return { changed, count: ledgerIndex, headHash: previousHash };
}

async function verifyLedger() {
  const rows = await all('SELECT * FROM coin_transactions ORDER BY ledger_index ASC, id ASC');
  let previousHash = GENESIS_HASH;
  const errors = [];
  const balances = new Map();

  rows.forEach((row, index) => {
    const subject = `Transakcja ${row.id}, użytkownik ${row.user_id}`;
    const expectedIndex = index + 1;
    const expectedBalanceBefore = Number(balances.get(row.user_id) || 0);
    const expectedBalance = expectedBalanceBefore + Number(row.amount || 0);
    const expectedHash = hashTransaction({ ...row, previous_hash: previousHash });

    if (Number(row.ledger_index || 0) !== expectedIndex) {
      errors.push(`${subject}: nieprawidłowy indeks księgi.`);
    }
    if ((row.previous_hash || '') !== previousHash) {
      errors.push(`${subject}: nieprawidłowy poprzedni hash.`);
    }
    if ((row.hash || '') !== expectedHash) {
      errors.push(`${subject}: hash transakcji nie zgadza się z danymi.`);
    }
    if (Number(row.balance_before || 0) !== expectedBalanceBefore) {
      errors.push(`${subject}: saldo przed operacją nie zgadza się z historią użytkownika.`);
    }
    if (Number(row.balance_after) !== expectedBalance) {
      errors.push(`${subject}: saldo po operacji nie zgadza się z historią użytkownika.`);
    }

    balances.set(row.user_id, Number(row.balance_after));
    previousHash = row.hash || expectedHash;
  });

  const users = await all('SELECT id, email, coins FROM users ORDER BY id ASC');
  users.forEach((user) => {
    const derivedBalance = Number(balances.get(user.id) || 0);
    const cachedBalance = Number(user.coins || 0);
    if (cachedBalance !== derivedBalance) {
      errors.push(`Użytkownik ${user.id} (${user.email}): cache users.coins=${cachedBalance}, saldo z księgi=${derivedBalance}.`);
    }
  });

  return {
    ok: errors.length === 0,
    errors,
    count: rows.length,
    headHash: previousHash,
    userBalances: users.map((user) => ({
      userId: Number(user.id),
      email: user.email,
      cachedBalance: Number(user.coins || 0),
      derivedBalance: Number(balances.get(user.id) || 0),
      ok: Number(user.coins || 0) === Number(balances.get(user.id) || 0)
    }))
  };
}

async function getLedgerTail() {
  await ensureLedgerIntegrityFields();
  const tail = await get('SELECT ledger_index, hash FROM coin_transactions ORDER BY ledger_index DESC, id DESC LIMIT 1');
  return {
    ledgerIndex: Number(tail?.ledger_index || 0),
    hash: tail?.hash || GENESIS_HASH
  };
}

async function getBalance(userId) {
  await ensureLedgerIntegrityFields();
  const row = await get(`
    SELECT balance_after
    FROM coin_transactions
    WHERE user_id = ?
    ORDER BY ledger_index DESC, id DESC
    LIMIT 1
  `, [userId]);
  return Number(row?.balance_after || 0);
}

async function syncUserBalance(userId) {
  const balance = await getBalance(userId);
  await run('UPDATE users SET coins = ? WHERE id = ?', [balance, userId]);
  return balance;
}

async function appendTransaction({
  userId,
  adminId = null,
  amount,
  transactionType = 'adjustment',
  referenceType = null,
  referenceId = null,
  metadata = null,
  note = null
}) {
  const parsedAmount = Number.parseInt(amount, 10);
  if (!Number.isInteger(parsedAmount) || parsedAmount === 0) {
    const error = new Error('Kwota transakcji Spotycoin musi być liczbą różną od zera.');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const account = await get('SELECT id FROM users WHERE id = ?', [userId]);
  if (!account) {
    const error = new Error('Nie znaleziono użytkownika.');
    error.code = 'NOT_FOUND';
    throw error;
  }

  await ensureLedgerIntegrityFields();
  const balanceBefore = await getBalance(userId);
  const balanceAfter = balanceBefore + parsedAmount;
  if (balanceAfter < 0) {
    const error = new Error('Masz za mało Spotycoinów.');
    error.code = 'INSUFFICIENT_FUNDS';
    throw error;
  }

  const tail = await getLedgerTail();
  const createdAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const row = {
    ledger_index: tail.ledgerIndex + 1,
    user_id: Number(userId),
    admin_id: adminId ? Number(adminId) : null,
    amount: parsedAmount,
    balance_before: balanceBefore,
    balance_after: balanceAfter,
    transaction_type: transactionType,
    reference_type: referenceType,
    reference_id: referenceId === null || referenceId === undefined ? null : String(referenceId),
    previous_hash: tail.hash,
    metadata: normalizeMetadata(metadata),
    note: note?.trim() || null,
    created_at: createdAt
  };
  const hash = hashTransaction(row);

  const ownsTransaction = !isInTransaction();
  if (ownsTransaction) await run('BEGIN TRANSACTION');
  try {
    await run(`
      INSERT INTO coin_transactions (
        user_id, admin_id, amount, balance_after, ledger_index, transaction_type,
        balance_before, reference_type, reference_id, previous_hash, hash, metadata, note, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      row.user_id,
      row.admin_id,
      row.amount,
      row.balance_after,
      row.ledger_index,
      row.transaction_type,
      row.balance_before,
      row.reference_type,
      row.reference_id,
      row.previous_hash,
      hash,
      row.metadata,
      row.note,
      row.created_at
    ]);
    await run('UPDATE users SET coins = ? WHERE id = ?', [balanceAfter, userId]);
    if (ownsTransaction) await run('COMMIT');
  } catch (error) {
    if (ownsTransaction) await run('ROLLBACK');
    throw error;
  }

  return { balanceAfter, hash, ledgerIndex: row.ledger_index };
}

async function getUserTransactions(userId, limit = 25) {
  await ensureLedgerIntegrityFields();
  return all(`
    SELECT t.*, a.name AS admin_name, a.email AS admin_email
    FROM coin_transactions t
    LEFT JOIN users a ON a.id = t.admin_id
    WHERE t.user_id = ?
    ORDER BY t.ledger_index DESC, t.id DESC
    LIMIT ?
  `, [userId, limit]);
}

async function getAllTransactions(limit = 100) {
  await ensureLedgerIntegrityFields();
  return all(`
    SELECT t.*, u.name AS user_name, u.email AS user_email, a.name AS admin_name, a.email AS admin_email
    FROM coin_transactions t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN users a ON a.id = t.admin_id
    ORDER BY t.ledger_index DESC, t.id DESC
    LIMIT ?
  `, [limit]);
}

async function getPurchaseTransactions(limit = 20) {
  await ensureLedgerIntegrityFields();
  return all(`
    SELECT t.*, u.name AS user_name, u.email AS user_email
    FROM coin_transactions t
    JOIN users u ON u.id = t.user_id
    WHERE t.transaction_type = 'purchase'
    ORDER BY t.ledger_index DESC, t.id DESC
    LIMIT ?
  `, [limit]);
}

async function ensureAdmin(adminId) {
  const admin = await get('SELECT id, role FROM users WHERE id = ?', [adminId]);
  if (admin?.role === 'admin') return;
  const error = new Error('Tylko administrator może ręcznie dodawać Spotycoiny.');
  error.code = 'FORBIDDEN';
  throw error;
}

async function grantCoins({ userId, adminId, amount, note }) {
  await ensureAdmin(adminId);
  const parsedAmount = Number.parseInt(amount, 10);
  if (!Number.isInteger(parsedAmount) || parsedAmount <= 0) {
    const error = new Error('Podaj dodatnią liczbę Spotycoinów.');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const result = await appendTransaction({
    userId,
    adminId,
    amount: parsedAmount,
    transactionType: 'admin_grant',
    referenceType: 'admin',
    referenceId: adminId,
    note: note?.trim() || 'Dodanie Spotycoinów przez administratora'
  });

  return result.balanceAfter;
}

async function spendCoins({ userId, amount, transactionType, referenceType, referenceId, metadata, note }) {
  const parsedAmount = Number.parseInt(amount, 10);
  if (!Number.isInteger(parsedAmount) || parsedAmount <= 0) {
    const error = new Error('Podaj dodatnią liczbę Spotycoinów.');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  return appendTransaction({
    userId,
    amount: -parsedAmount,
    transactionType,
    referenceType,
    referenceId,
    metadata,
    note
  });
}

module.exports = {
  appendTransaction,
  ensureLedgerIntegrityFields,
  getAllTransactions,
  getBalance,
  getPurchaseTransactions,
  getUserTransactions,
  grantCoins,
  hashTransaction,
  spendCoins,
  syncUserBalance,
  verifyLedger
};
