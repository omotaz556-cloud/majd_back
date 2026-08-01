const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { ACCOUNT_PROVIDER } = require('../../config/providers');
const User = require('../users/user.model');
const walletService = require('../wallets/wallet.service');
const counterService = require('../common/counter.service');

// ====== أساس أرقام "Player ID" - بيبدأ من هنا بدل الصفر عشان يبان زي رقم
// تعريف حقيقي في لعبة استراتيجية كبيرة (6 أرقام) بدل "1", "2"... راجع
// counter.service.nextSequence للتفاصيل. ======
const PLAYER_ID_OFFSET = 100000;

const SALT_ROUNDS = 12;

async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

async function comparePassword(plainPassword, hash) {
  return bcrypt.compare(plainPassword, hash);
}

function generateToken(user) {
  return jwt.sign(
    {
      sub: user._id.toString(),
      role: user.role,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

/**
 * ====== نقطة الالتقاء المشتركة بين كل مزودي الحساب ======
 * بتاخد "ملف تعريف خارجي" موحّد الشكل (external_id, name, email) - نفس الشكل
 * الراجع من أي مزوّد (local.provider.js أو majdPlatform.provider.js لاحقاً) -
 * وبتربطه بحساب محلي في User collection: لو موجود بيرجّعه زي ما هو، لو مش
 * موجود بتنشئه (ومعاه محفظة فوراً، زي أي مستخدم جديد بالظبط).
 *
 * دي بالضبط النقطة اللي بتخلي auth.controller وكل الموديولات التانية
 * (castle, games, wallet, challenges, ...) متعرفش ولا يهمها مين المزوّد
 * الفعّال - كلهم شغالين على User محلي عادي وJWT عادي زي ما كان دايماً.
 */
async function findOrCreateFromProfile(profile) {
  const { external_id: externalId, name, email } = profile;

  if (!externalId) {
    throw new Error('Account provider profile is missing external_id');
  }

  // local: الربط بيتم بالإيميل (زي ما كان الحساب المحلي شغال بيه دايماً)
  // majd_platform: الربط بيتم بـ platform_account_id (external_id عند المنصة)
  const lookup =
    ACCOUNT_PROVIDER === 'local'
      ? { email: externalId }
      : { platform_account_id: externalId };

  let user = await User.findOne(lookup);

  if (!user) {
    // بيانات خاصة بمزوّد local بس (password_hash جاهز من register()) - أي
    // مزوّد تاني مش بيبعتها والحقل بيفضل فاضي (مش مطلوب غير لـ local، راجع
    // user.model.js)
    const localOnlyFields = profile._local || {};

    user = await User.create({
      name,
      email: email || undefined,
      auth_provider: ACCOUNT_PROVIDER,
      // مقصود: من غير الحقل خالص لحسابات local (مش null) - راجع الملحوظة
      // على تعريف الحقل في user.model.js
      ...(ACCOUNT_PROVIDER !== 'local' ? { platform_account_id: externalId } : {}),
      password_hash: localOnlyFields.password_hash,
      role: 'player',
      player_id: await counterService.nextSequence('player_id', PLAYER_ID_OFFSET),
    });

    // كل مستخدم جديد بياخد محفظة فوراً - نفس السلوك بالظبط بغض النظر عن مصدر الحساب
    await walletService.createWalletForUser(user._id);
  }

  if (!user.is_active) {
    throw new Error('Invalid credentials');
  }

  return user;
}

module.exports = {
  hashPassword,
  comparePassword,
  generateToken,
  verifyToken,
  findOrCreateFromProfile,
};
