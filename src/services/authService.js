const bcrypt = require('bcryptjs');
const { run, get } = require('../db');
const accountSecurityService = require('./accountSecurityService');

const ACCOUNT_TYPES = ['prywatne', 'agencja', 'salon_masazu'];
const USERNAME_PATTERN = /^[A-Za-z0-9_-]+$/;

function validationError(message) {
  const error = new Error(message);
  error.code = 'VALIDATION_ERROR';
  return error;
}

function normalizeAccepted(value) {
  return value === true || value === 'on' || value === '1' || value === 'true';
}

async function registerUser(payload = {}) {
  const username = String(payload.username || '').trim();
  const fullName = String(payload.full_name || payload.name || '').trim();
  const email = String(payload.email || '').trim().toLowerCase();
  const password = String(payload.password || '');
  const passwordConfirmation = String(payload.password_confirmation || payload.confirm_password || '');
  const accountType = ACCOUNT_TYPES.includes(payload.account_type) ? payload.account_type : '';

  if (username.length < 3 || username.length > 30 || !USERNAME_PATTERN.test(username)) {
    throw validationError('Nazwa użytkownika musi mieć 3-30 znaków i może zawierać tylko litery, cyfry, podkreślenie oraz myślnik.');
  }
  if (!fullName) {
    throw validationError('Imię i nazwisko jest wymagane.');
  }
  if (!email) {
    throw validationError('Adres e-mail jest wymagany.');
  }
  if (!password || password.length < 6) {
    throw validationError('Hasło musi mieć co najmniej 6 znaków.');
  }
  if (password !== passwordConfirmation) {
    throw validationError('Hasła muszą być takie same.');
  }
  if (!accountType) {
    throw validationError('Wybierz rodzaj konta.');
  }
  if (!normalizeAccepted(payload.legal_acceptance)) {
    throw validationError('Potwierdź pełnoletność oraz akceptację Regulaminu i Polityki prywatności.');
  }

  const existingUsername = await get('SELECT id FROM users WHERE lower(username) = lower(?)', [username]);
  if (existingUsername) {
    const error = new Error('Ta nazwa użytkownika jest już zajęta.');
    error.code = 'USERNAME_TAKEN';
    throw error;
  }
  const existingEmail = await get('SELECT id FROM users WHERE email = ?', [email]);
  if (existingEmail) {
    const error = new Error('Ten adres e-mail jest już zajęty.');
    error.code = 'EMAIL_TAKEN';
    throw error;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const result = await run(
    'INSERT INTO users (name, username, account_type, email, password_hash) VALUES (?, ?, ?, ?, ?)',
    [fullName, username, accountType, email, passwordHash]
  );
  await accountSecurityService.sendVerificationEmail(result.lastID);
  return result.lastID;
}

async function authenticateUser(email, password) {
  const normalizedEmail = email?.trim().toLowerCase();
  const user = await get('SELECT * FROM users WHERE email = ? AND deleted_at IS NULL', [normalizedEmail]);
  if (!user || !(await bcrypt.compare(password || '', user.password_hash))) {
    return null;
  }
  return user;
}

async function logoutAllSessions(userId) {
  await run('UPDATE users SET session_version = COALESCE(session_version, 0) + 1 WHERE id = ?', [userId]);
}

module.exports = {
  authenticateUser,
  logoutAllSessions,
  registerUser
};
