const path = require('path');
const express = require('express');
const session = require('express-session');
const methodOverride = require('method-override');
const { initDb } = require('./db');
const { loadLocals } = require('./middleware/auth');
const { protectVerificationUploads, sameOriginGuard } = require('./middleware/security');
const { registerRoutes } = require('./routes');
const { handleError, notFound } = require('./controllers/errorController');

const app = express();
const PORT = process.env.PORT || 3000;
app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride('_method'));
app.use(session({
  secret: process.env.SESSION_SECRET || 'lokalny-sekret-spotykaj',
  resave: false,
  saveUninitialized: false,
  name: 'spotykaj.sid',
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));
app.use(loadLocals);
app.use(sameOriginGuard);
app.use(protectVerificationUploads);
app.use(express.static(path.join(__dirname, '..', 'public')));

registerRoutes(app);

app.use(notFound);
app.use(handleError);

if (require.main === module) {
  initDb().then(() => {
    app.listen(PORT, () => {
      console.log(`Spotykaj działa: http://localhost:${PORT}`);
    });
  }).catch((error) => {
    console.error('Nie można uruchomić aplikacji:', error);
    process.exit(1);
  });
}

module.exports = app;
