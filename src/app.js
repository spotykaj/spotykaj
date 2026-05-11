const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const methodOverride = require('method-override');
const { initDb } = require('./db');
const { csrfProtection } = require('./middleware/csrf');
const { loadLocals } = require('./middleware/auth');
const { blockSensitivePaths, protectVerificationUploads, sameOriginGuard } = require('./middleware/security');
const { sessionActivity } = require('./middleware/sessionSecurity');
const backupService = require('./services/backupService');
const { registerRoutes } = require('./routes');
const { handleError, notFound } = require('./controllers/errorController');

const app = express();
const PORT = process.env.PORT || 3000;
app.set('trust proxy', true);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'", "'unsafe-inline'", "https://challenges.cloudflare.com"],
      "frame-src": ["'self'", "https://challenges.cloudflare.com"],
      "connect-src": ["'self'", "https://challenges.cloudflare.com"],
      "img-src": ["'self'", "data:", "blob:"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "font-src": ["'self'", "data:"],
      "form-action": ["'self'"],
      "base-uri": ["'self'"],
      "object-src": ["'none'"]
    }
  },
  frameguard: { action: 'sameorigin' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  xContentTypeOptions: true,
  xXssProtection: true
}));
app.use((_req, res, next) => {
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});
app.disable('x-powered-by');
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride('_method'));
app.use(session({
  secret: process.env.SESSION_SECRET || 'lokalny-sekret-spotykaj',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  proxy: true,
  name: 'spotykaj.sid',
  cookie: {
    httpOnly: true,
    secure: 'auto',
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));
app.use(sessionActivity());
app.use(loadLocals);
app.use(csrfProtection);
app.use(sameOriginGuard);
app.use(blockSensitivePaths);
app.use(protectVerificationUploads);
app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders: (res, filePath) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (filePath.includes(`${path.sep}uploads${path.sep}`) || filePath.includes(`${path.sep}media${path.sep}`)) {
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'none'; script-src 'none'; sandbox");
    }
  }
}));

registerRoutes(app);

app.use(notFound);
app.use(handleError);

if (require.main === module) {
  initDb().then(() => {
    backupService.scheduleAutomatedBackups();
    app.listen(PORT, () => {
      console.log(`Spotykaj działa: http://localhost:${PORT}`);
    });
  }).catch((error) => {
    console.error('Nie można uruchomić aplikacji:', error);
    process.exit(1);
  });
}

module.exports = app;
