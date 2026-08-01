const BattlePlan = require('./battlePlan.model');
const Formation = require('./formation.model');
const Castle = require('../castle/castle.model');
const CastleDefense = require('../defense/defense.model');
const castleService = require('../castle/castle.service');
const { nextSequence } = require('../common/counter.service');
const { TROOP_TYPES } = require('../castle/castle.config');
const {
  BATTLE_TARGET_TYPES,
  RETREAT_CONDITION_TYPES,
  RETREAT_ACTIONS,
  PROTECTION_RULE_TYPES,
  COMMANDER_PREFERENCE_MODES,
  COMMANDER_ROLE_PREFERENCES,
  BATTLE_PLAN_STATUS,
  BATTLE_PLAN_ID_PREFIX,
  BATTLE_PLAN_ID_COUNTER_NAME,
  BATTLE_PLAN_ID_OFFSET,
  MAX_BATTLE_PLANS_PER_CASTLE,
  MAX_TARGET_PRIORITIES_PER_PLAN,
  MAX_RETREAT_RULES_PER_PLAN,
  MAX_PROTECTION_RULES_PER_PLAN,
  MAX_METADATA_KEYS,
  FORMATION_LINES,
  MAX_SLOTS_PER_FORMATION_LINE,
  TARGET_PRIORITY_TYPES,
  STRATEGIC_RETREAT_RULE_TYPES,
  STRATEGIC_PROTECTION_RULE_TYPES,
  isValidTargetType,
  isValidRetreatConditionType,
  isValidRetreatAction,
  isValidProtectionRuleType,
  isValidCommanderPreferenceMode,
  isValidCommanderRolePreference,
  isValidPlanStatus,
  isValidFormationLine,
  isValidTargetPriorityType,
  isValidStrategicRetreatRuleType,
  isValidStrategicProtectionRuleType,
} = require('./army.config');

// ====== Battle Planner 2.0 - Backend Foundation ======
// الملف ده بس تخزين + تحقق (validation) لخطط استراتيجية. مفيش هنا أي:
//  - تقييم شرط أو نشر فعل (ده شغل Rule Engine - battle/engines/ruleEngine.js)
//  - محاكاة أو حسم قتال (Simulation/Combat Engine)
//  - أي import من battle/engines خالص
// الربط الفعلي مع الأنظمة دي هيتم في خطوة لاحقة تمامًا. ======

async function generatePlanId() {
  const seq = await nextSequence(BATTLE_PLAN_ID_COUNTER_NAME, BATTLE_PLAN_ID_OFFSET);
  return `${BATTLE_PLAN_ID_PREFIX}-${seq}`;
}

// =============================================================================
// تطبيع + تحقق حقول (Field-level normalize & validate) - كل دالة هنا بترمي
// Error واضح لو أي حقل مش صالح، عشان createPlan/updatePlan يرفضوا أي payload
// غلط فورًا (مطلب "Validate every field") قبل ما يوصل لقاعدة البيانات خالص.
// =============================================================================

function normalizePosition(position) {
  if (position === undefined || position === null) return null;
  const x = Number(position.x);
  const y = Number(position.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error('الموقع (position) لازم يحتوي على x و y رقميين');
  }
  return { x, y };
}

function normalizeTargetPriorities(list) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) {
    throw new Error('أولويات الأهداف (target_priorities) لازم تكون مصفوفة');
  }
  if (list.length > MAX_TARGET_PRIORITIES_PER_PLAN) {
    throw new Error(`تعديت الحد الأقصى لعدد أولويات الأهداف (${MAX_TARGET_PRIORITIES_PER_PLAN})`);
  }

  const seenPriorities = new Set();
  return list.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`عنصر أولوية الأهداف رقم ${index + 1} لازم يكون object`);
    }
    const priority = Number(item.priority);
    if (!Number.isFinite(priority) || priority < 1) {
      throw new Error(`عنصر أولوية الأهداف رقم ${index + 1}: priority لازم يكون رقم أكبر من أو يساوي 1`);
    }
    if (seenPriorities.has(priority)) {
      throw new Error(`فيه أكتر من هدف بنفس الأولوية (priority = ${priority})`);
    }
    seenPriorities.add(priority);

    if (!isValidTargetType(item.target_type)) {
      throw new Error(`نوع هدف غير معروف: ${item.target_type}`);
    }

    if (item.target_type === BATTLE_TARGET_TYPES.COORDINATES && !item.position) {
      throw new Error(`عنصر أولوية الأهداف رقم ${index + 1}: نوع الهدف "coordinates" محتاج position صالح`);
    }

    return {
      priority,
      target_type: item.target_type,
      target_castle_id: item.target_castle_id || null,
      target_ref_id: item.target_ref_id || null,
      position: normalizePosition(item.position),
      label: item.label || null,
      notes: item.notes || null,
    };
  });
}

