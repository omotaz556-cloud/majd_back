const mongoose = require('mongoose');

// ====== حالة المكافأة اليومية بتاعة اللاعب ======
// مستند واحد لكل لاعب (unique على user_id) - بيحمل تاريخ آخر استلام (كـ
// "مفتاح يوم" UTC بصيغة YYYY-MM-DD، بنفس فلسفة day_key في quest.model.js)
// والستريك الحالي. الاستلام الفعلي ومنطق الأهلية/تصفير الستريك كله في
// dailyReward.service.js - الموديل هنا بيانات خام بس.
const dailyRewardStateSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    // آخر يوم (UTC، YYYY-MM-DD) استلم فيه اللاعب المكافأة اليومية بنجاح -
    // null يعني لسه ما استلمش أي مكافأة يومية خالص. لسه محتفظين بيه لحساب
    // الستريك (يوم متتالي/فجوة) بس مش بيتحكم في الأهلية بمفرده - راجع
    // last_claim_at تحت (ده مصدر الحقيقة الوحيد للـ 24h cooldown نفسه).
    last_claim_date: { type: String, default: null },
    // ====== طابع زمني (server time) لآخر استلام فعلي - ده اللي بيحدد
    // الأهلية الحقيقية (كل 24 ساعة بالظبط من آخر استلام، مش "يوم تقويمي
    // UTC") بدل ما نعتمد على last_claim_date بمفرده. null يعني لسه ما
    // استلمش أي مكافأة يومية خالص. ======
    last_claim_at: { type: Date, default: null },
    // عدد الأيام المتتالية اللي استلم فيها اللاعب المكافأة من غير ما يفوّت
    // يوم - بيتصفّر لـ 1 لو فوّت يوم (أو أكتر) واستلم تاني.
    current_streak: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

module.exports = mongoose.model('DailyRewardState', dailyRewardStateSchema);
