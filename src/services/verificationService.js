const fs = require('fs');
const { run, get, all } = require('../db');
const auditService = require('./auditService');
const fraudService = require('./fraudService');
const accountSecurityService = require('./accountSecurityService');

function validationError(message) {
  const error = new Error(message);
  error.code = 'VALIDATION_ERROR';
  return error;
}

function forbidden(message) {
  const error = new Error(message);
  error.code = 'FORBIDDEN';
  return error;
}

function uploadedPath(file) {
  return file ? `/uploads/verifications/${file.filename}` : null;
}

function isAllowedImageSignature(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return true;
  const buffer = fs.readFileSync(filePath);
  if (buffer.length < 12) return false;
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng = buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP';
  return isJpeg || isPng || isWebp;
}

async function validateUploadedImage(userId, file) {
  if (!file || isAllowedImageSignature(file.path)) return;
  try {
    fs.unlinkSync(file.path);
  } catch (error) {
    // Best effort cleanup after rejecting an invalid upload.
  }
  await fraudService.flagSuspicious({
    userId,
    eventType: 'blocked_upload',
    score: 3,
    metadata: { filename: file.originalname, mimetype: file.mimetype, reason: 'verification_signature' }
  }).catch(() => {});
  throw validationError('Dodaj prawidłowy plik JPG, PNG albo WEBP.');
}

async function getLatestUserRequest(userId) {
  return get(`
    SELECT r.*, reviewer.name AS reviewer_name, reviewer.email AS reviewer_email
    FROM verification_requests r
    LEFT JOIN users reviewer ON reviewer.id = r.reviewer_id
    WHERE r.user_id = ?
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT 1
  `, [userId]);
}

async function submitRequest({ userId, documentFile, selfieFile, note }) {
  const user = await get('SELECT id, profile_verified FROM users WHERE id = ?', [userId]);
  if (!user) throw validationError('Nie znaleziono użytkownika.');
  if (Number(user.profile_verified || 0)) {
    throw validationError('Profil jest już zweryfikowany.');
  }
  if (!documentFile || !selfieFile) {
    throw validationError('Dodaj zdjęcie dokumentu oraz selfie z kartką.');
  }
  await validateUploadedImage(userId, documentFile);
  await validateUploadedImage(userId, selfieFile);

  const pending = await get(`
    SELECT id FROM verification_requests
    WHERE user_id = ? AND status = 'pending'
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `, [userId]);
  if (pending) {
    throw validationError('Twoja weryfikacja oczekuje już na sprawdzenie.');
  }

  const result = await run(`
    INSERT INTO verification_requests (user_id, document_image_path, selfie_image_path, note, status)
    VALUES (?, ?, ?, ?, 'pending')
  `, [
    userId,
    uploadedPath(documentFile),
    uploadedPath(selfieFile),
    String(note || '').trim() || null
  ]);
  await accountSecurityService.notifyAdmins(
    'Nowy wniosek o weryfikację profilu',
    `Użytkownik ${userId} wysłał wniosek o weryfikację profilu.`
  );
  return result.lastID;
}

async function getPendingRequests() {
  return all(`
    SELECT r.*, u.name AS user_name, u.email AS user_email
    FROM verification_requests r
    JOIN users u ON u.id = r.user_id
    WHERE r.status = 'pending'
    ORDER BY r.created_at ASC, r.id ASC
  `);
}

async function getRequestsForAdmin(limit = 100) {
  return all(`
    SELECT r.*, u.name AS user_name, u.email AS user_email,
      reviewer.name AS reviewer_name, reviewer.email AS reviewer_email
    FROM verification_requests r
    JOIN users u ON u.id = r.user_id
    LEFT JOIN users reviewer ON reviewer.id = r.reviewer_id
    ORDER BY
      CASE r.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
      r.created_at DESC,
      r.id DESC
    LIMIT ?
  `, [limit]);
}

async function ensureReviewer(reviewerId) {
  const reviewer = await get('SELECT id, role FROM users WHERE id = ?', [reviewerId]);
  if (reviewer?.role === 'admin' || reviewer?.role === 'moderator') return reviewer;
  throw forbidden('Brak dostępu do tej operacji.');
}

async function getRequestForReview(requestId) {
  const request = await get('SELECT * FROM verification_requests WHERE id = ?', [requestId]);
  if (!request) {
    const error = new Error('Nie znaleziono wniosku weryfikacyjnego.');
    error.code = 'NOT_FOUND';
    throw error;
  }
  if (request.status !== 'pending') {
    throw validationError('Ten wniosek został już rozpatrzony.');
  }
  return request;
}

async function approveRequest({ requestId, reviewerId, reviewerNote }) {
  await ensureReviewer(reviewerId);
  const request = await getRequestForReview(requestId);
  if (Number(request.user_id) === Number(reviewerId)) {
    throw forbidden('Nie możesz rozpatrzyć własnego wniosku.');
  }

  await run('BEGIN TRANSACTION');
  try {
    await run(`
      UPDATE verification_requests
      SET status = 'approved', reviewer_id = ?, reviewer_note = ?, reviewed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'pending'
    `, [reviewerId, String(reviewerNote || '').trim() || null, request.id]);
    await run('UPDATE users SET profile_verified = 1 WHERE id = ?', [request.user_id]);
    await auditService.logAction({
      adminId: reviewerId,
      actionType: 'approve_verification',
      targetType: 'verification_request',
      targetId: request.id,
      metadata: { userId: request.user_id }
    });
    await run('COMMIT');
    return { status: 'approved' };
  } catch (error) {
    await run('ROLLBACK');
    throw error;
  }
}

async function rejectRequest({ requestId, reviewerId, reviewerNote }) {
  await ensureReviewer(reviewerId);
  const request = await getRequestForReview(requestId);
  if (Number(request.user_id) === Number(reviewerId)) {
    throw forbidden('Nie możesz rozpatrzyć własnego wniosku.');
  }
  if (!String(reviewerNote || '').trim()) {
    throw validationError('Podaj powód odrzucenia weryfikacji.');
  }

  await run(`
    UPDATE verification_requests
    SET status = 'rejected', reviewer_id = ?, reviewer_note = ?, reviewed_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'pending'
  `, [reviewerId, String(reviewerNote || '').trim() || null, request.id]);
  await auditService.logAction({
    adminId: reviewerId,
    actionType: 'reject_verification',
    targetType: 'verification_request',
    targetId: request.id,
    metadata: { userId: request.user_id, reason: String(reviewerNote || '').trim() }
  });
  return { status: 'rejected' };
}

module.exports = {
  approveRequest,
  getLatestUserRequest,
  getPendingRequests,
  getRequestsForAdmin,
  rejectRequest,
  submitRequest
};