function normalizeThreshold(conditionType, threshold) {
  if (threshold === undefined || threshold === null) return null;
  switch (conditionType) {
    case RETREAT_CONDITION_TYPES.CASUALTIES_ABOVE_PERCENT: {
      const value = Number(threshold);
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        throw new Error('قيمة "خسائر فوق نسبة مئوية" لازم تكون رقم بين 0 و 100');
      }
      return value;
    }
    case RETREAT_CONDITION_TYPES.MORALE_BELOW: {
      const value = Number(threshold);
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        throw new Error('قيمة "معنويات أقل من" لازم تكون رقم بين 0 و 100');
      }
      return value;
    }
    case RETREAT_CONDITION_TYPES.TIMER_REACHED: {
      const value = Number(threshold);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error('قيمة "بعد مدة زمنية" لازم تكون رقم موجب (بالثواني)');
      }
      return value;
    }
    default:
      // commander_dead / formation_destroyed / gate_destroyed / wall_destroyed
      // مالهاش قيمة عددية - أي threshold متبعوت بيتحفظ زي ما هو من غير فحص إضافي.
      return threshold;
  }
}

function normalizeRetreatRules(list) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) {
    throw new Error('قواعد الانسحاب (retreat_rules) لازم تكون مصفوفة');
  }
  if (list.length > MAX_RETREAT_RULES_PER_PLAN) {
    throw new Error(`تعديت الحد الأقصى لعدد قواعد الانسحاب (${MAX_RETREAT_RULES_PER_PLAN})`);
  }

  return list.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`قاعدة الانسحاب رقم ${index + 1} لازم تكون object`);
    }
    if (!isValidRetreatConditionType(item.condition_type)) {
      throw new Error(`نوع شرط انسحاب غير معروف: ${item.condition_type}`);
    }
    if (item.action !== undefined && item.action !== null && !isValidRetreatAction(item.action)) {
      throw new Error(`إجراء انسحاب غير معروف: ${item.action}`);
    }
    const priority = item.priority !== undefined ? Number(item.priority) : 0;
    if (!Number.isFinite(priority)) {
      throw new Error(`قاعدة الانسحاب رقم ${index + 1}: priority لازم يكون رقم`);
    }

    return {
      condition_type: item.condition_type,
      threshold: normalizeThreshold(item.condition_type, item.threshold),
      action: item.action || RETREAT_ACTIONS.FULL_RETREAT,
      priority,
      notes: item.notes || null,
    };
  });
}

function normalizeProtectionRules(list) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) {
    throw new Error('قواعد الحماية (protection_rules) لازم تكون مصفوفة');
  }
  if (list.length > MAX_PROTECTION_RULES_PER_PLAN) {
    throw new Error(`تعديت الحد الأقصى لعدد قواعد الحماية (${MAX_PROTECTION_RULES_PER_PLAN})`);
  }

  return list.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`قاعدة الحماية رقم ${index + 1} لازم تكون object`);
    }
    if (!isValidProtectionRuleType(item.rule_type)) {
      throw new Error(`نوع قاعدة حماية غير معروف: ${item.rule_type}`);
    }
    const priority = item.priority !== undefined ? Number(item.priority) : 0;
    if (!Number.isFinite(priority)) {
      throw new Error(`قاعدة الحماية رقم ${index + 1}: priority لازم يكون رقم`);
    }

    const needsRef = [
      PROTECTION_RULE_TYPES.DEFEND_GATE,
      PROTECTION_RULE_TYPES.DEFEND_WALL,
      PROTECTION_RULE_TYPES.DEFEND_TOWER,
      PROTECTION_RULE_TYPES.REINFORCE_WALL,
    ].includes(item.rule_type);
    if (needsRef && !item.target_ref_id) {
      throw new Error(`قاعدة الحماية رقم ${index + 1} (${item.rule_type}) محتاجة target_ref_id للعنصر المطلوب حمايته`);
    }

    return {
      rule_type: item.rule_type,
      target_castle_id: item.target_castle_id || null,
      target_ref_id: item.target_ref_id || null,
      priority,
      notes: item.notes || null,
    };
  });
}

function normalizeCommanderPreferences(input) {
  if (input === undefined || input === null) {
    return {
      preferred_commander_key: null,
      secondary_commander_key: null,
      role_preference: null,
      assignment_mode: COMMANDER_PREFERENCE_MODES.MANUAL,
      notes: null,
    };
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('تفضيلات القادة (commander_preferences) لازم تكون object');
  }
  if (
    input.role_preference !== undefined &&
    input.role_preference !== null &&
    !isValidCommanderRolePreference(input.role_preference)
  ) {
    throw new Error(`دور قائد مفضّل غير معروف: ${input.role_preference}`);
  }
  if (
    input.assignment_mode !== undefined &&
    input.assignment_mode !== null &&
    !isValidCommanderPreferenceMode(input.assignment_mode)
  ) {
    throw new Error(`وضع تعيين قادة غير معروف: ${input.assignment_mode}`);
  }

  return {
    preferred_commander_key: input.preferred_commander_key || null,
    secondary_commander_key: input.secondary_commander_key || null,
    role_preference: input.role_preference || null,
    assignment_mode: input.assignment_mode || COMMANDER_PREFERENCE_MODES.MANUAL,
    notes: input.notes || null,
  };
}

