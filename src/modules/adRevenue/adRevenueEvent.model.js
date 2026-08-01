const mongoose = require('mongoose');

/**
 * ====== AdRevenueEvent ======
 * مهم جداً - ده مختلف تماماً عن RewardSession/AdView (في ads module):
 * - RewardSession/AdView = المكافأة (كوين) اللي المنصة بتدّيها للاعب مقابل مشاهدة إعلان
 *   (ده مصروف/تكلفة على المنصة، مش دخل)
 * - AdRevenueEvent (هنا) = الفلوس الحقيقية اللي شبكة الإعلانات (Google Ad Manager) بتدفعها
 *   فعلاً للمنصة نفسها مقابل عرض الإعلان ده. ده الدخل الحقيقي.
 *
 * المصدر المتوقع لكل event:
 * - client_sdk: الفرونت إند (ويب) بيبعت القيمة دي وقت حدث الدفع من Google Ad
 *   Manager (GPT slotRenderEnded / impressionViewable مع بيانات القيمة لو
 *   متاحة) - تقدير لحظي لكل impression - "estimated" أو "precise" حسب دقة الشبكة
 * - network_report_import: استيراد مجمّع من تقرير Google Ad Manager
 *   Reporting API (يومي/أسبوعي) - أدق من client_sdk لأنه رقم نهائي من جوجل نفسها
 * - manual_admin_entry: الأدمن بيدخل الرقم يدوياً من Google Ad Manager
 *   Dashboard لحد ما التكامل الآلي يتظبط - عشان صاحب المشروع يقدر يشوف مكسبه
 *   الحقيقي من دلوقتي من غير أي شغل تقني
 */
const adRevenueEventSchema = new mongoose.Schema(
  {
    // اختياري - مش كل event لازم يبقى مربوط بمستخدم معين (مثلاً استيراد تقرير مجمّع)
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    source: {
      type: String,
      enum: ['client_sdk', 'network_report_import', 'manual_admin_entry'],
      required: true,
    },
    ad_network: {
      type: String, // 'google-ad-manager', 'unity_ads', 'gamedistribution', 'crazygames', 'poki', ...
      default: 'google-ad-manager',
    },
    ad_unit: {
      type: String,
      default: null,
    },
    ad_format: {
      type: String, // 'rewarded' | 'interstitial' | 'banner' ...
      default: null,
    },
    // دقة الرقم - بعض شبكات الإعلانات بترجع precision_type مع حدث الدفع
    // (estimated غالباً، precise لو فيه اتفاقية مباشرة مع المعلن)
    precision: {
      type: String,
      enum: ['estimated', 'precise', 'publisher_provided'],
      default: 'estimated',
    },
    revenue_amount: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },
    currency: {
      type: String,
      default: 'SAR',
    },
    platform: {
      type: String, // 'android' | 'ios' | 'web'
      default: null,
    },
    // لمنع تكرار نفس الـ impression لو التطبيق بعت نفس الحدث أكتر من مرة (retry شبكة مثلاً)
    client_transaction_id: {
      type: String,
      default: null,
    },
    // ملحوظات حرة - مفيدة خصوصاً في manual_admin_entry (مثلاً "تقرير Google Ad Manager يوم كذا")
    note: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },
    recorded_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null, // الأدمن اللي دخل القيمة يدوياً، لو source = manual_admin_entry
    },
    // التاريخ الفعلي اللي الإيراد ده بيخص - مهم لما يكون استيراد/إدخال يدوي لتقرير
    // يوم سابق (مش نفس يوم الإدخال)
    revenue_date: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: false },
  }
);

// بيمنع تكرار نفس event من client_sdk (لو client_transaction_id موجود) - sparse
// عشان الـ imports/manual entries اللي مفيهاش transaction id ميتأثروش
adRevenueEventSchema.index(
  { client_transaction_id: 1 },
  { unique: true, sparse: true }
);
adRevenueEventSchema.index({ revenue_date: 1 });
adRevenueEventSchema.index({ source: 1, revenue_date: 1 });

module.exports = mongoose.model('AdRevenueEvent', adRevenueEventSchema);
