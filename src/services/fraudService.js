const { run, all } = require('../db');
const accountSecurityService = require('./accountSecurityService');

async function flagSuspicious({ userId = null, ip = null, eventType, score = 1, metadata = null }) {
  await run(`
    INSERT INTO suspicious_activity (user_id, ip, event_type, score, metadata)
    VALUES (?, ?, ?, ?, ?)
  `, [
    userId || null,
    ip || null,
    eventType,
    score,
    metadata ? JSON.stringify(metadata, Object.keys(metadata).sort()) : null
  ]);
  if (String(eventType || '').match(/spam|abuse|blocked_upload|rate_limit/i) || Number(score || 0) >= 3) {
    await accountSecurityService.notifyAdmins(
      'Wykryto podejrzaną aktywność',
      `System wykrył zdarzenie bezpieczeństwa: ${eventType}.`
    ).catch(() => {});
  }
}

async function getSuspiciousActivity(limit = 50) {
  return all(`
    SELECT s.*, u.name AS user_name, u.email AS user_email
    FROM suspicious_activity s
    LEFT JOIN users u ON u.id = s.user_id
    ORDER BY s.id DESC
    LIMIT ?
  `, [limit]);
}

module.exports = {
  flagSuspicious,
  getSuspiciousActivity
};
