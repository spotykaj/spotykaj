const { run, get, all } = require('../db');
const promotionService = require('./promotionService');

async function isFavorite(userId, listingId) {
  if (!userId) return false;
  const row = await get('SELECT id FROM user_favorites WHERE user_id = ? AND listing_id = ?', [userId, listingId]);
  return Boolean(row);
}

async function toggleFavorite({ userId, listingId }) {
  const listing = await get('SELECT id FROM listings WHERE id = ? AND deleted_at IS NULL', [listingId]);
  if (!listing) {
    const error = new Error('Nie znaleziono ogłoszenia.');
    error.code = 'NOT_FOUND';
    throw error;
  }
  const existing = await get('SELECT id FROM user_favorites WHERE user_id = ? AND listing_id = ?', [userId, listingId]);
  if (existing) {
    await run('DELETE FROM user_favorites WHERE id = ?', [existing.id]);
    return { saved: false };
  }
  await run('INSERT INTO user_favorites (user_id, listing_id) VALUES (?, ?)', [userId, listingId]);
  return { saved: true };
}

async function getFavorites(userId) {
  const listings = await all(`
    SELECT l.*, COALESCE(NULLIF(u.username, ''), 'Użytkownik ' || u.id) AS author_name, u.profile_verified AS owner_verified, MIN(COALESCE(i.thumbnail_path, i.medium_path, i.image_path)) AS cover, f.created_at AS saved_at
    FROM user_favorites f
    JOIN listings l ON l.id = f.listing_id
    JOIN users u ON u.id = l.user_id
    LEFT JOIN listing_images i ON i.listing_id = l.id AND COALESCE(i.hidden, 0) = 0 AND i.deleted_at IS NULL
    WHERE f.user_id = ? AND l.deleted_at IS NULL
    GROUP BY l.id
    ORDER BY datetime(f.created_at) DESC
  `, [userId]);
  return promotionService.decorateListings(listings);
}

module.exports = {
  getFavorites,
  isFavorite,
  toggleFavorite
};
