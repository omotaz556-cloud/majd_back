// ====== Battle Plan → Rule Engine Compiler (Battle Planner 2.0 integration) ======
// الملف ده هو "الجسر" الوحيد بين خطة معركة (BattlePlan - battlePlan.model.js)
// واللي اللاعب بناها بالكامل عن طريق battlePlanner.service.js، وبين الـ Rule
// Engine الموجود بالفعل (battle/engines/ruleEngine.js). مسؤوليته الوحيدة:
// تحويل (compile) "نية" اللاعب المخزّنة في BattlePlan (تشكيلة + أولويات أهداف
// + قواعد انسحاب + قواعد حماية + إعداد استراتيجي) لمصفوفة "وصفات قواعد" جاهزة
// تتسجّل مباشرة عن طريق RuleEngine.registerRule() الموجودة بالفعل.
//
// ====== حدود المسؤولية (Requirements 1/5/6/8 - مهم جدًا) ======
// - الملف ده *مايعدّلش* ruleEngine.js ولا بيكرر منطقه: بيستورد بس المفردات
//   الجاهزة منه (CONDITION_TYPE / PLAN_ACTION_TYPE / LOGICAL_OPERATOR) ويبني
//   بيها بيانات (data) - مفيش أي evaluate أو registerRule بيحصل هنا في نفس
//   لحظة "compile"؛ التسجيل الفعلي بيحصل بعدين عن طريق registerBattlePlanRules
//   (تصدير مباشر لنفس registerRule العام، مش تنفيذ بديل).
// - مفيش هنا أي حساب ضرر ولا قرار قتالي: كل "قاعدة" هنا هي ترجمة مباشرة
//   لحقل موجود بالفعل في BattlePlan (validated بالفعل في battlePlanner.service.js)
//   - الملف ده منظّم كجداول تعيين (mapping tables) بدل if/else مكرر لكل قيمة،
//   عشان "كل خيار استراتيجي" (Requirement 3) يتحول لقاعدة من غير ما نحتاج
//   نضيف فرع كود جديد لكل قيمة enum جديدة تتضاف لاحقًا في army.config.js.
// - Battle Planner يفضل بس "منشئ قواعد" (Requirement 6): الملف ده مايعملش
//   أي subscribe على event bus ولا بيحتفظ بأي حالة معركة حية - بيرجع/يسجّل
//   قواعد وبس، والـ Rule Engine نفسه هو اللي هيقيّمها وينشرها كل تيك.
//
// ====== ليه بعض القواعد بتتفعّل من "أول تيك" (TIMER_REACHED { tick: 0 }) ======
// شوية خيارات استراتيجية (تشكيل المعركة، أولوية الاستهداف العامة، تفضيل
// القائد) مش "لو X حصل" - هي أوامر واقفة (standing orders) سارية طول
// المعركة من البداية. الـ Rule Engine الحالي مفيهوش نوع شرط "دايمًا صحيح"،
// فبنستخدم TIMER_REACHED{tick:0} (موجود بالفعل في CONDITION_TYPE) كطريقة
// جاهزة لنشر الأمر ده مرة واحدة من غير ما نحتاج نضيف شرط جديد لـ ruleEngine.js.
// عشان القاعدة دي متتكررش تتنشر كل تيك (TIMER_REACHED فضل صحيح للأبد بعد
// اللحظة دي)، بنديها cooldown كبير جدًا (STANDING_ORDER_COOLDOWN_TICKS) بدل
// من غير cooldown خالص.

'use strict';

const {
  CONDITION_TYPE,
  PLAN_ACTION_TYPE,
} = require('../battle/engines/ruleEngine');

const {
  RETREAT_CONDITION_TYPES,
  RETREAT_ACTIONS,
  PROTECTION_RULE_TYPES,
  STRATEGIC_RETREAT_RULE_TYPES,
  STRATEGIC_PROTECTION_RULE_TYPES,
  BATTLE_TARGET_TYPES,
} = require('./army.config');

