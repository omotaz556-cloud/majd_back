const mongoose = require('mongoose');

// رسالة شات واحدة - إما عامة (channel='global', كل اللاعبين تشوفها) أو خاصة
// (channel='private', بين مرسِل ومستقبِل محددين بس). بنخزن اسم المرسِل وقت
// الإرسال (sender_name) عشان العرض في الفرونت إند ميحتاجش populate إضافي في
// كل مرة اللاعب يفتح الشات - نفس فلسفة metadata في InboxMessage.
const chatMessageSchema = new mongoose.Schema(
  {
    channel: {
      type: String,
      enum: ['global', 'private'],
      required: true,
    },
    sender_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    sender_name: {
      type: String,
      required: true,
      trim: true,
    },
    // موجود بس لرسائل channel='private' - مين المستقبِل. من غير default عمداً
    // (زي platform_account_id في user.model.js) عشان الرسائل العامة تفضل من
    // غير الحقل ده خالص بدل ما يتخزن null لكل رسالة عامة.
    recipient_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: function () {
        return this.channel === 'private';
      },
    },
    body: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: false },
  }
);

// أهم نمط استعلام للشات العام: آخر رسائل الشات العام مرتبة بالأحدث
chatMessageSchema.index({ channel: 1, created_at: -1 });

// أهم نمط استعلام للشات الخاص: محادثة بين شخصين (بأي اتجاه) مرتبة بالأحدث.
// بنستخدم sender_id + recipient_id مع بعض في نفس الفهرس، والاستعلام نفسه في
// chat.service.js بيدور بالاتجاهين ($or).
chatMessageSchema.index({ channel: 1, sender_id: 1, recipient_id: 1, created_at: -1 });
chatMessageSchema.index({ channel: 1, recipient_id: 1, sender_id: 1, created_at: -1 });

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
