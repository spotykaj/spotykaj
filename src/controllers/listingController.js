const favoriteService = require('../services/favoriteService');
const listingService = require('../services/listingService');
const mediaService = require('../services/mediaService');
const messageService = require('../services/messageService');
const promotionService = require('../services/promotionService');
const reportService = require('../services/reportService');
const tipService = require('../services/tipService');
const { promotionOptions } = require('../config/constants');
const { flash } = require('../middleware/flash');
const fs = require('fs');

const wizardCategories = [
  'Panie',
  'Panowie',
  'Kluby',
  'Pary',
  'Trans',
  'Masaż',
  'BDSM',
  'Onlyfans',
  'Pokazy/Sex telefon',
  'Gej/Les',
  'Filmy'
];

function showNewListing(_req, res) {
  res.render('listings/new', { title: 'Dodaj ogłoszenie', promotionOptions, wizardCategories });
}

async function showEditListing(req, res, next) {
  try {
    const listing = await listingService.getOwnedListing(req.params.id, res.locals.user.id);
    if (!listing) {
      return res.status(404).render('error', { title: 'Nie znaleziono', message: 'Nie znaleziono ogłoszenia.' });
    }
    return res.render('listings/edit', { title: 'Edycja ogłoszenia', listing, promotionOptions });
  } catch (error) {
    return next(error);
  }
}

async function createListing(req, res, next) {
  try {
    if (res.locals.user.role !== 'admin') {
      const recentCount = await listingService.countUserListingSubmissions(res.locals.user.id, 24);
      if (recentCount >= 5) {
        flash(req, 'error', 'Możesz dodać maksymalnie 5 ogłoszeń w ciągu 24 godzin.');
        return res.redirect('/ogloszenia/nowe');
      }
    }
    const media = await mediaService.processListingUploads(res.locals.user.id, req.files || {});
    const listingId = await listingService.createListing(res.locals.user.id, req.body, media, { ip: req.ip });
    await mediaService.saveMediaAssets(res.locals.user.id, listingId, media);
    flash(req, 'success', 'Ogłoszenie zostało wysłane do moderacji.');
    res.redirect(`/ogloszenia/${listingId}`);
  } catch (error) {
    Object.values(req.files || {}).flat().forEach((file) => {
      if (file?.path) {
        try { fs.unlinkSync(file.path); } catch (cleanupError) {}
      }
    });
    if (['VALIDATION_ERROR', 'INSUFFICIENT_FUNDS'].includes(error.code) || error.message.includes('Dozwolone są')) {
      flash(req, 'error', error.message);
      return res.redirect('/ogloszenia/nowe');
    }
    return next(error);
  }
}

function extractPhone(description) {
  const line = String(description || '').split('\n').find((item) => item.toLowerCase().startsWith('telefon:'));
  return line ? line.slice(line.indexOf(':') + 1).trim() : '';
}

async function revealPhone(req, res, next) {
  try {
    const { listing } = await listingService.getListingWithImages(req.params.id);
    if (!listing || !listingService.canViewListing(listing, res.locals.user)) {
      return res.status(404).json({ ok: false, message: 'Nie znaleziono ogłoszenia.' });
    }
    return res.json({ ok: true, phone: extractPhone(listing.description) || 'Numer telefonu niedostępny' });
  } catch (error) {
    return next(error);
  }
}

async function reportListing(req, res, next) {
  try {
    await reportService.createReport({
      listingId: req.params.id,
      reporterId: res.locals.user?.id || null,
      reason: req.body.reason,
      note: req.body.note
    });
    flash(req, 'success', 'Zgłoszenie zostało wysłane do moderacji.');
    return res.redirect(`/ogloszenia/${req.params.id}`);
  } catch (error) {
    if (['VALIDATION_ERROR'].includes(error.code)) {
      flash(req, 'error', error.message);
      return res.redirect(`/ogloszenia/${req.params.id}`);
    }
    return next(error);
  }
}

