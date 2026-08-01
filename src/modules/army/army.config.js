// ====== إعدادات نظام "إدارة الجيش ومخطط المعارك" (Army Management &
// Battle Planner) - نفس فلسفة castle.config.js/defense.config.js بالظبط:
// الملف ده بيحتوي بس على القيم الثابتة والـ enums اللي محتاجينها عشان
// نجهّز جيش المهاجم (تشكيلات + قادة) ونصمّم استراتيجية معركة (Battle Plan
// 2.0: تشكيلة + أولويات أهداف + قواعد انسحاب + قواعد حماية + تفضيلات قادة)
// - مفيش أي منطق قتال أو محاكاة أو ذكاء اصطناعي هنا خالص، ومفيش أي تشبيك مع
// Rule/Simulation/Combat Engine (الموجودين بالفعل في موديول battle) - ده كله
// هيتضاف لاحقًا فوق نفس الأساس ده من غير ما يحتاج تعديل في الشكل هنا. ======

// ====== أنواع التشكيلات (Formation Types) - دلوقتي بنخزّن بس النوع
// المختار من غير أي منطق فعلي بيفرق بينهم (بونصات/ترتيب وحدات...) - ده
// هيتحدد لما محرك القتال يتبنى فعليًا. 'custom' يعني اللاعب هيحدد شكل
// التشكيلة بنفسه لاحقًا (لسه مفيش محرر شكل تشكيلة حقيقي). ======
const FORMATION_TYPES = {
  BALANCED: 'balanced',
  OFFENSIVE: 'offensive',
  DEFENSIVE: 'defensive',
  ARCHER_FOCUS: 'archer_focus',
  CAVALRY_FOCUS: 'cavalry_focus',
  INFANTRY_FOCUS: 'infantry_focus',
  CUSTOM: 'custom',
};

// ====== أنواع المسير (March Types) - نظير direction في march.model لكن
// أعم: بيوصف "أسلوب" مسير التشكيلة نفسها (مش مجرد طالع/راجع) عشان محرك
// المعارك/المحاكاة يقدر يفرّق بين تشكيلة "طليعة" سريعة وتشكيلة "دعم" بطيئة
// جاية خلفها مثلاً. لسه مفيش منطق فعلي بيستخدمه. ======
const MARCH_TYPES = {
  NORMAL: 'normal',
  VANGUARD: 'vanguard',
  RALLY: 'rally',
  REINFORCEMENT: 'reinforcement',
  SCOUT: 'scout',
};

// ====== أنواع أهداف المعركة (Battle Target Types) - كل عنصر جوه أولويات
// الأهداف (target_priorities) بيستهدف حاجة واحدة من القايمة دي. 'coordinates'
// مختلفة عن الباقي: بتستهدف نقطة حرة على شبكة المدينة (مثلاً "انزل هنا") بدل
// عنصر دفاعي محدد بذاته. ======
const BATTLE_TARGET_TYPES = {
  GATE: 'gate',
  WALL: 'wall',
  TOWER: 'tower',
  DEFENSIVE_STRUCTURE: 'defensive_structure',
  TOWN_HALL: 'town_hall',
  COORDINATES: 'coordinates',
};

// ====== أنواع شروط قواعد الانسحاب (Retreat Rule Condition Types) - تخزين
// بس دلوقتي، مفيش أي تقييم أو تنفيذ آلي (ده شغل Rule Engine لاحقًا - راجع
// CONDITION_TYPE في battle/engines/ruleEngine.js، نفس المفردات هنا بالظبط
// عشان أي تكامل مستقبلي يكون مباشر من غير ترجمة أسماء). ======
const RETREAT_CONDITION_TYPES = {
  CASUALTIES_ABOVE_PERCENT: 'casualties_above_percent',
  MORALE_BELOW: 'morale_below',
  COMMANDER_DEAD: 'commander_dead',
  FORMATION_DESTROYED: 'formation_destroyed',
  GATE_DESTROYED: 'gate_destroyed',
  WALL_DESTROYED: 'wall_destroyed',
  TIMER_REACHED: 'timer_reached',
};

// ====== الإجراء المرتبط بقاعدة انسحاب - لسه مجرد تخزين "نية" اللاعب، مفيش
// تنفيذ آلي بيقرأه. ======
const RETREAT_ACTIONS = {
  FULL_RETREAT: 'full_retreat',
  PARTIAL_RETREAT: 'partial_retreat',
  HOLD_POSITION: 'hold_position',
};

