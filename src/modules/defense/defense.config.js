// ====== إعدادات نظام الدفاع (City Defense System) - نفس فلسفة
// castle.config.js بالظبط: كل الأرقام هنا قابلة للتعديل من غير ما تلمس أي
// منطق تاني (service/controller). الخطوة دي أساس إدارة دفاعية (بناء/ترقية/
// تخطيط) + رقم "قوة دفاعية" (defense_power) حقيقي لكل مبنى دفاعي، بيدخل
// فعليًا في حساب قوة دفاع القلعة الكلية جنب الجنود (راجع
// battleResolution/calculators/defensePowerCalculator.js) - المباني بقت
// جزء أساسي من قوة الدفاع مش مجرد أهداف hp بس. damage/range لسه placeholder
// لمحرك القتال اللحظي (Combat Engine) بتاع الأبراج/الفخاخ النشطة. ======

// ====== تصنيف عام لكل نوع مبنى دفاعي - مستخدم في "التخطيط الدفاعي"
// (Defensive Layout) عشان نقدر نرجّع مواقع الأبراج/البوابات/الفخاخ/المباني
// الدفاعية كل واحدة لوحدها من غير ما نكرر التخزين (المصدر الوحيد للحقيقة
// هو DEFENSE_STRUCTURE_TYPES.category). ======
const STRUCTURE_CATEGORY = {
  WALL: 'wall',
  GATE: 'gate',
  TOWER: 'tower',
  TRAP: 'trap',
  BARRICADE: 'barricade',
};

