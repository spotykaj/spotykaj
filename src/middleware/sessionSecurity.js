const { flash } = require('./flash');

const DEFAULT_INACTIVITY_MS = 30 * 60 * 1000;

function sessionActivity(timeoutMs = Number(process.env.SESSION_IDLE_TIMEOUT_MS || DEFAULT_INACTIVITY_MS)) {
  return function sessionActivityMiddleware(req, res, next) {
    if (!req.session) return next();
    const now = Date.now();
    const lastActivity = Number(req.session.lastActivity || now);

    if (req.session.userId && now - lastActivity > timeoutMs) {
      delete req.session.userId;
      delete req.session.sessionVersion;
      flash(req, 'error', 'Sesja wygasła z powodu braku aktywności. Zaloguj się ponownie.');
      return res.redirect('/logowanie');
    }

    req.session.lastActivity = now;
    return next();
  };
}

module.exports = {
  sessionActivity
};
