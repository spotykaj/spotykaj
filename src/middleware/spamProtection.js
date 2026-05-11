const crypto = require('crypto');
const fs = require('fs');
const fraudService = require('../services/fraudService');
const { flash } = require('./flash');

const recentSubmissions = new Map();

function normalizeValue(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function submissionKey(req, scope, fields) {
  const identity = req.session?.userId || req.ip || 'guest';
  const payload = fields.map((field) => normalizeValue(req.body?.[field])).join('|');
  const hash = crypto.createHash('sha256').update(payload).digest('hex');
  return `${scope}:${identity}:${hash}`;
}

function hasRequiredContent(req, fields) {
  return fields.some((field) => normalizeValue(req.body?.[field]).length > 0);
}

function wantsJson(req) {
  return req.is('application/json') || req.xhr || (req.accepts('json') && !req.accepts('html'));
}

function reject(req, res, message) {
  [req.file, ...Object.values(req.files || {}).flat()].filter(Boolean).forEach((file) => {
    if (file.path) {
      try { fs.unlinkSync(file.path); } catch (error) {}
    }
  });
  if (wantsJson(req)) return res.status(400).json({ ok: false, message });
  flash(req, 'error', message);
  return res.redirect(req.get('referer') || '/');
}

function blockRepeatedSubmission({
  scope,
  fields,
  windowMs = 60 * 1000,
  message = 'Wykryto powtórzone lub puste zgłoszenie. Odczekaj chwilę i spróbuj ponownie.'
}) {
  return async function repeatedSubmissionMiddleware(req, res, next) {
    const now = Date.now();
    if (!hasRequiredContent(req, fields)) {
      try {
        await fraudService.flagSuspicious({
          userId: req.session?.userId || null,
          ip: req.ip,
          eventType: `${scope}_empty_submission`,
          score: 2,
          metadata: { path: req.path }
        });
      } catch (error) {}
      return reject(req, res, message);
    }

    const key = submissionKey(req, scope, fields);
    const previous = recentSubmissions.get(key);
    if (previous && now - previous < windowMs) {
      try {
        await fraudService.flagSuspicious({
          userId: req.session?.userId || null,
          ip: req.ip,
          eventType: `${scope}_repeated_submission`,
          score: 3,
          metadata: { path: req.path, windowMs }
        });
      } catch (error) {}
      return reject(req, res, message);
    }

    recentSubmissions.set(key, now);
    for (const [itemKey, timestamp] of recentSubmissions.entries()) {
      if (now - timestamp > windowMs * 4) recentSubmissions.delete(itemKey);
    }
    return next();
  };
}

module.exports = {
  blockRepeatedSubmission
};
