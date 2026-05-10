const coinService = require('./coinService');
const { run, get, all, isInTransaction } = require('../db');
const auditService = require('./auditService');
const fraudService = require('./fraudService');

const packages = [
  { priceEur: 25, amount: 145, label: 'Crypto Code' },
  { priceEur: 50, amount: 290, label: 'Crypto Code' },
  { priceEur: 100, amount: 575, label: 'Crypto Code' },
  { priceEur: 150, amount: 1290, label: 'Crypto Code' },
  { priceEur: 300, amount: 1725, label: 'Crypto Code' },
  { priceEur: 700, amount: 4865, label: 'Crypto Code' }
];

function getPackages() {
  return packages.map((item) => ({
    priceEur: item.priceEur,
    amount: item.amount,
    label: item.label
  }));
}

function getPackage(amount) {
  const parsedAmount = Number.parseInt(amount, 10);
  return getPackages().find((item) => item.amount === parsedAmount);
}

function validationError(message) {
  const error = new Error(message);
  error.code = 'VALIDATION_ERROR';
  return error;
}

function normalizeOptional(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

async function activateVoucher({ userId, amount, code, voucherEmail, ltcTxid, userNote }) {
  const selectedPackage = getPackage(amount);
  if (!selectedPackage) {
    throw validationError('Wybierz prawidłowy pakiet Spotycoin.');
  }

  const normalizedCode = String(code || '').trim().toUpperCase();
  if (!normalizedCode) {
    throw validationError('Wpisz kod lub numer vouchera.');
  }
  const normalizedEmail = normalizeOptional(voucherEmail);
  const normalizedTxid = normalizeOptional(ltcTxid);
  const normalizedNote = normalizeOptional(userNote);
  if (!normalizedEmail && !normalizedTxid) {
    throw validationError('Podaj e-mail użyty przy realizacji vouchera albo TXID Litecoin.');
  }
  try {
    const result = await run(`
      INSERT INTO spotycoin_purchase_requests (
        user_id, package_eur, package_spotycoins, crypto_code, voucher_email, ltc_txid, user_note, status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `, [userId, selectedPackage.priceEur, selectedPackage.amount, normalizedCode, normalizedEmail, normalizedTxid, normalizedNote]);

    return {
      id: result.lastID,
      packageAmount: selectedPackage.amount,
      priceEur: selectedPackage.priceEur,
      status: 'pending'
    };
  } catch (error) {
    if (String(error.message || '').includes('UNIQUE')) {
      await fraudService.flagSuspicious({
        userId,
        eventType: 'duplicate_voucher_attempt',
        score: 3,
        metadata: { code: normalizedCode, ltcTxid: normalizedTxid }
      });
      const existingCode = await get('SELECT id FROM spotycoin_purchase_requests WHERE crypto_code = ?', [normalizedCode]);
      if (existingCode) throw validationError('Ten kod został już wysłany do weryfikacji.');
      if (normalizedTxid) {
        const existingTxid = await get('SELECT id FROM spotycoin_purchase_requests WHERE ltc_txid = ?', [normalizedTxid]);
        if (existingTxid) throw validationError('Ten TXID Litecoin został już wysłany do weryfikacji.');
      }
      throw validationError('To zgłoszenie zostało już wysłane do weryfikacji.');
    }
    throw error;
  }
}

async function ensureReviewer(adminId) {
  const admin = await get('SELECT id, role FROM users WHERE id = ?', [adminId]);
  if (admin?.role === 'admin' || admin?.role === 'moderator') return admin;
  const error = new Error('Brak dostępu do tej operacji.');
  error.code = 'FORBIDDEN';
  throw error;
}

async function getRequestForReview(requestId) {
  const request = await get('SELECT * FROM spotycoin_purchase_requests WHERE id = ?', [requestId]);
  if (!request) {
    const error = new Error('Nie znaleziono wniosku.');
    error.code = 'NOT_FOUND';
    throw error;
  }
  if (request.status !== 'pending') {
    const error = new Error('Ten wniosek został już rozpatrzony.');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  return request;
}

async function approveRequest({ requestId, adminId, adminNote }) {
  await ensureReviewer(adminId);
  const request = await getRequestForReview(requestId);

  const ownsTransaction = !isInTransaction();
  if (ownsTransaction) await run('BEGIN TRANSACTION');
  try {
    const ledger = await coinService.appendTransaction({
      userId: request.user_id,
      adminId,
      amount: request.package_spotycoins,
      transactionType: 'purchase',
      referenceType: 'spotycoin_purchase_request',
      referenceId: request.id,
      metadata: {
        packageAmount: request.package_spotycoins,
        priceEur: request.package_eur,
        code: request.crypto_code,
        voucherEmail: request.voucher_email,
        ltcTxid: request.ltc_txid,
        requestId: request.id
      },
      note: `Zatwierdzony zakup ${request.package_spotycoins} Spotycoinów po weryfikacji płatności LTC`
    });
    await run(`
      UPDATE spotycoin_purchase_requests
      SET status = 'approved', admin_id = ?, admin_note = ?, reviewed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'pending'
    `, [adminId, adminNote?.trim() || null, request.id]);
    await auditService.logAction({
      adminId,
      actionType: 'approve_coins',
      targetType: 'spotycoin_purchase_request',
      targetId: request.id,
      metadata: { userId: request.user_id, amount: request.package_spotycoins }
    });
    if (ownsTransaction) await run('COMMIT');
    return { ...ledger, status: 'approved' };
  } catch (error) {
    if (ownsTransaction) await run('ROLLBACK');
    throw error;
  }
}

async function rejectRequest({ requestId, adminId, adminNote }) {
  await ensureReviewer(adminId);
  const request = await getRequestForReview(requestId);

  await run(`
    UPDATE spotycoin_purchase_requests
    SET status = 'rejected', admin_id = ?, admin_note = ?, reviewed_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'pending'
  `, [adminId, adminNote?.trim() || null, request.id]);
  await auditService.logAction({
    adminId,
    actionType: 'reject_coins',
    targetType: 'spotycoin_purchase_request',
    targetId: request.id,
    metadata: { userId: request.user_id, note: adminNote?.trim() || null }
  });

  return { status: 'rejected' };
}

async function getUserPurchaseRequests(userId) {
  return all(`
    SELECT *
    FROM spotycoin_purchase_requests
    WHERE user_id = ?
    ORDER BY created_at DESC, id DESC
  `, [userId]);
}

async function getPurchaseRequestsForAdmin(limit = 100) {
  return all(`
    SELECT r.*, u.name AS user_name, u.email AS user_email, a.name AS admin_name, a.email AS admin_email
    FROM spotycoin_purchase_requests r
    JOIN users u ON u.id = r.user_id
    LEFT JOIN users a ON a.id = r.admin_id
    ORDER BY
      CASE r.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
      r.created_at DESC,
      r.id DESC
    LIMIT ?
  `, [limit]);
}

module.exports = {
  activateVoucher,
  approveRequest,
  getPackages,
  getPurchaseRequestsForAdmin,
  getUserPurchaseRequests,
  rejectRequest
};