// ====== أنواع المباني الدفاعية المدعومة ======
const DEFENSE_STRUCTURE_TYPES = {
  wall: {
    key: 'wall',
    name: 'سور',
    description: 'قطعة سور أساسية بتحمي محيط المدينة - بتترص جنب بعض عشان تكوّن خط دفاع كامل (شوف نظام تخطيط الأسوار).',
    category: STRUCTURE_CATEGORY.WALL,
    rotation_applicable: true, // اتجاه القطعة (أفقي/رأسي) على شبكة المدينة
    max_level: 20,
    base_hp: 200,
    hp_growth: 1.25,
    base_cost: { gold: 0, wood: 100, stone: 60 },
    cost_growth: 1.28,
    base_build_seconds: 90,
    time_growth: 1.2,
    // سور: مساهمة flat بسيطة لكل قطعة + نسبة صغيرة بتتراكم مع باقي قطع
    // السور المبنية (خط دفاع كامل أقوى من مجموع قطعه المنفردة).
    base_defense_power: 15,
    defense_power_growth: 1.22,
    base_defense_bonus_percent: 0.004,
    defense_bonus_percent_growth: 1.05,
  },
  gate: {
    key: 'gate',
    name: 'بوابة',
    description: 'فتحة متحكَّم فيها في خط الأسوار - بتتفتح/تتقفل، ونقطة الاقتحام المفضّلة لأي جيش مهاجم.',
    category: STRUCTURE_CATEGORY.GATE,
    rotation_applicable: true, // اتجاه البوابة (facing) - مهم لمحرك المعركة لاحقًا
    max_level: 20,
    base_hp: 260,
    hp_growth: 1.25,
    base_cost: { gold: 50, wood: 120, stone: 80 },
    cost_growth: 1.3,
    base_build_seconds: 120,
    time_growth: 1.22,
    // بوابة: أضعف من قطعة سور دفاعيًا (نقطة اختراق مقصودة) بس لسه بتساهم.
    base_defense_power: 10,
    defense_power_growth: 1.2,
    base_defense_bonus_percent: 0.002,
    defense_bonus_percent_growth: 1.05,
  },
  archer_tower: {
    key: 'archer_tower',
    name: 'برج رماة',
    description: 'برج دفاعي بعيد المدى - نيران خفيفة ومتكررة، الأنسب ضد وحدات كتير في نفس الوقت.',
    category: STRUCTURE_CATEGORY.TOWER,
    rotation_applicable: false,
    max_level: 15,
    base_hp: 320,
    hp_growth: 1.27,
    base_cost: { gold: 200, wood: 150, stone: 100 },
    cost_growth: 1.32,
    base_build_seconds: 240,
    time_growth: 1.25,
    base_damage: 12,
    damage_growth: 1.2,
    base_range: 6,
    // برج رماة: قوة دفاعية معتدلة بتنمو مع المستوى زي باقي الأبراج.
    base_defense_power: 35,
    defense_power_growth: 1.24,
    base_defense_bonus_percent: 0.006,
    defense_bonus_percent_growth: 1.05,
  },
  ballista_tower: {
    key: 'ballista_tower',
    name: 'برج بالستا',
    description: 'برج دفاعي بضربة واحدة قوية بطيئة - الأنسب ضد وحدة مفردة عالية الدفاع/الفارس.',
    category: STRUCTURE_CATEGORY.TOWER,
    rotation_applicable: false,
    max_level: 15,
    base_hp: 300,
    hp_growth: 1.27,
    base_cost: { gold: 250, wood: 120, stone: 150 },
    cost_growth: 1.33,
    base_build_seconds: 260,
    time_growth: 1.26,
    base_damage: 26,
    damage_growth: 1.22,
    base_range: 7,
    // برج بالستا: أعلى قوة دفاعية بين الأبراج (بيوازي ضربته القوية البطيئة).
    base_defense_power: 45,
    defense_power_growth: 1.25,
    base_defense_bonus_percent: 0.007,
    defense_bonus_percent_growth: 1.05,
  },
  catapult_tower: {
    key: 'catapult_tower',
    name: 'برج منجنيق',
    description: 'برج دفاعي بضرر منطقة (Area) - الأنسب ضد تجمعات كبيرة من الوحدات القريبة من بعض.',
    category: STRUCTURE_CATEGORY.TOWER,
    rotation_applicable: false,
    max_level: 15,
    base_hp: 280,
    hp_growth: 1.27,
    base_cost: { gold: 300, wood: 150, stone: 180 },
    cost_growth: 1.34,
    base_build_seconds: 300,
    time_growth: 1.27,
    base_damage: 18,
    damage_growth: 1.21,
    base_range: 5,
    // برج منجنيق: قوة دفاعية قريبة من برج الرماة، ضرره الحقيقي في المحاكاة
    // اللحظية (Area damage) مش هنا.
    base_defense_power: 38,
    defense_power_growth: 1.24,
    base_defense_bonus_percent: 0.006,
    defense_bonus_percent_growth: 1.05,
  },
  watch_tower: {
    key: 'watch_tower',
    name: 'برج مراقبة',
    description: 'برج استطلاع بحماية ذاتية بسيطة - مالوش نيران دفاعية حقيقية، غرضه الأساسي الرؤية/الإنذار المبكر لاحقًا.',
    category: STRUCTURE_CATEGORY.TOWER,
    rotation_applicable: false,
    max_level: 10,
    base_hp: 180,
    hp_growth: 1.2,
    base_cost: { gold: 80, wood: 100, stone: 60 },
    cost_growth: 1.25,
    base_build_seconds: 150,
    time_growth: 1.2,
    base_damage: 0,
    damage_growth: 1,
    base_range: 8,
    // برج مراقبة: مالوش نيران هجومية، بس لسه بيحمي محيطه بقوة دفاعية خفيفة.
    base_defense_power: 8,
    defense_power_growth: 1.15,
    base_defense_bonus_percent: 0,
    defense_bonus_percent_growth: 1,
  },
  trap: {
    key: 'trap',
    name: 'فخ',
    description: 'فخ مخفي مرة استخدام واحدة (يفترض) - بيتفعّل تلقائي لما جيش مهاجم يمر عليه (منطق التفعيل نفسه في محرك القتال المستقبلي).',
    category: STRUCTURE_CATEGORY.TRAP,
    rotation_applicable: false,
    max_level: 10,
    base_hp: 1, // الفخ مالوش "صلابة" حقيقية - أي احتكاك بيه بيستهلكه
    hp_growth: 1,
    base_cost: { gold: 60, wood: 40, stone: 20 },
    cost_growth: 1.3,
    base_build_seconds: 60,
    time_growth: 1.2,
    base_damage: 20,
    damage_growth: 1.25,
    base_range: 1,
    // فخ: مساهمة دفاعية صغيرة (رغم إنه استخدام واحد فعليًا في المحاكاة
    // اللحظية) - بيمثّل هنا "ردع" مستمر ضد أي هجوم بيتحسب.
    base_defense_power: 6,
    defense_power_growth: 1.18,
    base_defense_bonus_percent: 0,
    defense_bonus_percent_growth: 1,
  },
  barricade: {
    key: 'barricade',
    name: 'متراس',
    description: 'حاجز مؤقت رخيص بيبطّئ تقدم الجيش المهاجم جوه المدينة - مالوش نيران دفاعية، بس بيمتص ضربات.',
    category: STRUCTURE_CATEGORY.BARRICADE,
    rotation_applicable: false,
    max_level: 10,
    base_hp: 120,
    hp_growth: 1.22,
    base_cost: { gold: 0, wood: 60, stone: 20 },
    cost_growth: 1.25,
    base_build_seconds: 45,
    time_growth: 1.18,
    // متراس: عائق بحت، بس بيديله مساهمة دفاعية flat خفيفة زي أي عائق فيزيائي.
    base_defense_power: 4,
    defense_power_growth: 1.15,
    base_defense_bonus_percent: 0,
    defense_bonus_percent_growth: 1,
  },
};

// ====== حالة الإصلاح العامة لأي قطعة دفاعية ======
const REPAIR_STATES = ['intact', 'damaged', 'destroyed'];

