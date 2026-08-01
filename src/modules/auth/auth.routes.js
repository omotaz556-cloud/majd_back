const express = require('express');
const rateLimit = require('express-rate-limit');
const { register, login } = require('./auth.controller');

const router = express.Router();

// حماية بسيطة من brute-force على تسجيل الدخول
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 دقيقة
  max: 20,
  message: { error: 'Too many attempts, please try again later' },
});

router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);

module.exports = router;
