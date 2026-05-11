const express = require('express');
const authController = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const { blockRepeatedSubmission } = require('../middleware/spamProtection');
const { verifyTurnstile } = require('../middleware/turnstile');

const router = express.Router();

router.get('/rejestracja', authController.showRegister);
router.post('/rejestracja', rateLimit({ scope: 'register', max: 3, windowMs: 60 * 60 * 1000, message: 'Za dużo prób rejestracji. Spróbuj ponownie za godzinę.', suspiciousType: 'registration_rate_limit' }), verifyTurnstile, blockRepeatedSubmission({ scope: 'register', fields: ['email', 'username'], windowMs: 10 * 60 * 1000, message: 'Wykryto powtórzoną próbę rejestracji. Odczekaj chwilę i spróbuj ponownie.' }), authController.register);
router.get('/weryfikacja-email', requireAuth, authController.showEmailVerification);
router.get('/weryfikuj-email', authController.verifyEmail);
router.post('/weryfikacja-email/wyslij', requireAuth, rateLimit({ scope: 'resend_email_verification', max: 3, windowMs: 60 * 60 * 1000, message: 'Za dużo prób wysłania linku. Spróbuj później.', suspiciousType: 'email_verification_resend_rate_limit' }), authController.resendVerification);
router.get('/logowanie', authController.showLogin);
router.post('/logowanie', rateLimit({ scope: 'login', max: 5, windowMs: 15 * 60 * 1000, message: 'Za dużo prób logowania. Spróbuj za 15 minut.', suspiciousType: 'login_rate_limit' }), verifyTurnstile, authController.login);
router.get('/przypomnij-haslo', authController.showForgotPassword);
router.post('/przypomnij-haslo', rateLimit({ scope: 'password_reset_request', max: 3, windowMs: 60 * 60 * 1000, message: 'Za dużo prób resetowania hasła. Spróbuj później.', suspiciousType: 'password_reset_rate_limit' }), authController.forgotPassword);
router.get('/reset-hasla', authController.showResetPassword);
router.post('/reset-hasla', rateLimit({ scope: 'password_reset_submit', max: 5, windowMs: 60 * 60 * 1000, message: 'Za dużo prób zmiany hasła. Spróbuj później.', suspiciousType: 'password_reset_submit_rate_limit' }), authController.resetPassword);
router.post('/wyloguj', authController.logout);
router.post('/wyloguj-wszedzie', requireAuth, authController.logoutAll);

module.exports = router;
