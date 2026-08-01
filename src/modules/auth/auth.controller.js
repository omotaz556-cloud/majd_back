const { ACCOUNT_PROVIDER } = require('../../config/providers');
const accountProvider = require('./providers');
const { generateToken, findOrCreateFromProfile } = require('./auth.service');

/**
 * ====== تسجيل حساب جديد ======
 * متاح بس لما ACCOUNT_PROVIDER=local. حساب منصة (majd_platform) أصلاً موجود
 * على المنصة نفسها - مفيش تسجيل جديد من جوا اللعبة، وده بالظبط سبب طلب
 * التكامل ده.
 */
async function register(req, res) {
  if (ACCOUNT_PROVIDER !== 'local' || typeof accountProvider.register !== 'function') {
    return res.status(400).json({
      error: 'Registration is not available - sign in with your existing Majd platform account',
    });
  }

  try {
    const profile = await accountProvider.register(req.body || {});
    const user = await findOrCreateFromProfile(profile);
    const token = generateToken(user);

    return res.status(201).json({ user, token });
  } catch (err) {
    console.error('[Auth] register error:', err.message);
    const status = err.message === 'Email already registered' ? 409 : 400;
    return res.status(status).json({ error: err.message || 'Registration failed' });
  }
}

/**
 * ====== تسجيل دخول ======
 * الـ controller ده متعرفش تفاصيل المزوّد الفعّال خالص - بينادي
 * accountProvider.authenticate() (اللي بيرجّع ملف تعريف موحّد الشكل مهما كان
 * المزوّد)، وبعدين findOrCreateFromProfile بتربطه بحساب محلي وتصدر JWT
 * بالظبط زي ما كان بيحصل دايماً. تحويل ACCOUNT_PROVIDER من local
 * لـ majd_platform (بعد ما التنفيذ الفعلي يتحط في
 * providers/majdPlatform.provider.js) مش محتاج أي تعديل هنا.
 */
async function login(req, res) {
  try {
    const profile = await accountProvider.authenticate(req.body || {});
    const user = await findOrCreateFromProfile(profile);
    const token = generateToken(user);

    return res.json({ user, token });
  } catch (err) {
    console.error('[Auth] login error:', err.message);
    return res.status(401).json({ error: 'Invalid credentials' });
  }
}

module.exports = { register, login };
