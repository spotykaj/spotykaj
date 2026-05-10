const { run, get, all } = require('../db');
const auditService = require('./auditService');
const bcrypt = require('bcryptjs');

const ALLOWED_ROLES = ['user', 'moderator', 'admin'];
const ACCOUNT_TYPES = ['prywatne', 'agencja', 'salon_masazu'];
const USERNAME_PATTERN = /^[A-Za-z0-9_-]+$/;

function validationError(message) {
  const error = new Error(message);
  error.code = 'VALIDATION_ERROR';
  return error;
}

async function getUsersForAdmin() {
  return all('SELECT id, name, email, role, coins, profile_verified, created_at FROM users ORDER BY created_at DESC');
}

async function getProfilesForModeration() {
  return all(`
    SELECT id, name, email, role, profile_verified, created_at
    FROM users
    WHERE role != 'admin' AND COALESCE(profile_verified, 0) = 0
    ORDER BY created_at DESC
  `);
}

async function ensureAdminActor(actor) {
  if (actor?.role === 'admin') return;
  const error = new Error('Tylko administrator może zmieniać role użytkowników.');
  error.code = 'FORBIDDEN';
  throw error;
}

async function updateUserRole(userId, role, actor = null) {
  await ensureAdminActor(actor);
  const normalizedRole = ALLOWED_ROLES.includes(role) ? role : 'user';
  const current = await get('SELECT id, role FROM users WHERE id = ?', [userId]);
  if (!current) {
    const error = new Error('Nie znaleziono użytkownika.');
    error.code = 'NOT_FOUND';
    throw error;
  }
  if (current.role === 'admin' && normalizedRole !== 'admin') {
    const adminCount = await get("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'");
    if (Number(adminCount?.count || 0) <= 1) {
      const error = new Error('Nie można odebrać roli ostatniemu administratorowi.');
      error.code = 'VALIDATION_ERROR';
      throw error;
    }
  }
  await run('UPDATE users SET role = ? WHERE id = ?', [normalizedRole, userId]);
  await auditService.logAction({
    adminId: actor.id,
    actionType: 'role_change',
    targetType: 'user',
    targetId: userId,
    metadata: { from: current.role, to: normalizedRole }
  });
}

async function updateProfileVerification(userId, verified) {
  const result = await run('UPDATE users SET profile_verified = ? WHERE id = ?', [verified ? 1 : 0, userId]);
  if (!result.changes) {
    const error = new Error('Nie znaleziono użytkownika.');
    error.code = 'NOT_FOUND';
    throw error;
  }
}

async function getUserProfile(userId) {
  const user = await get('SELECT id, name, username, account_type, first_name, last_name, email, profile_verified, coins FROM users WHERE id = ?', [userId]);
  if (!user) {
    const error = new Error('Nie znaleziono użytkownika.');
    error.code = 'NOT_FOUND';
    throw error;
  }
  return user;
}

async function updateUserProfile(userId, payload = {}) {
  const username = String(payload.username || payload.name || '').trim();
  const fullName = String(payload.full_name || '').trim();
  const firstName = String(payload.first_name || payload.firstName || '').trim();
  const lastName = String(payload.last_name || payload.lastName || '').trim();
  const email = String(payload.email || '').trim().toLowerCase();
  const accountType = ACCOUNT_TYPES.includes(payload.account_type) ? payload.account_type : '';
  const password = String(payload.password || '');
  const passwordConfirmation = String(payload.password_confirmation || '');

  if (username.length < 3 || username.length > 30 || !USERNAME_PATTERN.test(username)) {
    throw validationError('Nazwa użytkownika musi mieć 3-30 znaków i może zawierać tylko litery, cyfry, podkreślenie oraz myślnik.');
  }
  if (!fullName || !email) {
    throw validationError('Imię i nazwisko oraz e-mail są wymagane.');
  }
  if (!accountType) {
    throw validationError('Wybierz rodzaj konta.');
  }

  const existingEmail = await get('SELECT id FROM users WHERE email = ? AND id != ?', [email, userId]);
  if (existingEmail) {
    throw validationError('Ten adres e-mail jest już używany.');
  }
  const existingUsername = await get('SELECT id FROM users WHERE lower(username) = lower(?) AND id != ?', [username, userId]);
  if (existingUsername) {
    throw validationError('Ta nazwa użytkownika jest już zajęta.');
  }

  if (password) {
    if (password !== passwordConfirmation) {
      throw validationError('Nowe hasła muszą być takie same.');
    }
    if (password.length < 8) {
      throw validationError('Nowe hasło musi mieć co najmniej 8 znaków.');
    }
    const passwordHash = await bcrypt.hash(password, 10);
    await run(`
      UPDATE users
      SET name = ?, username = ?, account_type = ?, first_name = ?, last_name = ?, email = ?, password_hash = ?
      WHERE id = ?
    `, [fullName, username, accountType, firstName || null, lastName || null, email, passwordHash, userId]);
  } else {
    await run(`
      UPDATE users
      SET name = ?, username = ?, account_type = ?, first_name = ?, last_name = ?, email = ?
      WHERE id = ?
    `, [fullName, username, accountType, firstName || null, lastName || null, email, userId]);
  }

  return getUserProfile(userId);
}

module.exports = {
  getUserProfile,
  getProfilesForModeration,
  getUsersForAdmin,
  updateUserProfile,
  updateProfileVerification,
  updateUserRole
};
