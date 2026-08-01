const mongoose = require('mongoose');

/**
 * ====== توكن استعادة كلمة المرور (Password Reset Token) ======
 * بيتخزن هنا الـ hash بتاع التوكن بس (SHA-256) - أبدًا مش التوكن الخام نفسه.
 * ده نفس المنطق المستخدم لأي "session token" حساس: حتى لو حصل تسريب لقاعدة
 * البيانات، محدّش يقدر يستخدم الـ hash عشان يعمل reset لحساب حد. التوكن
 * الخام بيتبعت في الإيميل بس، وبيتقارن وقت الاستخدام بعد ما يتعمل hash تاني
 * لنفس القيمة (راجع passwordReset.service.js).
 *
 * TTL index على expires_at: MongoDB بيشيل المستندات المنتهية تلقائيًا في
 * الخلفية - مفيش حاجة لأي job/cron يدوي عشان ننضف الجدول ده.
 */
const passwordResetTokenSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    token_hash: {
      type: String,
      required: true,
      unique: true,
    },
    expires_at: {
      type: Date,
      required: true,
      // TTL index: المستند بيتشال تلقائيًا من MongoDB بعد ما تعدي القيمة دي
      index: { expires: 0 },
    },
    used_at: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: false },
  }
);

module.exports = mongoose.model('PasswordResetToken', passwordResetTokenSchema);