// =============================================================================
// ثوابت الضبط (Tunables) - كل حاجة هنا رقم/سلوك قابل للتعديل من مكان واحد،
// مفيش أي رقم "سحري" متبعثر في نص الكود تحت.
// =============================================================================

// "أمر واقف" (standing order) بيتفعّل مرة واحدة بس فعليًا من أول تيك - رقم
// كبير جدًا يضمن إنه عمليًا مايتكررش تاني خلال عمر المعركة (مش Infinity عشان
// cooldown_ticks لازم يكون رقم Finite - راجع validateConditionNode في ruleEngine.js).
const STANDING_ORDER_COOLDOWN_TICKS = Number.MAX_SAFE_INTEGER;

// كولداون افتراضي للقواعد الديناميكية (انسحاب/حماية مبنية على شرط بيتغيّر
// أثناء المعركة زي خسائر/معنويات) - يمنع نفس القاعدة تتنفذ كل تيك بعد أول
// مرة تتحقق، من غير ما يمنعها تتنفذ تاني لو الوضع اتغيّر (رجعت المعنويات
// وقعت تاني مثلاً). قابل للتعديل من هنا بس.
const DEFAULT_DYNAMIC_RULE_COOLDOWN_TICKS = 20;

// معدل تحويل الثواني (وحدة threshold بتاعة "timer_reached" القديمة في
// retreat_rules) لمللي ثانية (وحدة simulation_time في الـ Rule Engine -
// راجع simulationEngine.js: simulation_time = current_tick * tickRateMs).
const SECONDS_TO_SIMULATION_TIME_MS = 1000;

// =============================================================================
// أدوات صغيرة عامة (Helpers) - بدون أي منطق قتالي، مجرد بناء/تنسيق بيانات.
// =============================================================================

// ====== تحويل "priority" بتاعة BattlePlan (رقم أصغر = أعلى أولوية - نفس
// الاتفاقية في كل الـ schemas: targetPrioritySchema/retreatRuleSchema/
// protectionRuleSchema/strategicProtectionRuleSchema) لـ "priority" بتاعة
// Rule Engine (رقم أكبر = يتقيّم الأول - راجع evaluateTick في ruleEngine.js:
// `.sort((a, b) => b.priority - a.priority)`). تحويل اتجاه الترتيب بس -
// مفيش أي قرار استراتيجي هنا. ======
function toEnginePriority(planPriority) {
  const value = Number(planPriority);
  return Number.isFinite(value) ? -value : 0;
}

function buildRuleId(owner, planId, category, discriminator) {
  return `${owner}:plan:${planId}:${category}:${discriminator}`;
}

function makeRule({ id, owner, name, priority, cooldown_ticks, condition, action }) {
  return {
    id,
    owner,
    name,
    priority: Number.isFinite(priority) ? priority : 0,
    cooldown_ticks: Number.isFinite(cooldown_ticks) ? cooldown_ticks : DEFAULT_DYNAMIC_RULE_COOLDOWN_TICKS,
    enabled: true,
    condition,
    action,
  };
}

function standingOrderCondition() {
  return { check: CONDITION_TYPE.TIMER_REACHED, params: { tick: 0 } };
}

// =============================================================================
// طبقة 1: قواعد الانسحاب القديمة (BattlePlan.retreat_rules - RETREAT_CONDITION_TYPES)
// نفس المفردات بالظبط الموجودة في CONDITION_TYPE (راجع تعليق RETREAT_CONDITION_TYPES
// في army.config.js: "نفس المفردات هنا بالظبط") - جدول تعيين مباشر (passthrough)
// بدون أي ترجمة معنى.
// =============================================================================
const RETREAT_CONDITION_TO_RULE_CONDITION = {
  [RETREAT_CONDITION_TYPES.CASUALTIES_ABOVE_PERCENT]: CONDITION_TYPE.CASUALTIES_ABOVE_PERCENT,
  [RETREAT_CONDITION_TYPES.MORALE_BELOW]: CONDITION_TYPE.MORALE_BELOW,
  [RETREAT_CONDITION_TYPES.COMMANDER_DEAD]: CONDITION_TYPE.COMMANDER_DEAD,
  [RETREAT_CONDITION_TYPES.FORMATION_DESTROYED]: CONDITION_TYPE.FORMATION_DESTROYED,
  [RETREAT_CONDITION_TYPES.GATE_DESTROYED]: CONDITION_TYPE.GATE_DESTROYED,
  [RETREAT_CONDITION_TYPES.WALL_DESTROYED]: CONDITION_TYPE.WALL_DESTROYED,
  [RETREAT_CONDITION_TYPES.TIMER_REACHED]: CONDITION_TYPE.TIMER_REACHED,
};

