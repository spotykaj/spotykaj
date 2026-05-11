const crypto = require('crypto');
const fs = require('fs');
const fraudService = require('../services/fraudService');
const { flash } = require('./flash');

const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CSRF_ERROR = 'Formularz wygasł. Odśwież stronę i spróbuj ponownie.';

function ensureToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

function tokenFromRequest(req) {
  return String(
    req.body?._csrf
    || req.query?._csrf
    || req.get('x-csrf-token')
    || req.get('csrf-token')
    || ''
  );
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function wantsJson(req) {
  return req.is('application/json') || req.xhr || (req.accepts('json') && !req.accepts('html'));
}

async function reject(req, res) {
  [req.file, ...Object.values(req.files || {}).flat()].filter(Boolean).forEach((file) => {
    if (file.path) {
      try { fs.unlinkSync(file.path); } catch (error) {}
    }
  });
  try {
    await fraudService.flagSuspicious({
      userId: req.session?.userId || null,
      ip: req.ip,
      eventType: 'csrf_rejected',
      score: 3,
      metadata: { path: req.path, method: req.method }
    });
  } catch (error) {}

  if (wantsJson(req)) {
    return res.status(403).json({ ok: false, message: CSRF_ERROR });
  }
  flash(req, 'error', CSRF_ERROR);
  return res.status(403).render('error', { title: 'Formularz odrzucony', message: CSRF_ERROR });
}

function injectToken(html, token) {
  if (!token || typeof html !== 'string' || !html.includes('<form')) return html;
  let output = html.replace(
    /<head([^>]*)>/i,
    `<head$1>\n  <meta name="csrf-token" content="${token}">`
  );
  output = output.replace(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi, (match, attrs, body) => {
    if (!/\bmethod\s*=\s*["']?post["']?/i.test(attrs) || /\bname\s*=\s*["']_csrf["']/i.test(body)) {
      return match;
    }
    return match.replace(/<form\b([^>]*)>/i, `$&<input type="hidden" name="_csrf" value="${token}">`);
  });
  return output;
}

function csrfProtection(req, res, next) {
  const token = ensureToken(req);
  res.locals.csrfToken = token;

  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const contentType = String(res.get('content-type') || '');
    if (contentType.includes('text/html') && typeof body === 'string') {
      return originalSend(injectToken(body, token));
    }
    return originalSend(body);
  };

  if (!unsafeMethods.has(req.method)) return next();
  if (String(req.get('content-type') || '').includes('multipart/form-data')) return next();
  if (safeEqual(tokenFromRequest(req), token)) return next();
  return reject(req, res);
}

function requireCsrf(req, res, next) {
  const token = ensureToken(req);
  res.locals.csrfToken = token;
  if (!unsafeMethods.has(req.method) || safeEqual(tokenFromRequest(req), token)) return next();
  return reject(req, res);
}

module.exports = {
  CSRF_ERROR,
  csrfProtection,
  requireCsrf
};
