const { flash } = require('../middleware/flash');

function notFound(_req, res) {
  res.status(404).render('error', { title: 'Nie znaleziono', message: 'Ta strona nie istnieje.' });
}

function handleError(error, req, res, _next) {
  console.error(error);
  const message = error.code === 'LIMIT_FILE_SIZE'
    ? 'Przesłany plik jest za duży.'
    : 'Wystąpił błąd aplikacji. Spróbuj ponownie.';
  flash(req, 'error', message);
  res.status(500).render('error', { title: 'Błąd', message: 'Wystąpił błąd aplikacji.' });
}

module.exports = {
  handleError,
  notFound
};