// ====== بنّائين "params" الشرط - جدول واحد لكل نوع شرط في CONDITION_TYPE
// (مش لكل نوع retreat)، عشان لو اتضاف نوع شرط جديد لـ ruleEngine.js يوم ما،
// يكفي نضيف سطر واحد هنا من غير ما نلمس أي منطق تاني. ======
function buildConditionParams(ruleConditionType, { item, owner, plan }) {
  switch (ruleConditionType) {
    case CONDITION_TYPE.CASUALTIES_ABOVE_PERCENT:
      return { owner, percent: Number(item.threshold) || 0 };
    case CONDITION_TYPE.MORALE_BELOW:
      return { owner, value: Number(item.threshold) || 0 };
    case CONDITION_TYPE.COMMANDER_DEAD:
      // مفيش نظام قادة حقيقي لسه (راجع formation.model.js) - معرّف عام لكل
      // طرف، نفس فلسفة fallback الموجودة بالفعل في CONDITION_EVALUATORS.commander_dead.
      return { commander_id: `${owner}:commander` };
    case CONDITION_TYPE.FORMATION_DESTROYED:
      return { formation_id: plan.assigned_formation_id ? String(plan.assigned_formation_id) : `${owner}:formation` };
    case CONDITION_TYPE.GATE_DESTROYED:
      return { gate_id: findMatchingTargetRef(plan, BATTLE_TARGET_TYPES.GATE) };
    case CONDITION_TYPE.WALL_DESTROYED:
      return { wall_id: findMatchingTargetRef(plan, BATTLE_TARGET_TYPES.WALL) };
    case CONDITION_TYPE.TIMER_REACHED:
      // threshold القديم بالثواني (راجع normalizeThreshold في battlePlanner.service.js) -
      // بيتحول لـ simulation_time بالمللي ثانية (وحدة الـ Rule Engine نفسها).
      return { simulation_time: (Number(item.threshold) || 0) * SECONDS_TO_SIMULATION_TIME_MS };
    default:
      return {};
  }
}

// ====== لو retreat rule من نوع gate_destroyed/wall_destroyed، بنستخدم أقرب
// هدف من نفس النوع مسجّل بالفعل في target_priorities بتاعة نفس الخطة (ربط
// بيانات موجودة فعلًا في نفس الخطة، مش اختراع id وهمي) - لو مفيش، بيرجع null
// والـ Rule Engine نفسه بيتعامل مع ده بأمان (الشرط يرجع false لحد ما تتضاف
// بيانات حقيقية - نفس فلسفة "أي حقل facts مش موجود = لسه ما تحققش"). ======
function findMatchingTargetRef(plan, targetType) {
  const match = (plan.target_priorities || []).find((t) => t.target_type === targetType && t.target_ref_id);
  return match ? match.target_ref_id : null;
}

const RETREAT_ACTION_TO_PLAN_ACTION = {
  [RETREAT_ACTIONS.FULL_RETREAT]: PLAN_ACTION_TYPE.RETREAT,
  [RETREAT_ACTIONS.PARTIAL_RETREAT]: PLAN_ACTION_TYPE.RETREAT,
  [RETREAT_ACTIONS.HOLD_POSITION]: PLAN_ACTION_TYPE.HOLD_POSITION,
};

