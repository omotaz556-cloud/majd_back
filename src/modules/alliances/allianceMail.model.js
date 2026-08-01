const mongoose = require('mongoose');

// رسالة تحالف واحدة - بيبعتها القائد أو الضابط لكل أعضاء التحالف دفعة واحدة.
// نفس فلسفة InboxMessage/InboxRead: مستند واحد مشترك بين كل الأعضاء بدل ما
// نكرر نفس الرسالة لكل عضو وقت الإرسال (fan-out على الكتابة) - حالة
// "مقروءة/غير مقروءة" بتتسجل لكل عضو لوحده في AllianceMailRead.
const allianceMailSchema = new mongoose.Schema(
  {
    alliance_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Alliance', required: true },
    // مين اللي بعت الرسالة - قائد أو ضابط وقت الإرسال (بيتفحص في service،
    // مش هنا على مستوى الموديل).
    sender_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    body: { type: String, required: true, trim: true, maxlength: 2000 },
  },
  {
    // sent_at بدل created_at عشان يتوافق مع مسمى المتطلبات (Sent Time)
    timestamps: { createdAt: 'sent_at', updatedAt: false },
  }
);

// أهم نمط استعلام: رسائل تحالف معيّن مرتبة بالأحدث
allianceMailSchema.index({ alliance_id: 1, sent_at: -1 });

module.exports = mongoose.model('AllianceMail', allianceMailSchema);