function normalizeMetadata(input) {
  if (input === undefined || input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('metadata لازم تكون object عادي (key-value)');
  }
  const keys = Object.keys(input);
  if (keys.length > MAX_METADATA_KEYS) {
    throw new Error(`تعديت الحد الأقصى لعدد مفاتيح metadata (${MAX_METADATA_KEYS})`);
  }
  return { ...input };
}

// =============================================================================
// نظام التشكيل التكتيكي للمعركة (Battle Formation System) - Front/Middle/Back
// Line. تخزين + تحقق بس (نفس فلسفة باقي أجزاء Battle Planner 2.0): مفيش هنا
// أي حساب قتالي ولا تنفيذ فعلي ولا أي import من battle/engines.
// =============================================================================

// ====== تحقق شكل خانة واحدة (line صالح، slot_index رقم صحيح >= 0 وجوه
// الحد الأقصى للخط، troop_key إما null "خانة فاضية مسموح بيها" أو مفتاح
// حقيقي موجود في TROOP_TYPES). بترجع نسخة نضيفة (normalized) من الخانة. ======
function normalizeFormationSlot(slot, index) {
  if (!slot || typeof slot !== 'object') {
    throw new Error(`خانة التشكيل رقم ${index + 1} لازم تكون object`);
  }

  if (!isValidFormationLine(slot.line)) {
    throw new Error(`خط تشكيل غير معروف في خانة رقم ${index + 1}: ${slot.line}`);
  }

  const slotIndex = slot.slot_index !== undefined ? Number(slot.slot_index) : 0;
  if (!Number.isInteger(slotIndex) || slotIndex < 0) {
    throw new Error(`خانة التشكيل رقم ${index + 1}: slot_index لازم يكون رقم صحيح >= 0`);
  }
  if (slotIndex >= MAX_SLOTS_PER_FORMATION_LINE) {
    throw new Error(
      `خانة التشكيل رقم ${index + 1}: slot_index تعدّى الحد الأقصى المسموح به لكل خط (${MAX_SLOTS_PER_FORMATION_LINE})`
    );
  }

  // ====== خانة فاضية مسموح بيها صراحة (troop_key: null/undefined) - مفيش
  // إلزام إن كل خانة مسجّلة تبقى معبّية بمجموعة قوات. ======
  let troopKey = slot.troop_key === undefined ? null : slot.troop_key;
  if (troopKey !== null) {
    if (typeof troopKey !== 'string' || !TROOP_TYPES[troopKey]) {
      throw new Error(`نوع قوات غير معروف في خانة التشكيل رقم ${index + 1}: ${troopKey}`);
    }
  }

  return { line: slot.line, slot_index: slotIndex, troop_key: troopKey };
}

// ====== مفيش خانتين بنفس المكان بالظبط (نفس الخط + نفس slot_index) ======
function assertNoDuplicateSlotPositions(slots) {
  const seen = new Set();
  for (const slot of slots) {
    const positionKey = `${slot.line}:${slot.slot_index}`;
    if (seen.has(positionKey)) {
      throw new Error(`فيه أكتر من خانة تشكيل بنفس المكان (${slot.line}, slot_index=${slot.slot_index})`);
    }
    seen.add(positionKey);
  }
}

// ====== مفيش مجموعة قوات (troop group) واحدة متكررة في أكتر من خانة -
// "no duplicated troop groups": نفس مجموعة القوات متقدرش تتحط في أكتر من
// مكان في نفس الوقت (سواء في نفس الخط أو خطوط مختلفة). خانات فاضية
// (troop_key: null) مستثناة من الفحص ده بطبيعتها. ======
function assertNoDuplicateTroopGroups(slots) {
  const seen = new Set();
  for (const slot of slots) {
    if (!slot.troop_key) continue;
    if (seen.has(slot.troop_key)) {
      throw new Error(`مجموعة القوات "${slot.troop_key}" اتكررت في أكتر من خانة تشكيل`);
    }
    seen.add(slot.troop_key);
  }
}

// ====== تطبيع + تحقق كامل مصفوفة التشكيل التكتيكي - بيرجع undefined لو
// القيمة الأصلية undefined (عشان الكولر (createPlan/updatePlan) يقرر هو
// الـ default المناسب)، وبيرمي Error واضح لأول مخالفة يلاقيها غير كده. ======
function normalizeBattleFormation(list) {
  if (list === undefined) return undefined;
  if (!Array.isArray(list)) {
    throw new Error('التشكيل التكتيكي للمعركة (battle_formation) لازم يكون مصفوفة');
  }

  const maxTotalSlots = MAX_SLOTS_PER_FORMATION_LINE * Object.keys(FORMATION_LINES).length;
  if (list.length > maxTotalSlots) {
    throw new Error(`تعديت الحد الأقصى الإجمالي لعدد خانات التشكيل (${maxTotalSlots})`);
  }

  const normalized = list.map((slot, index) => normalizeFormationSlot(slot, index));
  assertNoDuplicateSlotPositions(normalized);
  assertNoDuplicateTroopGroups(normalized);
  return normalized;
}

