const express = require('express');
const authController = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const { verifyTurnstile } = require('../middleware/turnstile');

const router = express.Router();

router.get('/rejestracja', authController.showRegister);
router.post('/rejestracja', rateLimit({ scope: 'register', max: 5, windowMs: 15 * 60 * 1000, message: 'Za dużo prób rejestracji. Spróbuj później.', suspiciousType: 'registration_rate_limit' }), verifyTurnstile, authController.register);
router.get('/logowanie', authController.showLogin);
router.post('/logowanie', rateLimit({ scope: 'login', max: 10, windowMs: 15 * 60 * 1000, message: 'Za dużo prób logowania. Spróbuj za 15 minut.', suspiciousType: 'login_rate_limit' }), verifyTurnstile, authController.login);
router.post('/wyloguj', authController.logout);
router.post('/wyloguj-wszedzie', requireAuth, authController.logoutAll);

module.exports = router;
