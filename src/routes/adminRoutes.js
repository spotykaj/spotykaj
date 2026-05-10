const express = require('express');
const adminController = require('../controllers/adminController');
const { requireAdmin } = require('../middleware/auth');
const { upload } = require('../utils/upload');

const router = express.Router();

router.get('/admin', requireAdmin, adminController.showAdmin);
router.post('/admin/weryfikacje/:id/zatwierdz', requireAdmin, adminController.approveVerificationRequest);
router.post('/admin/weryfikacje/:id/odrzuc', requireAdmin, adminController.rejectVerificationRequest);
router.post('/admin/wnioski-spotycoin/:id/zatwierdz', requireAdmin, adminController.approvePurchaseRequest);
router.post('/admin/wnioski-spotycoin/:id/odrzuc', requireAdmin, adminController.rejectPurchaseRequest);
router.post('/admin/uzytkownicy/:id/spotycoin', requireAdmin, adminController.grantSpotycoin);
router.post('/admin/uzytkownicy/:id/rola', requireAdmin, adminController.updateUserRole);
router.post('/admin/ogloszenia/:id/status', requireAdmin, adminController.updateListingStatus);
router.post('/admin/zgloszenia/:id/rozpatrz', requireAdmin, adminController.reviewReport);
router.post('/admin/media/:id/moderacja', requireAdmin, adminController.updateImageModeration);
router.post('/admin/media/:id/zastap', requireAdmin, upload.single('image'), adminController.replaceListingImage);

module.exports = router;