async function assertFormationOwnership(userId, castleId, formationId) {
  if (!formationId) return;
  const formation = await Formation.findOne({ _id: formationId, user_id: userId, castle_id: castleId });
  if (!formation) {
    throw new Error('التشكيلة (formation) المحددة مش موجودة أو مش ملكك');
  }
}

// =============================================================================
// الإعداد الاستراتيجي (Battle Strategy - Strategic Configuration) - أولوية
// استهداف + قواعد انسحاب + قواعد حماية + تفضيل قائد عام واحد. تخزين + تحقق
// بس (نفس فلسفة باقي أجزاء Battle Planner 2.0): مفيش هنا أي تقييم شرط ولا
// نشر فعل ولا أي تنفيذ فعلي، ومفيش أي import من battle/engines/ruleEngine.js.
// =============================================================================

// ====== أولوية الاستهداف - مصفوفة مرتّبة من TARGET_PRIORITY_TYPES (أول
// عنصر أعلى أولوية)، كل نوع مسموح يتحط مرة واحدة بس. ======
function normalizeTargetPriorityList(list) {
  if (!Array.isArray(list)) {
    throw new Error('أولوية الاستهداف (strategy_config.target_priority) لازم تكون مصفوفة');
  }
  const maxEntries = Object.keys(TARGET_PRIORITY_TYPES).length;
  if (list.length > maxEntries) {
    throw new Error(`تعديت الحد الأقصى لعدد أنواع أولوية الاستهداف (${maxEntries})`);
  }

  const seen = new Set();
  return list.map((item, index) => {
    if (!isValidTargetPriorityType(item)) {
      throw new Error(`نوع أولوية استهداف غير معروف في العنصر رقم ${index + 1}: ${item}`);
    }
    if (seen.has(item)) {
      throw new Error(`نوع أولوية استهداف "${item}" مكرر - كل نوع مسموح مرة واحدة بس (ترتيب المصفوفة هو الأولوية)`);
    }
    seen.add(item);
    return item;
  });
}

// ====== قواعد الانسحاب الاستراتيجية - hp_threshold/morale_threshold
// محتاجين threshold رقمي (0-100)، commander_death/never_retreat مالهمش
// threshold. never_retreat لو موجود لازم يكون القاعدة الوحيدة (override
// عام يلغي منطق أي قاعدة تانية). كل نوع مسموح يتحط مرة واحدة بس. ======
function normalizeStrategicRetreatRules(list) {
  if (!Array.isArray(list)) {
    throw new Error('قواعد الانسحاب الاستراتيجية (strategy_config.retreat_rules) لازم تكون مصفوفة');
  }
  const maxRules = Object.keys(STRATEGIC_RETREAT_RULE_TYPES).length;
  if (list.length > maxRules) {
    throw new Error(`تعديت الحد الأقصى لعدد قواعد الانسحاب الاستراتيجية (${maxRules})`);
  }

  const seenTypes = new Set();
  const normalized = list.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`قاعدة الانسحاب الاستراتيجية رقم ${index + 1} لازم تكون object`);
    }
    if (!isValidStrategicRetreatRuleType(item.rule_type)) {
      throw new Error(`نوع قاعدة انسحاب استراتيجية غير معروف: ${item.rule_type}`);
    }
    if (seenTypes.has(item.rule_type)) {
      throw new Error(`قاعدة الانسحاب "${item.rule_type}" مكررة - كل نوع مسموح مرة واحدة بس`);
    }
    seenTypes.add(item.rule_type);

    const needsThreshold = [
      STRATEGIC_RETREAT_RULE_TYPES.HP_THRESHOLD,
      STRATEGIC_RETREAT_RULE_TYPES.MORALE_THRESHOLD,
    ].includes(item.rule_type);

    let threshold = null;
    if (needsThreshold) {
      threshold = Number(item.threshold);
      if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
        throw new Error(`قاعدة الانسحاب "${item.rule_type}" محتاجة threshold رقمي بين 0 و 100`);
      }
    } else if (item.threshold !== undefined && item.threshold !== null) {
      throw new Error(`قاعدة الانسحاب "${item.rule_type}" مش محتاجة threshold`);
    }

    return { rule_type: item.rule_type, threshold };
  });

  if (seenTypes.has(STRATEGIC_RETREAT_RULE_TYPES.NEVER_RETREAT) && normalized.length > 1) {
    throw new Error('قاعدة "عدم الانسحاب أبدًا" (never_retreat) لازم تكون القاعدة الوحيدة لو موجودة');
  }

  return normalized;
}

