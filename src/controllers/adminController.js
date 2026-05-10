const coinService = require('../services/coinService');
const listingService = require('../services/listingService');
const messageService = require('../services/messageService');
const purchaseService = require('../services/purchaseService');
const userService = require('../services/userService');
const verificationService = require('../services/verificationService');
const reportService = require('../services/reportService');
const auditService = require('../services/auditService');
const fraudService = require('../services/fraudService');
const mediaService = require('../services/mediaService');
const { getSecurityStatus } = require('../config/securityStatus');
const { flash } = require('../middleware/flash');

async function showAdmin(req, res, next) {
  try {
    const users = await userService.getUsersForAdmin();
    const listings = await listingService.getAllListingsForAdmin();
    const moderationListings = await listingService.getListingsPendingModeration();
    const transactions = await coinService.getAllTransactions();
    const purchases = await coinService.getPurchaseTransactions(20);
    const purchaseRequests = await purchaseService.getPurchaseRequestsForAdmin();
    const verificationRequests = await verificationService.getRequestsForAdmin();
    const latestMessages = await messageService.getLatestMessages(20);
    const reports = await reportService.getReportsForModeration();
    const auditLog = await auditService.getRecentAuditLog();
    const suspiciousActivity = await fraudService.getSuspiciousActivity();
    const ledgerIntegrity = await coinService.verifyLedger();
    const securityStatus = getSecurityStatus();
    res.render('admin/index', { title: 'Panel administracyjny', users, listings, moderationListings, transactions, purchases, purchaseRequests, verificationRequests, reports, auditLog, suspiciousActivity, latestMessages, ledgerIntegrity, securityStatus });
  } catch (error) {
    next(error);
  }
}

async function approvePurchaseRequest(req, res, next) {
  try {
    await purchaseService.approveRequest({
      requestId: req.params.id,
      adminId: res.locals.user.id,
      adminNote: req.body.admin_note
    });
    flash(req, 'success', 'Wniosek został zatwierdzony. Spotycoiny dodano do konta.');
    return res.redirect('/admin');
  } catch (error) {
    if (['VALIDATION_ERROR', 'NOT_FOUND', 'FORBIDDEN'].includes(error.code)) {
      flash(req, 'error', error.message);
      return res.redirect('/admin');
    }
    return next(error);
  }
}

async function rejectPurchaseRequest(req, res, next) {
  try {
    await purchaseService.rejectRequest({
      requestId: req.params.id,
      adminId: res.locals.user.id,
      adminNote: req.body.admin_note
    });
    flash(req, 'success', 'Wniosek został odrzucony.');
    return res.redirect('/admin');
  } catch (error) {
    if (['VALIDATION_ERROR', 'NOT_FOUND', 'FORBIDDEN'].includes(error.code)) {
      flash(req, 'error', error.message);
      return res.redirect('/admin');
    }
    return next(error);
  }
}

async function grantSpotycoin(req, res, next) {
  try {
    await coinService.grantCoins({
      userId: req.params.id,
      adminId: res.locals.user.id,
      amount: req.body.amount,
      note: req.body.note
    });
    flash(req, 'success', 'Spotycoiny zostały dodane.');
    return res.redirect('/admin');
  } catch (error) {
    if (['VALIDATION_ERROR', 'NOT_FOUND'].includes(error.code)) {
      flash(req, 'error', error.message);
      return res.redirect('/admin');
    }
    return next(error);
  }
}

async function updateUserRole(req, res, next) {
  try {
    await userService.updateUserRole(req.params.id, req.body.role, res.locals.user);
    flash(req, 'success', 'Rola użytkownika została zmieniona.');
    res.redirect('/admin');
  } catch (error) {
    if (['VALIDATION_ERROR', 'NOT_FOUND', 'FORBIDDEN'].includes(error.code)) {
      flash(req, 'error', error.message);
      return res.redirect('/admin');
    }
    return next(error);
  }
}

async function updateListingStatus(req, res, next) {
  try {
    await listingService.updateListingStatus(req.params.id, req.body.status, res.locals.user, req.body.reason);
    flash(req, 'success', 'Status ogłoszenia został zmieniony.');
    res.redirect('/admin');
  } catch (error) {
    next(error);
  }
}

async function reviewReport(req, res, next) {
  try {
    await reportService.reviewReport({
      reportId: req.params.id,
      reviewerId: res.locals.user.id,
      status: req.body.status,
      reviewerNote: req.body.reviewer_note
    });
    flash(req, 'success', 'Zgłoszenie zostało rozpatrzone.');
    return res.redirect('/admin');
  } catch (error) {
    if (['VALIDATION_ERROR'].includes(error.code)) {
      flash(req, 'error', error.message);
      return res.redirect('/admin');
    }
    return next(error);
  }
}

async function updateImageModeration(req, res, next) {
  try {
    await mediaService.updateImageModeration({
      imageId: req.params.id,
      hidden: req.body.hidden === '1',
      nsfwSeverity: req.body.nsfw_severity
    });
    flash(req, 'success', 'Status zdjęcia został zmieniony.');
    return res.redirect(req.get('referer') || '/admin');
  } catch (error) {
    return next(error);
  }
}

async function replaceListingImage(req, res, next) {
  try {
    await mediaService.replaceListingImage({
      imageId: req.params.id,
      userId: res.locals.user.id,
      file: req.file
    });
    flash(req, 'success', 'Poprawione zdjęcie zostało wgrane.');
    return res.redirect(req.get('referer') || '/admin');
  } catch (error) {
    if (['VALIDATION_ERROR'].includes(error.code)) {
      flash(req, 'error', error.message);
      return res.redirect(req.get('referer') || '/admin');
    }
    return next(error);
  }
}

async function approveVerificationRequest(req, res, next) {
  try {
    await verificationService.approveRequest({
      requestId: req.params.id,
      reviewerId: res.locals.user.id,
      reviewerNote: req.body.reviewer_note
    });
    flash(req, 'success', 'Profil został zweryfikowany.');
    return res.redirect('/admin');
  } catch (error) {
    if (['VALIDATION_ERROR', 'NOT_FOUND', 'FORBIDDEN'].includes(error.code)) {
      flash(req, 'error', error.message);
      return res.redirect('/admin');
    }
    return next(error);
  }
}

async function rejectVerificationRequest(req, res, next) {
  try {
    await verificationService.rejectRequest({
      requestId: req.params.id,
      reviewerId: res.locals.user.id,
      reviewerNote: req.body.reviewer_note
    });
    flash(req, 'success', 'Weryfikacja została odrzucona.');
    return res.redirect('/admin');
  } catch (error) {
    if (['VALIDATION_ERROR', 'NOT_FOUND', 'FORBIDDEN'].includes(error.code)) {
      flash(req, 'error', error.message);
      return res.redirect('/admin');
    }
    return next(error);
  }
}

module.exports = {
  approveVerificationRequest,
  approvePurchaseRequest,
  grantSpotycoin,
  rejectVerificationRequest,
  rejectPurchaseRequest,
  replaceListingImage,
  showAdmin,
  reviewReport,
  updateImageModeration,
  updateListingStatus,
  updateUserRole
};
