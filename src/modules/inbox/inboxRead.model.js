const mongoose = require('mongoose');

// سجل قراءة رسالة معينة من مستخدم معين - منفصل عن InboxMessage نفسها عشان
// الرسائل الجماعية (broadcast) مستند واحد بيتشارك بين كل اللاعبين، فحالة
// "مقروءة" لازم تتخزن لكل مستخدم لوحده مش على الرسالة نفسها.
const inboxReadSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    message_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InboxMessage',
      required: true,
    },
    read_at: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: false }
);

// مينفعش يتسجل نفس المستخدم قرا نفس الرسالة مرتين - بيسهّل استخدام upsert
// (updateOne + $setOnInsert) من غير ما نقلق من تكرار وقت الضغط على "تعليم كمقروء"
// أكتر من مرة.
inboxReadSchema.index({ user_id: 1, message_id: 1 }, { unique: true });

module.exports = mongoose.model('InboxRead', inboxReadSchema);
