const express = require('express');
const { protect } = require('../../middleware/auth.middleware');
const {
  getPublicAdsConfig,
  startReward,
  completeReward,
  providerWebhook,
  getHourlyGiftStatus,
} = require('./ads.controller');

const router = express.Router();

// إعدادات عامة (Publisher ID, Network Code, Ad Unit IDs..) - من غير أسرار
router.get('/config', getPublicAdsConfig);

// تدفق الإعلان المكافئ (Reward Kind System) - محمي (لازم توكن مستخدم)
router.post('/reward/start', protect, startReward);
router.post('/reward/complete', protect, completeReward);

// حالة هدية الساعة (أهلية + عدّاد تنازلي) - عشان الكارت في الفرونت إند
router.get('/hourly-gift/status', protect, getHourlyGiftStatus);

// من المزوّد نفسه (server-to-server) - من غير `protect`
router.post('/webhook', providerWebhook);

module.exports = router;
