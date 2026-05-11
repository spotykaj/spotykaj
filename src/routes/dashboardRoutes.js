const express = require('express');
const dashboardController = require('../controllers/dashboardController');
const { requireAuth } = require('../middleware/auth');
const { flash } = require('../middleware/flash');
const { verificationUpload } = require('../utils/upload');
const { rateLimit } = require('../middleware/rateLimit');
const { verifyTurnstile } = require('../middleware/turnstile');
const { requireCsrf } = require('../middleware/csrf');
const { blockRepeatedSubmission } = require('../middleware/spamProtection');
const { requireEmailVerified } = require('../middleware/emailVerification');

const router = express.Router();

router.get('/panel', requireAuth, dashboardController.showDashboard);
router.get('/panel/profile', requireAuth, dashboardController.showProfile);
router.post('/panel/profile', requireAuth, dashboardController.updateProfile);
router.get('/panel/messages', requireAuth, dashboardController.showMessages);
router.get('/panel/messages/:id', requireAuth, dashboardController.showConversation);
router.post('/panel/messages/:id/reply', requireAuth, requireEmailVerified, rateLimit({ scope: 'message_send', max: 3, windowMs: 60 * 1000, message: 'Wysyłasz wiadomości zbyt szybko. Spróbuj za chwilę.', suspiciousType: 'message_rate_limit' }), verifyTurnstile, blockRepeatedSubmission({ scope: 'message_reply', fields: ['body'], windowMs: 2 * 60 * 1000, message: 'Wykryto powtórzoną lub pustą odpowiedź. Odczekaj chwilę i spróbuj ponownie.' }), dashboardController.replyMessage);
router.get('/panel/favorites', requireAuth, dashboardController.showFavorites);
router.get('/panel/spotycoins/history', requireAuth, dashboardController.showSpotycoinHistory);
router.get('/panel/tips/history', requireAuth, dashboardController.showTipHistory);
router.get('/panel/weryfikacja', requireAuth, dashboardController.showVerification);
const handleVerificationUpload = verificationUpload.fields([
  { name: 'document', maxCount: 1 },
  { name: 'selfie', maxCount: 1 }
]);

router.post('/panel/weryfikacja', requireAuth, rateLimit({ scope: 'profile_verification', max: 3, windowMs: 60 * 60 * 1000, message: 'Za dużo prób weryfikacji profilu. Spróbuj później.', suspiciousType: 'profile_verification_rate_limit' }), (req, res, next) => {
  handleVerificationUpload(req, res, (error) => {
    if (!error) return next();
    flash(req, 'error', error.code === 'LIMIT_FILE_SIZE' ? 'Plik weryfikacyjny może mieć maksymalnie 8 MB.' : error.message);
    return res.redirect('/panel/weryfikacja');
  });
}, requireCsrf, verifyTurnstile, dashboardController.submitVerification);
router.get('/wiadomosci/:id', requireAuth, dashboardController.showMessage);

module.exports = router;
