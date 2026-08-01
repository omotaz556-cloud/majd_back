const mongoose = require('mongoose');

// سجل "إخفاء/حذف" رسالة معينة من عند مستخدم معين - منفصل عن InboxMessage
// نفسها لنفس السبب اللي خلانا نعمل InboxRead منفصل: الرسائل الجماعية
// (broadcast) مستند واحد بيتشارك بين كل اللاعبين، فلو مسحنا المستند نفسه
// هيختفي عند الكل مش بس عند اللي طلب الحذف. الحذف هنا "شخصي" (soft) - كل
// مستخدم بيقدر يخفي الرسالة من صندوقه هو بس، والمستند الأصلي فاضل زي ما هو.
const inboxDeletedSchema = new mongoose.Schema(
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
    deleted_at: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: false }
);

// مينفعش يتسجل نفس المستخدم حذف نفس الرسالة مرتين - بيسهّل استخدام upsert
// من غير ما نقلق من تكرار وقت الضغط على "حذف" أكتر من مرة (double click, retry).
inboxDeletedSchema.index({ user_id: 1, message_id: 1 }, { unique: true });

module.exports = mongoose.model('InboxDeleted', inboxDeletedSchema);