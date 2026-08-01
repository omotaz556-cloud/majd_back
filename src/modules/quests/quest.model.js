const mongoose = require('mongoose');

// مهمة واحدة جوّه القائمة اليومية بتاعة اللاعب - snapshot كامل وقت التوليد
// (target/reward محسوبين ومخزّنين، مش بيتحسبوا live من الـ config) عشان لو
// اللاعب رقّى مستواه في نفس اليوم، مهامه المتولدة أصلاً متتغيرش من تحته.
const dailyQuestSchema = new mongoose.Schema(
  {
    quest_key: { type: String, required: true }, // يطابق مفتاح في quest.config QUEST_TYPES
    tier: { type: Number, required: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    icon: { type: String, default: 'target' },
    target: { type: Number, required: true },
    progress: { type: Number, default: 0 },
    reward: {
      gold: { type: Number, default: 0 },
      wood: { type: Number, default: 0 },
      stone: { type: Number, default: 0 },
      coins: { type: Number, default: 0 },
    },
    status: {
      type: String,
      enum: ['in_progress', 'completed', 'claimed'],
      default: 'in_progress',
    },
    completed_at: { type: Date, default: null },
    claimed_at: { type: Date, default: null },
  },
  { _id: true }
);

// مستند واحد لكل لاعب - بيحمل القائمة اليومية الحالية بتاعته + تاريخ آخر
// تجديد (عشان نعرف نحدد إمتى نولّد يوم جديد) + آخر مستوى (tier) اتولدت بيه
// المهام (عشان نعرف نولّد مبكر لو اللاعب رقّى مبناه الرئيسي لنطاق أعلى قبل
// ما اليوم يخلص - راجع quest.service.maybeRefreshQuests).
const playerQuestStateSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    quests: [dailyQuestSchema],
    generated_tier: { type: Number, default: 0 },
    generated_at: { type: Date, default: Date.now },
    // تاريخ بداية اليوم الحالي (منتصف الليل UTC) - المهام بتتجدد تلقائي أول
    // ما السيرفر يلاحظ إن اليوم اتغيّر عن القيمة دي (راجع quest.service).
    day_key: { type: String, required: true },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

module.exports = mongoose.model('PlayerQuestState', playerQuestStateSchema);
