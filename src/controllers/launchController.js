const { appName } = require('../config/constants');
const { run } = require('../db');
const { flash } = require('../middleware/flash');

function renderComingSoon(_req, res) {
  return res.status(200).render('launch/coming-soon', {
    title: 'Strona jest w budowie',
    metaDescription: 'Spotykaj jest w budowie. Zostaw e-mail, a powiadomimy Cię o starcie.',
    canonicalUrl: 'https://spotykaj.pl/',
    appName
  });
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

async function subscribe(req, res, next) {
  const email = normalizeEmail(req.body.email);

  if (!isValidEmail(email)) {
    flash(req, 'error', 'Podaj prawidłowy adres e-mail.');
    return res.redirect('/');
  }

  try {
    await run(`
      INSERT OR IGNORE INTO launch_subscribers (email, ip, user_agent)
      VALUES (?, ?, ?)
    `, [email, req.ip || null, req.get('user-agent') || null]);

    flash(req, 'success', 'Dziękujemy. Powiadomimy Cię o starcie Spotykaj.');
    return res.redirect('/');
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  renderComingSoon,
  subscribe
};
