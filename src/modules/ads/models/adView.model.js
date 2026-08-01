const mongoose = require('mongoose');

/**
 * ====== AdView ======
 * سجل لكل تفاعل مع إعلان (بانر / إنترستيشيال / مكافئ)، بغض النظر عن نوع
 * المزوّد. الغرض: تتبّع تشغيلي (كام إعلان اتعرض، كام واحد فشل، إلخ) - ده
 * مختلف عن RewardSession اللي هو خاص فقط بمنح المكافآت وتأمينها.
 */
const adViewSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null, // ممكن يكون فيه إعلانات (بانر) لزائر مش مسجل دخول
    },
    provider: {
      type: String, // 'google-ad-manager' | 'mock' | ...
      required: true,
    },
    adType: {
      type: String,
      enum: ['banner', 'interstitial', 'rewarded'],
      required: true,
    },
    adUnit: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ['requested', 'loaded', 'shown', 'closed', 'failed', 'skipped'],
      default: 'requested',
    },
    rewardGranted: {
      type: Boolean,
      default: false,
    },
    rewardAmount: {
      type: Number,
      default: 0,
    },
    transactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WalletTransaction',
      default: null,
    },
    sessionId: {
      type: String, // بيربط بـ RewardSession.sessionId لو النوع rewarded
      default: null,
    },
    errorMessage: {
      type: String,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  }
);

adViewSchema.index({ userId: 1, createdAt: -1 });
adViewSchema.index({ sessionId: 1 });
adViewSchema.index({ adType: 1, status: 1 });

module.exports = mongoose.model('AdView', adViewSchema);
