const authService = require('../services/authService');
const fraudService = require('../services/fraudService');
const { flash } = require('../middleware/flash');

function showRegister(_req, res) {
  res.render('auth/register', { title: 'Rejestracja' });
}

async function register(req, res, next) {
  try {
    const userId = await authService.registerUser(req.body);
    req.session.userId = userId;
    flash(req, 'success', 'Konto zostało utworzone.');
    return res.redirect('/panel');
  } catch (error) {
    if (['VALIDATION_ERROR', 'USERNAME_TAKEN', 'EMAIL_TAKEN'].includes(error.code)) {
      flash(req, 'error', error.message);
      return res.redirect('/rejestracja');
    }
    if (error.message.includes('UNIQUE')) {
      flash(req, 'error', 'Ten adres e-mail jest już zajęty.');
      return res.redirect('/rejestracja');
    }
    return next(error);
  }
}

function showLogin(_req, res) {
  res.render('auth/login', { title: 'Logowanie' });
}

async function login(req, res, next) {
  try {
    const user = await authService.authenticateUser(req.body.email, req.body.password);
    if (!user) {
      await fraudService.flagSuspicious({
        ip: req.ip,
        eventType: 'failed_login',
        score: 1,
        metadata: { email: req.body.email }
      });
      flash(req, 'error', 'Nieprawidłowy e-mail lub hasło.');
      return res.redirect('/logowanie');
    }
    req.session.userId = user.id;
    req.session.sessionVersion = Number(user.session_version || 0);
    flash(req, 'success', 'Zalogowano pomyślnie.');
    return res.redirect('/panel');
  } catch (error) {
    return next(error);
  }
}

function logout(req, res) {
  req.session.destroy(() => res.redirect('/'));
}

async function logoutAll(req, res, next) {
  try {
    if (res.locals.user) await authService.logoutAllSessions(res.locals.user.id);
    req.session.destroy(() => res.redirect('/logowanie'));
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  login,
  logout,
  logoutAll,
  register,
  showLogin,
  showRegister
};
