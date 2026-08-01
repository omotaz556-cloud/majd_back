const { ADS_PROVIDER } = require('../../config/providers');

/**
 * ====== Ads Config ======
 * المكان الوحيد في الباك إند اللي بيقرأ منه الكود متغيرات البيئة الخاصة
 * بالإعلانات (غير ADS_PROVIDER اللي موجود أصلاً في config/providers.js).
 * لما العميل يخلّص حساب Google Ad Manager بتاعه، التغيير المطلوب هو فقط في
 * ملف .env - من غير أي لمسة للكود.
 */

const ADS_ENABLED = String(process.env.ADS_ENABLED || 'true').trim().toLowerCase() === 'true';
const ADS_DEBUG = String(process.env.ADS_DEBUG || 'false').trim().toLowerCase() === 'true';
const ADS_TEST_MODE = String(process.env.ADS_TEST_MODE || 'true').trim().toLowerCase() === 'true';

// ====== Google Ad Manager (Web / GPT) ======
const GOOGLE_AD_MANAGER_NETWORK_CODE = process.env.GOOGLE_AD_MANAGER_NETWORK_CODE || 'TEST_NETWORK';
const GOOGLE_PUBLISHER_ID = process.env.GOOGLE_PUBLISHER_ID || 'pub-test';
const GOOGLE_APP_ID = process.env.GOOGLE_APP_ID || 'test-app';
const GOOGLE_BANNER_AD_UNIT = process.env.GOOGLE_BANNER_AD_UNIT || 'test-banner';
const GOOGLE_INTERSTITIAL_AD_UNIT = process.env.GOOGLE_INTERSTITIAL_AD_UNIT || 'test-interstitial';
const GOOGLE_REWARDED_AD_UNIT = process.env.GOOGLE_REWARDED_AD_UNIT || 'test-rewarded';
// مش السيرفر بيتحقق بيه من جوجل مباشرة (زي ما كان الحال مع AdMob SSV) -
// GPT rewarded web مفيهوش callback موقّع من جوجل زي الموبايل، فالتوكن ده
// بيتحول لتوقيع HMAC داخلي على مستوى السيرفر نفسه (راجع rewardedSession.util.js)
// بيفضل موجود كمتغير بيئة عشان لو Google أضافت لاحقاً آلية تحقق مشابهة لـ SSV
// للويب، يبقى جاهز نربطه من غير تعديل كود إضافي.
const GOOGLE_REWARDED_SERVER_TOKEN = process.env.GOOGLE_REWARDED_SERVER_TOKEN || 'test-token';

// مدة صلاحية جلسة المكافأة بالثواني (افتراضي: 5 دقايق - وقت كافي لعرض إعلان)
const REWARD_SESSION_TTL_SECONDS = Number(process.env.REWARD_SESSION_TTL_SECONDS) || 300;

// السر المستخدم لتوقيع جلسات المكافأة (HMAC) - لازم يتغيّر في الإنتاج
const REWARD_SESSION_SECRET =
  process.env.REWARD_SESSION_SECRET || process.env.JWT_SECRET || 'change_this_reward_session_secret';

// ====== Security Hardening: Production startup validation ======
// لو السيرفر شغال في الإنتاج (NODE_ENV=production) وأي سر من دول لسه على
// قيمته الافتراضية الغير آمنة (نفس القيمة الموجودة في .env.example)، نمنع
// السيرفر من الإقلاع خالص بدل ما نسيبه يشتغل وهو بيوقّع جلسات مكافأة بسر
// معروف/تخميني - ده بيسمح لأي حد يزوّر signedToken ويستدعي completeRewardSession
// من غير ما يشوف إعلان أصلاً. نفس فلسفة الفحص الموجود أصلاً في
// config/providers.js (throw عند require() - بيوقف الإقلاع فورًا، مش بعد
// ما يتقبل أول طلب).
const INSECURE_DEFAULT_SECRETS = ['change_this_reward_session_secret', 'change_this_to_a_long_random_secret'];
if (process.env.NODE_ENV === 'production' && INSECURE_DEFAULT_SECRETS.includes(REWARD_SESSION_SECRET)) {
  throw new Error(
    'REWARD_SESSION_SECRET (و/أو JWT_SECRET) لسه على القيمة الافتراضية الغير آمنة في الإنتاج. ' +
      'حط قيمة عشوائية طويلة في متغيرات البيئة قبل التشغيل.'
  );
}
if (process.env.NODE_ENV === 'production' && GOOGLE_REWARDED_SERVER_TOKEN === 'test-token') {
  // ====== ملحوظة: التوكن ده احتياطي حاليًا (مفيش أي استهلاك فعلي ليه في
  // الكود - راجع التعليق فوق GOOGLE_REWARDED_SERVER_TOKEN)، فمنمنعش الإقلاع
  // بسببه، بس بننبّه بوضوح في اللوجات عشان ميتفاجئش حد لو Google ضافت آلية
  // تحقق SSV للويب مستقبلاً واستخدمنا القيمة دي من غير ما نكون غيّرناها. ======
  // eslint-disable-next-line no-console
  console.warn(
    '[Ads] تحذير: GOOGLE_REWARDED_SERVER_TOKEN لسه على القيمة الافتراضية في الإنتاج (احتياطي، مش مستخدم حاليًا في أي تحقق فعلي).'
  );
}

// ====== Webhook verification (Security Hardening) ======
// /api/ads/webhook كان من غير أي تحقق خالص - أي حد يعرف الـ URL يقدر يبعت
// أي payload ويخليه يترتبط بأي sessionId (data pollution، ومحتمل استغلاله
// كناقل DoS بسيط). بنضيف سر مشترك (shared secret) بسيط بيتبعت في هيدر
// (X-Webhook-Secret) - أبسط آلية تحقق ممكنة لسيناريو "مفيش توقيع HMAC
// حقيقي من المزوّد نفسه" (نفس وضع Moyasar webhook حاليًا في المشروع ده).
// لو اتحط في .env، الـ endpoint بيرفض أي طلب من غير الهيدر ده أو بقيمة غلط.
// من غيره (وضع mock/تطوير)، الـ endpoint بيفضل شغال زي ما هو - بس بيتمنع
// في الإنتاج (راجع الفحص تحت).
const ADS_WEBHOOK_SECRET = process.env.ADS_WEBHOOK_SECRET || null;
if (process.env.NODE_ENV === 'production' && !ADS_WEBHOOK_SECRET) {
  throw new Error(
    'ADS_WEBHOOK_SECRET غير محدد في الإنتاج - /api/ads/webhook لازم يكون محمي بسر مشترك. ' +
      'حط قيمة عشوائية طويلة في متغيرات البيئة قبل التشغيل.'
  );
}

module.exports = {
  ADS_PROVIDER,
  ADS_ENABLED,
  ADS_DEBUG,
  ADS_TEST_MODE,
  GOOGLE_AD_MANAGER_NETWORK_CODE,
  GOOGLE_PUBLISHER_ID,
  GOOGLE_APP_ID,
  GOOGLE_BANNER_AD_UNIT,
  GOOGLE_INTERSTITIAL_AD_UNIT,
  GOOGLE_REWARDED_AD_UNIT,
  GOOGLE_REWARDED_SERVER_TOKEN,
  REWARD_SESSION_TTL_SECONDS,
  REWARD_SESSION_SECRET,
  ADS_WEBHOOK_SECRET,
};
