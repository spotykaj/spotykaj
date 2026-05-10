const { appName } = require('../config/constants');
const listingService = require('../services/listingService');

async function showHome(req, res, next) {
  try {
    const filters = {
      q: req.query.q?.trim(),
      city: req.query.city?.trim(),
      district: req.query.district?.trim(),
      region: req.query.region,
      category: req.query.category,
      minPrice: req.query.minPrice,
      maxPrice: req.query.maxPrice
    };
    const listings = await listingService.getActiveListings(filters);
    const popularCities = await listingService.getCachedPopularCities();
    const categoryCounts = await listingService.getCachedCategoryCounts();
    res.render('home', {
      title: appName,
      listings,
      filters,
      popularCitiesStats: popularCities,
      categoryCounts,
      metaDescription: 'Spotykaj - szybkie wyszukiwanie moderowanych ogłoszeń w Twojej okolicy.',
      canonicalUrl: 'https://spotykaj.pl/'
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  showHome
};