function compileLegacyRetreatRules(plan, owner) {
  return (plan.retreat_rules || []).map((item, index) => {
    const ruleConditionType = RETREAT_CONDITION_TO_RULE_CONDITION[item.condition_type];
    const actionType = RETREAT_ACTION_TO_PLAN_ACTION[item.action] || PLAN_ACTION_TYPE.RETREAT;

    return makeRule({
      id: buildRuleId(owner, plan.plan_id, 'retreat', index),
      owner,
      name: `retreat_rule:${item.condition_type}`,
      priority: toEnginePriority(item.priority),
      condition: { check: ruleConditionType, params: buildConditionParams(ruleConditionType, { item, owner, plan }) },
      action: {
        type: actionType,
        target: null,
        payload: { source: 'retreat_rules', condition_type: item.condition_type, mode: item.action, notes: item.notes },
      },
    });
  });
}

// =============================================================================
// طبقة 2: قواعد الحماية القديمة (BattlePlan.protection_rules -
// PROTECTION_RULE_TYPES) - القيم هنا هي *بالظبط* نفس قيم PLAN_ACTION_TYPE
// (راجع تعليق PROTECTION_RULE_TYPES في army.config.js: "نفس مفردات
// PLAN_ACTION_TYPE الدفاعية في ruleEngine.js عشان يفضل الاتساق") - جدول
// تعيين مباشر (identity)، مفيش أي ترجمة معنى تحصل هنا.
// =============================================================================
const PROTECTION_RULE_TYPE_TO_PLAN_ACTION = Object.values(PROTECTION_RULE_TYPES).reduce((map, value) => {
  if (Object.values(PLAN_ACTION_TYPE).includes(value)) map[value] = value;
  return map;
}, {});

function compileLegacyProtectionRules(plan, owner) {
  return (plan.protection_rules || []).map((item, index) => {
    const actionType = PROTECTION_RULE_TYPE_TO_PLAN_ACTION[item.rule_type];
    if (!actionType) return null; // نوع مش معروف لـ Rule Engine - تجاهل آمن (اتفحص أصلًا وقت الحفظ)

    return makeRule({
      id: buildRuleId(owner, plan.plan_id, 'protection', index),
      owner,
      name: `protection_rule:${item.rule_type}`,
      priority: toEnginePriority(item.priority),
      cooldown_ticks: STANDING_ORDER_COOLDOWN_TICKS,
      // أمر واقف من بداية المعركة (راجع شرح TIMER_REACHED{tick:0} فوق) - قاعدة
      // الحماية دي "نية" اللاعب طول المعركة، مش رد فعل على حدث لحظي بعينه.
      condition: standingOrderCondition(),
      action: {
        type: actionType,
        target: item.target_ref_id || null,
        payload: { source: 'protection_rules', target_castle_id: item.target_castle_id, notes: item.notes },
      },
    });
  }).filter(Boolean);
}

// =============================================================================
// طبقة 3: أولويات الاستهداف القديمة (BattlePlan.target_priorities) - كل عنصر
// بيوصف هدف بذاته (target_ref_id/position) - بنحوّلها لأوامر هجوم واقفة.
// =============================================================================

// ====== نوع الهدف -> نوع فعل Rule Engine - جدول تعيين، مش فروع if/else.
// gate/wall عندهم فعل مخصّص جاهز في PLAN_ACTION_TYPE (attack_gate/attack_wall)؛
// أي نوع تاني (tower/defensive_structure/town_hall/coordinates) مفيش فعل هجوم
// مخصّص ليه في مفردات الـ Rule Engine الحالية، فبنستخدم move_formation العام
// (نفس فلسفة الـ Rule Engine: ينشر الفعل زي ما هو، والـ Combat Engine لاحقًا
// هو اللي هيقرر معناه بالظبط من الـ payload). ======
const TARGET_TYPE_TO_ATTACK_ACTION = {
  [BATTLE_TARGET_TYPES.GATE]: PLAN_ACTION_TYPE.ATTACK_GATE,
  [BATTLE_TARGET_TYPES.WALL]: PLAN_ACTION_TYPE.ATTACK_WALL,
};

