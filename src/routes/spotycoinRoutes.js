const express = require('express');
const spotycoinController = require('../controllers/spotycoinController');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const { verifyTurnstile } = require('../middleware/turnstile');

const router = express.Router();

router.get('/spotycoiny', requireAuth, spotycoinController.showShop);
router.get('/kup-spotycoiny', requireAuth, spotycoinController.showShop);
router.post('/kup-spotycoiny/aktywuj', requireAuth, rateLimit({ scope: 'spotycoin_verify', max: 5, windowMs: 15 * 60 * 1000, message: 'Za dużo zgłoszeń weryfikacji Spotycoin. Spróbuj później.', suspiciousType: 'spotycoin_verify_rate_limit' }), verifyTurnstile, spotycoinController.activateVoucher);

module.exports = router;
