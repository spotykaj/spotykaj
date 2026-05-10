const { run, get, all } = require('../db');
const coinService = require('./coinService');

function parseAmount(value) {
  const amount = Number.parseInt(value, 10);
  if (!Number.isInteger(amount) || amount <= 0) {
    const error = new Error('Podaj prawidłową kwotę napiwku.');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  return amount;
}

async function sendTip({ listingId, senderId, amount, note }) {
  const parsedAmount = parseAmount(amount);
  const listing = await get(`
    SELECT l.id, l.title, l.user_id, u.name AS receiver_name
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
    const error = new Error('Nie możesz wysłać napiwku do własnego ogłoszenia.');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  await run('BEGIN TRANSACTION');
  try {
    const result = await run(`
      INSERT INTO tips (listing_id, sender_id, receiver_id, amount, note)
      VALUES (?, ?, ?, ?, ?)
    `, [listing.id, senderId, listing.user_id, parsedAmount, note?.trim() || null]);
    await coinService.spendCoins({
      userId: senderId,
      amount: parsedAmount,
      transactionType: 'tip',
      referenceType: 'tip',
      referenceId: result.lastID,
      metadata: { listingId: listing.id, receiverId: listing.user_id },
      note: `Napiwek dla ogłoszenia: ${listing.title}`
    });
    await coinService.appendTransaction({
      userId: listing.user_id,
      amount: parsedAmount,
      transactionType: 'tip',
      referenceType: 'tip',
      referenceId: result.lastID,
      metadata: { listingId: listing.id, senderId },
      note: `Otrzymany napiwek za ogłoszenie: ${listing.title}`
    });
    await run('COMMIT');
    return { tipId: result.lastID, amount: parsedAmount };
  } catch (error) {
    await run('ROLLBACK');
    throw error;
  }
}

async function getTipHistory(userId) {
  return all(`
    SELECT t.*, l.title AS listing_title, s.name AS sender_name, s.email AS sender_email, r.name AS receiver_name, r.email AS receiver_email
    FROM tips t
    JOIN listings l ON l.id = t.listing_id
    JOIN users s ON s.id = t.sender_id
    JOIN users r ON r.id = t.receiver_id
    WHERE t.sender_id = ? OR t.receiver_id = ?
    ORDER BY datetime(t.created_at) DESC, t.id DESC
  `, [userId, userId]);
}

module.exports = {
  getTipHistory,
  sendTip
};