function compileLegacyTargetPriorities(plan, owner) {
  return [...(plan.target_priorities || [])]
    .sort((a, b) => a.priority - b.priority)
    .map((item) => {
      const actionType = TARGET_TYPE_TO_ATTACK_ACTION[item.target_type] || PLAN_ACTION_TYPE.MOVE_FORMATION;
      const target = item.target_ref_id || item.target_castle_id || item.position || null;

      return makeRule({
        id: buildRuleId(owner, plan.plan_id, 'target-priority', item.priority),
        owner,
        name: `target_priority:${item.target_type}`,
        priority: toEnginePriority(item.priority),
        cooldown_ticks: STANDING_ORDER_COOLDOWN_TICKS,
        condition: standingOrderCondition(),
        action: {
          type: actionType,
          target,
          payload: {
            source: 'target_priorities',
            target_type: item.target_type,
            target_castle_id: item.target_castle_id,
            label: item.label,
            notes: item.notes,
          },
        },
      });
    });
}

// =============================================================================
// طبقة 4: الإعداد الاستراتيجي (BattlePlan.strategy_config) - نية عامة (مش
// مرتبطة بعنصر بذاته) - كل "خيار" هنا بيتحوّل لقاعدة واحدة (Requirement 3:
// "Every strategy option must become reusable rules").
// =============================================================================

// ====== أولوية الاستهداف العامة (strategy_config.target_priority) - مصفوفة
// مرتّبة واحدة تمثّل خيار استراتيجي واحد ("رتّب أهدافي كده") - بتتحوّل لقاعدة
// واحدة بتنشر الترتيب كامل كـ payload، مش قاعدة لكل قيمة على حدة (نفس فلسفة
// الحقل نفسه: ترتيب واحد، مش N خيارات مستقلة). ======
function compileStrategicTargetPriority(plan, owner) {
  const list = plan.strategy_config?.target_priority;
  if (!Array.isArray(list) || list.length === 0) return [];

  return [
    makeRule({
      id: buildRuleId(owner, plan.plan_id, 'strategy-target-priority', 'order'),
      owner,
      name: 'strategy_config.target_priority',
      cooldown_ticks: STANDING_ORDER_COOLDOWN_TICKS,
      condition: standingOrderCondition(),
      action: {
        type: PLAN_ACTION_TYPE.MOVE_FORMATION,
        target: null,
        payload: { source: 'strategy_config.target_priority', order: list },
      },
    }),
  ];
}

// ====== قواعد الانسحاب الاستراتيجية (strategy_config.retreat_rules -
// STRATEGIC_RETREAT_RULE_TYPES) - hp_threshold بيتحوّل لمكافئه المباشر في
// CONDITION_TYPE (casualties_above_percent = 100 - hp المتبقي)، morale_threshold
// بيتحوّل لـ morale_below مباشرة، commander_death لـ commander_dead. never_retreat
// مالوش تجسيد كـ "شرط" أصلًا (هو نفي عام) - فمش بيتحوّل لقاعدة (يعني عمليًا:
// مفيش قاعدة انسحاب اتسجّلت، وده بالظبط معنى "متتراجعش أبدًا"). ======
const STRATEGIC_RETREAT_COMPILERS = {
  [STRATEGIC_RETREAT_RULE_TYPES.HP_THRESHOLD]: (item, owner) => ({
    check: CONDITION_TYPE.CASUALTIES_ABOVE_PERCENT,
    params: { owner, percent: 100 - (Number(item.threshold) || 0) },
  }),
  [STRATEGIC_RETREAT_RULE_TYPES.MORALE_THRESHOLD]: (item, owner) => ({
    check: CONDITION_TYPE.MORALE_BELOW,
    params: { owner, value: Number(item.threshold) || 0 },
  }),
  [STRATEGIC_RETREAT_RULE_TYPES.COMMANDER_DEATH]: (item, owner) => ({
    check: CONDITION_TYPE.COMMANDER_DEAD,
    params: { commander_id: `${owner}:commander` },
  }),
  // NEVER_RETREAT: بقصد مسجّلة هنا من غير compiler - راجع الفلتر تحت.
};

