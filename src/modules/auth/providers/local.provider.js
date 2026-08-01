const User = require('../../users/user.model');
const { hashPassword, comparePassword } = require('../auth.service');

/**
 * ====== مزوّد الحساب: Local (الوضع الحالي/الافتراضي) ======
 * بيتفعّل لما ACCOUNT_PROVIDER=local. حساب اللاعب بيتخزن بالكامل عندنا
 * (إيميل + password_hash في User collection) - زي ما كان الحال قبل ما
 * التكامل ده يتبني، من غير أي تغيير في السلوك.
 */

/**
 * إنشاء حساب جديد بإيميل وباسورد. متاحة بس للمزوّد ده - أي مزوّد "حساب منصة"
 * (زي majd_platform) مش المفروض يصدّر الدالة دي أصلاً.
 */
async function register({ name, email, password }) {
  if (!name || !email || !password) {
    throw new Error('name, email and password are required');
  }

  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }

  const normalizedEmail = email.toLowerCase();

  const existingUser = await User.findOne({ email: normalizedEmail });
  if (existingUser) {
    throw new Error('Email already registered');
  }

  const password_hash = await hashPassword(password);

  return {
    external_id: normalizedEmail,
    name,
    email: normalizedEmail,
    // بيانات خاصة بالمزوّد ده بس - auth.service بيستخدمها وقت الإنشاء
    // الأول فقط، ومحدّش خارج المزوّد ده بيشوفها
    _local: { password_hash },
  };
}

/**
 * التحقق من إيميل وباسورد مقابل الحساب المحلي الموجود بالفعل.
 */
async function authenticate({ email, password }) {
  if (!email || !password) {
    throw new Error('email and password are required');
  }

  const normalizedEmail = email.toLowerCase();

  // لازم select('+password_hash') لأن الموديل بيخفيه بشكل افتراضي
  const user = await User.findOne({ email: normalizedEmail }).select('+password_hash');

  if (!user || !user.is_active || !user.password_hash) {
    throw new Error('Invalid credentials');
  }

  const isMatch = await comparePassword(password, user.password_hash);
  if (!isMatch) {
    throw new Error('Invalid credentials');
  }

  return {
    external_id: normalizedEmail,
    name: user.name,
    email: normalizedEmail,
  };
}

module.exports = { register, authenticate };
