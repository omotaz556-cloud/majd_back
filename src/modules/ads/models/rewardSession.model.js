const mongoose = require('mongoose');
const { REWARD_KIND_VALUES } = require('../rewardKinds.config');

/**
 * ====== RewardSession ======
 * سجل لكل "جلسة إعلان مكافئ" - من لحظة ما اللاعب يضغط "شاهد إعلان" لحد ما
 * يتمنح المكافأة فعلياً. الهدف الأساسي: منع منح المكافأة مباشرة من الفرونت
 * إند (غير موثوق به أمنياً)، والحماية من:
 *   - Replay attacks (نفس sessionId يتبعت أكتر من مرة)
 *   - Duplicate rewards (idempotency عن طريق unique sessionId)
 *   - Expired sessions (expiresAt)
 *   - Double spending (completed flag + status transitions محكومة)
 *
 * ====== Reward Kind System (Castle Game) ======
 * الجلسة دلوقتي مش بس "مكافأة كوينز ثابتة" - بقت عامة لأي نوع مكافأة داخل
 * لعبة القلعة (Castle Game) عن طريق `kind` + `payload`:
 *   - resources        -> { resource: 'gold' | 'wood' | 'stone', amount }
 *   - double_reward    -> { battleId } (آخر معركة خلصت للاعب المفروض تتضاعف غنيمتها)
 *   - daily_double     -> {} (مفيش سياق مطلوب)
 * الـ payload بيتحط وقت /reward/start (من الفرونت إند، كسياق فقط - مفيش أي
 * قيمة مكافأة فعلية بتتحدد من الفرونت إند، القيم دايمًا من rewardKinds.config.js)
 * وبيتقرأ تاني وقت /reward/complete عشان completeRewardSession تعرف تنفذ
 * المكافأة الصح. راجع rewardSession.service.js لتفاصيل التنفيذ لكل نوع.
 *
 * تدفق الاستخدام:
 *   1) POST /api/ads/reward/start  -> بينشئ سجل بحالة "pending" + signedToken
 *   2) الفرونت إند يعرض الإعلان الفعلي عن طريق GPT rewarded slot
 *   3) POST /api/ads/reward/complete -> بيتحقق من signedToken + الحالة +
 *      انتهاء الصلاحية، وبس لو كل حاجة سليمة بيتم تنفيذ المكافأة حسب kind
 *      ووسم الجلسة completed
 */
const rewardSessionSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    provider: {
      type: String,
      required: true,
    },
    adUnit: {
      type: String,
      default: null,
    },
    // ====== Reward Kind System ======
    // نوع المكافأة - بيحدد إزاي completeRewardSession هينفذها فعليًا. راجع
    // rewardKinds.config.js للقيم المتاحة.
    kind: {
      type: String,
      enum: REWARD_KIND_VALUES,
      required: true,
    },
    // سياق/بيانات خاصة بنوع المكافأة ده بالذات (مثلاً { resource, amount }
    // لـ resources، أو { battleId } لـ double_reward).
    // Mixed عمدًا - شكلها مختلف تمامًا حسب kind، ومسؤولية rewardSession.service
    // وحده يفهم/يتحقق من شكلها الصحيح لكل نوع.
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    // ====== Legacy display field ======
    // القيمة الرقمية "المكافأة" - لسه موجودة للتوافق مع أي كود قديم/عرض بسيط
    // (مثلاً الفرونت إند القديم اللي كان بيعرض "+5 كوينز"). بتتحسب من
    // rewardKinds.config.js وقت /start حسب الـ kind (مثلاً إجمالي كمية
    // الموارد لـ resources)، مش رقم عشوائي منفصل. ممكن تكون null لأنواع
    // مالهاش قيمة رقمية مفيدة للعرض (زي daily_double/double_reward).
    reward: {
      type: Number,
      default: null,
    },
    // ====== 'processing' حالة انتقالية قصيرة العمر بس - بتتحط عن طريق
    // atomic findOneAndUpdate({status:'pending'}) في completeRewardSession
    // قبل تنفيذ المكافأة فعليًا، عشان أي طلب متزامن تاني على نفس الجلسة
    // يرفض فورًا (مافيش مستند طابق status:'pending' بعد كده). راجع
    // completeRewardSession لتفاصيل الحماية من الـ race condition. ======
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'rejected', 'expired'],
      default: 'pending',
    },
    completed: {
      type: Boolean,
      default: false,
    },
    // بصمة موقّعة (HMAC) بتتحقق منها /reward/complete - بتمنع أي حد يزوّر
    // sessionId أو يبعت complete من غير ما يعدي بـ /start الأول
    signedToken: {
      type: String,
      required: true,
    },
    // أي payload راجع من المزوّد (مثلاً بيانات تحقق GPT rewarded slot، أو
    // بيانات webhook مستقبلية من مزوّد تاني زي Unity Ads / CrazyGames)
    providerPayload: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    transactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WalletTransaction',
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  }
);

rewardSessionSchema.index({ userId: 1, createdAt: -1 });
// ====== TTL index (Security Hardening) ======
// بيمسح المستند تلقائيًا بعد 30 يوم من createdAt - سجلات جلسات المكافأة
// مالهاش قيمة تشغيلية/تدقيقية بعد فترة، وتراكمها بلا نهاية عبء تخزين وبحث
// غير ضروري. الأمان مش متأثر: كل التحقق الفعلي بيحصل وقت /complete نفسها
// (خلال TTL الجلسة القصير - REWARD_SESSION_TTL_SECONDS)، مش بعدها بأيام.
rewardSessionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });
rewardSessionSchema.index({ expiresAt: 1 });

module.exports = mongoose.model('RewardSession', rewardSessionSchema);