function compileStrategicRetreatRules(plan, owner) {
  return (plan.strategy_config?.retreat_rules || [])
    .filter((item) => item.rule_type !== STRATEGIC_RETREAT_RULE_TYPES.NEVER_RETREAT)
    .map((item) => {
      const buildCondition = STRATEGIC_RETREAT_COMPILERS[item.rule_type];
      if (!buildCondition) return null;

      return makeRule({
        id: buildRuleId(owner, plan.plan_id, 'strategy-retreat', item.rule_type),
        owner,
        name: `strategy_config.retreat_rules:${item.rule_type}`,
        condition: buildCondition(item, owner),
        action: {
          type: PLAN_ACTION_TYPE.RETREAT,
          target: null,
          payload: { source: 'strategy_config.retreat_rules', rule_type: item.rule_type, mode: RETREAT_ACTIONS.FULL_RETREAT },
        },
      });
    })
    .filter(Boolean);
}

// ====== قواعد الحماية الاستراتيجية (strategy_config.protection_rules -
// STRATEGIC_PROTECTION_RULE_TYPES) - دي عن *نوع* وحدة (قائد/حصار/رماية/الأضعف)
// مش عنصر دفاعي بذاته، فمفيش فعل مخصّص ليها في PLAN_ACTION_TYPE - بتتحوّل
// لـ hold_position (أقرب فعل "وضعية دفاعية عامة" موجود بالفعل) مع تفاصيل
// النوع في الـ payload، نفس فلسفة الحماية القديمة (target=null هنا لأنها
// نية عامة عن نوع وحدة مش عنصر بمعرّف). ======
function compileStrategicProtectionRules(plan, owner) {
  return (plan.strategy_config?.protection_rules || []).map((item) => {
    if (!Object.values(STRATEGIC_PROTECTION_RULE_TYPES).includes(item.rule_type)) return null;

    return makeRule({
      id: buildRuleId(owner, plan.plan_id, 'strategy-protection', item.rule_type),
      owner,
      name: `strategy_config.protection_rules:${item.rule_type}`,
      priority: toEnginePriority(item.priority),
      cooldown_ticks: STANDING_ORDER_COOLDOWN_TICKS,
      condition: standingOrderCondition(),
      action: {
        type: PLAN_ACTION_TYPE.HOLD_POSITION,
        target: null,
        payload: { source: 'strategy_config.protection_rules', rule_type: item.rule_type },
      },
    });
  }).filter(Boolean);
}

// ====== تفضيل القائد العام (strategy_config.commander_preference) - قيمة
// واحدة حرة (offensive/defensive/support/balanced) - قاعدة واحدة بس تنشرها
// كـ payload (نفس فلسفة hold_position العامة فوق). ======
function compileStrategicCommanderPreference(plan, owner) {
  const value = plan.strategy_config?.commander_preference;
  if (!value) return [];

  return [
    makeRule({
      id: buildRuleId(owner, plan.plan_id, 'strategy-commander-preference', value),
      owner,
      name: 'strategy_config.commander_preference',
      cooldown_ticks: STANDING_ORDER_COOLDOWN_TICKS,
      condition: standingOrderCondition(),
      action: {
        type: PLAN_ACTION_TYPE.HOLD_POSITION,
        target: null,
        payload: { source: 'strategy_config.commander_preference', commander_preference: value },
      },
    }),
  ];
}

// =============================================================================
// طبقة 5: التشكيل التكتيكي للمعركة (BattlePlan.battle_formation - Front/
// Middle/Back Line) - أمر واقف واحد بيوصف توزيع كل مجموعات القوات دفعة واحدة
// (نفس فلسفة أولوية الاستهداف الاستراتيجية فوق: تشكيلة واحدة، مش N قواعد).
// =============================================================================
function compileBattleFormation(plan, owner) {
  const slots = plan.battle_formation;
  if (!Array.isArray(slots) || slots.length === 0) return [];

  return [
    makeRule({
      id: buildRuleId(owner, plan.plan_id, 'formation', 'layout'),
      owner,
      name: 'battle_formation',
      cooldown_ticks: STANDING_ORDER_COOLDOWN_TICKS,
      condition: standingOrderCondition(),
      action: {
        type: PLAN_ACTION_TYPE.MOVE_FORMATION,
        target: null,
        payload: { source: 'battle_formation', slots },
      },
    }),
  ];
}

