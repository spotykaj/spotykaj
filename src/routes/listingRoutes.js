const express = require('express');
const listingController = require('../controllers/listingController');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const { upload } = require('../utils/upload');
const { flash } = require('../middleware/flash');
const { verifyTurnstile } = require('../middleware/turnstile');

const router = express.Router();

router.get('/ogloszenia/nowe', requireAuth, listingController.showNewListing);
router.get('/ogloszenia/dodaj', requireAuth, listingController.showNewListing);
router.get('/ogloszenia/:id/edytuj', requireAuth, listingController.showEditListing);
const handleListingUpload = upload.fields([
  { name: 'images', maxCount: 6 },
  { name: 'video', maxCount: 1 }
]);

router.post('/ogloszenia', requireAuth, (req, res, next) => {
  handleListingUpload(req, res, (error) => {
    if (!error) return next();
    flash(req, 'error', error.code === 'LIMIT_FILE_SIZE' ? 'Plik jest za duży. Wideo może mieć maksymalnie 60 MB.' : error.message);
    return res.redirect('/ogloszenia/nowe');
  });
}, listingController.createListing);
router.post('/ogloszenia/:id/wiadomosc', rateLimit({ scope: 'message_send', max: 10, windowMs: 60 * 1000, message: 'Wysyłasz wiadomości zbyt szybko. Spróbuj za chwilę.', suspiciousType: 'message_rate_limit' }), verifyTurnstile, listingController.sendMessage);
router.post('/ogloszenia/:id/ulubione', requireAuth, listingController.toggleFavorite);
router.post('/ogloszenia/:id/napiwek', requireAuth, listingController.sendTip);
router.post('/ogloszenia/:id/zglos', rateLimit({ scope: 'listing_report', max: 10, windowMs: 60 * 60 * 1000, message: 'Za dużo zgłoszeń. Spróbuj później.' }), verifyTurnstile, listingController.reportListing);
router.post('/ogloszenia/:id/promocja', requireAuth, listingController.promoteListing);
router.get('/ogloszenia/:id', listingController.showListing);
router.get('/ogloszenia/:id/telefon', rateLimit({ scope: 'phone_reveal', max: 20, windowMs: 60 * 60 * 1000, message: 'Za dużo prób odsłonięcia numeru telefonu. Spróbuj później.', suspiciousType: 'phone_reveal_rate_limit' }), listingController.revealPhone);
router.delete('/ogloszenia/:id', requireAuth, listingController.deleteListing);

module.exports = router;
