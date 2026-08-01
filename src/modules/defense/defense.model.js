const mongoose = require('mongoose');
const {
  REPAIR_STATES,
  BUILD_STATES,
  GARRISON_TARGET_TYPES,
  GARRISON_STATUSES,
  RESERVED_ARMY_CATEGORIES,
  DEFENSE_PLAN_RULE_TYPES,
} = require('./defense.config');

const positionSchema = new mongoose.Schema(
  { x: { type: Number, required: true }, y: { type: Number, required: true } },
  { _id: false }
);

// ====== حالة الترقية الحالية لأي قطعة دفاعية - نفس شكل upgrade في
// castle.model buildingSchema بالظبط عشان يفضل نفس المنطق العام لأي "حاجة
// بتترقّى بمرور وقت" في المشروع كله. ======
const upgradeStateSchema = new mongoose.Schema(
  {
    in_progress: { type: Boolean, default: false },
    target_level: { type: Number, default: null },
    started_at: { type: Date, default: null },
    completes_at: { type: Date, default: null },
  },
  { _id: false }
);

// ====== حالة الإصلاح - منفصلة عن حالة الترقية لأن قطعة ممكن تتضرر (تحتاج
// إصلاح) من غير ما تكون بترقّى، والعكس. لسه مفيش محرك قتال حقيقي بينقص الـ
// hp، فالحقل ده بيتغيّر بس يدوي دلوقتي (endpoint مخصص) لحد ما "Building
// Interaction" في موديول battle يربطه بمعركة حقيقية. ======
const repairStateSchema = new mongoose.Schema(
  {
    state: { type: String, enum: REPAIR_STATES, default: 'intact' },
    started_at: { type: Date, default: null },
    completes_at: { type: Date, default: null },
  },
  { _id: false }
);

// ====== حالة البناء - "قيد الطابور" وقت الإنشاء الأول، "قيد البناء" لما
// يبدأ العد التنازلي، "مكتمل" لما ينتهي. منفصلة عن upgrade (اللي بيبدأ
// يشتغل بس بعد ما build.state يوصل complete). ======
const buildStateSchema = new mongoose.Schema(
  {
    state: { type: String, enum: BUILD_STATES, default: 'queued' },
    started_at: { type: Date, default: null },
    completes_at: { type: Date, default: null },
  },
  { _id: false }
);

// ====== إحصائيات قتال Placeholder بحتة - راجع تعليق
// structureCombatStatsPlaceholder في defense.config.js: مش مستخدمة في أي
// منطق قتال أو محاكاة حاليًا. ======
const combatStatsPlaceholderSchema = new mongoose.Schema(
  {
    attack: { type: Number, default: 0 },
    // ====== defense: قوة الدفاع الحقيقية بتاعة القطعة دي (تُحسب في
    // defense.config.js structureCombatStatsPlaceholder من
    // base_defense_power * defense_power_growth^(level-1)) - دي اللي بتتنسخ
    // في battle snapshot (defense_power) وتدخل فعليًا في حساب قوة دفاع
    // القلعة الكلية جنب الجنود، مش مجرد رقم وصفي. ======
    defense: { type: Number, default: 0 },
    damage: { type: Number, default: 0 },
    range: { type: Number, default: 0 },
    // ====== نسبة تعزيز إضافية بتضيفها القطعة دي لإجمالي قوة الدفاع (زي
    // hero_bonus_percent/research_bonus_percent) - راجع
    // base_defense_bonus_percent في defense.config.js. ======
    defense_bonus_percent: { type: Number, default: 0 },
  },
  { _id: false }
);

// ====== حالة خاصة بالبوابات بس (open/closed + destroyed) - موجودة على كل
// قطعة دفاعية في الموديل (عشان مفيش discriminators هنا) بس مش ليها معنى
// إلا لما type === 'gate'. الـ hp/repair.state فوق بيعبّروا برضه عن حالة
// "تدمير" عامة لأي قطعة، لكن destroyed هنا حقل صريح مخصص للبوابة نفسها
// (زي ما طلب نظام البوابة بالظبط) - الاتنين بيتزامنوا مع بعض في service. ======
const gateStateSchema = new mongoose.Schema(
  {
    open: { type: Boolean, default: true },
    destroyed: { type: Boolean, default: false },
  },
  { _id: false }
);

