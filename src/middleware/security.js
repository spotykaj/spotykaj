const { flash } = require('./flash');
const { get } = require('../db');

const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function sameOriginGuard(req, res, next) {
  if (!unsafeMethods.has(req.method)) return next();

  const origin = req.get('origin');
  const referer = req.get('referer');
  const host = req.get('host');
  const source = origin || referer;

  if (!source || !host) return next();

  try {
    const sourceUrl = new URL(source);
    if (sourceUrl.host === host) return next();
  } catch (error) {
    flash(req, 'error', 'Nieprawidłowe źródło formularza.');
    return res.status(403).render('error', {
      title: 'Brak dostępu',
      message: 'Nieprawidłowe źródło formularza.'
    });
  }

  flash(req, 'error', 'Formularz został odrzucony ze względów bezpieczeństwa.');
  return res.status(403).render('error', {
    title: 'Brak dostępu',
    message: 'Formularz został odrzucony ze względów bezpieczeństwa.'
  });
}

async function protectVerificationUploads(req, res, next) {
  if (!req.path.startsWith('/uploads/verifications/')) return next();
  const user = res.locals.user;
  if (!user) return res.status(404).render('error', { title: 'Nie znaleziono', message: 'Nie znaleziono pliku.' });
  if (user.role === 'admin' || user.role === 'moderator') return next();

  try {
    const request = await get(`
      SELECT id
      FROM verification_requests
      WHERE user_id = ?
        AND (document_image_path = ? OR selfie_image_path = ?)
      LIMIT 1
    `, [user.id, req.path, req.path]);
    if (request) return next();
    return res.status(404).render('error', { title: 'Nie znaleziono', message: 'Nie znaleziono pliku.' });
  } catch (error) {
    return next(error);
  }
}

function blockSensitivePaths(req, res, next) {
  if (/\/(?:\.env|backups|logs|\.git)(?:\/|$)/i.test(req.path)) {
    return res.status(404).render('error', { title: 'Nie znaleziono', message: 'Ta strona nie istnieje.' });
  }
  return next();
}

module.exports = {
  blockSensitivePaths,
  protectVerificationUploads,
  sameOriginGuard
};