// ====== قواعد الحماية الاستراتيجية - كل نوع (protect_commander/
// protect_siege/protect_ranged/protect_weakest) مسموح يتحط مرة واحدة بس،
// priority بترتب أولوية التنفيذ لو أكتر من قاعدة انطبقت في نفس اللحظة. ======
function normalizeStrategicProtectionRules(list) {
  if (!Array.isArray(list)) {
    throw new Error('قواعد الحماية الاستراتيجية (strategy_config.protection_rules) لازم تكون مصفوفة');
  }
  const maxRules = Object.keys(STRATEGIC_PROTECTION_RULE_TYPES).length;
  if (list.length > maxRules) {
    throw new Error(`تعديت الحد الأقصى لعدد قواعد الحماية الاستراتيجية (${maxRules})`);
  }

  const seenTypes = new Set();
  return list.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`قاعدة الحماية الاستراتيجية رقم ${index + 1} لازم تكون object`);
    }
    if (!isValidStrategicProtectionRuleType(item.rule_type)) {
      throw new Error(`نوع قاعدة حماية استراتيجية غير معروف: ${item.rule_type}`);
    }
    if (seenTypes.has(item.rule_type)) {
      throw new Error(`قاعدة الحماية "${item.rule_type}" مكررة - كل نوع مسموح مرة واحدة بس`);
    }
    seenTypes.add(item.rule_type);

    const priority = item.priority !== undefined ? Number(item.priority) : 0;
    if (!Number.isFinite(priority)) {
      throw new Error(`قاعدة الحماية "${item.rule_type}": priority لازم يكون رقم`);
    }

    return { rule_type: item.rule_type, priority };
  });
}

// ====== تفضيل القائد العام - بيعيد استخدام COMMANDER_ROLE_PREFERENCES/
// isValidCommanderRolePreference الموجودين بالفعل (نفس القيم بالظبط:
// offensive/defensive/support/balanced) - مفيش enum جديد مكرر. ======
function normalizeStrategicCommanderPreference(value) {
  if (value === undefined || value === null) return null;
  if (!isValidCommanderRolePreference(value)) {
    throw new Error(`تفضيل قائد غير معروف: ${value}`);
  }
  return value;
}

// ====== تطبيع + تحقق كامل الإعداد الاستراتيجي - بيرجع undefined لو القيمة
// الأصلية undefined (عشان createPlan/updatePlan يقرروا الـ default المناسب)،
// و null بيترجم لإعداد فاضي بالكامل (تصفير الإعداد الاستراتيجي). ======
function normalizeStrategyConfig(input) {
  if (input === undefined) return undefined;
  if (input === null) {
    return { target_priority: [], retreat_rules: [], protection_rules: [], commander_preference: null };
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('الإعداد الاستراتيجي (strategy_config) لازم يكون object');
  }

  return {
    target_priority: normalizeTargetPriorityList(input.target_priority ?? []),
    retreat_rules: normalizeStrategicRetreatRules(input.retreat_rules ?? []),
    protection_rules: normalizeStrategicProtectionRules(input.protection_rules ?? []),
    commander_preference: normalizeStrategicCommanderPreference(input.commander_preference),
  };
}

// =============================================================================
// CRUD
// =============================================================================

async function listPlans(userId) {
  const castle = await castleService.getOrCreateCastle(userId);
  return BattlePlan.find({ user_id: userId, castle_id: castle._id }).sort({ is_default: -1, created_at: -1 });
}

async function getPlanById(userId, planId) {
  const plan = await BattlePlan.findOne({ _id: planId, user_id: userId });
  if (!plan) {
    throw new Error('خطة المعركة دي مش موجودة');
  }
  return plan;
}

async function getDefaultPlan(userId) {
  const castle = await castleService.getOrCreateCastle(userId);
  return BattlePlan.findOne({ user_id: userId, castle_id: castle._id, is_default: true });
}

async function createPlan(userId, payload = {}) {
  const castle = await castleService.getOrCreateCastle(userId);

  const existingCount = await BattlePlan.countDocuments({ user_id: userId, castle_id: castle._id });
  if (existingCount >= MAX_BATTLE_PLANS_PER_CASTLE) {
    throw new Error(`تعديت الحد الأقصى لعدد خطط المعارك لكل قلعة (${MAX_BATTLE_PLANS_PER_CASTLE})`);
  }

  const name = String(payload.name || '').trim();
  if (!name) {
    throw new Error('اسم خطة المعركة مطلوب');
  }

  if (payload.status !== undefined && payload.status !== null && !isValidPlanStatus(payload.status)) {
    throw new Error(`حالة خطة غير معروفة: ${payload.status}`);
  }

  await assertFormationOwnership(userId, castle._id, payload.assigned_formation_id);

  const plan_id = await generatePlanId();

  const plan = await BattlePlan.create({
    user_id: userId,
    castle_id: castle._id,
    plan_id,
    name,
    status: payload.status || BATTLE_PLAN_STATUS.DRAFT,
    assigned_formation_id: payload.assigned_formation_id || null,
    target_priorities: normalizeTargetPriorities(payload.target_priorities),
    retreat_rules: normalizeRetreatRules(payload.retreat_rules),
    protection_rules: normalizeProtectionRules(payload.protection_rules),
    commander_preferences: normalizeCommanderPreferences(payload.commander_preferences),
    battle_formation: normalizeBattleFormation(payload.battle_formation) || [],
    strategy_config:
      normalizeStrategyConfig(payload.strategy_config) || {
        target_priority: [],
        retreat_rules: [],
        protection_rules: [],
        commander_preference: null,
      },
    metadata: normalizeMetadata(payload.metadata),
    notes: payload.notes ?? null,
  });

  // ====== أول خطة للقلعة تتحط تلقائيًا كافتراضية - عشان كل قلعة يكون ليها
  // دايمًا خطة افتراضية واحدة من غير ما اللاعب يحتاج يعمل set-default يدوي
  // أول مرة. أي خطة بعد كده لازم set-default صريح. ======
  if (existingCount === 0) {
    plan.is_default = true;
    await plan.save();
  }

  await runAndStoreValidation(plan);
  return plan;
}

