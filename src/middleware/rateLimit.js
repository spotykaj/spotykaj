const fraudService = require('../services/fraudService');

const buckets = new Map();

function clientKey(req, scope) {
  return `${scope}:${req.ip || req.connection?.remoteAddress || 'unknown'}:${req.session?.userId || 'guest'}`;
}

function rateLimit({ scope, max, windowMs, message, suspiciousType = null }) {
  return async function rateLimitMiddleware(req, res, next) {
    const now = Date.now();
    const key = clientKey(req, scope);
    const bucket = buckets.get(key) || [];
    const recent = bucket.filter((timestamp) => now - timestamp < windowMs);
    if (recent.length >= max) {
      buckets.set(key, recent);
      if (suspiciousType) {
        try {
          await fraudService.flagSuspicious({
            userId: req.session?.userId || null,
            ip: req.ip,
            eventType: suspiciousType,
            score: recent.length,
            metadata: { scope, max, windowMs }
          });
        } catch (error) {
          // Rate limiting should not fail open because logging failed.
        }
      }
      const payload = { ok: false, message };
      if (req.accepts('html') && !req.path.includes('/wiadomosc') && !req.path.includes('/telefon')) {
        return res.status(429).render('error', { title: 'Za dużo prób', message });
      }
      return res.status(429).json(payload);
    }
    recent.push(now);
    buckets.set(key, recent);
    return next();
  };
}

function resetRateLimits() {
  buckets.clear();
}

module.exports = {
  rateLimit,
  resetRateLimits
};
