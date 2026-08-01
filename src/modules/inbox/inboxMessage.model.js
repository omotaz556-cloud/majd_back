const mongoose = require('mongoose');

// رسالة واحدة في صندوق الوارد - إما رسالة شخصية للاعب معين (user_id محدد، زي
// "خلصت ترقية مبنى" أو "كسبت جايزة تحدي")، أو رسالة جماعية (broadcast) لكل
// اللاعبين (user_id = null) بيبعتها الأدمن كإعلان عام.
//
// ملحوظة مهمة: حالة "مقروءة/غير مقروءة" مش متخزنة على المستند ده. الرسالة
// الجماعية مستند واحد بيتشارك بين كل اللاعبين، فمينفعش نحط عليه is_read بسيط
// لأنه هيبقى نفس القيمة لكل الناس. حالة القراءة بتتسجل لكل مستخدم لوحده في
// InboxRead بدل ما نكرر الرسالة نفسها لكل لاعب وقت البث (fan-out على الكتابة).
const inboxMessageSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null, // null = رسالة جماعية لكل اللاعبين
    },
    category: {
      type: String,
      enum: ['system', 'admin', 'player'],
      required: true,
    },
    // نوع الحدث اللي ولّد الرسالة - مفيد للفلترة والعرض بأيقونة مناسبة في الفرونت
    // إند (مثال: 'building_upgrade_complete', 'challenge_reward',
    // 'challenge_refund', 'admin_broadcast')
    type: {
      type: String,
      required: true,
      trim: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    body: {
      type: String,
      default: '',
      trim: true,
      maxlength: 2000,
    },
    // بيانات إضافية خاصة بنوع الرسالة (building_key, challenge_id, reward_amount...)
    // - مش مقصود يتعرض كنص للاعب، بس ممكن الفرونت إند يستخدمها لعمل رابط/أيقونة
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    // موجود بس للرسائل اللي بعتها أدمن (broadcast) - مين اللي بعتها
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    // موجود بس لرسائل category='player' (رسالة خاصة من لاعب لتاني وقت زيارة
    // مملكته) - مين اللاعب اللي بعتها. اسم المرسِل بيتخزن كمان في metadata
    // وقت الإنشاء عشان العرض ميحتاجش populate إضافي.
    sender_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

// أهم نمط استعلام: رسائل مستخدم معين (أو الرسائل الجماعية) مرتبة بالأحدث
inboxMessageSchema.index({ user_id: 1, created_at: -1 });

module.exports = mongoose.model('InboxMessage', inboxMessageSchema);
