const express = require('express');
const { protect } = require('../../middleware/auth.middleware');
const { getMyWallet, getMyTransactions } = require('./wallet.controller');

const router = express.Router();

router.get('/me', protect, getMyWallet);
router.get('/me/transactions', protect, getMyTransactions);

module.exports = router;