async function updatePlan(userId, planId, payload = {}) {
  const plan = await getPlanById(userId, planId);

  if (payload.name !== undefined) {
    const name = String(payload.name).trim();
    if (!name) throw new Error('اسم خطة المعركة مطلوب');
    plan.name = name;
  }

  if (payload.status !== undefined) {
    if (!isValidPlanStatus(payload.status)) {
      throw new Error(`حالة خطة غير معروفة: ${payload.status}`);
    }
    plan.status = payload.status;
  }

  if (payload.assigned_formation_id !== undefined) {
    await assertFormationOwnership(userId, plan.castle_id, payload.assigned_formation_id);
    plan.assigned_formation_id = payload.assigned_formation_id || null;
  }

  if (payload.target_priorities !== undefined) {
    plan.target_priorities = normalizeTargetPriorities(payload.target_priorities);
  }

  if (payload.retreat_rules !== undefined) {
    plan.retreat_rules = normalizeRetreatRules(payload.retreat_rules);
  }

  if (payload.protection_rules !== undefined) {
    plan.protection_rules = normalizeProtectionRules(payload.protection_rules);
  }

  if (payload.commander_preferences !== undefined) {
    plan.commander_preferences = normalizeCommanderPreferences(payload.commander_preferences);
  }

  if (payload.battle_formation !== undefined) {
    plan.battle_formation = normalizeBattleFormation(payload.battle_formation);
  }

  if (payload.strategy_config !== undefined) {
    plan.strategy_config = normalizeStrategyConfig(payload.strategy_config);
  }

  if (payload.metadata !== undefined) {
    plan.metadata = normalizeMetadata(payload.metadata);
  }

  if (payload.notes !== undefined) {
    plan.notes = payload.notes;
  }

  await plan.save();
  await runAndStoreValidation(plan);
  return plan;
}

async function deletePlan(userId, planId) {
  const plan = await getPlanById(userId, planId);
  const wasDefault = plan.is_default;
  await BattlePlan.deleteOne({ _id: plan._id });

  // ====== لو الخطة المحذوفة كانت الافتراضية، حاول تعيين أقدم خطة متبقية
  // (لو فيه) كافتراضية جديدة تلقائيًا - عشان القلعة متفضلش من غير خطة
  // افتراضية طول ما فيه خطط تانية موجودة أصلًا. ======
  if (wasDefault) {
    const fallback = await BattlePlan.findOne({ user_id: userId, castle_id: plan.castle_id }).sort({ created_at: 1 });
    if (fallback) {
      fallback.is_default = true;
      await fallback.save();
    }
  }

  return { deleted: true, plan_id: plan.plan_id };
}

// ====== تعيين خطة معيّنة كافتراضية لنفس القلعة - بيلغي is_default عن أي
// خطة تانية لنفس (user_id, castle_id) الأول عشان يضمن واحدة بس صح في نفس
// الوقت (راجع متطلب "Support one default battle plan"). ======
async function setDefaultPlan(userId, planId) {
  const plan = await getPlanById(userId, planId);

  await BattlePlan.updateMany(
    { user_id: userId, castle_id: plan.castle_id, _id: { $ne: plan._id }, is_default: true },
    { $set: { is_default: false } }
  );

  plan.is_default = true;
  await plan.save();
  return plan;
}

// =============================================================================
// نظام التشكيل التكتيكي للمعركة (Battle Formation System) - APIs مخصّصة
// لإدارة battle_formation لوحده من غير ما تحتاج تبعت شكل الخطة كامل في كل
// مرة (زي updatePlan). كلها تخزين + تحقق بس - مفيش أي تنفيذ فعلي للتشكيل
// (execution) هنا خالص، ده شغل مستقبلي تمامًا مش جزء من الخطوة دي.
// =============================================================================

// ====== جيب التشكيل التكتيكي الحالي لخطة معيّنة ======
async function getFormation(userId, planId) {
  const plan = await getPlanById(userId, planId);
  return plan.battle_formation;
}

// ====== استبدال التشكيل التكتيكي بالكامل بمصفوفة خانات جديدة - نفس تحقق
// normalizeBattleFormation (خط صالح/نوع قوات صالح/مفيش تكرار). ======
async function setFormation(userId, planId, slots) {
  const plan = await getPlanById(userId, planId);
  plan.battle_formation = normalizeBattleFormation(slots) || [];
  await plan.save();
  return plan;
}

