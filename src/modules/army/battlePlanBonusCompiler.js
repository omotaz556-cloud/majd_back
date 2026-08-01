// ====== Battle Plan → Combat Modifier Compiler ======
// الملف ده هو "الجسر" اللي بيخلي خطة المعركة (BattlePlan) تأثر فعليًا على
// *قوة* الجيش جوه Combat Engine الحقيقي، مش بس على سلوك الوحدات (استهداف/
// دفاع/انسحاب - ده شغل battlePlanRuleCompiler.js/rulePlanExecutor.js
// الموجودين بالفعل وده تأثيرهم فاضل زي ما هو، من غير أي تعديل).
//
// نفس فلسفة battlePlanRuleCompiler.js بالظبط: الملف ده *مايعدّلش*
// combatEngine.js/damageEngine.js ولا بيكرر منطقهم - بيستخدم نقطة التوسّع
// الجاهزة أصلاً فيهم (attacker.modifiers/ModifierStore.addModifier -
// موثّقة في damageEngine.js/modifierSystem.js كـ"نقطة تكامل لمهارات/
// تكنولوجيا مستقبلية"). كل رقم/نسبة هنا بييجي من battlePlanBonus.config.js
// (التوازن) - الملف ده منظّم كجداول تعيين + تجميع بونصات بس، مفيش أي رقم
// سحري متبعت هنا مباشرة.
//
// ====== حدود المسؤولية ======
// - مفيش هنا أي حساب ضرر ولا قرار قتالي - بس تحويل حقول BattlePlan
//   (المتحقق منها بالفعل في battlePlanner.service.js) لمودفيرز بالشكل
//   العام اللي ModifierStore متوقّعاه: { source, type, value }.
// - المودفيرز المُنتجة هنا "دائمة" لطول عمر المعركة (duration_ticks: null،
//   يعني مش بتنتهي لوحدها) - الخطة نية استراتيجية ثابتة من البداية،
//   مش buff مؤقت. لو حد عايز يشيلها وسط المعركة، removeModifiersBySource
//   الموجودة بالفعل في CombatEngine كافية (source بيحمل plan_id).
// - النسبة المئوية بتتحول هنا لقيمة *مطلقة* (raw attack/defense خاصة
//   بالوحدة دي بالذات ضرب النسبة) وقت التسجيل - مش نسبة عامة بتتخزن جوه
//   الوحدة نفسها، عشان ModifierStore.getAggregatedValue بترجع رقم واحد
//   نهائي (flat) بغض النظر عن مصدره (نفس فلسفة كل modifier تاني في اللعبة).

'use strict';

const {
  FORMATION_SLOT_ATTACK_BONUS_PERCENT,
  FORMATION_FILL_MAX_ATTACK_BONUS_PERCENT,
  FORMATION_LINE_BONUS_PERCENT,
  COMMANDER_ROLE_BONUS_PERCENT,
  STRATEGY_HAS_RETREAT_RULES_DEFENSE_PERCENT,
  STRATEGY_HAS_PROTECTION_RULES_DEFENSE_PERCENT,
  STRATEGY_NEVER_RETREAT_DEFENSE_PERCENT,
  MAX_TOTAL_BONUS_PERCENT,
} = require('./battlePlanBonus.config');
const { STRATEGIC_RETREAT_RULE_TYPES } = require('./army.config');
const { MODIFIER_TYPE } = require('../battle/engines/modifierSystem');

function clampPercent(value) {
  return Math.max(0, Math.min(MAX_TOTAL_BONUS_PERCENT, value));
}

// ====== بونص التشكيل التكتيكي - نسبة هجوم عامة (كل الجيش) حسب عدد الخانات
// المعبّاة فعليًا، بسقف MAX. لكل خانة معبّاة بيتضاف بونص خط الوحدة المحددة
// (defense_percent/attack_percent) - ده بونص *لكل مجموعة قوات بذاتها*
// (troop_key)، مش عام. ======
function computeFormationBonuses(battleFormation) {
  const slots = Array.isArray(battleFormation) ? battleFormation.filter((s) => s?.troop_key) : [];

  const overallAttackPercent = clampPercent(
    Math.min(slots.length * FORMATION_SLOT_ATTACK_BONUS_PERCENT, FORMATION_FILL_MAX_ATTACK_BONUS_PERCENT)
  );

  // troop_key -> { attack_percent, defense_percent } (تجميع لو نفس المجموعة
  // اتحطت في أكتر من خط - نظريًا ممنوع في battlePlanner.service.js
  // (assertNoDuplicateTroopGroups) لكن بنتعامل بأمان لو حصل تناقض بيانات).
  const perTroopKeyLineBonus = new Map();
  for (const slot of slots) {
    const lineBonus = FORMATION_LINE_BONUS_PERCENT[slot.line];
    if (!lineBonus) continue;
    const existing = perTroopKeyLineBonus.get(slot.troop_key) || { attack_percent: 0, defense_percent: 0 };
    perTroopKeyLineBonus.set(slot.troop_key, {
      attack_percent: existing.attack_percent + (lineBonus.attack_percent || 0),
      defense_percent: existing.defense_percent + (lineBonus.defense_percent || 0),
    });
  }

  return { overallAttackPercent, perTroopKeyLineBonus };
}

