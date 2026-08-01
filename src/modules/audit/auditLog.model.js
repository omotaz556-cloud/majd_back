const mongoose = require('mongoose');

// سجل تدقيق لكل إجراء إداري بيتنفذ على لاعب (شحن رصيد، خصم، بونص، تعديل بيانات...).
// منفصل عن WalletTransaction عشان يغطي أي إجراء إداري مش بس اللي بيمس المحفظة
// (زي تغيير حالة الحساب أو الدور)، لكن العمليات المالية بتتسجل في الاتنين مربوطين
// ببعض عن طريق wallet_transaction_id للتتبع الكامل.
const adminAuditLogSchema = new mongoose.Schema(
  {
    admin_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    action: {
      type: String,
      enum: [
        'wallet.credit', // إضافة كوينز
        'wallet.debit', // خصم كوينز
        'wallet.bonus', // منح بونص/مكافأة
        'wallet.transaction_reversed', // استرداد معاملة
        'user.status_change', // تفعيل/تعطيل حساب
        'user.role_change', // تغيير دور
        'user.profile_update', // تعديل بيانات محدودة (اسم، ملاحظات داخلية...)
      ],
      required: true,
    },
    target_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // مرجع اختياري لمعاملة المحفظة المرتبطة بالإجراء ده (لو فيه)
    wallet_transaction_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WalletTransaction',
      default: null,
    },
    // سبب العملية - إجباري لأي إجراء بيمس رصيد اللاعب (بيتفرض من الـ service layer)
    reason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },
    // أي تفاصيل إضافية (before/after، المبلغ، إلخ) - عرض/تدقيق بس، مفيش منطق بيعتمد عليها
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: false },
  }
);

adminAuditLogSchema.index({ target_user_id: 1, created_at: -1 });
adminAuditLogSchema.index({ admin_id: 1, created_at: -1 });

// ====== Append-only على مستوى الـ Schema - سجل تدقيق منفعش يتعدل أو يتمسح أبداً ======
function forbid(action) {
  return function (next) {
    next(new Error(`AdminAuditLog records are append-only. Operation "${action}" is not allowed.`));
  };
}

adminAuditLogSchema.pre('updateOne', forbid('updateOne'));
adminAuditLogSchema.pre('findOneAndUpdate', forbid('findOneAndUpdate'));
adminAuditLogSchema.pre('updateMany', forbid('updateMany'));
adminAuditLogSchema.pre('deleteOne', forbid('deleteOne'));
adminAuditLogSchema.pre('findOneAndDelete', forbid('findOneAndDelete'));
adminAuditLogSchema.pre('deleteMany', forbid('deleteMany'));

module.exports = mongoose.model('AdminAuditLog', adminAuditLogSchema);
