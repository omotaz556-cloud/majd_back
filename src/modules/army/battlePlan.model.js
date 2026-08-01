const mongoose = require('mongoose');
const {
  BATTLE_TARGET_TYPES,
  RETREAT_CONDITION_TYPES,
  RETREAT_ACTIONS,
  PROTECTION_RULE_TYPES,
  COMMANDER_PREFERENCE_MODES,
  COMMANDER_ROLE_PREFERENCES,
  BATTLE_PLAN_STATUS,
  FORMATION_LINES,
  TARGET_PRIORITY_TYPES,
  STRATEGIC_RETREAT_RULE_TYPES,
  STRATEGIC_PROTECTION_RULE_TYPES,
} = require('./army.config');

// ====== Battle Planner 2.0 ======
// الطبقة الاستراتيجية اللي بتقعد فوق الـ Rule Engine (battle/engines/ruleEngine.js)
// مباشرة - هنا بس تخزين "نية" اللاعب الاستراتيجية (تشكيلة + أولويات أهداف +
// قواعد انسحاب + قواعد حماية + تفضيلات قادة) بشكل مُتحقَّق منه (validated)،
// مفيش أي تقييم شرط ولا نشر فعل ولا أي تنفيذ فعلي هنا خالص، ومفيش أي استدعاء
// أو import من battle/engines في الملف ده أو أي ملف تاني جوه الموديول ده -
// الربط الفعلي مع Rule Engine هيتم في خطوة لاحقة تمامًا فوق نفس الأساس ده. ======

const positionSchema = new mongoose.Schema(
  { x: { type: Number, required: true }, y: { type: Number, required: true } },
  { _id: false }
);

// ====== عنصر واحد جوه أولويات الأهداف (Target Priorities) - قايمة مرتّبة
// بتوصف "إيه اللي الخطة دي المفروض تستهدفه الأول" - priority أصغر = أعلى
// أولوية. نفس فلسفة target_ref_id في battleTargetSchema القديمة بالظبط:
// نص حر (String) مش ref صريح عشان ممكن يشاور على مستندات مختلفة حسب النوع
// (قطعة دفاعية جوه CastleDefense.structures، أو مبنى جوه Castle.buildings). ======
const targetPrioritySchema = new mongoose.Schema(
  {
    priority: { type: Number, required: true, min: 1 },

    target_type: {
      type: String,
      enum: Object.values(BATTLE_TARGET_TYPES),
      required: true,
    },

    // القلعة اللي الهدف ده جوّاها - غالبًا قلعة العدو المستهدفة، بس محفوظة
    // صراحة هنا عشان نفس الخطة تقدر تحمل أولويات لأكتر من قلعة نظريًا.
    target_castle_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Castle', default: null },

    // معرّف حر للعنصر المستهدف بالظبط (قطعة دفاعية/مبنى) - null لو
    // target_type === 'coordinates' (مفيش عنصر بذاته، بس نقطة على الشبكة).
    target_ref_id: { type: String, default: null },

    // نقطة حرة على شبكة المدينة - مستخدمة بس لما target_type === 'coordinates'،
    // بتتخزن برضه (اختياريًا) لباقي الأنواع كموقع مرجعي للعرض في الواجهة.
    position: { type: positionSchema, default: null },

    label: { type: String, default: null },
    notes: { type: String, default: null },
  },
  { _id: true }
);

