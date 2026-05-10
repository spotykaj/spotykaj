const launchController = require('../controllers/launchController');

const allowedExactPaths = new Set([
  '/logowanie',
  '/powiadom-mnie',
  '/wyloguj',
  '/regulamin',
  '/polityka-prywatnosci',
  '/zasady-zdjec'
]);

function hasStaffAccess(user) {
  return user?.role === 'admin' || user?.role === 'moderator';
}

function isAllowedPublicPath(req) {
  if (allowedExactPaths.has(req.path)) return true;
  if (req.path.startsWith('/css/') || req.path.startsWith('/img/') || req.path.startsWith('/uploads/')) return true;
  return false;
}

function launchGate(req, res, next) {
  if (req.query.preview === '1') {
    req.session.launchPreview = true;
    return next();
  }
  if (req.session.launchPreview) return next();
  if (hasStaffAccess(res.locals.user)) return next();
  if (isAllowedPublicPath(req)) return next();

  if (req.method === 'GET' || req.method === 'HEAD') {
    return launchController.renderComingSoon(req, res);
  }

  return res.redirect('/');
}

module.exports = {
  launchGate
};
