const { run, all } = require('../db');

async function logAction({ adminId, actionType, targetType, targetId, metadata = null }) {
  await run(`
    INSERT INTO admin_audit_log (admin_id, action_type, target_type, target_id, metadata)
    VALUES (?, ?, ?, ?, ?)
  `, [
    adminId || null,
    actionType,
    targetType,
    targetId === undefined || targetId === null ? null : String(targetId),
    metadata ? JSON.stringify(metadata, Object.keys(metadata).sort()) : null
  ]);
}

async function getRecentAuditLog(limit = 50) {
  return all(`
    SELECT l.*, u.name AS admin_name, u.email AS admin_email
    FROM admin_audit_log l
    LEFT JOIN users u ON u.id = l.admin_id
    ORDER BY l.id DESC
    LIMIT ?
  `, [limit]);
}

module.exports = {
  getRecentAuditLog,
  logAction
};
