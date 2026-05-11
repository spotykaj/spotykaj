const { getTurnstileConfig } = require('../config/securityStatus');
const fs = require('fs');

const TURNSTILE_ERROR = 'Nie udało się potwierdzić zabezpieczenia. Spróbuj ponownie.';

function getToken(req) {
  return req.body?.['cf-turnstile-response'] || req.body?.turnstileToken || '';
}

function reject(req, res) {
  [req.file, ...Object.values(req.files || {}).flat()].filter(Boolean).forEach((file) => {
    if (file.path) {
      try { fs.unlinkSync(file.path); } catch (error) {}
    }
  });
  const contentType = req.get?.('content-type') || '';
  const wantsJson = req.is?.('application/json') || contentType.includes('application/json') || req.xhr || (req.accepts?.('json') && !req.accepts?.('html'));
  if (wantsJson) {
    return res.status(400).json({ ok: false, message: TURNSTILE_ERROR });
  }
  const { flash } = require('./flash');
  flash(req, 'error', TURNSTILE_ERROR);
  return res.redirect(req.get('referer') || '/');
}

async function verifyTurnstile(req, res, next) {
  const config = getTurnstileConfig();
  if (!config.enabled) return next();

  const token = String(getToken(req) || '').trim();
  if (!token || !config.secretKey) return reject(req, res);

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: config.secretKey,
        response: token,
        remoteip: req.ip || ''
      })
    });
    const payload = await response.json();
    if (!payload.success) return reject(req, res);
    return next();
  } catch (error) {
    return reject(req, res);
  }
}

module.exports = {
  TURNSTILE_ERROR,
  verifyTurnstile
};