// ====== أنواع قواعد الحماية (Protection Rule Types) - نفس فلسفة
// DEFENSE_PLAN_RULE_TYPES في defense.config.js، لكن هنا جوه سياق خطة هجوم/
// معركة (مثلاً "احمِ القائد الأساسي" أو "دافع عن البوابة اللي فتحناها").
// نفس مفردات PLAN_ACTION_TYPE الدفاعية في ruleEngine.js عشان يفضل الاتساق. ======
const PROTECTION_RULE_TYPES = {
  PROTECT_TOWN_HALL: 'protect_town_hall',
  DEFEND_GATE: 'defend_gate',
  DEFEND_WALL: 'defend_wall',
  DEFEND_TOWER: 'defend_tower',
  REINFORCE_WALL: 'reinforce_wall',
  ACTIVATE_RESERVE_ARMY: 'activate_reserve_army',
};

// ====== وضع تفضيل تعيين القادة - 'manual' يعني اللاعب هو اللي هيختار
// القائد بنفسه وقت التنفيذ، 'auto' يعني الخطة بتسجّل تفضيل بس (زي دور
// عسكري معيّن) ومحرك مستقبلي هو اللي هيختار القائد المناسب تلقائيًا -
// مفيش أي منطق auto فعلي حاليًا، بس تخزين النية. ======
const COMMANDER_PREFERENCE_MODES = {
  MANUAL: 'manual',
  AUTO: 'auto',
};

// ====== الدور العسكري المفضّل للقائد جوه الخطة دي - نظام القادة نفسه مش
// موجود في اللعبة لسه (زي ما هو موضّح في formation.model.js
// commanderAssignmentSchema)، فبنكتفي بتفضيل حر هنا كمان. ======
const COMMANDER_ROLE_PREFERENCES = {
  OFFENSIVE: 'offensive',
  DEFENSIVE: 'defensive',
  SUPPORT: 'support',
  BALANCED: 'balanced',
};

// ====== حالة خطة المعركة (Battle Plan Status) - دورة حياة بسيطة: مسودة
// بيعدّل فيها اللاعب، جاهزة (بعد ما اتحققت validatePlan بنجاح) تقدر
// تتربط بمسير هجوم حقيقي لاحقًا، أو متأرشفة (خطة قديمة محفوظة للرجوع
// ليها/نسخها بس مش هتتستخدم). ======
const BATTLE_PLAN_STATUS = {
  DRAFT: 'draft',
  READY: 'ready',
  ARCHIVED: 'archived',
};

// ====== نظام التشكيل التكتيكي للمعركة (Battle Formation System) - خطوط
// المعركة اللي مجموعات القوات (troop groups) بتتوزّع عليها وقت التخطيط
// (أمامية/وسطى/خلفية). مختلف عن FORMATION_TYPES فوق (ده وصف عام لتشكيلة
// الجيش/المسير، مفيش أي "خطوط" فيه) - هنا كل خانة (slot) بتربط مجموعة قوات
// واحدة (بمفتاحها - نفس مفاتيح TROOP_TYPES في castle.config.js) بخط معيّن
// ورقم خانة جواه. مفيش أي حساب قتالي أو تنفيذ هنا خالص - تخزين + تحقق بس
// (نفس فلسفة باقي أجزاء Battle Planner 2.0)، وأي خط جديد لو احتجناه لاحقًا
// بيتضاف هنا وبس من غير ما نحتاج نعدّل شكل الـ schema أو منطق التحقق. ======
const FORMATION_LINES = {
  FRONT_LINE: 'front_line',
  MIDDLE_LINE: 'middle_line',
  BACK_LINE: 'back_line',
};

// حد أقصى لعدد الخانات (slots) المسموح بيها في كل خط - رقم Placeholder
// مبدئي قابل للتعديل من هنا بس، غرضه يمنع نمو غير محدود لمصفوفة التشكيل.
const MAX_SLOTS_PER_FORMATION_LINE = 10;

function isValidFormationLine(value) {
  return Object.values(FORMATION_LINES).includes(value);
}

