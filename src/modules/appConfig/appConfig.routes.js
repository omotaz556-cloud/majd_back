const express = require('express');
const { PAYMENT_PROVIDER, ADS_PROVIDER, ACCOUNT_PROVIDER } = require('../../config/providers');

/**
 * ====== Endpoint عام لمعرفة المزوّدين الفعّالين ======
 * عام (من غير توكن) وما بيرجعش أي مفاتيح سرية - بس أسماء المزودين.
 * الفرونت إند بينادي عليه مرة واحدة عشان يعرف يعرض شاشة الدفع/الإعلان/تسجيل
 * الدخول المناسبة (mock/حقيقي، local/majd_platform) من غير ما يحتاج .env
 * منفصل بيكرر نفس القيمة. لما account_provider يبقى majd_platform، الفرونت
 * إند هو اللي هيقرر يخفي فورم التسجيل المحلي ويحول لتدفق حساب المنصة -
 * مفيش أي تغيير محتاج يحصل في الباك إند وقتها.
 */
const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    payment_provider: PAYMENT_PROVIDER,
    ads_provider: ADS_PROVIDER,
    account_provider: ACCOUNT_PROVIDER,
  });
});

module.exports = router;
