const mongoose = require('mongoose');

// عضو واحد ساعد في طلب مساعدة معيّن - بيتسجل زمن المساعدة عشان أي عرض
// مستقبلي لتاريخ المساهمات (contributors).
const helperSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    helped_at: { type: Date, default: Date.now },
  },
  { _id: false }
);

// طلب مساعدة تحالف واحد - عضو بيطلبه على عنصر شغال عنده (ترقية مبنى/دفعة
// علاج/إصلاح قطعة دفاعية)، وأعضاء تانيين في نفس التحالف يقدروا يضغطوا
// "مساعدة" عليه لحد ما يوصل لأقصى عدد مساعدات أو يخلص وقته. العنصر الحقيقي
// (upgrade.completes_at / heal_completes_at / repair.completes_at) بيتعدّل
// مباشرة في موديوله الأصلي - target_id هنا بس مرجع ليه، مش نسخة منه.
const allianceHelpRequestSchema = new mongoose.Schema(
  {
    alliance_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Alliance', required: true },
    requester_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    castle_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Castle', required: true },
    help_type: { type: String, enum: ['building', 'healing', 'repair'], required: true },
    // معرف الـ subdocument الحقيقي اللي بيتساعد فيه - Castle.buildings._id
    // (building) أو Hospital.queue._id (healing) أو CastleDefense.structures._id
    // (repair) على حسب help_type.
    target_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    status: { type: String, enum: ['open', 'completed', 'cancelled'], default: 'open' },
    max_helps: { type: Number, required: true },
    helpers: { type: [helperSchema], default: [] },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

// أهم نمط استعلام: طلبات المساعدة المفتوحة لتحالف معيّن، الأحدث الأول
allianceHelpRequestSchema.index({ alliance_id: 1, status: 1, created_at: -1 });

// مفيش أكتر من طلب مساعدة "مفتوح" واحد لنفس العنصر بالظبط في نفس الوقت -
// partial index عشان القيد ده يتطبّق بس على status='open' (نفس العنصر ممكن
// يبقى ليه أكتر من طلب completed/cancelled في التاريخ).
allianceHelpRequestSchema.index(
  { target_id: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'open' } }
);

module.exports = mongoose.model('AllianceHelpRequest', allianceHelpRequestSchema);
