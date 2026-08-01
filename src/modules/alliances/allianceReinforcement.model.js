const mongoose = require('mongoose');

// ====== كومة وحدات - نفس شكل marchTroopStackSchema في castle/march.model
// بالظبط (key/count)، منسوخة هنا عشان allianceReinforcement مستند مستقل. ======
const troopStackSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    count: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

// ====== "تعزيز" واحد = دفعة جنود بعتها عضو (origin) لتحصين قلعة عضو تاني
// في نفس التحالف (target)، وهي "واقفة" حاليًا جوه قلعة الهدف بعد ما وصلت.
// كل استدعاء لـ sendReinforcement بيعمل مستند مستقل (مش بيتجمّع مع تعزيز
// سابق)، عشان صاحب كل دفعة يقدر يسحبها لوحدها من غير ما يأثر على تعزيزات
// حلفاء تانيين واقفة في نفس القلعة. march_id بيربط الدفعة دي بمسير الذهاب
// الأصلي (March direction: 'reinforcement') لغرض العرض/التتبع بس. ======
const allianceReinforcementSchema = new mongoose.Schema(
  {
    alliance_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Alliance', required: true, index: true },

    origin_user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    origin_castle_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Castle', required: true },

    target_user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    target_castle_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Castle', required: true, index: true },

    outgoing_march_id: { type: mongoose.Schema.Types.ObjectId, ref: 'March', default: null },
    return_march_id: { type: mongoose.Schema.Types.ObjectId, ref: 'March', default: null },

    troops: { type: [troopStackSchema], default: [] },

    // stationed: الجنود واقفين فعليًا في قلعة الهدف ومشاركين في دفاعها.
    // recalled: اتسحبت (يدوي أو تلقائي) وفيه مسير عودة ماشي دلوقتي.
    // returned: مسير العودة وصل وخلص (نفس منطق resolveReturnArrival القديم).
    status: { type: String, enum: ['stationed', 'recalled', 'returned'], default: 'stationed', index: true },

    recalled_reason: { type: String, enum: [null, 'manual', 'alliance_exit'], default: null },

    stationed_at: { type: Date, default: null },
    recalled_at: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

allianceReinforcementSchema.index({ target_castle_id: 1, status: 1 });
allianceReinforcementSchema.index({ origin_user_id: 1, status: 1 });

module.exports = mongoose.model('AllianceReinforcement', allianceReinforcementSchema);
