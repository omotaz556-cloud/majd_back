const express = require('express');
const { protect } = require('../../middleware/auth.middleware');
const { getVipRanking } = require('./ranking.controller');

const router = express.Router();

router.get('/vip', protect, getVipRanking);

module.exports = router;
