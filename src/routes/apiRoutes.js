const express = require('express');
const locationController = require('../controllers/locationController');

const router = express.Router();

router.get('/api/locations/regions', locationController.regions);
router.get('/api/locations/cities', locationController.cities);
router.get('/api/locations/districts', locationController.districts);
router.get('/api/locations/streets', locationController.streets);

module.exports = router;
