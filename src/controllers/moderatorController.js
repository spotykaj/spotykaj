const listingService = require('../services/listingService');
const purchaseService = require('../services/purchaseService');
const userService = require('../services/userService');
const verificationService = require('../services/verificationService');
const reportService = require('../services/reportService');
const fraudService = require('../services/fraudService');
const mediaService = require('../services/mediaService');
const auditService = require('../services/auditService');
const { flash } = require('../middleware/flash');

async function showModerator(req, res, next) {
  try {
    const profiles = await userService.getProfilesForModeration();
    const verificationRequests = await verificationService.getPendingRequests();
    const pendingListings = await listingService.getListingsWaitingForVerification();
    const moderationListings = await listingService.getListingsPendingModeration();
    const listings = await listingService.getListingsForModeration();
    const purchaseRequests = await purchaseService.getPurchaseRequestsForAdmin();
    const reports = await reportService.getReportsForModeration();
    const suspiciousActivity = await fraudService.getSuspiciousActivity();
    return res.render('moderator/index', {
      title: 'Panel moderatora',
      profiles,
      verificationRequests,
      pendingListings,
      moderationListings,
      listings,
      purchaseRequests,
      reports,
      suspiciousActivity
    });
  } catch (error) {
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
    return res.redirect('/moderator');
  } catch (error) {
    if (['VALIDATION_ERROR', 'NOT_FOUND', 'FORBIDDEN'].includes(error.code)) {
      flash(req, 'error', error.message);
      return res.redirect('/moderator');
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
    return res.redirect('/moderator');
  } catch (error) {
    if (['VALIDATION_ERROR', 'NOT_FOUND', 'FORBIDDEN'].includes(error.code)) {
      flash(req, 'error', error.message);
      return res.redirect('/moderator');
    }
    return next(error);
  }
}

async function verifyProfile(req, res, next) {
  try {
    await userService.updateProfileVerification(req.params.id, true);
    flash(req, 'success', 'Profil został zweryfikowany.');
    return res.redirect('/moderator');
  } catch (error) {
    if (['NOT_FOUND'].includes(error.code)) {
      flash(req, 'error', error.message);
      return res.redirect('/moderator');
    }
    return next(error);
  }
}

async function rejectProfile(req, res, next) {
  try {
    await userService.updateProfileVerification(req.params.id, false);
    flash(req, 'success', 'Profil został odrzucony.');
    return res.redirect('/moderator');
  } catch (error) {
    if (['NOT_FOUND'].includes(error.code)) {
      flash(req, 'error', error.message);
      return res.redirect('/moderator');
    }
    return next(error);
  }
}

async function verifyListing(req, res, next) {
  try {
    await listingService.updateListingVerification(req.params.id, true);
    flash(req, 'success', 'Ogłoszenie zostało zweryfikowane.');
    return res.redirect('/moderator');
  } catch (error) {
    if (['NOT_FOUND'].includes(error.code)) {
      flash(req, 'error', error.message);
      return res.redirect('/moderator');
    }
    return next(error);
  }
}

async function rejectListing(req, res, next) {
  try {
    await listingService.updateListingVerification(req.params.id, false);
    await listingService.updateListingStatus(req.params.id, 'hidden', res.locals.user, req.body.reason || 'Odrzucono w weryfikacji.');
    flash(req, 'success', 'Ogłoszenie zostało odrzucone i wstrzymane.');
    return res.redirect('/moderator');
  } catch (error) {
    if (['NOT_FOUND'].includes(error.code)) {
      flash(req, 'error', error.message);
      return res.redirect('/moderator');
    }
    return next(error);
  }
}

async function updateListingStatus(req, res, next) {
  try {
    await listingService.updateListingStatus(req.params.id, req.body.status, res.locals.user, req.body.reason);
    flash(req, 'success', 'Status ogłoszenia został zmieniony.');
    return res.redirect('/moderator');
  } catch (error) {
    return next(error);
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
    return res.redirect('/moderator');
  } catch (error) {
    if (['VALIDATION_ERROR'].includes(error.code)) {
      flash(req, 'error', error.message);
      return res.redirect('/moderator');
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
    await auditService.logAction({
      adminId: res.locals.user.id,
      actionType: 'moderate_listing_image',
      targetType: 'listing_image',
      targetId: req.params.id,
      metadata: { hidden: req.body.hidden === '1', nsfwSeverity: req.body.nsfw_severity || 'standard' }
    });
    flash(req, 'success', 'Status zdjęcia został zmieniony.');
    return res.redirect(req.get('referer') || '/moderator');
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
    await auditService.logAction({
      adminId: res.locals.user.id,
      actionType: 'replace_listing_image',
      targetType: 'listing_image',
      targetId: req.params.id
    });
    flash(req, 'success', 'Poprawione zdjęcie zostało wgrane.');
    return res.redirect(req.get('referer') || '/moderator');
  } catch (error) {
    if (['VALIDATION_ERROR'].includes(error.code)) {
      flash(req, 'error', error.message);
      return res.redirect(req.get('referer') || '/moderator');
    }
    return next(error);
  }
}

async function deleteListingImage(req, res, next) {
  try {
    await mediaService.deleteListingImage({
      imageId: req.params.id,
      actor: res.locals.user
    });
    await auditService.logAction({
      adminId: res.locals.user.id,
      actionType: 'delete_listing_image',
      targetType: 'listing_image',
      targetId: req.params.id
    });
    flash(req, 'success', 'Zdjęcie zostało usunięte.');
    return res.redirect(req.get('referer') || '/moderator');
  } catch (error) {
    if (['VALIDATION_ERROR', 'FORBIDDEN'].includes(error.code)) {
      flash(req, 'error', error.message);
      return res.redirect(req.get('referer') || '/moderator');
    }
    return next(error);
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
    return res.redirect('/moderator');
  } catch (error) {
    if (['VALIDATION_ERROR', 'NOT_FOUND', 'FORBIDDEN'].includes(error.code)) {
      flash(req, 'error', error.message);
      return res.redirect('/moderator');
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
    return res.redirect('/moderator');
  } catch (error) {
    if (['VALIDATION_ERROR', 'NOT_FOUND', 'FORBIDDEN'].includes(error.code)) {
      flash(req, 'error', error.message);
      return res.redirect('/moderator');
    }
    return next(error);
  }
}

module.exports = {
  approveVerificationRequest,
  approvePurchaseRequest,
  deleteListingImage,
  rejectListing,
  rejectProfile,
  rejectVerificationRequest,
  rejectPurchaseRequest,
  replaceListingImage,
  reviewReport,
  updateImageModeration,
  showModerator,
  updateListingStatus,
  verifyListing,
  verifyProfile
};
