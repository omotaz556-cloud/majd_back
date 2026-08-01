const mongoose = require('mongoose');

// سجل قراءة رسالة تحالف معينة من عضو معين - منفصل عن AllianceMail نفسها
// عشان الرسالة مستند واحد بيتشارك بين كل الأعضاء، فحالة "مقروءة" لازم
// تتسجل لكل عضو لوحده مش على الرسالة نفسها (نفس نمط InboxRead بالظبط).
const allianceMailReadSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    mail_id: { type: mongoose.Schema.Types.ObjectId, ref: 'AllianceMail', required: true },
    read_at: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

// مينفعش يتسجل نفس العضو قرا نفس الرسالة مرتين - بيسهّل استخدام upsert
// (updateOne + $setOnInsert) من غير ما نقلق من تكرار وقت "تعليم كمقروء".
allianceMailReadSchema.index({ user_id: 1, mail_id: 1 }, { unique: true });

module.exports = mongoose.model('AllianceMailRead', allianceMailReadSchema);
