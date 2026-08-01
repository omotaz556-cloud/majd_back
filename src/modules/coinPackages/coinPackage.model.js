const mongoose = require('mongoose');

/**
 * ====== CoinPackage ======
 * باقة شحن جاهزة (مثلاً "500 Coin + 50 هدية مقابل 20 ريال").
 * ده كتالوج الأسعار اللي الأدمن بيديره - منفصل عن منطق الدفع الفعلي (Moyasar)
 * عشان يقدر يعدل الأسعار والعروض من غير ما يلمس كود الدفع.
 *
 * total coins اللي المفروض يتزود في محفظة اللاعب = coins_amount + bonus_coins
 */
const coinPackageSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    coins_amount: {
      type: Number, // عدد الـ Coins الأساسي في الباقة
      required: true,
      min: 1,
    },
    bonus_coins: {
      type: Number, // Coins إضافية هدية (عروض)، 0 يعني مفيش عرض
      default: 0,
      min: 0,
    },
    price: {
      type: Number, // السعر الحقيقي اللي اللاعب هيدفعه
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: 'SAR',
    },
    badge: {
      type: String, // تسمية تسويقية زي "الأكثر قيمة" أو "عرض محدود" - اختياري
      default: null,
    },
    is_active: {
      type: Boolean,
      default: true,
    },
    sort_order: {
      type: Number, // ترتيب العرض في صفحة الشحن، الأصغر بيظهر الأول
      default: 0,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

coinPackageSchema.index({ is_active: 1, sort_order: 1 });

module.exports = mongoose.model('CoinPackage', coinPackageSchema);
