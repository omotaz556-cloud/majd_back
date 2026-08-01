const mongoose = require('mongoose');
const { FORMATION_TYPES, MARCH_TYPES } = require('./army.config');

// ====== كومة وحدات من نوع واحد جوه التشكيلة - نفس شكل troopStackSchema في
// castle.model.js بالظبط (key بيطابق مفتاح في castle.config TROOP_TYPES). ======
const troopStackSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    count: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

// ====== تعيين قائد واحد (أساسي أو ثانوي) - نظام القادة نفسه مش موجود في
// اللعبة لسه (زي ما هو موضّح في battle.model.js commanderSnapshotSchema)،
// فبنكتفي بشكل حر مرن هنا كمان عشان نظام القادة الحقيقي يتبنى فوقه من غير
// ما نحتاج نعدّل شكل التشكيلة تاني. skills هنا Placeholder بحت - مفيش أي
// تنفيذ (execution) ليها لسه. ======
const commanderAssignmentSchema = new mongoose.Schema(
  {
    commander_key: { type: String, default: null },
    name: { type: String, default: null },
    level: { type: Number, default: 1 },
    // مهارات مستقبلية خاصة بالقائد - شكلها مش نهائي لسه، بتتخزن كأوبچكت حر
    // (زي bonuses في commanderSnapshotSchema) بدل ما نخترع حقول وهمية.
    skills: { type: [mongoose.Schema.Types.Mixed], default: [] },
  },
  { _id: false }
);

// ====== تعيين قادة التشكيلة - أساسي وثانوي بس، مفيش أكتر من كده دلوقتي.
// null يعني "مفيش قائد متعيّن في الخانة دي لسه". ======
const commanderSlotsSchema = new mongoose.Schema(
  {
    primary: { type: commanderAssignmentSchema, default: null },
    secondary: { type: commanderAssignmentSchema, default: null },
  },
  { _id: false }
);

// ====== تشكيلة واحدة من جيش اللاعب - وحدة التخطيط الأساسية اللي هتتحط جوه
// مراحل خطة المعركة (Battle Plan) بعد كده. مفيش أي حساب قتالي هنا خالص -
// كل الأرقام (movement_speed/load_capacity) دلوقتي Placeholder بيتحط يدوي
// أو بيفضل null لحد ما محرك حساب فعلي (بناءً على troops) يتبنى لاحقًا. ======
const formationSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    castle_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Castle', required: true, index: true },

    // ====== معرّف عرض فريد وقابل للمشاركة (زي battle_id) - منفصل عن _id
    // بتاع Mongo عشان يبان واضح في الواجهة/الـ Battle Planner. ======
    formation_id: { type: String, required: true, unique: true, index: true },

    name: { type: String, required: true, trim: true },

    troops: { type: [troopStackSchema], default: [] },

    commanders: { type: commanderSlotsSchema, default: () => ({}) },

    march_type: {
      type: String,
      enum: Object.values(MARCH_TYPES),
      default: MARCH_TYPES.NORMAL,
    },

    // ====== سرعة الحركة/سعة الحمل - Placeholder دلوقتي (null يعني "لسه
    // ما اتحسبتش"). محرك حساب فعلي (بناءً على أبطأ وحدة في troops، زي منطق
    // armyMinSpeed في castle.config.js) هيتبنى لاحقًا فوق نفس الحقلين دول
    // من غير ما نحتاج نعدّل شكل الموديل تاني. ======
    movement_speed: { type: Number, default: null },
    load_capacity: { type: Number, default: null },

    formation_type: {
      type: String,
      enum: Object.values(FORMATION_TYPES),
      default: FORMATION_TYPES.BALANCED,
    },

    // ====== مهارات نشطة (Active Skills) - حاوية فاضية دلوقتي لحد ما نظام
    // المهارات الحقيقي يتبنى (مفيش تنفيذ لأي مهارة هنا خالص). ======
    active_skills: { type: [mongoose.Schema.Types.Mixed], default: [] },

    // ====== التشكيلة "المختارة" حاليًا للاعب - واحدة بس في نفس الوقت
    // (الـ service هو اللي بيضمن الحصرية عن طريق unselect باقي التشكيلات
    // وقت select جديد، نفس فلسفة upsert بالفئة في defense.reserved_army). ======
    is_selected: { type: Boolean, default: false },

    notes: { type: String, default: null },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

formationSchema.index({ user_id: 1, castle_id: 1 });

module.exports = mongoose.model('Formation', formationSchema);
