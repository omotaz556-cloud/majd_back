/**
 * ====== إعدادات مزوّدي الدفع والإعلانات والحسابات ======
 *
 * ده المكان الوحيد اللي بيقرأ منه الكود قيمة PAYMENT_PROVIDER و ADS_PROVIDER
 * و ACCOUNT_PROVIDER. الهدف: عشان لما بيانات العميل الحقيقية توصل، كل اللي
 * محتاجينه هو:
 *   1) تغيير PAYMENT_PROVIDER من "mock" لـ "moyasar"
 *   2) تغيير ADS_PROVIDER من "mock" لـ "google-ad-manager"
 *   3) تغيير ACCOUNT_PROVIDER من "local" لـ "majd_platform" (لما تفاصيل
 *      التكامل مع حساب منصة مجد تتحدد فعلياً)
 *   4) حط مفاتيح/معرّفات الـ API في .env
 * من غير أي تعديل على كود التطبيق (Backend ولا Frontend) خالص.
 *
 * الفرونت إند بيعرف المزوّد الفعّال عن طريق GET /api/config العام (مش محتاج
 * .env منفصل بتاعه)، فالقيمة دي بتتحط مرة واحدة هنا وبس.
 *
 * ملحوظة مهمة عن الإعلانات: المنصة دي ويب بالكامل (React + HTML5 Games) -
 * مفيش تطبيق موبايل ولا AdMob SDK هنا خالص. مزوّد الإعلانات الافتراضي
 * للإنتاج هو Google Ad Manager للويب (GPT - Google Publisher Tag)، ومهيّأ
 * عشان يدعم مزوّدين تانيين مستقبلاً (Unity Ads / GameDistribution /
 * CrazyGames / Poki) بمجرد إضافة Provider class جديدة - من غير أي تعديل
 * على منطق الأعمال في AdsManager.
 */

const PAYMENT_PROVIDERS = ['mock', 'moyasar'];
const ADS_PROVIDERS = ['mock', 'google-ad-manager'];
// 'local': تسجيل دخول/إنشاء حساب محلي بإيميل وباسورد (الوضع الحالي).
// 'majd_platform': اللاعب بيدخل بحسابه الموجود بالفعل في منصة مجد - التفاصيل
// النهائية (شكل الطلب، توكن المنصة، ...إلخ) لسه مش متحددة، والتنفيذ الفعلي
// هيتحط في auth/providers/majdPlatform.provider.js كـ نقطة تجميع واحدة.
const ACCOUNT_PROVIDERS = ['local', 'majd_platform'];

const PAYMENT_PROVIDER = (process.env.PAYMENT_PROVIDER || 'mock').trim().toLowerCase();
const ADS_PROVIDER = (process.env.ADS_PROVIDER || 'mock').trim().toLowerCase();
const ACCOUNT_PROVIDER = (process.env.ACCOUNT_PROVIDER || 'local').trim().toLowerCase();

if (!PAYMENT_PROVIDERS.includes(PAYMENT_PROVIDER)) {
  throw new Error(
    `PAYMENT_PROVIDER="${PAYMENT_PROVIDER}" غير معروف. القيم المسموحة: ${PAYMENT_PROVIDERS.join(', ')}`
  );
}

if (!ADS_PROVIDERS.includes(ADS_PROVIDER)) {
  throw new Error(
    `ADS_PROVIDER="${ADS_PROVIDER}" غير معروف. القيم المسموحة: ${ADS_PROVIDERS.join(', ')}`
  );
}

if (!ACCOUNT_PROVIDERS.includes(ACCOUNT_PROVIDER)) {
  throw new Error(
    `ACCOUNT_PROVIDER="${ACCOUNT_PROVIDER}" غير معروف. القيم المسموحة: ${ACCOUNT_PROVIDERS.join(', ')}`
  );
}

module.exports = {
  PAYMENT_PROVIDER,
  ADS_PROVIDER,
  ACCOUNT_PROVIDER,
  isPaymentProvider: (name) => PAYMENT_PROVIDER === name,
  isAdsProvider: (name) => ADS_PROVIDER === name,
  isAccountProvider: (name) => ACCOUNT_PROVIDER === name,
};
