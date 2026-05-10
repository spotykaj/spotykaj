function isTurnstileEnabled() {
  return String(process.env.TURNSTILE_ENABLED || 'false').toLowerCase() === 'true';
}

function getTurnstileConfig() {
  return {
    enabled: isTurnstileEnabled(),
    siteKey: process.env.TURNSTILE_SITE_KEY || '',
    secretKey: process.env.TURNSTILE_SECRET_KEY || ''
  };
}

function getSecurityStatus() {
  return {
    ageGate: 'active',
    turnstile: isTurnstileEnabled() ? 'enabled' : 'disabled',
    rateLimits: 'active'
  };
}

module.exports = {
  getSecurityStatus,
  getTurnstileConfig,
  isTurnstileEnabled
};
