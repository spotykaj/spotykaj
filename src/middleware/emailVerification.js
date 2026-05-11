const { flash } = require('./flash');

function requireEmailVerified(req, res, next) {
  const user = res.locals.user;
  if (!user) return next();
  if (user.role === 'admin' || user.email_verified_at) return next();
  const message = 'Potwierdź adres e-mail, aby skorzystać z tej funkcji.';
  if (req.is('application/json') || req.xhr || (req.accepts('json') && !req.accepts('html'))) {
    return res.status(403).json({ ok: false, message });
  }
  flash(req, 'error', message);
  return res.redirect('/weryfikacja-email');
}

module.exports = {
  requireEmailVerified
};