async function showListing(req, res, next) {
  try {
    const includeHidden = ['admin', 'moderator'].includes(res.locals.user?.role);
    const { listing, images } = await listingService.getListingWithImages(req.params.id, { includeHidden });
    if (!listing || !listingService.canViewListing(listing, res.locals.user)) {
      return res.status(404).render('error', { title: 'Nie znaleziono', message: 'Nie znaleziono ogłoszenia.' });
    }
    const isFavorite = res.locals.user ? await favoriteService.isFavorite(res.locals.user.id, listing.id) : false;
    return res.render('listings/show', {
      title: listing.title,
      listing,
      images,
      isFavorite,
      metaDescription: `${listing.title} - ${listing.city}, ${listing.region}. Moderowane ogłoszenie Spotykaj.`,
      canonicalUrl: `https://spotykaj.pl/ogloszenia/${listing.id}`,
      ogType: 'article',
      ogImage: images[0]?.large_path || images[0]?.image_path || listing.cover
    });
  } catch (error) {
    return next(error);
  }
}

async function toggleFavorite(req, res, next) {
  try {
    const result = await favoriteService.toggleFavorite({
      userId: res.locals.user.id,
      listingId: req.params.id
    });
    flash(req, 'success', result.saved ? 'Dodano do ulubionych.' : 'Usunięto z ulubionych.');
    const returnTo = String(req.body.returnTo || req.get('referer') || `/ogloszenia/${req.params.id}`);
    return res.redirect(returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : `/ogloszenia/${req.params.id}`);
  } catch (error) {
    if (['NOT_FOUND', 'VALIDATION_ERROR'].includes(error.code)) {
      flash(req, 'error', error.message);
      return res.redirect(`/ogloszenia/${req.params.id}`);
    }
    return next(error);
  }
}

async function deleteListing(req, res, next) {
  try {
    await listingService.deleteListing(req.params.id, res.locals.user);
    flash(req, 'success', 'Ogłoszenie zostało usunięte.');
    res.redirect(res.locals.user.role === 'admin' ? '/admin' : '/panel');
  } catch (error) {
    if (error.code === 'FORBIDDEN') {
      flash(req, 'error', error.message);
      return res.redirect('/panel');
    }
    return next(error);
  }
}

async function promoteListing(req, res, next) {
  try {
    const result = await promotionService.promoteListing({
      listingId: req.params.id,
      userId: res.locals.user.id,
      days: req.body.days
    });
    flash(req, 'success', result.message);
    const returnTo = String(req.body.returnTo || '');
    return res.redirect(returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/panel');
  } catch (error) {
    if (['VALIDATION_ERROR', 'FORBIDDEN', 'INSUFFICIENT_FUNDS'].includes(error.code)) {
      flash(req, 'error', error.message);
      return res.redirect('/panel');
    }
    return next(error);
  }
}

async function sendMessage(req, res, next) {
  try {
    if (!res.locals.user) {
      return res.status(401).json({
        ok: false,
        message: 'Zaloguj się, aby wysłać wiadomość.'
      });
    }
    const result = await messageService.sendListingMessage({
      listingId: req.params.id,
      senderId: res.locals.user.id,
      body: req.body.message || req.body.body
    });
    return res.json({
      ok: true,
      message: 'Wiadomość została wysłana. Pobrano 5 Spotycoinów.',
      messageId: result.messageId,
      balanceAfter: result.balanceAfter,
      cost: result.cost
    });
  } catch (error) {
    if (['VALIDATION_ERROR', 'NOT_FOUND', 'INSUFFICIENT_FUNDS'].includes(error.code)) {
      return res.status(error.code === 'INSUFFICIENT_FUNDS' ? 402 : 400).json({
        ok: false,
        message: error.message
      });
    }
    return next(error);
  }
}

async function sendTip(req, res, next) {
  try {
    const result = await tipService.sendTip({
      listingId: req.params.id,
      senderId: res.locals.user.id,
      amount: req.body.customAmount || req.body.amount,
      note: req.body.note
    });
    flash(req, 'success', `Napiwek ${result.amount} Spotycoinów został wysłany.`);
    return res.redirect(`/ogloszenia/${req.params.id}`);
  } catch (error) {
    if (['VALIDATION_ERROR', 'NOT_FOUND', 'INSUFFICIENT_FUNDS'].includes(error.code)) {
      flash(req, 'error', error.message);
      return res.redirect(`/ogloszenia/${req.params.id}`);
    }
    return next(error);
  }
}

module.exports = {
  createListing,
  deleteListing,
  promoteListing,
  reportListing,
  revealPhone,
  sendMessage,
  sendTip,
  showEditListing,
  showListing,
  showNewListing,
  toggleFavorite
};
