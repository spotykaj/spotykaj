const { get } = require('../db');
const { regiony, kategorie } = require('../config/constants');
const { getTurnstileConfig } = require('../config/securityStatus');
const { flash } = require('./flash');

async function loadLocals(req, res, next) {
  res.locals.user = null;
  res.locals.flash = req.session.flash;
  res.locals.regiony = regiony;
  res.locals.kategorie = kategorie;
  res.locals.searchFilters = {
    q: req.query.q?.trim() || '',
    city: req.query.city?.trim() || '',
    category: req.query.category || ''
  };
  res.locals.turnstile = getTurnstileConfig();
  res.locals.isLegalPage = ['/regulamin', '/polityka-prywatnosci', '/zasady-zdjec'].includes(req.path);
  delete req.session.flash;

  if (!req.session.userId) return next();
  try {
    res.locals.user = await get('SELECT id, name, username, account_type, email, role, coins, profile_verified, session_version FROM users WHERE id = ? AND deleted_at IS NULL', [req.session.userId]);
    if (!res.locals.user || Number(req.session.sessionVersion || 0) !== Number(res.locals.user.session_version || 0)) {
      req.session.destroy(() => {});
      res.locals.user = null;
      res.locals.flash = { type: 'error', message: 'Sesja wygasła. Zaloguj się ponownie.' };
    }
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireAuth(req, res, next) {
  if (res.locals.user) return next();
  flash(req, 'error', 'Zaloguj się, aby przejść dalej.');
  return res.redirect('/logowanie');
}

function requireAdmin(req, res, next) {
  if (res.locals.user?.role === 'admin') return next();
  flash(req, 'error', 'Brak dostępu do panelu administracyjnego.');
  return res.redirect('/');
}

function requireModerator(req, res, next) {
  if (res.locals.user?.role === 'moderator' || res.locals.user?.role === 'admin') return next();
  flash(req, 'error', 'Brak dostępu do panelu moderatora.');
  return res.redirect(res.locals.user ? '/panel' : '/logowanie');
}

module.exports = {
  loadLocals,
  requireAuth,
  requireAdmin,
  requireModerator
};
