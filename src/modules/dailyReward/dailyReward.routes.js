const express = require('express');
const { protect } = require('../../middleware/auth.middleware');
const { getStatus, claim } = require('./dailyReward.controller');

const router = express.Router();

router.get('/status', protect, getStatus);
router.post('/claim', protect, claim);

module.exports = router;