// ====== قطعة دفاعية واحدة - الشكل الموحّد لكل الأنواع التمنية (سور/بوابة/
// أبراج التلاتة/برج مراقبة/فخ/متراس). category بتتحسب من
// DEFENSE_STRUCTURE_TYPES[type].category وقت الإدخال في الخدمة عشان
// "التخطيط الدفاعي" (Defensive Layout) يقدر يرجّع المواقع مجمّعة بالفئة من
// غير ما يحتاج جدول تاني منفصل لكل فئة. ======
const defenseStructureSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      // القيم المسموحة بتتفحص فعليًا في service (defense.config
      // DEFENSE_STRUCTURE_TYPES) عشان ميحصلش تكرار قائمة هنا وهناك.
    },
    category: { type: String, required: true }, // wall | gate | tower | trap | barricade
    level: { type: Number, default: 1 },
    hp: { type: Number, required: true },
    max_hp: { type: Number, required: true },
    position: { type: positionSchema, required: true },
    // اتجاه القطعة (0/90/180/270 درجة مثلاً) - مهم بس للأنواع اللي
    // rotation_applicable: true في الإعدادات (سور/بوابة)، بيتسجّل هنا
    // برضه لباقي الأنواع كـ 0 من غير أي تأثير.
    rotation: { type: Number, default: 0 },
    upgrade: { type: upgradeStateSchema, default: () => ({}) },
    repair: { type: repairStateSchema, default: () => ({}) },
    build: { type: buildStateSchema, default: () => ({}) },
    combat_stats: { type: combatStatsPlaceholderSchema, default: () => ({}) },
    // مستخدمة فقط لما type === 'gate' - راجع تعليق gateStateSchema فوق.
    gate_state: { type: gateStateSchema, default: () => ({}) },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

// ====== قطعة سور مستقلة داخل "تخطيط الأسوار" - مش شكل قتالي (ده موجود
// أصلًا في defenseStructureSchema لكل قطعة سور مبنية فعليًا)، دي بس بتوصف
// "الشكل الهندسي" لخط الأسوار كخطوط متصلة بين نقطتين على شبكة المدينة، عشان
// يستخدمها لاحقًا أي محرر خرائط (Wall Editor UI - مش جزء من الخطوة دي) وأي
// تحقق مستقبلي (حلقة سور مقفولة، تجاور صحيح مع بوابة...). ======
const wallSegmentSchema = new mongoose.Schema(
  {
    from: { type: positionSchema, required: true },
    to: { type: positionSchema, required: true },
  },
  { _id: true }
);

// ====== تخطيط الأسوار - مخزّن منفصل تمامًا عن مصفوفة المباني/القطع
// الدفاعية (structures) عشان اللاعب يقدر يصمم شكل سوره بحرّية (مش سور ثابت
// مفروض من اللعبة). grid_size بيتسجّل هنا كمرجع لحجم شبكة المدينة وقت
// التصميم (يطابق getMaxCityTiles/unlocked_tiles في castle.service). ======
const wallLayoutSchema = new mongoose.Schema(
  {
    grid_size: { type: Number, default: null },
    segments: { type: [wallSegmentSchema], default: [] },
  },
  { _id: false }
);

const troopStackSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    count: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

// ====== قائد اختياري لحامية - نظام القادة نفسه مش موجود في اللعبة لسه (زي
// ما هو موضّح في battle.snapshot.service)، فبنكتفي بشكل حر بسيط هنا كمان. ======
const garrisonCommanderSchema = new mongoose.Schema(
  {
    commander_key: { type: String, default: null },
    name: { type: String, default: null },
    level: { type: Number, default: 1 },
  },
  { _id: false }
);

