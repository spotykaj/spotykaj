const { run, get } = require('../db');
const { promotionOptions } = require('../config/constants');
const coinService = require('./coinService');

function getPromotionOption(days) {
  const parsedDays = Number.parseInt(days, 10);
  return promotionOptions.find((option) => option.days === parsedDays);
}

function toSqlDate(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function fromSqlDate(value) {
  if (!value) return null;
  return new Date(value.replace(' ', 'T') + 'Z');
}

function isPromoted(listing, now = new Date()) {
  const promotedUntil = fromSqlDate(listing.promoted_until);
  return Boolean(promotedUntil && promotedUntil > now);
}

function getPromotionRemainingText(listing, now = new Date()) {
  const promotedUntil = fromSqlDate(listing.promoted_until);
  if (!promotedUntil || promotedUntil <= now) return 'Brak aktywnej promocji';

  const diffMs = promotedUntil.getTime() - now.getTime();
  const totalHours = Math.ceil(diffMs / (1000 * 60 * 60));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;

  if (days > 0 && hours > 0) return `${days} dni ${hours} godz.`;
  if (days > 0) return `${days} dni`;
  return `${hours} godz.`;
}

function getPromotionExpiresText(listing, now = new Date()) {
  const promotedUntil = fromSqlDate(listing.promoted_until);
  if (!promotedUntil || promotedUntil <= now) return '';
  return promotedUntil.toLocaleDateString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

function decorateListing(listing, now = new Date()) {
  return {
    ...listing,
    is_promoted: isPromoted(listing, now),
    promotion_expires_text: getPromotionExpiresText(listing, now),
    promotion_remaining_text: getPromotionRemainingText(listing, now)
  };
}

function decorateListings(listings, now = new Date()) {
  return listings.map((listing) => decorateListing(listing, now));
}

async function promoteListing({ listingId, userId, days }) {
  const option = getPromotionOption(days);
  if (!option) {
    const error = new Error('Wybierz prawidłową opcję promocji.');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  if (option.price === 0) {
    return { skipped: true, message: 'Nie wybrano płatnej promocji. Saldo Spotycoin bez zmian.' };
  }

  const listing = await get('SELECT id, user_id, title, promoted_until FROM listings WHERE id = ?', [listingId]);
  if (!listing || listing.user_id !== userId) {
    const error = new Error('Możesz promować tylko własne ogłoszenia.');
    error.code = 'FORBIDDEN';
    throw error;
  }

  const balance = await coinService.getBalance(userId);
  if (balance < option.price) {
    const error = new Error(`Masz za mało Spotycoinów. Ta promocja kosztuje ${option.price} Spotycoinów.`);
    error.code = 'INSUFFICIENT_FUNDS';
    throw error;
  }

  const now = new Date();
  const currentPromotedUntil = fromSqlDate(listing.promoted_until);
  const baseDate = currentPromotedUntil && currentPromotedUntil > now ? currentPromotedUntil : now;
  const promotedUntil = new Date(baseDate.getTime() + option.days * 24 * 60 * 60 * 1000);

  await run('BEGIN TRANSACTION');
  try {
    await run('UPDATE listings SET promoted_until = ? WHERE id = ?', [toSqlDate(promotedUntil), listing.id]);
    const ledgerResult = await coinService.spendCoins({
      userId,
      amount: option.price,
      transactionType: 'listing_promotion',
      referenceType: 'listing',
      referenceId: listing.id,
      metadata: { days: option.days, promotedUntil: toSqlDate(promotedUntil) },
      note: `Promocja ogłoszenia "${listing.title}" na ${option.label}`
    });
    await run('COMMIT');
    return {
      skipped: false,
      balanceAfter: ledgerResult.balanceAfter,
      promotedUntil: toSqlDate(promotedUntil),
      message: `Ogłoszenie zostało wypromowane do ${promotedUntil.toLocaleString('pl-PL')}.`
    };
  } catch (error) {
    await run('ROLLBACK');
    throw error;
  }
}

module.exports = {
  decorateListing,
  decorateListings,
  getPromotionExpiresText,
  getPromotionRemainingText,
  isPromoted,
  promoteListing
};
