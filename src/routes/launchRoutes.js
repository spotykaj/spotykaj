const express = require('express');
const launchController = require('../controllers/launchController');

const router = express.Router();

router.post('/powiadom-mnie', launchController.subscribe);

module.exports = router;
