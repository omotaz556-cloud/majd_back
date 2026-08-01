const mongoose = require('mongoose');

const walletTransactionSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    wallet_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Wallet',
      required: true,
    },
    type: {
      type: String,
      enum: ['deposit', 'reward', 'spend', 'reversal', 'admin_credit', 'admin_debit'],
      required: true,
    },
    // مين سبب العملية - بيفرق بين حركة عادية جاية من اللاعب/النظام وحركة إدارية.
    // ده منفصل عن "type" اللي بيوصف طبيعة العملية محاسبياً؛ "source" بيوصف مين نفّذها.
    source: {
      type: String,
      enum: ['user', 'admin', 'system', 'payment_gateway'],
      default: 'user',
    },
    // لو العملية دي من لوحة الأدمن، ده الأدمن اللي نفّذها - إجباري لو source = admin
    initiated_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    // سبب العملية - إجباري لأي عملية إدارية (بيتفرض في wallet.service.js)
    reason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },
    // تصنيف اختياري لعرض/تقارير أوضح في لوحة التحكم - شامل تصنيفات عمليات
    // الأدمن الإدارية (topup/deduction/bonus/correction/penalty) وتصنيفات
    // عمليات اللعب اللي بتخصم/تضيف رصيد تلقائيًا (premium_troop_training،
    // building_speedup، training_speedup، quest_reward). أي قيمة جديدة تتضاف
    // من أي موديول تاني لازم تتسجل هنا الأول، وإلا الـ transaction هترفض
    // بالكامل (validation error) قبل ما تتسجل - زي ما حصل مع تسريع البناء.
    category: {
      type: String,
      enum: [
        'topup',
        'deduction',
        'bonus',
        'correction',
        'penalty',
        'premium_troop_training',
        'building_speedup',
        'training_speedup',
        'quest_reward',
        null,
      ],
      default: null,
    },
    // إعدادات الضريبة قابلة للضبط لكل عملية حسب المعالجة المحاسبية المعتمدة وقت التنفيذ
    tax_mode: {
      type: String,
      enum: ['inclusive', 'exclusive', 'not_applicable'],
      default: 'not_applicable',
    },
    vat_rate: {
      type: Number, // نسبة مئوية، مثلاً 15
      default: 0,
    },
    gross_amount: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },
    vat_amount: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
      default: () => mongoose.Types.Decimal128.fromString('0.00'),
    },
    net_amount: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },
    // ====== مقدار الكوين الفعلي اللي اتغير في رصيد المحفظة ======
    // منفصل عمداً عن gross/vat/net (اللي بتوصف الريال الحقيقي لأغراض
    // الضريبة/الإيراد/الزكاة). في معظم الأنواع (reward/spend/admin_credit/
    // admin_debit) coin_amount == gross_amount لأنه مفيش سعر منفصل عن
    // الكوين. لكن في deposit المرتبط بباقة (CoinPackage)، اللاعب ممكن يدفع
    // 10 ريال ويستحق 150 كوين (بونص) - net_amount بيفضل يعكس الـ 10 ريال
    // الحقيقيين (للإيراد)، وcoin_amount هو اللي بيتحط فعلاً في wallet.balance.
    coin_amount: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },
    currency: {
      type: String,
      required: true,
      default: 'SAR',
    },
    payment_ref: {
      type: String, // مرجع بوابة الدفع (Moyasar) - null للعمليات الداخلية زي المكافآت
      default: null,
    },
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'reversed'],
      default: 'pending',
    },
    // مرجع اختياري لو العملية دي Reversal لعملية سابقة - بيحافظ على الـ Audit Trail
    reversal_of: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WalletTransaction',
      default: null,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: false }, // مفيش updated_at أصلاً - السجل ثابت
  }
);

walletTransactionSchema.index({ initiated_by: 1, created_at: -1 });

// ====== فرض مبدأ Append-only على مستوى الـ Schema نفسه ======
// أي محاولة update أو delete على السجلات دي هترفض من هنا، مش بس من الـ Service layer
function forbid(action) {
  return function (next) {
    next(new Error(`WalletTransaction records are append-only. Operation "${action}" is not allowed.`));
  };
}

walletTransactionSchema.pre('updateOne', forbid('updateOne'));
walletTransactionSchema.pre('findOneAndUpdate', forbid('findOneAndUpdate'));
walletTransactionSchema.pre('updateMany', forbid('updateMany'));
walletTransactionSchema.pre('deleteOne', forbid('deleteOne'));
walletTransactionSchema.pre('findOneAndDelete', forbid('findOneAndDelete'));
walletTransactionSchema.pre('deleteMany', forbid('deleteMany'));

module.exports = mongoose.model('WalletTransaction', walletTransactionSchema);