// ====== حامية واحدة - تعيين جزء من الجيش لموقع دفاعي بعينه (سور/برج/بوابة/
// مبنى دفاعي) بدل جيش دفاعي عام واحد. target_id بيشاور على _id بتاعة قطعة
// جوه structures[] فوق (أو _id بتاعة مبنى جوه Castle.buildings لو
// target_type === 'building') - مخزّن كنص حر (String) مش ref صريح عشان ممكن
// يشاور على مستندين مختلفين حسب target_type. ======
const garrisonSchema = new mongoose.Schema(
  {
    target_type: { type: String, enum: GARRISON_TARGET_TYPES, required: true },
    target_id: { type: String, required: true },
    position: { type: positionSchema, default: () => ({ x: 0, y: 0 }) },
    troops: { type: [troopStackSchema], default: [] },
    commander: { type: garrisonCommanderSchema, default: null },
    status: { type: String, enum: GARRISON_STATUSES, default: 'empty' },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

// ====== فئة واحدة من الجيش الاحتياطي المخصص للدفاع - عنصر واحد بالحد
// الأقصى لكل فئة (wall_defense/gate_defense/mobile_reserve)، الـ service هو
// اللي بيضمن عدم التكرار (upsert بالفئة). الجنود هنا "محجوزين" فعليًا:
// منطق إرسال مسير هجوم (march.service startMarch) بيستثنيهم من الجيش
// المتاح للإرسال. ======
const reservedArmyEntrySchema = new mongoose.Schema(
  {
    category: { type: String, enum: RESERVED_ARMY_CATEGORIES, required: true },
    troops: { type: [troopStackSchema], default: [] },
  },
  { _id: false }
);

// ====== قاعدة واحدة جوه خطة الدفاع - تخزين إعدادات بس، مفيش أي تنفيذ آلي
// (AI Execution) بيقرأها لسه. target حر (مثلاً معرّف بوابة/سور معيّن) عشان
// نفس القاعدة (زي defend_gate) ممكن تتكرر بأهداف مختلفة. ======
const defensePlanRuleSchema = new mongoose.Schema(
  {
    rule_type: { type: String, enum: DEFENSE_PLAN_RULE_TYPES, required: true },
    target_id: { type: String, default: null },
    priority: { type: Number, default: 0 },
    notes: { type: String, default: null },
  },
  { _id: true }
);

const defensePlanSchema = new mongoose.Schema(
  {
    // اسم/وصف مختصر حر لكل خطة (زي "دفاع أساسي"، "استعداد لحصار") - حر بحت
    strategy: { type: String, default: null },
    rules: { type: [defensePlanRuleSchema], default: [] },
    notes: { type: String, default: null },
  },
  { _id: false }
);

// ====== مستند دفاع واحد لكل قلعة - نفس فلسفة فصل Castle عن March/Battle:
// كل حاجة خاصة بـ"إدارة الدفاع" (مباني دفاعية، تخطيط أسوار، حاميات، جيش
// احتياطي، خطة دفاع) بتتخزن هنا منفصلة تمامًا عن castle.model (المباني/
// الجيش/الموارد) - عشان القلعة تفضل بسيطة، والدفاع يقدر يكبر لوحده من غير
// ما يأثر على منطق البناء/الاقتصاد الحالي. castle_id فريد (مستند دفاع واحد
// بالظبط لكل قلعة، بيتعمل lazily أول مرة حد يطلب دفاع قلعته - راجع
// getOrCreateDefense في service). ======
const castleDefenseSchema = new mongoose.Schema(
  {
    castle_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Castle',
      required: true,
      unique: true,
    },
    structures: { type: [defenseStructureSchema], default: [] },
    wall_layout: { type: wallLayoutSchema, default: () => ({}) },
    garrisons: { type: [garrisonSchema], default: [] },
    reserved_army: { type: [reservedArmyEntrySchema], default: [] },
    defense_plan: { type: defensePlanSchema, default: () => ({}) },
    // ====== NEW (NPC World System rebuild) - قائد دفاعي على مستوى المدينة
    // كلها (مش حامية واحدة بس) - بيتحط بس لمعسكرات NPC (راجع
    // npcCastle.generator.generateNpcCommander + worldMap.service). اختياري
    // تمامًا (default: null) فمستندات الدفاع الحقيقية للاعبين مش بتتأثر. ======
    commander: { type: garrisonCommanderSchema, default: null },
    // وصف سلوك الذكاء الاصطناعي الدفاعي (passive|defensive|aggressive) -
    // Placeholder وصفي بس زي combat_stats فوق، جاهز لمحرك القتال يستخدمه
    // لاحقًا من غير ما نغيّر محرك القتال نفسه دلوقتي.
    ai_posture: { type: String, default: null },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

module.exports = mongoose.model('CastleDefense', castleDefenseSchema);
