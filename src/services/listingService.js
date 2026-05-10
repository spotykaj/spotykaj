const { run, get, all } = require('../db');
const { promotionOptions } = require('../config/constants');
const promotionService = require('./promotionService');
const auditService = require('./auditService');
const fraudService = require('./fraudService');

const TATTOO_REMOVAL_PRICE = 20;
const cache = new Map();

async function cached(key, ttlMs, loader) {
  const current = cache.get(key);
  if (current && Date.now() - current.createdAt < ttlMs) return current.value;
  const value = await loader();
  cache.set(key, { value, createdAt: Date.now() });
  return value;
}

function toSqlDate(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function getPromotionOption(days) {
  const parsedDays = Number.parseInt(days, 10);
  return promotionOptions.find((option) => option.days === parsedDays);
}

function normalizeCreateFiles(files = {}) {
  if (Array.isArray(files)) {
    return { images: files, video: [] };
  }
  return {
    images: files.images || [],
    video: files.video || []
  };
}

function parseTattooRemovalCount(value) {
  const count = Number.parseInt(value || '0', 10);
  if (!Number.isInteger(count) || count < 0) return 0;
  return count;
}

function normalizeArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
}

function valueOrEmpty(value) {
  return String(value || '').trim();
}

function normalizePhone(value) {
  const trimmed = valueOrEmpty(value);
  if (!trimmed) return '';
  const compact = trimmed.replace(/\s+/g, ' ');
  if (!/^\+?[0-9 ]+$/.test(compact)) {
    const error = new Error('Podaj prawidłowy numer telefonu. Dozwolone są cyfry, spacje i opcjonalny znak + na początku.');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  if ((compact.match(/\+/g) || []).length > 1 || (compact.includes('+') && !compact.startsWith('+'))) {
    const error = new Error('Znak + może wystąpić tylko na początku numeru telefonu.');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  return compact;
}

function inferGender(category, gender) {
  const lockedGenderByCategory = {
    Panie: 'Kobieta',
    Panowie: 'Mężczyzna',
    Pary: 'Para',
    Trans: 'Trans',
    Kluby: 'Klub / Firma'
  };
  return lockedGenderByCategory[category] || valueOrEmpty(gender);
}

function buildHours(data) {
  const labels = ['Poniedziałek - Piątek', 'Sobota', 'Niedziela'];
  return labels.map((label, index) => {
    if (data[`dayOff${index}`] === 'on') return `${label}: Wolne`;
    if (data[`allDay${index}`] === 'on') return `${label}: Cały czas`;
    return `${label}: ${valueOrEmpty(data[`hoursFrom${index}`]) || '-'}-${valueOrEmpty(data[`hoursTo${index}`]) || '-'}`;
  }).join('; ');
}

function buildStructuredDescription(data) {
  const priceLabels = ['15 minut', '30 minut', '45 minut', '2 godziny', '3 godziny', '6 godzin', '12 godzin', '24 godziny', 'Noc', 'Weekend', 'Tydzień'];
  const lines = [
    ['Opis', valueOrEmpty(data.description)],
    ['Wiek', valueOrEmpty(data.age)],
    ['Płeć', inferGender(data.category, data.gender)],
    ['Orientacja', valueOrEmpty(data.orientation)],
    ['Zodiak', valueOrEmpty(data.zodiac)],
    ['Wzrost', valueOrEmpty(data.height)],
    ['Waga', valueOrEmpty(data.weight)],
    ['Biust', valueOrEmpty(data.bust)],
    ['Rodzaj biustu', valueOrEmpty(data.bustType)],
    ['Oczy', valueOrEmpty(data.eyes)],
    ['Włosy', valueOrEmpty(data.hair)],
    ['Kraj', 'Polska'],
    ['Dzielnica', valueOrEmpty(data.district)],
    ['Telefon', normalizePhone(data.phone)],
    ['Preferowany kontakt', valueOrEmpty(data.contactPreference)],
    ['Języki', normalizeArray(data['languages[]'] || data.languages).join(', ')],
    ['Narodowość', valueOrEmpty(data.nationality)],
    ['Etniczność', valueOrEmpty(data.ethnicity)],
    ['Godziny spotkań', buildHours(data)],
    ['Wyjazdy', valueOrEmpty(data.outcalls)],
    ['Preferencje', normalizeArray(data['preferences[]'] || data.preferences).join(', ')],
    ['Weryfikacja', 'Nie']
  ];

  priceLabels.forEach((label) => {
    const key = `price_${label.replace(/\s+/g, '_').replace(/ł/g, 'l')}`;
    const value = valueOrEmpty(data[key]);
    if (value) lines.push([label, value]);
  });

  return lines
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n');
}

function buildActiveListingQuery(filters = {}) {
  const where = ["l.status IN ('approved', 'active')", 'l.deleted_at IS NULL'];
  const params = [];

  if (filters.q) {
    where.push('(l.title LIKE ? OR l.description LIKE ? OR l.city LIKE ?)');
    params.push(`%${filters.q}%`, `%${filters.q}%`, `%${filters.q}%`);
  }
  if (filters.city) {
    where.push('l.city LIKE ?');
    params.push(`%${filters.city}%`);
  }
  if (filters.region) {
    where.push('l.region = ?');
    params.push(filters.region);
  }
  if (filters.category) {
    where.push('l.category = ?');
    params.push(filters.category);
  }
  if (filters.minPrice) {
    where.push('l.price >= ?');
    params.push(Number(filters.minPrice));
  }
  if (filters.maxPrice) {
    where.push('l.price <= ?');
    params.push(Number(filters.maxPrice));
  }

  return {
    sql: `
      SELECT l.*, COALESCE(NULLIF(u.username, ''), 'Użytkownik ' || u.id) AS author_name, u.profile_verified AS owner_verified, MIN(COALESCE(i.thumbnail_path, i.medium_path, i.image_path)) AS cover
      FROM listings l
      JOIN users u ON u.id = l.user_id
      LEFT JOIN listing_images i ON i.listing_id = l.id AND COALESCE(i.hidden, 0) = 0 AND i.deleted_at IS NULL
      WHERE ${where.join(' AND ')}
      GROUP BY l.id
      ORDER BY
        CASE
          WHEN l.promoted_until IS NOT NULL AND datetime(l.promoted_until) > datetime('now') THEN 0
          ELSE 1
        END,
        datetime(l.promoted_until) DESC,
        l.created_at DESC
    `,
    params
  };
}

async function getActiveListings(filters) {
  const query = buildActiveListingQuery(filters);
  const listings = await all(query.sql, query.params);
  return promotionService.decorateListings(listings);
}

async function getCachedPopularCities() {
  return cached('popular-cities', 5 * 60 * 1000, () => all(`
    SELECT city, COUNT(*) AS count
    FROM listings
    WHERE status IN ('approved', 'active') AND deleted_at IS NULL
    GROUP BY city
    ORDER BY count DESC, city ASC
    LIMIT 20
  `));
}

async function getCachedCategoryCounts() {
  return cached('category-counts', 5 * 60 * 1000, () => all(`
    SELECT category, COUNT(*) AS count
    FROM listings
    WHERE status IN ('approved', 'active') AND deleted_at IS NULL
    GROUP BY category
    ORDER BY category ASC
  `));
}

async function getUserListings(userId) {
  const listings = await all(`
    SELECT l.*, MIN(COALESCE(i.thumbnail_path, i.medium_path, i.image_path)) AS cover
    FROM listings l
    LEFT JOIN listing_images i ON i.listing_id = l.id AND COALESCE(i.hidden, 0) = 0 AND i.deleted_at IS NULL
    WHERE l.user_id = ? AND l.deleted_at IS NULL
    GROUP BY l.id
    ORDER BY l.created_at DESC
  `, [userId]);
  return promotionService.decorateListings(listings);
}

async function getOwnedListing(listingId, userId) {
  const listing = await get(`
    SELECT l.*, MIN(COALESCE(i.thumbnail_path, i.medium_path, i.image_path)) AS cover
    FROM listings l
    LEFT JOIN listing_images i ON i.listing_id = l.id AND COALESCE(i.hidden, 0) = 0 AND i.deleted_at IS NULL
    WHERE l.id = ? AND l.user_id = ? AND l.deleted_at IS NULL
    GROUP BY l.id
  `, [listingId, userId]);
  return listing ? promotionService.decorateListing(listing) : null;
}

async function getAllListingsForAdmin() {
  const listings = await all(`
    SELECT l.*, u.email AS author_email, COALESCE(NULLIF(u.username, ''), 'Użytkownik ' || u.id) AS author_name, u.profile_verified AS owner_verified, MIN(COALESCE(i.thumbnail_path, i.medium_path, i.image_path)) AS cover
    FROM listings l
    JOIN users u ON u.id = l.user_id
    LEFT JOIN listing_images i ON i.listing_id = l.id AND COALESCE(i.hidden, 0) = 0 AND i.deleted_at IS NULL
    WHERE l.deleted_at IS NULL
    GROUP BY l.id
    ORDER BY l.created_at DESC
  `);
  return promotionService.decorateListings(listings);
}

async function getListingsForModeration() {
  const listings = await all(`
    SELECT l.*, u.email AS author_email, COALESCE(NULLIF(u.username, ''), 'Użytkownik ' || u.id) AS author_name, u.profile_verified AS owner_verified, MIN(COALESCE(i.thumbnail_path, i.medium_path, i.image_path)) AS cover
    FROM listings l
    JOIN users u ON u.id = l.user_id
    LEFT JOIN listing_images i ON i.listing_id = l.id AND COALESCE(i.hidden, 0) = 0 AND i.deleted_at IS NULL
    GROUP BY l.id
    ORDER BY l.created_at DESC
  `);
  return promotionService.decorateListings(listings);
}

async function getListingsWaitingForVerification() {
  const listings = await all(`
    SELECT l.*, u.email AS author_email, COALESCE(NULLIF(u.username, ''), 'Użytkownik ' || u.id) AS author_name, u.profile_verified AS owner_verified, MIN(COALESCE(i.thumbnail_path, i.medium_path, i.image_path)) AS cover
    FROM listings l
    JOIN users u ON u.id = l.user_id
    LEFT JOIN listing_images i ON i.listing_id = l.id AND COALESCE(i.hidden, 0) = 0 AND i.deleted_at IS NULL
    WHERE COALESCE(l.verified, 0) = 0 AND l.deleted_at IS NULL
    GROUP BY l.id
    ORDER BY l.created_at DESC
  `);
  return promotionService.decorateListings(listings);
}

async function getListingsPendingModeration() {
  const listings = await all(`
    SELECT l.*, u.email AS author_email, COALESCE(NULLIF(u.username, ''), 'Użytkownik ' || u.id) AS author_name, u.profile_verified AS owner_verified, MIN(COALESCE(i.thumbnail_path, i.medium_path, i.image_path)) AS cover
    FROM listings l
    JOIN users u ON u.id = l.user_id
    LEFT JOIN listing_images i ON i.listing_id = l.id AND COALESCE(i.hidden, 0) = 0 AND i.deleted_at IS NULL
    WHERE l.status = 'pending' AND l.deleted_at IS NULL
    GROUP BY l.id
    ORDER BY l.created_at ASC
  `);
  return promotionService.decorateListings(listings);
}

async function countUserListingSubmissions(userId, hours = 24) {
  const row = await get(`
    SELECT COUNT(*) AS count
    FROM listings
    WHERE user_id = ? AND datetime(created_at) > datetime('now', ?)
  `, [userId, `-${Number(hours) || 24} hours`]);
  return Number(row?.count || 0);
}

async function createListing(userId, data, files = {}, context = {}) {
  const { title, description, price, city, region, category, age } = data;
  const gender = inferGender(category, data.gender);
  if (!valueOrEmpty(title)) {
    const error = new Error('Podaj nazwę lub tytuł ogłoszenia.');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  if (!valueOrEmpty(age)) {
    const error = new Error('Podaj wiek.');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  if (!valueOrEmpty(gender)) {
    const error = new Error('Wybierz płeć.');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  if (!valueOrEmpty(category)) {
    const error = new Error('Wybierz kategorię.');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  if (!valueOrEmpty(region)) {
    const error = new Error('Wybierz województwo.');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  if (!valueOrEmpty(city)) {
    const error = new Error('Wybierz miasto.');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  if (!valueOrEmpty(description)) {
    const error = new Error('Dodaj opis ogłoszenia.');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  if (!valueOrEmpty(price)) {
    const error = new Error('Podaj cenę na godzinę.');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const media = normalizeCreateFiles(files);
  if (media.images.length < 3 || media.images.length > 6) {
    const error = new Error('Dodaj od 3 do 6 zdjęć.');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  if (media.video.length > 1) {
    const error = new Error('Możesz dodać maksymalnie jeden plik wideo.');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const tattooRemovalCount = parseTattooRemovalCount(data.tattooRemovalCount);
  if (tattooRemovalCount > media.images.length) {
    const error = new Error('Liczba zdjęć do usuwania tatuażu nie może być większa niż liczba dodanych zdjęć.');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const promotionOption = getPromotionOption(data.promotionDays || 0);
  if (!promotionOption) {
    const error = new Error('Wybierz prawidłową opcję promowania.');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const faceBlur = 0;
  const tattooRemovalCost = tattooRemovalCount * TATTOO_REMOVAL_PRICE;
  const promotionCost = promotionOption.price;
  const totalCost = tattooRemovalCost + promotionCost;

  const promotedUntil = promotionOption.days > 0
    ? toSqlDate(new Date(Date.now() + promotionOption.days * 24 * 60 * 60 * 1000))
    : null;
  const videoPath = media.video[0] ? media.video[0].videoPath : null;
  const structuredDescription = buildStructuredDescription(data);
  const mediaWarnings = [...new Set(media.images.map((file) => file.warning).filter(Boolean))];
  const moderationReason = mediaWarnings.length ? mediaWarnings.join(' ') : null;

  await run('BEGIN TRANSACTION');
  try {
    const result = await run(`
      INSERT INTO listings (
        user_id, title, description, price, city, region, category,
        status, moderation_reason, created_ip, promoted_until, video_path, face_blur, tattoo_removal_count, create_options_cost
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)
    `, [
      userId,
      title.trim(),
      structuredDescription,
      Number(price),
      city.trim(),
      region,
      category,
      moderationReason,
      context.ip || null,
      promotedUntil,
      videoPath,
      faceBlur,
      tattooRemovalCount,
      totalCost
    ]);

    for (const file of media.images) {
      await run(`
        INSERT INTO listing_images (
          listing_id, image_path, thumbnail_path, medium_path, large_path,
          original_path, file_hash, file_size, processing_warning
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        result.lastID,
        file.imagePath || file.mediumPath,
        file.thumbnailPath || null,
        file.mediumPath || file.imagePath || null,
        file.largePath || file.imagePath || null,
        file.originalPath || file.largePath || file.imagePath || null,
        file.hash || null,
        file.size || 0,
        file.warning || null
      ]);
    }

    await run('COMMIT');
    const recentFromIp = context.ip ? await all(`
      SELECT id FROM listings
      WHERE created_ip = ? AND datetime(created_at) > datetime('now', '-1 hour')
    `, [context.ip]).catch(() => []) : [];
    if (recentFromIp.length >= 5) {
      await fraudService.flagSuspicious({
        userId,
        ip: context.ip,
        eventType: 'many_listings_same_ip',
        score: recentFromIp.length,
        metadata: { listingId: result.lastID }
      });
    }
    return result.lastID;
  } catch (error) {
    await run('ROLLBACK');
    throw error;
  }
}

async function getListingWithImages(listingId, options = {}) {
  const listing = await get(`
    SELECT l.*, COALESCE(NULLIF(u.username, ''), 'Użytkownik ' || u.id) AS author_name, u.email AS author_email, u.profile_verified AS owner_verified
    FROM listings l
    JOIN users u ON u.id = l.user_id
    WHERE l.id = ? AND l.deleted_at IS NULL
  `, [listingId]);
  if (!listing) return { listing: null, images: [] };

  const images = await all(`
    SELECT * FROM listing_images
    WHERE listing_id = ?
      AND deleted_at IS NULL
      ${options.includeHidden ? '' : 'AND COALESCE(hidden, 0) = 0'}
    ORDER BY id ASC
  `, [listing.id]);
  return { listing: promotionService.decorateListing(listing), images };
}

function canViewListing(listing, user) {
  return ['approved', 'active'].includes(listing.status) || user?.role === 'admin' || user?.role === 'moderator' || listing.user_id === user?.id;
}

async function deleteListing(listingId, user) {
  const listing = await get('SELECT * FROM listings WHERE id = ? AND deleted_at IS NULL', [listingId]);
  if (!listing || (listing.user_id !== user.id && user.role !== 'admin')) {
    const error = new Error('Nie możesz usunąć tego ogłoszenia.');
    error.code = 'FORBIDDEN';
    throw error;
  }

  await run('UPDATE listings SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?', [listingId]);
  await auditService.logAction({
    adminId: user.role === 'admin' ? user.id : null,
    actionType: 'listing_soft_delete',
    targetType: 'listing',
    targetId: listingId,
    metadata: { actorRole: user.role }
  });
}

function normalizeStatus(status) {
  if (['pending', 'approved', 'rejected', 'hidden'].includes(status)) return status;
  if (status === 'active') return 'approved';
  return 'hidden';
}

async function updateListingStatus(listingId, status, actor = null, reason = null) {
  const normalizedStatus = normalizeStatus(status);
  await run('UPDATE listings SET status = ?, moderation_reason = ? WHERE id = ?', [
    normalizedStatus,
    normalizedStatus === 'rejected' ? String(reason || '').trim() || 'Odrzucono w moderacji.' : String(reason || '').trim() || null,
    listingId
  ]);
  if (actor) {
    const actions = {
      approved: 'approve_listing',
      rejected: 'reject_listing',
      hidden: 'hide_listing',
      pending: 'mark_listing_pending'
    };
    await auditService.logAction({
      adminId: actor.id,
      actionType: actions[normalizedStatus] || 'update_listing_status',
      targetType: 'listing',
      targetId: listingId,
      metadata: { status: normalizedStatus, reason: String(reason || '').trim() || null }
    });
  }
}

function setDescriptionVerification(description, verified) {
  const lines = String(description || '').split('\n');
  const value = verified ? 'Tak' : 'Nie';
  let replaced = false;
  const updated = lines.map((line) => {
    if (/^\s*weryfikacja\s*:/i.test(line)) {
      replaced = true;
      return `Weryfikacja: ${value}`;
    }
    return line;
  });
  if (!replaced) updated.push(`Weryfikacja: ${value}`);
  return updated.join('\n').trim();
}

async function updateListingVerification(listingId, verified) {
  const listing = await get('SELECT id, description FROM listings WHERE id = ?', [listingId]);
  if (!listing) {
    const error = new Error('Nie znaleziono ogłoszenia.');
    error.code = 'NOT_FOUND';
    throw error;
  }
  await run('UPDATE listings SET verified = ?, description = ? WHERE id = ?', [
    verified ? 1 : 0,
    setDescriptionVerification(listing.description, verified),
    listing.id
  ]);
}

module.exports = {
  countUserListingSubmissions,
  canViewListing,
  createListing,
  deleteListing,
  getActiveListings,
  getAllListingsForAdmin,
  getCachedCategoryCounts,
  getCachedPopularCities,
  getListingsForModeration,
  getListingsPendingModeration,
  getListingsWaitingForVerification,
  getListingWithImages,
  getOwnedListing,
  getUserListings,
  updateListingStatus,
  updateListingVerification
};
