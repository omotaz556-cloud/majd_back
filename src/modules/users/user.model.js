const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 100,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Invalid email format'],
    },
    password_hash: {
      type: String,
      // مطلوب بس لحسابات auth_provider='local' - حساب منصة (majd_platform)
      // مفيش عنده باسورد محلي خالص، بيانات الدخول كلها عند المنصة نفسها
      required: function () {
        return this.auth_provider === 'local';
      },
      select: false, // لا يترجع في queries عادية إلا لو اتطلب صراحة
    },
    // ====== تكامل حساب المنصة (Platform Account Integration) ======
    // auth_provider: مين المسؤول عن هوية الحساب ده. 'local' = حساب محلي
    // بإيميل/باسورد (زي ما كان الوضع دايماً). 'majd_platform' = حساب أصله
    // من منصة مجد نفسها (لسه مش متصل فعلياً - راجع
    // modules/auth/providers/majdPlatform.provider.js).
    auth_provider: {
      type: String,
      enum: ['local', 'majd_platform'],
      default: 'local',
    },
    // مُعرّف اللاعب عند المزوّد الخارجي (لو auth_provider != 'local'). بيتحط
    // مرة واحدة وقت أول دخول، وبيُستخدم بعد كده للربط بنفس الحساب المحلي في
    // كل مرة اللاعب يدخل تاني - من غير أي تسجيل جديد.
    // ملحوظة مهمة: من غير default هنا عمداً - لو اتحطّت default: null، Mongo
    // هيعتبرها "قيمة موجودة" حتى لو null وهيكسر الـ sparse unique index أول
    // ما يبقى فيه أكتر من حساب local (كلهم null). من غير default، الحقل
    // بيفضل غير موجود خالص للحسابات اللي مش من مزوّد خارجي، والـ sparse index
    // بيتجاهله زي ما المفروض.
    platform_account_id: {
      type: String,
      index: true,
      sparse: true,
      unique: true,
    },
    // ====== مُعرّف لاعب دائم وفريد (Player ID) - رقم ثابت طول عمر الحساب،
    // بيتحدد مرة واحدة بس وقت إنشاء الحساب (auth.service.js
    // findOrCreateFromProfile) عن طريق counter.service (عداد تسلسلي atomic).
    // مستخدم أساسًا في نظام "بحث العالم" (World Search) عشان اللاعبين يقدروا
    // يتدوّروا عليهم برقم ثابت بدل الاعتماد على الاسم بس (اللي ممكن يتكرر أو
    // يتغيّر لاحقًا لو فتحنا تغيير الاسم يومًا ما). sparse عشان أي حساب قديم
    // اتعمل قبل الحقل ده ميكسرش الـ unique index (null مايتعتبرش قيمة مكررة).
    player_id: {
      type: Number,
      unique: true,
      sparse: true,
      index: true,
    },
    role: {
      type: String,
      enum: ['player', 'admin'],
      default: 'player',
    },
    is_active: {
      type: Boolean,
      default: true,
    },
    // ملاحظات إدارية داخلية بحتة - مفيش أي منطق لعب أو صلاحية بيعتمد عليها.
    // select: false زي password_hash بالظبط: منعزلة افتراضياً من أي query عادي
    // (بما فيها استجابات login/register اللي بترجع الـ user كامل للاعب نفسه)،
    // ولازم .select('+admin_notes') صريح من داخل admin module بس عشان تتقرأ.
    admin_notes: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: null,
      select: false,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

// نمنع إرجاع password_hash حتى لو حد عمل toJSON بالغلط
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password_hash;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
