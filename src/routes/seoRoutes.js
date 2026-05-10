const express = require('express');
const listingService = require('../services/listingService');

const router = express.Router();

router.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send([
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /moderator',
    'Disallow: /panel',
    'Sitemap: https://spotykaj.pl/sitemap.xml'
  ].join('\n'));
});

router.get('/sitemap.xml', async (_req, res, next) => {
  try {
    const listings = await listingService.getActiveListings({});
    const urls = [
      'https://spotykaj.pl/',
      'https://spotykaj.pl/logowanie',
      'https://spotykaj.pl/rejestracja',
      ...listings.slice(0, 1000).map((listing) => `https://spotykaj.pl/ogloszenia/${listing.id}`)
    ];
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url><loc>${url}</loc></url>`).join('\n')}
</urlset>`);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