// ====== حالة البناء العامة لأي قطعة دفاعية ======
const BUILD_STATES = ['queued', 'building', 'complete'];

// ====== الأنواع اللي ممكن تتحط عليها حامية (Garrison) ======
const GARRISON_TARGET_TYPES = ['wall', 'tower', 'gate', 'building'];

// ====== حالة الحامية - "غير محتلة" افتراضيًا لحد ما يتحط فيها جنود ======
const GARRISON_STATUSES = ['empty', 'understaffed', 'active'];

// ====== فئات الجيش الاحتياطي المخصص للدفاع - مينفعش يتحرك في مسير هجوم ======
const RESERVED_ARMY_CATEGORIES = ['wall_defense', 'gate_defense', 'mobile_reserve'];

// ====== أنواع القواعد المدعومة في "خطة الدفاع" - تخزين إعدادات بس دلوقتي،
// مفيش أي تنفيذ فعلي (AI Execution) لسه ======
const DEFENSE_PLAN_RULE_TYPES = [
  'defend_gate',
  'defend_wall',
  'hold_position',
  'retreat',
  'reinforce',
  'protect_town_hall',
];

function getStructureConfig(type) {
  return DEFENSE_STRUCTURE_TYPES[type] || null;
}

function structureMaxLevel(type) {
  const cfg = getStructureConfig(type);
  return cfg ? cfg.max_level : null;
}

// ====== نمو الـ HP الأساسي مع المستوى - نفس فلسفة نمو الموارد/الوقت في
// castle.config (أساسي * نسبة نمو ^ (مستوى - 1)) ======
function structureMaxHp(type, level) {
  const cfg = getStructureConfig(type);
  if (!cfg) return 0;
  return Math.round(cfg.base_hp * cfg.hp_growth ** (level - 1));
}

function structureUpgradeCost(type, targetLevel) {
  const cfg = getStructureConfig(type);
  if (!cfg) return { gold: 0, wood: 0, stone: 0 };
  const growth = cfg.cost_growth ** (targetLevel - 1);
  return {
    gold: Math.round(cfg.base_cost.gold * growth),
    wood: Math.round(cfg.base_cost.wood * growth),
    stone: Math.round(cfg.base_cost.stone * growth),
  };
}

function structureUpgradeSeconds(type, targetLevel) {
  const cfg = getStructureConfig(type);
  if (!cfg) return 0;
  return Math.round(cfg.base_build_seconds * cfg.time_growth ** (targetLevel - 1));
}

// ====== إحصائيات القتال بتاعة القطعة الدفاعية - damage/range لسه
// Placeholder لمحرك القتال اللحظي (Combat Engine) بتاع الأبراج/الفخاخ
// النشطة. defense/defense_bonus_percent دلوقتي أرقام حقيقية بتتحسب من
// base_defense_power/base_defense_bonus_percent فوق (نفس فلسفة نمو الـ HP:
// أساسي * نسبة نمو ^ (مستوى - 1)) - دول اللي defensePowerCalculator بيقراهم
// فعليًا (كـ defense_power/defense_bonus_percent بعد النسخ في battle
// snapshot) عشان مباني الدفاع تبقى جزء حقيقي من قوة دفاع القلعة مع الجنود،
// مش مجرد أهداف hp. ======
function structureCombatStatsPlaceholder(type, level) {
  const cfg = getStructureConfig(type);
  if (!cfg) return { attack: 0, defense: 0, damage: 0, range: 0, defense_bonus_percent: 0 };

  const damageGrowth = (cfg.damage_growth ?? 1) ** (level - 1);
  const defenseGrowth = (cfg.defense_power_growth ?? 1) ** (level - 1);
  const defenseBonusGrowth = (cfg.defense_bonus_percent_growth ?? 1) ** (level - 1);

  return {
    attack: 0, // مفيش هجوم إحصائي منفصل عن damage للمباني الدفاعية لحد دلوقتي
    defense: Math.round((cfg.base_defense_power ?? 0) * defenseGrowth),
    damage: Math.round((cfg.base_damage ?? 0) * damageGrowth),
    range: cfg.base_range ?? 0,
    defense_bonus_percent: (cfg.base_defense_bonus_percent ?? 0) * defenseBonusGrowth,
  };
}

module.exports = {
  STRUCTURE_CATEGORY,
  DEFENSE_STRUCTURE_TYPES,
  REPAIR_STATES,
  BUILD_STATES,
  GARRISON_TARGET_TYPES,
  GARRISON_STATUSES,
  RESERVED_ARMY_CATEGORIES,
  DEFENSE_PLAN_RULE_TYPES,
  getStructureConfig,
  structureMaxLevel,
  structureMaxHp,
  structureUpgradeCost,
  structureUpgradeSeconds,
  structureCombatStatsPlaceholder,
};
