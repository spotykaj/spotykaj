const { flash } = require('../middleware/flash');

function notFound(_req, res) {
  res.status(404).render('error', { title: 'Nie znaleziono', message: 'Ta strona nie istnieje.' });
}

function handleError(error, req, res, _next) {
  if (process.env.NODE_ENV === 'production') {
    console.error({
      message: error.message,
      code: error.code,
      path: req.path,
      method: req.method
    });
  } else {
    console.error(error);
  }
  const message = error.code === 'LIMIT_FILE_SIZE'
    ? 'Przesłany plik jest za duży.'
    : 'Wystąpił błąd aplikacji. Spróbuj ponownie.';
  flash(req, 'error', message);
  if (req.is('application/json') || req.xhr || (req.accepts('json') && !req.accepts('html'))) {
    return res.status(error.status || 500).json({ ok: false, message });
  }
  res.status(500).render('error', { title: 'Błąd', message: 'Wystąpił błąd aplikacji.' });
}

module.exports = {
  handleError,
  notFound
};
