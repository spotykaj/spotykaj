const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { run, get } = require('../db');
const mailService = require('./mailService');

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function sqlDate(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function validationError(message) {
  const error = new Error(message);
  error.code = 'VALIDATION_ERROR';
  return error;
}

function createToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function createEmailVerificationToken(userId) {
  const token = createToken();
  await run('UPDATE email_verification_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND used_at IS NULL', [userId]);
  await run(`
    INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
    VALUES (?, ?, ?)
  `, [userId, tokenHash(token), sqlDate(new Date(Date.now() + 24 * 60 * 60 * 1000))]);
  return token;
}

async function sendVerificationEmail(userId) {
  const user = await get('SELECT id, email, email_verified_at FROM users WHERE id = ?', [userId]);
  if (!user || user.email_verified_at) return { skipped: true };
  const token = await createEmailVerificationToken(user.id);
  const url = `${mailService.appBaseUrl()}/weryfikuj-email?token=${encodeURIComponent(token)}`;
  const template = mailService.emailTemplates.verificationEmail({ url });
  return mailService.sendMail({ to: user.email, ...template });
}

async function verifyEmailToken(token) {
  const hash = tokenHash(String(token || ''));
  const row = await get(`
    SELECT t.*, u.email
    FROM email_verification_tokens t
    JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = ? AND t.used_at IS NULL
    LIMIT 1
  `, [hash]);
  if (!row) throw validationError('Link weryfikacyjny jest nieprawidłowy albo został już użyty.');
  if (new Date(`${row.expires_at}Z`) < new Date()) {
    throw validationError('Link weryfikacyjny wygasł. Wyślij nowy link.');
  }
  await run('BEGIN TRANSACTION');
  try {
    await run('UPDATE email_verification_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ?', [row.id]);
    await run('UPDATE users SET email_verified_at = CURRENT_TIMESTAMP, trust_score = MAX(COALESCE(trust_score, 0), 10) WHERE id = ?', [row.user_id]);
    await run('COMMIT');
  } catch (error) {
    await run('ROLLBACK');
    throw error;
  }
  return { userId: row.user_id };
}

async function createPasswordReset(email) {
  const user = await get('SELECT id, email FROM users WHERE email = ? AND deleted_at IS NULL', [String(email || '').trim().toLowerCase()]);
  if (!user) return { sent: false };
  const token = createToken();
  await run('UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND used_at IS NULL', [user.id]);
  await run(`
    INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
    VALUES (?, ?, ?)
  `, [user.id, tokenHash(token), sqlDate(new Date(Date.now() + 60 * 60 * 1000))]);
  const url = `${mailService.appBaseUrl()}/reset-hasla?token=${encodeURIComponent(token)}`;
  const template = mailService.emailTemplates.passwordResetEmail({ url });
  await mailService.sendMail({ to: user.email, ...template });
  return { sent: true };
}

async function getValidPasswordReset(token) {
  const row = await get(`
    SELECT t.*, u.email
    FROM password_reset_tokens t
    JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = ? AND t.used_at IS NULL
    LIMIT 1
  `, [tokenHash(String(token || ''))]);
  if (!row) throw validationError('Link resetowania hasła jest nieprawidłowy albo został już użyty.');
  if (new Date(`${row.expires_at}Z`) < new Date()) {
    throw validationError('Link resetowania hasła wygasł. Wyślij nowy link.');
  }
  return row;
}

async function resetPassword({ token, password, passwordConfirmation }) {
  if (!password || password.length < 8) throw validationError('Nowe hasło musi mieć co najmniej 8 znaków.');
  if (password !== passwordConfirmation) throw validationError('Hasła muszą być takie same.');
  const row = await getValidPasswordReset(token);
  const passwordHash = await bcrypt.hash(password, 10);
  await run('BEGIN TRANSACTION');
  try {
    await run('UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ?', [row.id]);
    await run('UPDATE users SET password_hash = ?, session_version = COALESCE(session_version, 0) + 1 WHERE id = ?', [passwordHash, row.user_id]);
    await run('COMMIT');
  } catch (error) {
    await run('ROLLBACK');
    throw error;
  }
  await sendSecurityAlert(row.user_id, 'Hasło zostało zmienione', 'Hasło do Twojego konta Spotykaj zostało zmienione.');
  return { userId: row.user_id };
}

async function sendSecurityAlert(userId, title, message) {
  const user = await get('SELECT email FROM users WHERE id = ?', [userId]);
  if (!user?.email) return;
  return sendSecurityAlertToEmail(user.email, title, message);
}

async function sendSecurityAlertToEmail(email, title, message) {
  if (!email) return;
  const template = mailService.emailTemplates.securityAlertEmail({ title, message });
  return mailService.sendMail({ to: email, ...template }).catch(() => null);
}

async function notifyAdmins(title, message) {
  const template = mailService.emailTemplates.moderationNoticeEmail({
    title,
    message,
    actionUrl: `${mailService.appBaseUrl()}/admin`
  });
  return mailService.notifyAdmins(template);
}

module.exports = {
  createPasswordReset,
  getValidPasswordReset,
  notifyAdmins,
  resetPassword,
  sendSecurityAlert,
  sendSecurityAlertToEmail,
  sendVerificationEmail,
  verifyEmailToken
};