// ====== نظام الإعداد الاستراتيجي (Battle Strategy - Strategic
// Configuration) - طبقة استراتيجية مبسّطة ومباشرة تُخزَّن جوه نفس BattlePlan:
// أولوية استهداف + قواعد انسحاب + قواعد حماية + تفضيل قائد عام واحد. مختلف
// عن target_priorities/retreat_rules/protection_rules الأقدم فوق (دول
// بيشتغلوا على عناصر/إحداثيات فعلية جوه قلعة بعينها زي بوابة أو برج
// بمعرّفه) - الطبقة دي أبسط وأعم: بس "نية" استراتيجية عامة (زي "استهدف
// الأضعف الأول" أو "دافع عن قائدي") من غير أي ربط بعنصر معيّن. تخزين + تحقق
// بس - مفيش أي تقييم شرط أو تنفيذ فعلي هنا خالص، ومفيش أي import من
// battle/engines/ruleEngine.js في الملف ده أو أي ملف تاني جوه الموديول ده. ======

// ====== أولوية الاستهداف (Target Priority) - كل قيمة هنا معيار اختيار هدف
// عام (مش عنصر بذاته): إما بمعيار مسافة/قوة (nearest/weakest/strongest)،
// أو نوع وحدة (commander/archers/cavalry/infantry/siege)، أو نوع منشأة
// دفاعية (walls/gates/towers/buildings). الترتيب اللي اللاعب بيحطها بيه
// (array) هو نفسه ترتيب الأولوية - أول عنصر أعلى أولوية. ======
const TARGET_PRIORITY_TYPES = {
  NEAREST: 'nearest',
  WEAKEST: 'weakest',
  STRONGEST: 'strongest',
  COMMANDER: 'commander',
  ARCHERS: 'archers',
  CAVALRY: 'cavalry',
  INFANTRY: 'infantry',
  SIEGE: 'siege',
  WALLS: 'walls',
  GATES: 'gates',
  TOWERS: 'towers',
  BUILDINGS: 'buildings',
};

// ====== قواعد الانسحاب الاستراتيجية (Strategic Retreat Rules) - مجموعة
// مبسّطة ومختلفة عن RETREAT_CONDITION_TYPES الأقدم فوق. hp_threshold/
// morale_threshold محتاجين قيمة رقمية (نسبة مئوية 0-100)، commander_death
// شرط بلا قيمة، never_retreat علم عام (override) معناه "متتراجعش أبدًا" -
// لو موجود، المفروض يكون القاعدة الوحيدة (بيتفحص في battlePlanner.service). ======
const STRATEGIC_RETREAT_RULE_TYPES = {
  HP_THRESHOLD: 'hp_threshold',
  MORALE_THRESHOLD: 'morale_threshold',
  COMMANDER_DEATH: 'commander_death',
  NEVER_RETREAT: 'never_retreat',
};

// ====== قواعد الحماية الاستراتيجية (Strategic Protection Rules) - مجموعة
// مبسّطة ومختلفة عن PROTECTION_RULE_TYPES الأقدم فوق (دي عن حماية عناصر
// دفاعية بعينها - بوابة/سور/برج - مش أدوار قوات عامة). ======
const STRATEGIC_PROTECTION_RULE_TYPES = {
  PROTECT_COMMANDER: 'protect_commander',
  PROTECT_SIEGE: 'protect_siege',
  PROTECT_RANGED: 'protect_ranged',
  PROTECT_WEAKEST: 'protect_weakest',
};

function isValidTargetPriorityType(value) {
  return Object.values(TARGET_PRIORITY_TYPES).includes(value);
}

function isValidStrategicRetreatRuleType(value) {
  return Object.values(STRATEGIC_RETREAT_RULE_TYPES).includes(value);
}

function isValidStrategicProtectionRuleType(value) {
  return Object.values(STRATEGIC_PROTECTION_RULE_TYPES).includes(value);
}

// ====== معرّفات عرض فريدة (Display IDs) - نفس فلسفة battle_id في
// battle.config.js بالظبط: عداد تسلسلي atomic عن طريق common/counter.service
// عشان الشكل يبان واضح في الواجهة/اللوجات (زي FRM-100001 / PLN-100001). ======
const FORMATION_ID_PREFIX = 'FRM';
const FORMATION_ID_COUNTER_NAME = 'formation_id';
const FORMATION_ID_OFFSET = 100000;