// ====== تعيين مجموعة قوات في خانة واحدة بعينها (أو تفريغها لو troop_key
// جه null) - بيدمج مع باقي التشكيل الحالي (مش استبدال كامل زي setFormation
// فوق) عشان الفرونت إند يقدر يعدّل خانة واحدة بس من غير ما يبعت التشكيل
// كامل في كل مرة. لو الخانة (نفس line + slot_index) موجودة بالفعل، بيتم
// استبدالها؛ غير كده بتتضاف كخانة جديدة. ======
async function assignTroopToSlot(userId, planId, { line, slot_index, troop_key } = {}) {
  const plan = await getPlanById(userId, planId);

  const currentSlots = plan.battle_formation.map((slot) => ({
    line: slot.line,
    slot_index: slot.slot_index,
    troop_key: slot.troop_key,
  }));

  const remainingSlots = currentSlots.filter(
    (slot) => !(slot.line === line && Number(slot.slot_index) === Number(slot_index))
  );
  remainingSlots.push({ line, slot_index, troop_key: troop_key === undefined ? null : troop_key });

  plan.battle_formation = normalizeBattleFormation(remainingSlots);
  await plan.save();
  return plan;
}

// ====== تفريغ خانة معيّنة (ترجعها فاضية) - اختصار لـ assignTroopToSlot
// بـ troop_key: null. ======
async function clearFormationSlot(userId, planId, { line, slot_index } = {}) {
  return assignTroopToSlot(userId, planId, { line, slot_index, troop_key: null });
}

// ====== قايمة خطوط التشكيل المدعومة - مفيدة للفرونت إند عشان يبني قايمة
// منسدلة (dropdown) من غير ما يكرر الـ enum يدوي. ======
function listFormationLines() {
  return Object.values(FORMATION_LINES);
}

// =============================================================================
// الإعداد الاستراتيجي (Battle Strategy - Strategic Configuration) - APIs
// مخصّصة لإدارة strategy_config لوحده من غير ما تحتاج تبعت شكل الخطة كامل في
// كل مرة (زي updatePlan). كلها تخزين + تحقق بس - مفيش أي تنفيذ فعلي أو تقييم
// شرط هنا خالص، ده شغل Rule Engine (مش من ضمن الخطوة دي خالص، ومفيش أي
// import منه هنا).
// =============================================================================

// ====== جيب الإعداد الاستراتيجي الحالي لخطة معيّنة ======
async function getStrategyConfig(userId, planId) {
  const plan = await getPlanById(userId, planId);
  return plan.strategy_config;
}

// ====== تحديث جزئي للإعداد الاستراتيجي - كل حقل (target_priority/
// retreat_rules/protection_rules/commander_preference) بيتحدّث بس لو
// اتبعت صراحة في الـ payload، والباقي بيفضل زي ما هو - عشان الفرونت إند
// يقدر يعدّل حقل واحد بس من غير ما يبعت الإعداد كامل في كل مرة. ======
async function updateStrategyConfig(userId, planId, payload = {}) {
  const plan = await getPlanById(userId, planId);

  if (payload.target_priority !== undefined) {
    plan.strategy_config.target_priority = normalizeTargetPriorityList(payload.target_priority);
  }
  if (payload.retreat_rules !== undefined) {
    plan.strategy_config.retreat_rules = normalizeStrategicRetreatRules(payload.retreat_rules);
  }
  if (payload.protection_rules !== undefined) {
    plan.strategy_config.protection_rules = normalizeStrategicProtectionRules(payload.protection_rules);
  }
  if (payload.commander_preference !== undefined) {
    plan.strategy_config.commander_preference = normalizeStrategicCommanderPreference(payload.commander_preference);
  }

  await plan.save();
  return plan;
}

// ====== استبدال الإعداد الاستراتيجي بالكامل - نفس تحقق
// normalizeStrategyConfig (كل حقل بيتفحص من الأول). ======
async function setStrategyConfig(userId, planId, payload) {
  const plan = await getPlanById(userId, planId);
  plan.strategy_config = normalizeStrategyConfig(payload) || {
    target_priority: [],
    retreat_rules: [],
    protection_rules: [],
    commander_preference: null,
  };
  await plan.save();
  return plan;
}

// ====== قوايم القيم الثابتة (Reference Data) الخاصة بالإعداد الاستراتيجي -
// مفيدة للفرونت إند عشان يبني قوايم منسدلة من غير ما يكرر الـ enums يدوي.
// تفضيلات القائد بترجع من listCommanderPreferenceOptions الموجودة بالفعل
// (بتعيد استخدام نفس COMMANDER_ROLE_PREFERENCES - مفيش تكرار). ======
function listTargetPriorityTypes() {
  return Object.values(TARGET_PRIORITY_TYPES);
}

function listStrategicRetreatRuleTypes() {
  return Object.values(STRATEGIC_RETREAT_RULE_TYPES);
}

function listStrategicProtectionRuleTypes() {
  return Object.values(STRATEGIC_PROTECTION_RULE_TYPES);
}

// =============================================================================
// التحقق (Validation) - فحص هيكلي/مرجعي بس، مفيش أي تقييم شرط أو تنفيذ فعلي.
// =============================================================================
async function validatePlan(userId, planId) {
  const plan = await getPlanById(userId, planId);
  return runAndStoreValidation(plan);
}

