const express = require('express');
const adminController = require('../controllers/adminController');
const { requireAdmin } = require('../middleware/auth');
const { upload } = require('../utils/upload');
const { flash } = require('../middleware/flash');
const { requireCsrf } = require('../middleware/csrf');

const router = express.Router();
const handleImageUpload = upload.single('image');

function uploadReplacementImage(req, res, next) {
  handleImageUpload(req, res, (error) => {
    if (!error) return next();
    flash(req, 'error', error.code === 'LIMIT_FILE_SIZE' ? 'Plik jest za duży.' : error.message);
    return res.redirect(req.get('referer') || '/admin');
  });
}

router.get('/admin', requireAdmin, adminController.showAdmin);
router.get('/admin/health', requireAdmin, adminController.showHealth);
router.post('/admin/backups/create', requireAdmin, adminController.createBackup);
router.post('/admin/weryfikacje/:id/zatwierdz', requireAdmin, adminController.approveVerificationRequest);
router.post('/admin/weryfikacje/:id/odrzuc', requireAdmin, adminController.rejectVerificationRequest);
router.post('/admin/wnioski-spotycoin/:id/zatwierdz', requireAdmin, adminController.approvePurchaseRequest);
router.post('/admin/wnioski-spotycoin/:id/odrzuc', requireAdmin, adminController.rejectPurchaseRequest);
router.post('/admin/uzytkownicy/:id/spotycoin', requireAdmin, adminController.grantSpotycoin);
router.post('/admin/uzytkownicy/:id/rola', requireAdmin, adminController.updateUserRole);
router.post('/admin/ogloszenia/:id/status', requireAdmin, adminController.updateListingStatus);
router.post('/admin/ogloszenia/:id/usun-trwale', requireAdmin, adminController.permanentlyDeleteListing);
router.post('/admin/zgloszenia/:id/rozpatrz', requireAdmin, adminController.reviewReport);
router.post('/admin/media/:id/moderacja', requireAdmin, adminController.updateImageModeration);
router.post('/admin/media/:id/zastap', requireAdmin, uploadReplacementImage, requireCsrf, adminController.replaceListingImage);
router.post('/admin/media/:id/usun', requireAdmin, adminController.deleteListingImage);

module.exports = router;