// ====== بونص تفضيل القائد - نسبة عامة واحدة (كل الجيش)، حسب
// commander_preferences.role_preference. ======
function computeCommanderBonus(commanderPreferences) {
  const role = commanderPreferences?.role_preference;
  const bonus = role && COMMANDER_ROLE_BONUS_PERCENT[role];
  if (!bonus) return { attack_percent: 0, defense_percent: 0 };
  return { attack_percent: bonus.attack_percent || 0, defense_percent: bonus.defense_percent || 0 };
}

// ====== بونص الإعداد الاستراتيجي - وجود قواعد مسجّلة (مش قيمتها) بيدّي
// بونص دفاع "تنظيم" بسيط + بونص إضافي لو never_retreat مسجّلة. ======
function computeStrategyBonus(strategyConfig) {
  let defensePercent = 0;
  const retreatRules = Array.isArray(strategyConfig?.retreat_rules) ? strategyConfig.retreat_rules : [];
  const protectionRules = Array.isArray(strategyConfig?.protection_rules) ? strategyConfig.protection_rules : [];

  if (retreatRules.length > 0) defensePercent += STRATEGY_HAS_RETREAT_RULES_DEFENSE_PERCENT;
  if (protectionRules.length > 0) defensePercent += STRATEGY_HAS_PROTECTION_RULES_DEFENSE_PERCENT;
  if (retreatRules.some((r) => r.rule_type === STRATEGIC_RETREAT_RULE_TYPES.NEVER_RETREAT)) {
    defensePercent += STRATEGY_NEVER_RETREAT_DEFENSE_PERCENT;
  }

  return { attack_percent: 0, defense_percent: defensePercent };
}

/**
 * بيبني مصفوفة "توصيف مودفير" (modifier specs) عامة لخطة معيّنة - نسب
 * مئوية مجمّعة بس، من غير أي معرفة بوحدة بعينها. buildUnitModifiers
 * (تحت) هي اللي بتحوّل النسب دي لقيمة raw خاصة بكل وحدة (attack/defense
 * الخاص بيها ضرب النسبة).
 *
 * @param {object} plan - مستند BattlePlan (أو null لو مفيش خطة افتراضية)
 * @returns {{ attack_percent: number, defense_percent_general: number,
 *   perTroopKeyLineBonus: Map }}
 */
function compilePlanBonusRates(plan) {
  if (!plan) {
    return { attack_percent: 0, defense_percent_general: 0, perTroopKeyLineBonus: new Map() };
  }

  const formation = computeFormationBonuses(plan.battle_formation);
  const commander = computeCommanderBonus(plan.commander_preferences);
  const strategy = computeStrategyBonus(plan.strategy_config);

  return {
    attack_percent: clampPercent(formation.overallAttackPercent + commander.attack_percent),
    defense_percent_general: clampPercent(commander.defense_percent + strategy.defense_percent),
    perTroopKeyLineBonus: formation.perTroopKeyLineBonus,
  };
}

/**
 * بيبني توصيفات المودفيرز الحقيقية الجاهزة تتسجّل عن طريق
 * CombatEngine.addModifier(unitId, modifier) لوحدة قتالية واحدة بعينها -
 * بيدمج البونص العام (كل الجيش) مع بونص خط التشكيل الخاص بمجموعة القوات
 * دي (troop_key) لو موجود.
 *
 * @param {object} plan - مستند BattlePlan (أو null)
 * @param {object} unit - نفس شكل الوحدة الجاهزة لـ registerCombatant
 *   (لازم فيها troop_key + stats.attack/defense)
 * @param {string} source - معرّف مصدر حر (plan_id) - نفس مفهوم `source` في
 *   ModifierStore.addModifier (يسمح لاحقًا بـ removeModifiersBySource لو
 *   الخطة اتغيّرت وسط معركة شغالة، أو للـ Battle Report يعرف مصدر البونص).
 * @returns {Array<{source:string, type:string, value:number}>}
 */
function buildUnitModifiers(plan, unit, source) {
  if (!plan || !unit) return [];

  const rates = compilePlanBonusRates(plan);
  const lineBonus = rates.perTroopKeyLineBonus.get(unit.troop_key) || { attack_percent: 0, defense_percent: 0 };

  const totalAttackPercent = clampPercent(rates.attack_percent + lineBonus.attack_percent);
  const totalDefensePercent = clampPercent(rates.defense_percent_general + lineBonus.defense_percent);

  const baseAttack = Number(unit.stats?.attack) || 0;
  const baseDefense = Number(unit.stats?.defense) || 0;

  const modifiers = [];
  if (totalAttackPercent > 0 && baseAttack > 0) {
    modifiers.push({ source, type: MODIFIER_TYPE.ATTACK_BONUS, value: baseAttack * totalAttackPercent });
  }
  if (totalDefensePercent > 0 && baseDefense > 0) {
    modifiers.push({ source, type: MODIFIER_TYPE.DEFENSE_BONUS, value: baseDefense * totalDefensePercent });
  }
  return modifiers;
}

module.exports = {
  compilePlanBonusRates,
  buildUnitModifiers,
};