async function runAndStoreValidation(plan) {
  const errors = [];

  // ---- 1) التشكيلة المعيّنة (لو موجودة) لازم تكون حقيقية ومملوكة لنفس اللاعب/القلعة ----
  if (plan.assigned_formation_id) {
    const formation = await Formation.findOne({
      _id: plan.assigned_formation_id,
      user_id: plan.user_id,
      castle_id: plan.castle_id,
    });
    if (!formation) {
      errors.push('التشكيلة المعيّنة للخطة مش موجودة أو مش ملك نفس اللاعب/القلعة');
    }
  }

  // ---- 2) صحة مراجع أولويات الأهداف حسب target_type ----
  for (const target of plan.target_priorities) {
    // eslint-disable-next-line no-await-in-loop
    const err = await validateTargetReference(target, target.priority);
    if (err) errors.push(err);
  }

  // ---- 3) صحة مراجع قواعد الحماية اللي محتاجة target_ref_id فعلي ----
  for (const rule of plan.protection_rules) {
    if (!rule.target_ref_id) continue;
    // eslint-disable-next-line no-await-in-loop
    const err = await validateProtectionReference(rule);
    if (err) errors.push(err);
  }

  plan.last_validation = {
    is_valid: errors.length === 0,
    errors,
    checked_at: new Date(),
  };
  await plan.save();

  return { is_valid: errors.length === 0, errors };
}

async function validateTargetReference(target, label) {
  if (target.target_type === BATTLE_TARGET_TYPES.COORDINATES) {
    if (!target.position) {
      return `هدف الأولوية رقم ${label ?? '?'} من نوع إحداثيات لكن من غير موقع (position) صالح`;
    }
    return null;
  }

  if (target.target_type === BATTLE_TARGET_TYPES.TOWN_HALL) {
    if (!target.target_castle_id) {
      return `هدف الأولوية رقم ${label ?? '?'} بيستهدف مبنى رئيسي لكن من غير تحديد قلعة (target_castle_id)`;
    }
    const castle = await Castle.findById(target.target_castle_id, 'buildings');
    if (!castle) {
      return `هدف الأولوية رقم ${label ?? '?'} بيستهدف قلعة مش موجودة`;
    }
    const hasTownHall = castle.buildings.some((b) => b.key === 'town_hall');
    if (!hasTownHall) {
      return `هدف الأولوية رقم ${label ?? '?'} بيستهدف مبنى رئيسي مش موجود في القلعة المحددة`;
    }
    return null;
  }

  // gate / wall / tower / defensive_structure
  if (!target.target_castle_id || !target.target_ref_id) {
    return `هدف الأولوية رقم ${label ?? '?'} بيستهدف عنصر دفاعي من غير تحديد القلعة أو معرّف العنصر`;
  }
  const defense = await CastleDefense.findOne({ castle_id: target.target_castle_id }, 'structures');
  if (!defense) {
    return `هدف الأولوية رقم ${label ?? '?'} بيستهدف قلعة مالهاش نظام دفاع مسجّل لسه`;
  }
  const structure = defense.structures.id(target.target_ref_id);
  if (!structure) {
    return `هدف الأولوية رقم ${label ?? '?'} بيستهدف عنصر دفاعي مش موجود في القلعة المحددة`;
  }
  const expectedCategory =
    target.target_type === BATTLE_TARGET_TYPES.DEFENSIVE_STRUCTURE ? null : target.target_type;
  if (expectedCategory && structure.category !== expectedCategory) {
    return `هدف الأولوية رقم ${label ?? '?'}: نوع الهدف (${target.target_type}) مش متطابق مع فئة العنصر المستهدف فعليًا (${structure.category})`;
  }
  return null;
}

async function validateProtectionReference(rule) {
  if (!rule.target_castle_id) {
    return `قاعدة الحماية (${rule.rule_type}) محتاجة target_castle_id مع target_ref_id`;
  }
  const defense = await CastleDefense.findOne({ castle_id: rule.target_castle_id }, 'structures');
  if (!defense) {
    return `قاعدة الحماية (${rule.rule_type}) بتشاور على قلعة مالهاش نظام دفاع مسجّل لسه`;
  }
  const structure = defense.structures.id(rule.target_ref_id);
  if (!structure) {
    return `قاعدة الحماية (${rule.rule_type}) بتشاور على عنصر دفاعي مش موجود في القلعة المحددة`;
  }
  return null;
}

module.exports = {
  listPlans,
  getPlanById,
  getDefaultPlan,
  createPlan,
  updatePlan,
  deletePlan,
  setDefaultPlan,
  validatePlan,
  getFormation,
  setFormation,
  assignTroopToSlot,
  clearFormationSlot,
  listFormationLines,
  getStrategyConfig,
  updateStrategyConfig,
  setStrategyConfig,
  listTargetPriorityTypes,
  listStrategicRetreatRuleTypes,
  listStrategicProtectionRuleTypes,
};
