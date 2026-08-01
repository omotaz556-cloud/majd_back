/**
 * ====== Daily Reward Config (Castle Game) ======
 *
 * نفس فلسفة rewardKinds.config.js - القيم كلها من هنا (أو من env عن طريق
 * هنا)، مفيش أي رقم hardcoded جوه dailyReward.service.js. الهدف: تعديل
 * مكافأة يوم معين أو طول دورة الستريك بيتم هنا بس.
 *
 * الأساس اليومي بيتقرأ من نفس RESOURCE_REWARD_AMOUNTS الموجودة أصلاً في
 * rewardKinds.config.js (مفيش تكرار لمنطق الموارد) وبيتضاعف حسب يوم
 * الستريك الحالي (STREAK_DAY_MULTIPLIERS) - أقصى ستريك بيلف على نفسه
 * (يوم 8 = نفس مضاعف يوم 1... إلخ) بدل ما يفضل يكبر من غير حد.
 */
const { RESOURCE_REWARD_AMOUNTS } = require('../ads/rewardKinds.config');

// ====== مضاعف كل يوم في دورة الستريك (7 أيام) - يوم 1 = أساسي، وبيزيد
// تدريجيًا لحد يوم 7 (المكافأة الأكبر) كتحفيز على الاستمرار. ======
const STREAK_DAY_MULTIPLIERS = [1, 1.15, 1.3, 1.5, 1.75, 2, 3];

function multiplierForStreakDay(streakDay) {
  const idx = Math.max(0, (streakDay - 1) % STREAK_DAY_MULTIPLIERS.length);
  return STREAK_DAY_MULTIPLIERS[idx];
}

module.exports = {
  RESOURCE_REWARD_AMOUNTS,
  STREAK_DAY_MULTIPLIERS,
  multiplierForStreakDay,
};
