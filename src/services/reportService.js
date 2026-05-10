const { run, all } = require('../db');
const auditService = require('./auditService');

const ALLOWED_REASONS = ['Spam', 'Fałszywe zdjęcia', 'Nieletni', 'Scam', 'Inne'];

function validationError(message) {
  const error = new Error(message);
  error.code = 'VALIDATION_ERROR';
  return error;
}

async function createReport({ listingId, reporterId, reason, note }) {
  if (!ALLOWED_REASONS.includes(reason)) {
    throw validationError('Wybierz prawidłowy powód zgłoszenia.');
  }
  const result = await run(`
    INSERT INTO listing_reports (listing_id, reporter_id, reason, note, status)
    VALUES (?, ?, ?, ?, 'pending')
  `, [listingId, reporterId || null, reason, String(note || '').trim() || null]);
  return result.lastID;
}

async function getReportsForModeration(limit = 100) {
  return all(`
    SELECT r.*, l.title AS listing_title, l.status AS listing_status,
      reporter.name AS reporter_name, reporter.email AS reporter_email,
      reviewer.name AS reviewer_name, reviewer.email AS reviewer_email
    FROM listing_reports r
    JOIN listings l ON l.id = r.listing_id
    LEFT JOIN users reporter ON reporter.id = r.reporter_id
    LEFT JOIN users reviewer ON reviewer.id = r.reviewer_id
    WHERE r.status = 'pending'
    ORDER BY r.created_at ASC, r.id ASC
    LIMIT ?
  `, [limit]);
}

async function reviewReport({ reportId, reviewerId, status, reviewerNote }) {
  const normalized = status === 'resolved' ? 'resolved' : 'dismissed';
  const result = await run(`
    UPDATE listing_reports
    SET status = ?, reviewer_id = ?, reviewer_note = ?, reviewed_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'pending'
  `, [normalized, reviewerId, String(reviewerNote || '').trim() || null, reportId]);
  if (!result.changes) throw validationError('Nie znaleziono aktywnego zgłoszenia.');
  await auditService.logAction({
    adminId: reviewerId,
    actionType: `report_${normalized}`,
    targetType: 'listing_report',
    targetId: reportId,
    metadata: { reviewerNote: String(reviewerNote || '').trim() || null }
  });
}

module.exports = {
  ALLOWED_REASONS,
  createReport,
  getReportsForModeration,
  reviewReport
};
