const coinService = require('../services/coinService');
const favoriteService = require('../services/favoriteService');
const listingService = require('../services/listingService');
const messageService = require('../services/messageService');
const purchaseService = require('../services/purchaseService');
const tipService = require('../services/tipService');
const userService = require('../services/userService');
const verificationService = require('../services/verificationService');
const { promotionOptions } = require('../config/constants');
const { flash } = require('../middleware/flash');

async function showDashboard(_req, res, next) {
  try {
    const listings = await listingService.getUserListings(res.locals.user.id);
    const transactions = await coinService.getUserTransactions(res.locals.user.id);
    const purchaseRequests = await purchaseService.getUserPurchaseRequests(res.locals.user.id);
    const verificationRequest = await verificationService.getLatestUserRequest(res.locals.user.id);
    const inboxMessages = await messageService.getInbox(res.locals.user.id);
    const outboxMessages = await messageService.getOutbox(res.locals.user.id);
    res.render('dashboard/index', {
      title: 'Panel użytkownika',
      listings,
      transactions,
      purchaseRequests,
      verificationRequest,
      inboxMessages,
      outboxMessages,
      activePanel: 'panel',
      promotionOptions
    });
  } catch (error) {
    next(error);
  }
}

async function showProfile(_req, res, next) {
  try {
    const profile = await userService.getUserProfile(res.locals.user.id);
    return res.render('dashboard/profile', {
      title: 'Mój profil',
      activePanel: 'profile',
      profile
    });
  } catch (error) {
    return next(error);
  }
}

async function updateProfile(req, res, next) {
  try {
    const profile = await userService.updateUserProfile(res.locals.user.id, req.body);
    res.locals.user.name = profile.name;
    res.locals.user.username = profile.username;
    res.locals.user.account_type = profile.account_type;
    res.locals.user.email = profile.email;
    res.locals.user.first_name = profile.first_name;
    res.locals.user.last_name = profile.last_name;
    flash(req, 'success', 'Profil został zaktualizowany.');
    return res.redirect('/panel/profile');
  } catch (error) {
    if (['VALIDATION_ERROR'].includes(error.code)) {
      flash(req, 'error', error.message);
      return res.redirect('/panel/profile');
    }
    return next(error);
  }
}

async function showMessages(_req, res, next) {
  try {
    const inboxMessages = await messageService.getInbox(res.locals.user.id);
    const outboxMessages = await messageService.getOutbox(res.locals.user.id);
    return res.render('dashboard/messages', {
      title: 'Wiadomości',
      activePanel: 'messages',
      inboxMessages,
      outboxMessages,
      selectedMessage: null,
      conversation: []
    });
  } catch (error) {
    return next(error);
  }
}

async function showConversation(req, res, next) {
  try {
    const inboxMessages = await messageService.getInbox(res.locals.user.id);
    const outboxMessages = await messageService.getOutbox(res.locals.user.id);
    const selectedMessage = await messageService.getMessageForUser(req.params.id, res.locals.user);
    const conversationResult = await messageService.getConversationForMessage(req.params.id, res.locals.user);
    return res.render('dashboard/messages', {
      title: 'Wiadomości',
      activePanel: 'messages',
      inboxMessages,
      outboxMessages,
      selectedMessage,
      conversation: conversationResult.messages || []
    });
  } catch (error) {
    if (['NOT_FOUND', 'FORBIDDEN'].includes(error.code)) {
      flash(req, 'error', error.message);
      return res.redirect('/panel/messages');
    }
    return next(error);
  }
}

async function replyMessage(req, res, next) {
  try {
    await messageService.replyToMessage({
      messageId: req.params.id,
      senderId: res.locals.user.id,
      body: req.body.body
    });
    flash(req, 'success', 'Odpowiedź została wysłana. Pobrano 5 Spotycoinów.');
    return res.redirect(`/panel/messages/${req.params.id}`);
  } catch (error) {
    if (['VALIDATION_ERROR', 'NOT_FOUND', 'FORBIDDEN', 'INSUFFICIENT_FUNDS'].includes(error.code)) {
      flash(req, 'error', error.message);
      return res.redirect(`/panel/messages/${req.params.id}`);
    }
    return next(error);
  }
}

async function showFavorites(_req, res, next) {
  try {
    const favorites = await favoriteService.getFavorites(res.locals.user.id);
    return res.render('dashboard/favorites', {
      title: 'Ulubione',
      activePanel: 'favorites',
      favorites
    });
  } catch (error) {
    return next(error);
  }
}

async function showSpotycoinHistory(_req, res, next) {
  try {
    const transactions = await coinService.getUserTransactions(res.locals.user.id, 200);
    return res.render('dashboard/spotycoinHistory', {
      title: 'Historia Spotycoinów',
      activePanel: 'spotycoins',
      transactions
    });
  } catch (error) {
    return next(error);
  }
}

async function showTipHistory(_req, res, next) {
  try {
    const tips = await tipService.getTipHistory(res.locals.user.id);
    return res.render('dashboard/tipHistory', {
      title: 'Historia napiwków',
      activePanel: 'tips',
      tips
    });
  } catch (error) {
    return next(error);
  }
}

async function showVerification(_req, res, next) {
  try {
    const verificationRequest = await verificationService.getLatestUserRequest(res.locals.user.id);
    return res.render('dashboard/verification', {
      title: 'Weryfikacja konta',
      activePanel: 'verification',
      verificationRequest
    });
  } catch (error) {
    return next(error);
  }
}

async function submitVerification(req, res, next) {
  try {
    await verificationService.submitRequest({
      userId: res.locals.user.id,
      documentFile: req.files?.document?.[0],
      selfieFile: req.files?.selfie?.[0],
      note: req.body.note
    });
    flash(req, 'success', 'Wniosek o weryfikację został wysłany.');
    return res.redirect('/panel/weryfikacja');
  } catch (error) {
    if (['VALIDATION_ERROR'].includes(error.code) || error.message.includes('Do weryfikacji')) {
      flash(req, 'error', error.message);
      return res.redirect('/panel/weryfikacja');
    }
    return next(error);
  }
}

async function showMessage(req, res, next) {
  try {
    const message = await messageService.getMessageForUser(req.params.id, res.locals.user);
    return res.render('messages/show', { title: 'Wiadomość', message });
  } catch (error) {
    if (['NOT_FOUND', 'FORBIDDEN'].includes(error.code)) {
      return res.status(error.code === 'FORBIDDEN' ? 403 : 404).render('error', {
        title: 'Wiadomość',
        message: error.message
      });
    }
    return next(error);
  }
}

module.exports = {
  replyMessage,
  showDashboard,
  showFavorites,
  showMessages,
  showVerification,
  showProfile,
  showSpotycoinHistory,
  showTipHistory,
  showConversation,
  showMessage,
  submitVerification,
  updateProfile
};
