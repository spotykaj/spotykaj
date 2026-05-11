const authService = require('../services/authService');
const accountSecurityService = require('../services/accountSecurityService');
const fraudService = require('../services/fraudService');
const { flash } = require('../middleware/flash');
const { get } = require('../db');

function showRegister(_req, res) {
  res.render('auth/register', { title: 'Rejestracja' });
}

async function register(req, res, next) {
  try {
    const userId = await authService.registerUser(req.body);
    req.session.userId = userId;
    flash(req, 'success', 'Konto zostało utworzone. Sprawdź skrzynkę e-mail i potwierdź adres.');
    return res.redirect('/weryfikacja-email');
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
      const normalizedEmail = String(req.body.email || '').trim().toLowerCase();
      if (normalizedEmail) {
        const user = await get('SELECT id FROM users WHERE email = ?', [normalizedEmail]).catch(() => null);
        if (user) {
          await accountSecurityService.sendSecurityAlert(user.id, 'Podejrzana próba logowania', 'Odnotowaliśmy nieudaną próbę logowania do Twojego konta.');
        }
      }
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

function showEmailVerification(_req, res) {
  return res.render('auth/verify-email', { title: 'Weryfikacja e-mail' });
}

async function verifyEmail(req, res) {
  try {
    await accountSecurityService.verifyEmailToken(req.query.token);
    flash(req, 'success', 'Adres e-mail został potwierdzony.');
    return res.redirect('/panel');
  } catch (error) {
    flash(req, 'error', error.message || 'Link weryfikacyjny jest nieprawidłowy.');
    return res.redirect('/weryfikacja-email');
  }
}

async function resendVerification(req, res, next) {
  try {
    await accountSecurityService.sendVerificationEmail(res.locals.user.id);
    flash(req, 'success', 'Wysłaliśmy nowy link weryfikacyjny.');
    return res.redirect('/weryfikacja-email');
  } catch (error) {
    return next(error);
  }
}

function showForgotPassword(_req, res) {
  return res.render('auth/forgot-password', { title: 'Przypomnij hasło' });
}

async function forgotPassword(req, res, next) {
  try {
    await accountSecurityService.createPasswordReset(req.body.email);
    flash(req, 'success', 'Jeżeli konto istnieje, wysłaliśmy link do resetowania hasła.');
    return res.redirect('/logowanie');
  } catch (error) {
    return next(error);
  }
}

async function showResetPassword(req, res) {
  try {
    await accountSecurityService.getValidPasswordReset(req.query.token);
    return res.render('auth/reset-password', { title: 'Reset hasła', token: req.query.token, invalidMessage: null });
  } catch (error) {
    return res.status(400).render('auth/reset-password', {
      title: 'Reset hasła',
      token: '',
      invalidMessage: error.message || 'Link resetowania hasła jest nieprawidłowy.'
    });
  }
}

async function resetPassword(req, res, next) {
  try {
    await accountSecurityService.resetPassword({
      token: req.body.token,
      password: req.body.password,
      passwordConfirmation: req.body.password_confirmation
    });
    flash(req, 'success', 'Hasło zostało zmienione. Zaloguj się ponownie.');
    return res.redirect('/logowanie');
  } catch (error) {
    if (error.code === 'VALIDATION_ERROR') {
      flash(req, 'error', error.message);
      return res.redirect(`/reset-hasla?token=${encodeURIComponent(req.body.token || '')}`);
    }
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
  forgotPassword,
  login,
  logout,
  logoutAll,
  register,
  resendVerification,
  resetPassword,
  showEmailVerification,
  showForgotPassword,
  showLogin,
  showRegister,
  showResetPassword,
  verifyEmail
};
