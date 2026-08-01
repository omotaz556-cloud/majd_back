const mongoose = require('mongoose');

// طلب واحد معلّق بين لاعب وتحالف - نوعين:
// 'invite'  = التحالف (ضابط/قائد) دعا اللاعب ينضم - اللاعب هو اللي بيوافق/يرفض.
// 'request' = اللاعب طلب ينضم بنفسه - قائد/ضابط التحالف هو اللي بيوافق/يرفض.
// بنستخدم نفس المستند للاتجاهين عشان الشكل مطابق تمامًا (تحالف + لاعب +
// وقت) والفرق الوحيد هو "مين قدر يوافق" - ده بيتحدد في alliance.service.
const allianceInviteSchema = new mongoose.Schema(
  {
    alliance_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Alliance', required: true, index: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['invite', 'request'], required: true },
    // مين بعت الدعوة (لو type='invite') - عشان العرض بس، مفيش منطق بيعتمد عليه.
    invited_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

// لاعب واحد مينفعش يكون عنده أكتر من طلب معلّق (أي نوع) لنفس التحالف في نفس الوقت
allianceInviteSchema.index({ alliance_id: 1, user_id: 1, type: 1 }, { unique: true });

module.exports = mongoose.model('AllianceInvite', allianceInviteSchema);
