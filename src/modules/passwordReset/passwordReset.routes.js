const express = require('express');
const rateLimit = require('express-rate-limit');
const { forgotPassword, resetPasswordHandler } = require('./passwordReset.controller');

const router = express.Router();

// حماية من إساءة استخدام endpoint الطلب (زي auth.routes.js بالظبط) - يمنع
// حد يستخدمه كوسيلة spam إيميلات على حساب حد تاني
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 دقيقة
  max: 5,
  message: { error: 'محاولات كتير - حاول تاني بعد شوية' },
});

const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'محاولات كتير - حاول تاني بعد شوية' },
});

router.post('/forgot-password', forgotPasswordLimiter, forgotPassword);
router.post('/reset-password', resetPasswordLimiter, resetPasswordHandler);

module.exports = router;
