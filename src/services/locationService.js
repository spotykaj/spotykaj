const locations = require('../../data/locations.json');

function getRegions() {
  return locations.regions.map((region) => region.name);
}

function findRegion(regionName) {
  return locations.regions.find((region) => region.name === regionName);
}

function findCity(cityName, regionName) {
  const regions = regionName ? [findRegion(regionName)].filter(Boolean) : locations.regions;
  for (const region of regions) {
    const city = region.cities.find((item) => item.name === cityName);
    if (city) return city;
  }
  return null;
}

function getCities(regionName) {
  const regions = regionName ? [findRegion(regionName)].filter(Boolean) : locations.regions;
  return regions.flatMap((region) => region.cities.map((city) => city.name));
}

function getDistricts(cityName, regionName) {
  const city = findCity(cityName, regionName);
  return city ? city.districts.map((district) => district.name) : [];
}

function getStreets(cityName, districtName, regionName) {
  const city = findCity(cityName, regionName);
  if (!city) return [];
  if (!districtName) return city.streets || [];
  const district = city.districts.find((item) => item.name === districtName);
  return district ? district.streets : [];
}

module.exports = {
  getCities,
  getDistricts,
  getRegions,
  getStreets
};
