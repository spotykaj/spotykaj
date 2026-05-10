const locationService = require('../services/locationService');

function regions(_req, res) {
  res.json({ regions: locationService.getRegions() });
}

function cities(req, res) {
  res.json({ cities: locationService.getCities(req.query.region) });
}

function districts(req, res) {
  res.json({ districts: locationService.getDistricts(req.query.city, req.query.region) });
}

function streets(req, res) {
  res.json({
    streets: locationService.getStreets(req.query.city, req.query.district, req.query.region)
  });
}

module.exports = {
  cities,
  districts,
  regions,
  streets
};
