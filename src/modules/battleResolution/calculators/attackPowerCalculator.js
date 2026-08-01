// ====== Attack Power Calculator ======
// Single responsibility: turn the attacker's raw inputs (Troops, Heroes,
// Research, Buffs, Battle Plan) into a single Attack Power number, plus a
// full breakdown so ResultBuilder/EventGenerator can explain how it was
// reached. Never looks at the defender at all except for the troops list
// needed to compute unit-vs-unit effectiveness — no defense math lives here.

'use strict';

const { getAverageEffectivenessAgainstArmy } = require('./unitEffectivenessCalculator');
const { aggregateBonuses, sumTypedHeroBonus, sumLeadershipBonus } = require('./bonusAggregator');
const { getFormationFlatPercent, getFormationTypePercent } = require('./formationCalculator');
const { BATTLE_PLAN_OBJECTIVE_BONUS, BATTLE_PLAN_OBJECTIVE } = require('../battleResolution.config');

/**
 * @param {Array} troops - [{ key, type, count, stats: { attack, defense, hp } }]
 * @param {Array} defenderTroops - the defender's troop stacks, used only to
 *   compute unit-type effectiveness multipliers per attacking stack.
 * @param {string} formation - attacker's formation key (Phase 5)
 * @param {Array} heroes - attacker's heroes, for per-troop-type bonuses (Phase 5)
 */
function calculateBaseAttackPower(troops = [], defenderTroops = [], formation, heroes) {
  const perStack = (troops || [])
    .filter((t) => t && Number(t.count) > 0)
    .map((t) => {
      const rawAttack = Number(t.stats?.attack ?? 0) * Number(t.count);
      const effectiveness = getAverageEffectivenessAgainstArmy(t.type, defenderTroops);
      const formationTypeBonus = getFormationTypePercent(formation, t.type, 'attack_percent');
      const heroTypeBonus = sumTypedHeroBonus(heroes, t.type, 'attack_percent');
      const strategyMultiplier = 1 + formationTypeBonus + heroTypeBonus;
      return {
        key: t.key ?? null,
        type: t.type ?? null,
        count: Number(t.count),
        raw_attack: rawAttack,
        effectiveness_multiplier: effectiveness,
        formation_type_bonus_percent: formationTypeBonus,
        hero_type_bonus_percent: heroTypeBonus,
        effective_attack: rawAttack * effectiveness * strategyMultiplier,
      };
    });

  const basePower = perStack.reduce((sum, s) => sum + s.effective_attack, 0);
  return { basePower, perStack };
}

/**
 * Battle Plan bonus is intentionally simple: whatever `attack_percent` the
 * plan explicitly carries, plus the small default granted by its objective
 * (see BATTLE_PLAN_OBJECTIVE_BONUS) unless the plan overrides it.
 */
function calculateBattlePlanBonus(battlePlan) {
  const objective = battlePlan?.objective && BATTLE_PLAN_OBJECTIVE_BONUS[battlePlan.objective]
    ? battlePlan.objective
    : BATTLE_PLAN_OBJECTIVE.CUSTOM;

  const objectiveDefault = BATTLE_PLAN_OBJECTIVE_BONUS[objective].attack_percent ?? 0;
  const explicit = Number(battlePlan?.bonus_percent?.attack_percent);

  return Number.isFinite(explicit) ? explicit : objectiveDefault;
}

/**
 * Main entry point for this module: returns { value, breakdown }.
 */
function calculateAttackPower({ troops, heroes, research, buffs, battlePlan, defenderTroops, formation }) {
  const { basePower, perStack } = calculateBaseAttackPower(troops, defenderTroops, formation, heroes);
  const bonuses = aggregateBonuses({ heroes, research, buffs }, 'attack_percent');
  const battlePlanBonusPercent = calculateBattlePlanBonus(battlePlan);
  const formationBonusPercent = getFormationFlatPercent(formation, 'attack_percent');
  const leadershipBonusPercent = sumLeadershipBonus(heroes);

  const totalBonusPercent =
    bonuses.total_percent + battlePlanBonusPercent + formationBonusPercent + leadershipBonusPercent;
  const value = basePower * (1 + totalBonusPercent);

  return {
    value,
    breakdown: {
      base_power: basePower,
      per_stack: perStack,
      hero_bonus_percent: bonuses.hero_bonus_percent,
      research_bonus_percent: bonuses.research_bonus_percent,
      buff_bonus_percent: bonuses.buff_bonus_percent,
      battle_plan_bonus_percent: battlePlanBonusPercent,
      formation: formation ?? null,
      formation_bonus_percent: formationBonusPercent,
      leadership_bonus_percent: leadershipBonusPercent,
      total_bonus_percent: totalBonusPercent,
    },
  };
}

module.exports = {
  calculateAttackPower,
};
