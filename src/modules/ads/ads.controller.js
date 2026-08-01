const crypto = require('crypto');
const rewardSessionService = require('./rewardSession.service');
const {
  ADS_ENABLED,
  ADS_PROVIDER,
  ADS_TEST_MODE,
  GOOGLE_AD_MANAGER_NETWORK_CODE,
  GOOGLE_PUBLISHER_ID,
  GOOGLE_BANNER_AD_UNIT,
  GOOGLE_INTERSTITIAL_AD_UNIT,
  GOOGLE_REWARDED_AD_UNIT,
  ADS_WEBHOOK_SECRET,
} = require('./ads.config');

/**
 * ====== GET /api/ads/config ======
 * إعدادات عامة (من غير أي أسرار) عشان الفرونت إند يهيّئ AdsBootstrap بيها.
 * لاحظ إننا منرجعش GOOGLE_REWARDED_SERVER_TOKEN هنا خالص - ده سر سيرفر فقط.
 */
function getPublicAdsConfig(req, res) {
  res.json({
    enabled: ADS_ENABLED,
    provider: ADS_PROVIDER,
    testMode: ADS_TEST_MODE,
    google: {
      networkCode: GOOGLE_AD_MANAGER_NETWORK_CODE,
      publisherId: GOOGLE_PUBLISHER_ID,
      bannerAdUnit: GOOGLE_BANNER_AD_UNIT,
      interstitialAdUnit: GOOGLE_INTERSTITIAL_AD_UNIT,
      rewardedAdUnit: GOOGLE_REWARDED_AD_UNIT,
    },
  });
}

/**
 * ====== POST /api/ads/reward/start ======
 * Body: { adUnit?, kind, context? }
 *   kind    : 'resources' | 'double_reward' | 'daily_double'
 *   context : بيانات إضافية خاصة بالـ kind (مثلاً { resource: 'gold' } لـ
 *             resources، أو { battleId } لـ double_reward).
 *             مفيش أي قيمة مكافأة فعلية بتتقرأ من هنا - القيم كلها من
 *             rewardKinds.config.js على مستوى السيرفر بس.
 */
async function startReward(req, res) {
  try {
    const { adUnit, kind, context } = req.body || {};
    const result = await rewardSessionService.startRewardSession({
      userId: req.user._id,
      adUnit,
      kind,
      context,
    });
    return res.status(201).json(result);
  } catch (err) {
    console.error('[Ads] startReward error:', err.message);
    return res.status(400).json({ error: err.message });
  }
}

/**
 * ====== GET /api/ads/hourly-gift/status ======
 * بيرجّع { eligible, secondsRemaining, cooldownHours } عشان الفرونت إند
 * يعرض عدّاد تنازلي حي لهدية الساعة الجاية من غير ما يحتاج يحاول /start.
 */
async function getHourlyGiftStatus(req, res) {
  try {
    const status = await rewardSessionService.getHourlyGiftStatus(req.user._id);
    return res.json(status);
  } catch (err) {
    console.error('[Ads] getHourlyGiftStatus error:', err.message);
    return res.status(400).json({ error: err.message });
  }
}

/**
 * ====== POST /api/ads/reward/complete ======
 */
async function completeReward(req, res) {
  try {
    const { sessionId, signedToken, providerPayload } = req.body || {};
    const result = await rewardSessionService.completeRewardSession({
      sessionId,
      userId: req.user._id,
      signedToken,
      providerPayload,
    });
    return res.status(200).json(result);
  } catch (err) {
    console.error('[Ads] completeReward error:', err.message);
    return res.status(400).json({ error: err.message });
  }
}

/**
 * ====== POST /api/ads/webhook ======
 * مفتوح من غير `protect` - بينادى عليه المزوّد نفسه (server-to-server)، مش
 * اللاعب. مفيش حاجة حساسة بترجع من هنا، وكل التحقق الفعلي بيحصل جوه
 * rewardSession.service بناءً على sessionId.
 *
 * ====== Webhook verification (Security Hardening) ======
 * لو ADS_WEBHOOK_SECRET متحدد في .env، أي طلب لازم يبعت نفس القيمة في هيدر
 * X-Webhook-Secret - المقارنة بتتم بـ timingSafeEqual (زي verifySessionToken
 * في rewardSessionToken.util.js) عشان تمنع timing attack يقدر يكشف السر
 * حرف بحرف. لو مفيش ADS_WEBHOOK_SECRET أصلًا (وضع mock/تطوير من غير سر
 * محدد)، الـ endpoint بيفضل شغال زي ما كان - بس ده مرفوض في الإنتاج أصلًا
 * (راجع الفحص في ads.config.js اللي بيمنع الإقلاع من غيره).
 */
function isValidWebhookSecret(req) {
  if (!ADS_WEBHOOK_SECRET) return true; // مفيش سر محدد (تطوير/mock) - مفيش تحقق مطلوب
  const provided = req.get('X-Webhook-Secret') || '';
  const expectedBuf = Buffer.from(ADS_WEBHOOK_SECRET);
  const providedBuf = Buffer.from(String(provided));
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

async function providerWebhook(req, res) {
  if (!isValidWebhookSecret(req)) {
    console.warn('[Ads] webhook rejected: invalid or missing X-Webhook-Secret');
    return res.status(401).json({ ok: false, error: 'Invalid webhook secret' });
  }

  try {
    const result = await rewardSessionService.handleProviderWebhook(req.body || {});
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('[Ads] webhook error:', err.message);
    return res.status(400).json({ ok: false, error: err.message });
  }
}

module.exports = {
  getPublicAdsConfig,
  startReward,
  completeReward,
  providerWebhook,
  getHourlyGiftStatus,
};
