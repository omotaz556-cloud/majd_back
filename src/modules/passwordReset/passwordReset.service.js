const crypto = require('crypto');
const User = require('../users/user.model');
const PasswordResetToken = require('./passwordResetToken.model');
const emailProvider = require('./emailProviders');
const { hashPassword } = require('../auth/auth.service');

const TOKEN_TTL_MINUTES = 60;
const TOKEN_BYTES = 32;

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function buildResetUrl(rawToken) {
  const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
  return `${frontendUrl}/reset-password?token=${rawToken}`;
}

/**
 * ====== طلب استعادة كلمة المرور ======
 * دايمًا بيرجع نجاح لو الإيميل مش موجود في القاعدة (عشان محدّش يقدر يستخدم
 * الـ endpoint ده كطريقة لمعرفة مين عنده حساب مسجّل بإيميل معيّن - user
 * enumeration). لو الإيميل موجود فعلاً وحساب local، بيتبعت له إيميل حقيقي.
 */
async function requestPasswordReset(email) {
  const normalizedEmail = (email || '').toLowerCase().trim();
  if (!normalizedEmail) {
    throw new Error('البريد الإلكتروني مطلوب');
  }

  const user = await User.findOne({ email: normalizedEmail });

  // حسابات auth_provider='majd_platform' مفيش عندها باسورد محلي أصلاً -
  // نفس منطق changePassword في user.controller.js. مفيش داعي نبعت إيميل
  // استعادة لحساب زي ده حتى لو موجود.
  if (!user || !user.is_active || user.auth_provider !== 'local') {
    return { sent: false };
  }

  const rawToken = crypto.randomBytes(TOKEN_BYTES).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000);

  // نمسح أي توكنات قديمة سارية لنفس اليوزر - رابط واحد سارٍ بس في كل مرة
  await PasswordResetToken.deleteMany({ user_id: user._id, used_at: null });

  await PasswordResetToken.create({
    user_id: user._id,
    token_hash: tokenHash,
    expires_at: expiresAt,
  });

  const resetUrl = buildResetUrl(rawToken);

  try {
    await emailProvider.sendPasswordResetEmail({
      to: user.email,
      resetUrl,
      userName: user.name,
    });
  } catch (err) {
    // لو الإرسال الفعلي فشل (مثلاً EMAIL_PROVIDER=resend والدومين لسه مش
    // Verified)، لازم نسجّل الخطأ من غير ما نسيبه يوصل لل response - لو
    // سبنا الـ error يترمي هنا، الـ controller هيرجّع رسالة خطأ مختلفة عن
    // حالة "الإيميل مش موجود" وده بيكسر حماية user enumeration اللي إحنا
    // مصممينها من الأول (فرق واضح بين "مسجّل بس فشل الإرسال" و"مش مسجّل").
    console.error('[PasswordReset] email send failed:', err.message);
  }

  return { sent: true };
}

/**
 * ====== تنفيذ استعادة كلمة المرور (بعد ضغط الرابط) ======
 * بيتحقق من التوكن (hash مطابق + لسه ساري + متستخدمش قبل كده)، يغيّر
 * الباسورد، ويعلّم التوكن كـ "مستخدم" عشان محدّش يقدر يعيد استخدامه تاني
 * (one-time use) حتى لو لسه جوه فترة الصلاحية.
 */
async function resetPassword(rawToken, newPassword) {
  if (!rawToken || !newPassword) {
    throw new Error('التوكن وكلمة المرور الجديدة مطلوبين');
  }

  if (newPassword.length < 8) {
    throw new Error('كلمة المرور الجديدة لازم تكون 8 أحرف على الأقل');
  }

  const tokenHash = hashToken(rawToken);
  const tokenDoc = await PasswordResetToken.findOne({ token_hash: tokenHash });

  if (!tokenDoc || tokenDoc.used_at || tokenDoc.expires_at < new Date()) {
    throw new Error('رابط الاستعادة غير صالح أو منتهي الصلاحية');
  }

  const user = await User.findById(tokenDoc.user_id).select('+password_hash');
  if (!user || !user.is_active || user.auth_provider !== 'local') {
    throw new Error('رابط الاستعادة غير صالح');
  }

  user.password_hash = await hashPassword(newPassword);
  await user.save();

  tokenDoc.used_at = new Date();
  await tokenDoc.save();

  return { success: true };
}

module.exports = { requestPasswordReset, resetPassword };