const BATTLE_PLAN_ID_PREFIX = 'PLN';
const BATTLE_PLAN_ID_COUNTER_NAME = 'battle_plan_id';
const BATTLE_PLAN_ID_OFFSET = 100000;

// ====== حد أقصى لعدد التشكيلات لكل لاعب - رقم Placeholder مبدئي قابل
// للتعديل من هنا بس، غرضه يمنع نمو غير محدود لمستندات التشكيلات. ======
const MAX_FORMATIONS_PER_PLAYER = 20;

// ====== حدود قصوى لحجم خطة معركة واحدة - نفس فكرة الحد فوق، بتمنع نمو غير
// محدود لأي مصفوفة جوه الخطة (مفيش أي معنى استراتيجي وراء الأرقام دي، بس
// حماية بسيطة لحجم المستند). ======
const MAX_BATTLE_PLANS_PER_CASTLE = 20;
const MAX_TARGET_PRIORITIES_PER_PLAN = 15;
const MAX_RETREAT_RULES_PER_PLAN = 10;
const MAX_PROTECTION_RULES_PER_PLAN = 10;

// ====== حد أقصى لعدد مفاتيح metadata الحرة - metadata حاوية توسّع مستقبلية
// حرة الشكل (Mixed)، الحد ده بس دفاع بسيط ضد إساءة استخدامها كتخزين ضخم. ======
const MAX_METADATA_KEYS = 20;

function isValidFormationType(value) {
  return Object.values(FORMATION_TYPES).includes(value);
}

function isValidMarchType(value) {
  return Object.values(MARCH_TYPES).includes(value);
}

function isValidTargetType(value) {
  return Object.values(BATTLE_TARGET_TYPES).includes(value);
}

function isValidRetreatConditionType(value) {
  return Object.values(RETREAT_CONDITION_TYPES).includes(value);
}

function isValidRetreatAction(value) {
  return Object.values(RETREAT_ACTIONS).includes(value);
}

function isValidProtectionRuleType(value) {
  return Object.values(PROTECTION_RULE_TYPES).includes(value);
}

function isValidCommanderPreferenceMode(value) {
  return Object.values(COMMANDER_PREFERENCE_MODES).includes(value);
}

function isValidCommanderRolePreference(value) {
  return Object.values(COMMANDER_ROLE_PREFERENCES).includes(value);
}

function isValidPlanStatus(value) {
  return Object.values(BATTLE_PLAN_STATUS).includes(value);
}

module.exports = {
  FORMATION_TYPES,
  FORMATION_LINES,
  MAX_SLOTS_PER_FORMATION_LINE,
  isValidFormationLine,
  TARGET_PRIORITY_TYPES,
  STRATEGIC_RETREAT_RULE_TYPES,
  STRATEGIC_PROTECTION_RULE_TYPES,
  isValidTargetPriorityType,
  isValidStrategicRetreatRuleType,
  isValidStrategicProtectionRuleType,
  MARCH_TYPES,
  BATTLE_TARGET_TYPES,
  RETREAT_CONDITION_TYPES,
  RETREAT_ACTIONS,
  PROTECTION_RULE_TYPES,
  COMMANDER_PREFERENCE_MODES,
  COMMANDER_ROLE_PREFERENCES,
  BATTLE_PLAN_STATUS,
  FORMATION_ID_PREFIX,
  FORMATION_ID_COUNTER_NAME,
  FORMATION_ID_OFFSET,
  BATTLE_PLAN_ID_PREFIX,
  BATTLE_PLAN_ID_COUNTER_NAME,
  BATTLE_PLAN_ID_OFFSET,
  MAX_FORMATIONS_PER_PLAYER,
  MAX_BATTLE_PLANS_PER_CASTLE,
  MAX_TARGET_PRIORITIES_PER_PLAN,
  MAX_RETREAT_RULES_PER_PLAN,
  MAX_PROTECTION_RULES_PER_PLAN,
  MAX_METADATA_KEYS,
  isValidFormationType,
  isValidMarchType,
  isValidTargetType,
  isValidRetreatConditionType,
  isValidRetreatAction,
  isValidProtectionRuleType,
  isValidCommanderPreferenceMode,
  isValidCommanderRolePreference,
  isValidPlanStatus,
};
