const { run, get, all } = require('../db');
const coinService = require('./coinService');

const MESSAGE_COST = 5;

async function ensureMessageTable() {
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
}

async function sendListingMessage({ listingId, senderId, body }) {
  const text = String(body || '').trim();
  if (!text) {
    const error = new Error('Wpisz treść wiadomości.');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  await ensureMessageTable();
  const listing = await get(`
    SELECT l.id, l.title, l.user_id, COALESCE(NULLIF(u.username, ''), 'Użytkownik ' || u.id) AS owner_name
    FROM listings l
    JOIN users u ON u.id = l.user_id
    WHERE l.id = ? AND l.deleted_at IS NULL AND l.status IN ('approved', 'active')
  `, [listingId]);
  if (!listing) {
    const error = new Error('Nie znaleziono ogłoszenia.');
    error.code = 'NOT_FOUND';
    throw error;
  }
  if (Number(listing.user_id) === Number(senderId)) {
    const error = new Error('Nie możesz wysłać wiadomości do własnego ogłoszenia.');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  await run('BEGIN TRANSACTION');
  try {
    const result = await run(`
      INSERT INTO messages (listing_id, sender_id, receiver_id, body, cost_spotycoins, is_read)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [listing.id, senderId, listing.user_id, text, MESSAGE_COST, 0]);

    const ledger = await coinService.spendCoins({
      userId: senderId,
      amount: MESSAGE_COST,
      transactionType: 'message_fee',
      referenceType: 'message',
      referenceId: result.lastID,
      metadata: { listingId: listing.id, receiverId: listing.user_id },
      note: `Wiadomość do ogłoszenia: ${listing.title}`
    });

    await run('COMMIT');
    return {
      messageId: result.lastID,
      balanceAfter: ledger.balanceAfter,
      cost: MESSAGE_COST,
      listingTitle: listing.title,
      receiver: listing.owner_name
    };
  } catch (error) {
    await run('ROLLBACK');
    throw error;
  }
}

function messageSelectSql() {
  return `
    SELECT
      m.*,
      l.title AS listing_title,
      s.name AS sender_name,
      s.email AS sender_email,
      r.name AS receiver_name,
      r.email AS receiver_email
    FROM messages m
    JOIN listings l ON l.id = m.listing_id
    JOIN users s ON s.id = m.sender_id
    JOIN users r ON r.id = m.receiver_id
  `;
}

async function getInbox(userId, limit = 50) {
  await ensureMessageTable();
  return all(`
    ${messageSelectSql()}
    WHERE m.receiver_id = ? AND m.deleted_at IS NULL
    ORDER BY datetime(m.created_at) DESC, m.id DESC
    LIMIT ?
  `, [userId, limit]);
}

async function getOutbox(userId, limit = 50) {
  await ensureMessageTable();
  return all(`
    ${messageSelectSql()}
    WHERE m.sender_id = ? AND m.deleted_at IS NULL
    ORDER BY datetime(m.created_at) DESC, m.id DESC
    LIMIT ?
  `, [userId, limit]);
}

async function getLatestMessages(limit = 20) {
  await ensureMessageTable();
  return all(`
    ${messageSelectSql()}
    WHERE m.deleted_at IS NULL
    ORDER BY datetime(m.created_at) DESC, m.id DESC
    LIMIT ?
  `, [limit]);
}

async function getMessageForUser(messageId, user) {
  await ensureMessageTable();
  const message = await get(`
    ${messageSelectSql()}
    WHERE m.id = ? AND m.deleted_at IS NULL
  `, [messageId]);
  if (!message) {
    const error = new Error('Nie znaleziono wiadomości.');
    error.code = 'NOT_FOUND';
    throw error;
  }

  const canRead = user?.role === 'admin'
    || Number(message.sender_id) === Number(user?.id)
    || Number(message.receiver_id) === Number(user?.id);
  if (!canRead) {
    const error = new Error('Nie masz dostępu do tej wiadomości.');
    error.code = 'FORBIDDEN';
    throw error;
  }

  if (Number(message.receiver_id) === Number(user.id) && Number(message.is_read) === 0) {
    await run('UPDATE messages SET is_read = 1 WHERE id = ?', [message.id]);
    message.is_read = 1;
  }

  return message;
}

async function replyToMessage({ messageId, senderId, body }) {
  const original = await getMessageForUser(messageId, { id: senderId, role: 'user' });
  const receiverId = Number(original.sender_id) === Number(senderId)
    ? Number(original.receiver_id)
    : Number(original.sender_id);
  const text = String(body || '').trim();
  if (!text) {
    const error = new Error('Wpisz treść wiadomości.');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  await run('BEGIN TRANSACTION');
  try {
    const result = await run(`
      INSERT INTO messages (listing_id, sender_id, receiver_id, body, cost_spotycoins, is_read)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [original.listing_id, senderId, receiverId, text, MESSAGE_COST, 0]);
    await coinService.spendCoins({
      userId: senderId,
      amount: MESSAGE_COST,
      transactionType: 'message_fee',
      referenceType: 'message',
      referenceId: result.lastID,
      metadata: { listingId: original.listing_id, receiverId, replyTo: original.id },
      note: `Odpowiedź do ogłoszenia: ${original.listing_title}`
    });
    await run('COMMIT');
    return { messageId: result.lastID };
  } catch (error) {
    await run('ROLLBACK');
    throw error;
  }
}

async function getConversationForMessage(messageId, user) {
  const message = await getMessageForUser(messageId, user);
  const otherId = Number(message.sender_id) === Number(user.id) ? Number(message.receiver_id) : Number(message.sender_id);
  const messages = await all(`
    ${messageSelectSql()}
    WHERE m.listing_id = ?
      AND m.deleted_at IS NULL
      AND (
        (m.sender_id = ? AND m.receiver_id = ?)
        OR (m.sender_id = ? AND m.receiver_id = ?)
      )
    ORDER BY datetime(m.created_at) ASC, m.id ASC
  `, [message.listing_id, user.id, otherId, otherId, user.id]);
  return { message, messages };
}

module.exports = {
  MESSAGE_COST,
  ensureMessageTable,
  getInbox,
  getLatestMessages,
  getConversationForMessage,
  getMessageForUser,
  getOutbox,
  replyToMessage,
  sendListingMessage
};
