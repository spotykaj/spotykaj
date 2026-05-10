function flash(req, type, message) {
  req.session.flash = { type, message };
}

module.exports = {
  flash
};