// ====== عنصر واحد جوه قواعد الانسحاب (Retreat Rules) - "لو الشرط ده اتحقق،
// نفّذ الإجراء ده" - تخزين بس دلوقتي، مفيش أي تقييم آلي بيقيّم condition_type
// ده لسه (ده شغل Rule Engine لاحقًا). threshold حر (Mixed) عشان يقدر ياخد أي
// شكل حسب condition_type (رقم نسبة مئوية لـ casualties_above_percent، عدد
// ثواني لـ timer_reached، null لو الشرط مالوش قيمة زي commander_dead). ======
const retreatRuleSchema = new mongoose.Schema(
  {
    condition_type: {
      type: String,
      enum: Object.values(RETREAT_CONDITION_TYPES),
      required: true,
    },

    // قيمة الشرط (زي 30 لـ "خسائر فوق 30%"، أو 120 لـ "بعد 120 ثانية") -
    // Mixed عشان يفضل مرن لحد ما محرك تقييم الشروط الحقيقي يتبنى.
    threshold: { type: mongoose.Schema.Types.Mixed, default: null },

    action: {
      type: String,
      enum: Object.values(RETREAT_ACTIONS),
      default: RETREAT_ACTIONS.FULL_RETREAT,
    },

    // ترتيب تقييم القواعد لو أكتر من قاعدة انطبقت في نفس اللحظة - رقم أصغر
    // يتقيّم الأول (نفس فلسفة priority في defensePlanRuleSchema).
    priority: { type: Number, default: 0 },

    notes: { type: String, default: null },
  },
  { _id: true }
);

// ====== عنصر واحد جوه قواعد الحماية (Protection Rules) - "إيه اللي المفروض
// يتحمي/يتدعّم أثناء تنفيذ الخطة دي" - تخزين بس، مفيش أي تنفيذ آلي. ======
const protectionRuleSchema = new mongoose.Schema(
  {
    rule_type: {
      type: String,
      enum: Object.values(PROTECTION_RULE_TYPES),
      required: true,
    },

    target_castle_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Castle', default: null },
    // معرّف حر للعنصر المطلوب حمايته بالتحديد (قطعة دفاعية) - null لو
    // rule_type عام (زي protect_town_hall/activate_reserve_army).
    target_ref_id: { type: String, default: null },

    priority: { type: Number, default: 0 },
    notes: { type: String, default: null },
  },
  { _id: true }
);

// ====== تفضيلات القادة (Commander Preferences) - نظام القادة نفسه مش موجود
// في اللعبة لسه (زي ما هو موضّح في formation.model.js commanderAssignmentSchema)،
// فبنكتفي بشكل حر مرن هنا كمان عشان نظام القادة الحقيقي يتبنى فوقه من غير ما
// نحتاج نعدّل شكل الخطة تاني. مفيش أي تعيين فعلي بيحصل هنا - بس تفضيل
// مسجّل يستخدمه محرك تعيين قادة مستقبلي (أو اللاعب نفسه وقت التنفيذ). ======
const commanderPreferencesSchema = new mongoose.Schema(
  {
    preferred_commander_key: { type: String, default: null },
    secondary_commander_key: { type: String, default: null },

    role_preference: {
      type: String,
      enum: [...Object.values(COMMANDER_ROLE_PREFERENCES), null],
      default: null,
    },

    assignment_mode: {
      type: String,
      enum: Object.values(COMMANDER_PREFERENCE_MODES),
      default: COMMANDER_PREFERENCE_MODES.MANUAL,
    },

    notes: { type: String, default: null },
  },
  { _id: false }
);

// ====== خطة معركة كاملة (Battle Plan 2.0) - طبقة تخطيط استراتيجي فوق الـ
// Rule Engine مباشرة: كل خطة بتخص لاعب واحد وقلعة واحدة، وبتحمل تشكيلة +
// أولويات أهداف + قواعد انسحاب + قواعد حماية + تفضيلات قادة + metadata حرة
// للتوسّع المستقبلي. مفيش أي تنفيذ فعلي أو تشبيك مع Rule/Simulation/Combat
// Engine هنا خالص - الخطوة دي أساس التخطيط بس. ======
// ====== Battle Formation System (Front/Middle/Back Line) ======
// خانة واحدة جوه التشكيل التكتيكي للمعركة - بتربط مجموعة قوات واحدة
// (troop_key - نفس مفاتيح TROOP_TYPES في castle.config.js) بخط معيّن (line)
// ورقم خانة (slot_index) جوه الخط ده. troop_key ممكن يفضل null يعني "خانة
// فاضية" (مسموح بها صراحة - مفيش أي إلزام إن كل الخانات المسجّلة تبقى
// معبّية). التحقق الفعلي (خط صالح/نوع قوات صالح/مفيش تكرار لمجموعة قوات في
// أكتر من خانة/مفيش خانتين في نفس المكان) بيحصل في
// battlePlanner.service.js وقت الحفظ - مفيش أي حساب قتالي أو تنفيذ هنا
// خالص، ومفيش أي import من battle/engines. مصمم يكون قابل للتوسّع: أي خط
// جديد بيتضاف في FORMATION_LINES (army.config.js) وبس، من غير ما نحتاج
// نعدّل شكل الـ schema هنا. ======
const battleFormationSlotSchema = new mongoose.Schema(
  {
    line: {
      type: String,
      enum: Object.values(FORMATION_LINES),
      required: true,
    },
    slot_index: { type: Number, default: 0, min: 0 },
    // مفتاح مجموعة القوات المعيّنة للخانة دي - null يعني خانة فاضية.
    troop_key: { type: String, default: null },
  },
  { _id: false }
);

