const mongoose = require('mongoose');

// ====== Phase 6: Battle Consequences - Lifetime Statistics ======
// إحصائيات تراكمية (lifetime) لكل لاعب - منفصلة تمامًا عن battle.model.js
// (اللي بيحمل إحصائيات *معركة واحدة* بس في statistics/battle_result).
// مستند واحد بالظبط لكل يوزر (lazy-created أول مرة يشارك في معركة تتحسم)،
// بيتراكم عليه كل معركة تخلص (finished) - سواء اليوزر كان مهاجم أو مدافع
// فيها. مفيش أي تعديل على Battle.model.js أو User.model.js عشان نضيف الحقل
// ده - موديول مستقل بالكامل، نفس فلسفة CastleDefense (مستند منفصل لكل
// castle_id) بس هنا مستند منفصل لكل user_id.
const battleStatsSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },

    total_battles: { type: Number, default: 0 },
    victories: { type: Number, default: 0 },
    defeats: { type: Number, default: 0 },
    draws: { type: Number, default: 0 },

    // إجمالي الجنود اللي اليوزر ده خسرهم (كمهاجم أو كمدافع) عبر كل معاركه
    troops_lost: { type: Number, default: 0 },
    // إجمالي الجنود اللي اليوزر ده "قتلهم" فعليًا - يعني خسائر الطرف التاني
    // في أي معركة اليوزر ده كان طرف فيها (مهاجم يقتل جنود الدافع، والعكس)
    troops_killed: { type: Number, default: 0 },

    resources_looted: {
      gold: { type: Number, default: 0 },
      wood: { type: Number, default: 0 },
      stone: { type: Number, default: 0 },
    },
    resources_lost: {
      gold: { type: Number, default: 0 },
      wood: { type: Number, default: 0 },
      stone: { type: Number, default: 0 },
    },

    // آخر معركة اتحسبت في الإحصائيات دي - مفيدة لتفادي عدّ نفس المعركة مرتين
    // لو applyBattleConsequences اتنادت أكتر من مرة لنفس الـ battle_id
    // (idempotency guard - راجع battleConsequences.service.js).
    last_battle_id: { type: String, default: null },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

module.exports = mongoose.model('BattleStats', battleStatsSchema);
