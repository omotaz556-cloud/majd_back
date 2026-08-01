const express = require('express');
const { protect } = require('../../middleware/auth.middleware');
const { listMyQuests, claimQuest } = require('./quest.controller');

const router = express.Router();

router.get('/', protect, listMyQuests);
router.post('/:questId/claim', protect, claimQuest);

module.exports = router;