// =============================================================================
// المُجمِّع الرئيسي (Public API) - Requirement 4: توليد تلقائي بالكامل: نداء
// واحد بياخد مستند BattlePlan (أو أي object بنفس الشكل) ويرجّع كل القواعد
// الجاهزة للتسجيل، من غير ما يحتاج الكولر يعرف حاجة عن شكل الحقول الداخلي.
// =============================================================================

/**
 * يحوّل خطة معركة (BattlePlan) كاملة لمصفوفة وصفات قواعد جاهزة لـ
 * RuleEngine.registerRule() - كل خيار استراتيجي مسجّل في الخطة (تشكيلة/
 * أولويات أهداف/قواعد انسحاب/قواعد حماية/إعداد استراتيجي) بيتحوّل لقاعدة أو
 * أكتر هنا. الدالة دي pure - مفيش أي side effect ولا استدعاء لـ Rule Engine
 * نفسه (التسجيل الفعلي مسؤولية registerBattlePlanRules تحت).
 *
 * @param {object} plan - مستند BattlePlan (أو plain object بنفس الحقول)
 * @param {{owner: 'attacker'|'defender'}} options - صاحب القواعد دي في نفس المعركة
 * @returns {object[]} مصفوفة قواعد بشكل RuleEngine.registerRule المتوقع
 */
function compileBattlePlanToRules(plan, { owner } = {}) {
  if (!plan || !plan.plan_id) {
    throw new Error('compileBattlePlanToRules: محتاج مستند BattlePlan صالح (لازم يكون فيه plan_id)');
  }
  if (owner !== 'attacker' && owner !== 'defender') {
    throw new Error('compileBattlePlanToRules: owner لازم يكون "attacker" أو "defender"');
  }

  return [
    ...compileLegacyRetreatRules(plan, owner),
    ...compileLegacyProtectionRules(plan, owner),
    ...compileLegacyTargetPriorities(plan, owner),
    ...compileStrategicTargetPriority(plan, owner),
    ...compileStrategicRetreatRules(plan, owner),
    ...compileStrategicProtectionRules(plan, owner),
    ...compileStrategicCommanderPreference(plan, owner),
    ...compileBattleFormation(plan, owner),
  ];
}

/**
 * يحوّل خطة معركة لقواعد (compileBattlePlanToRules) وبعدين يسجّلها مباشرة في
 * نسخة RuleEngine مبعوتة - "التنفيذ" هنا هو بالظبط استدعاء الـ API العام
 * الموجود بالفعل (registerRule)، مفيش أي منطق تقييم/نشر جديد بيتضاف هنا
 * (Requirement 5: Rule Engine يفضل هو طبقة التنفيذ الوحيدة). لو قاعدة واحدة
 * فشل تسجيلها (مثلاً id مكرر نادرًا)، بيتسجّل خطأ وباقي القواعد تكمل تتسجّل -
 * نفس فلسفة evaluateTick بتاعة الـ Rule Engine نفسه ("خطأ في قاعدة واحدة
 * مايوقفش الباقي").
 *
 * @param {import('../battle/engines/ruleEngine').RuleEngine} ruleEngine
 * @param {object} plan
 * @param {{owner: 'attacker'|'defender'}} options
 * @returns {string[]} الـ id بتاع كل قاعدة اتسجّلت بنجاح
 */
function registerBattlePlanRules(ruleEngine, plan, options) {
  const rules = compileBattlePlanToRules(plan, options);
  const registeredIds = [];

  for (const rule of rules) {
    try {
      ruleEngine.registerRule(rule);
      registeredIds.push(rule.id);
    } catch (err) {
      console.error(`[BattlePlanRuleCompiler] فشل تسجيل القاعدة "${rule.id}":`, err.message);
    }
  }

  return registeredIds;
}

module.exports = {
  compileBattlePlanToRules,
  registerBattlePlanRules,
};
