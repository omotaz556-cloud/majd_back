const express = require('express');
const rateLimit = require('express-rate-limit');
const { protect } = require('../../middleware/auth.middleware');
const { getPublicProfile, searchUsers, changePassword } = require('./user.controller');

const router = express.Router();

// حماية من محاولات تخمين كلمة المرور الحالية بالتكرار
const changePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 دقيقة
  max: 10,
  message: { error: 'محاولات كتير - جرّب تاني بعد شوية' },
});

// ملحوظة: راوت البحث لازم يتحط قبل '/:id/profile' عشان 'search' متتفسرش
// كـ :id (express بيطابق بالترتيب).
router.get('/search', protect, searchUsers);
router.post('/change-password', protect, changePasswordLimiter, changePassword);
router.get('/:id/profile', protect, getPublicProfile);

module.exports = router;