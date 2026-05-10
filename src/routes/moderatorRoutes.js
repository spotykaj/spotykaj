const express = require('express');
const moderatorController = require('../controllers/moderatorController');
const { requireModerator } = require('../middleware/auth');
const { upload } = require('../utils/upload');

const router = express.Router();

router.get('/moderator', requireModerator, moderatorController.showModerator);
router.post('/moderator/weryfikacje/:id/zatwierdz', requireModerator, moderatorController.approveVerificationRequest);
router.post('/moderator/weryfikacje/:id/odrzuc', requireModerator, moderatorController.rejectVerificationRequest);
router.post('/moderator/profile/:id/zweryfikuj', requireModerator, moderatorController.verifyProfile);
router.post('/moderator/profile/:id/odrzuc', requireModerator, moderatorController.rejectProfile);
router.post('/moderator/ogloszenia/:id/zweryfikuj', requireModerator, moderatorController.verifyListing);
router.post('/moderator/ogloszenia/:id/odrzuc', requireModerator, moderatorController.rejectListing);
router.post('/moderator/ogloszenia/:id/status', requireModerator, moderatorController.updateListingStatus);
router.post('/moderator/zgloszenia/:id/rozpatrz', requireModerator, moderatorController.reviewReport);
router.post('/moderator/media/:id/moderacja', requireModerator, moderatorController.updateImageModeration);
router.post('/moderator/media/:id/zastap', requireModerator, upload.single('image'), moderatorController.replaceListingImage);
router.post('/moderator/wnioski-spotycoin/:id/zatwierdz', requireModerator, moderatorController.approvePurchaseRequest);
router.post('/moderator/wnioski-spotycoin/:id/odrzuc', requireModerator, moderatorController.rejectPurchaseRequest);

module.exports = router;