// ====== Battle Strategy System (Strategic Configuration) ======
// طبقة استراتيجية مبسّطة ومباشرة تُخزَّن جوه نفس BattlePlan - أولوية استهداف
// + قواعد انسحاب + قواعد حماية + تفضيل قائد عام واحد. مختلف عن
// target_priorities/retreat_rules/protection_rules الأقدم فوق (دول بيشتغلوا
// على عناصر/إحداثيات فعلية جوه قلعة بعينها) - الطبقة دي أبسط: "نية"
// استراتيجية عامة بس، من غير أي ربط بعنصر معيّن. التحقق الفعلي (قيم صالحة/
// مفيش تكرار/threshold المطلوب لأنواع معينة/never_retreat لازم يكون القاعدة
// الوحيدة لو موجود) بيحصل في battlePlanner.service.js وقت الحفظ - مفيش أي
// تقييم شرط أو تنفيذ فعلي هنا خالص، ومفيش أي import من
// battle/engines/ruleEngine.js. ======

// ====== قاعدة انسحاب استراتيجية واحدة - threshold مطلوب (0-100) بس لـ
// hp_threshold/morale_threshold، وبيفضل null لـ commander_death/never_retreat
// (مالهمش قيمة عددية). ======
const strategicRetreatRuleSchema = new mongoose.Schema(
  {
    rule_type: {
      type: String,
      enum: Object.values(STRATEGIC_RETREAT_RULE_TYPES),
      required: true,
    },
    threshold: { type: Number, default: null },
  },
  { _id: false }
);

// ====== قاعدة حماية استراتيجية واحدة - priority بترتب أولوية التنفيذ لو
// أكتر من قاعدة انطبقت في نفس اللحظة (رقم أصغر = أعلى أولوية). ======
const strategicProtectionRuleSchema = new mongoose.Schema(
  {
    rule_type: {
      type: String,
      enum: Object.values(STRATEGIC_PROTECTION_RULE_TYPES),
      required: true,
    },
    priority: { type: Number, default: 0 },
  },
  { _id: false }
);

// ====== الإعداد الاستراتيجي الكامل - أولوية استهداف (مصفوفة مرتّبة من
// TARGET_PRIORITY_TYPES - أول عنصر أعلى أولوية) + قواعد انسحاب + قواعد
// حماية + تفضيل قائد عام واحد (بيعيد استخدام COMMANDER_ROLE_PREFERENCES
// الموجودة بالفعل - نفس القيم بالظبط: offensive/defensive/support/balanced). ======
const strategyConfigSchema = new mongoose.Schema(
  {
    target_priority: {
      type: [{ type: String, enum: Object.values(TARGET_PRIORITY_TYPES) }],
      default: [],
    },
    retreat_rules: { type: [strategicRetreatRuleSchema], default: [] },
    protection_rules: { type: [strategicProtectionRuleSchema], default: [] },
    commander_preference: {
      type: String,
      enum: [...Object.values(COMMANDER_ROLE_PREFERENCES), null],
      default: null,
    },
  },
  { _id: false }
);

const battlePlanSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    castle_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Castle', required: true, index: true },

    // ====== معرّف عرض فريد (زي battle_id/formation_id) ======
    plan_id: { type: String, required: true, unique: true, index: true },

    name: { type: String, required: true, trim: true },

    // ====== خطة القلعة الافتراضية (Default Battle Plan) - واحدة بس صح في
    // نفس الوقت لكل (user_id, castle_id) - الـ service هو اللي بيضمن الحصرية
    // دي (setDefaultPlan بيلغي is_default عن أي خطة تانية لنفس القلعة قبل ما
    // يحطها هنا)، مفيش unique index مباشر على الحقل ده لوحده عشان ممكن يبقى
    // false لأي عدد من الخطط في نفس الوقت. ======
    is_default: { type: Boolean, default: false },

    status: {
      type: String,
      enum: Object.values(BATTLE_PLAN_STATUS),
      default: BATTLE_PLAN_STATUS.DRAFT,
    },

    // ====== التشكيلة المكلّفة بتنفيذ الخطة دي - لازم تكون تشكيلة حقيقية
    // موجودة ومملوكة لنفس صاحب الخطة (بيتفحص في battlePlanner.service.validatePlan). ======
    assigned_formation_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Formation', default: null },

    target_priorities: { type: [targetPrioritySchema], default: [] },
    retreat_rules: { type: [retreatRuleSchema], default: [] },
    protection_rules: { type: [protectionRuleSchema], default: [] },

    commander_preferences: { type: commanderPreferencesSchema, default: () => ({}) },

    // ====== التشكيل التكتيكي للمعركة (Battle Formation System) - توزيع
    // مجموعات القوات على خطوط المعركة (أمامية/وسطى/خلفية - راجع
    // battleFormationSlotSchema فوق). مختلف عن assigned_formation_id فوق:
    // ده تشكيل *تكتيكي* لخطوط المعركة نفسها، مش تشكيلة الجيش/المسير العامة
    // (اللي بتتخزن في موديول Formation المنفصل). مفيش أي تنفيذ أو تشبيك مع
    // Combat/Simulation Engine هنا خالص - تخزين وتحقق بس (نفس فلسفة باقي
    // حقول الخطة). فاضية افتراضيًا لحد ما اللاعب يبني تشكيله بنفسه.
    battle_formation: { type: [battleFormationSlotSchema], default: [] },

    // ====== الإعداد الاستراتيجي (Battle Strategy - Strategic
    // Configuration) - راجع strategyConfigSchema فوق: أولوية استهداف +
    // قواعد انسحاب + قواعد حماية + تفضيل قائد عام واحد. مفيش أي تنفيذ أو
    // تشبيك مع Rule/Combat/Simulation Engine هنا خالص - تخزين وتحقق بس
    // (نفس فلسفة باقي حقول الخطة). فاضي افتراضيًا لحد ما اللاعب يبني
    // استراتيجيته بنفسه.
    strategy_config: { type: strategyConfigSchema, default: () => ({}) },

    // ====== حاوية توسّع حرة (Metadata) - أي بيانات وصفية إضافية (تاجات،
    // لون/أيقونة للواجهة، تصنيف اللاعب الخاص...) من غير ما نحتاج نعدّل شكل
    // الموديول الأساسي كل مرة نضيف حاجة جديدة. بيتفحص إنها object عادي بس
    // (مش array) في service، وعدد مفاتيحها محدود (MAX_METADATA_KEYS). ======
    metadata: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },

    // ====== آخر نتيجة تحقق (validatePlan) اتسجّلت - مفيدة عشان الواجهة
    // تعرض حالة الخطة (صالحة/فيها أخطاء) من غير ما تحتاج تنادي /validate
    // في كل مرة. بتتحدّث تلقائيًا في service بعد أي إنشاء/تعديل. ======
    last_validation: {
      is_valid: { type: Boolean, default: false },
      errors: { type: [String], default: [] },
      checked_at: { type: Date, default: null },
    },

    notes: { type: String, default: null },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

battlePlanSchema.index({ user_id: 1, castle_id: 1 });
battlePlanSchema.index({ user_id: 1, castle_id: 1, is_default: 1 });

module.exports = mongoose.model('BattlePlan', battlePlanSchema);
