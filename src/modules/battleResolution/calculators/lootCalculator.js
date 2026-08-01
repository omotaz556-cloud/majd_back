// ====== Loot Calculator ======
// Single responsibility: given the battle outcome and the defender's stored
// resources, compute how much the attacker loots. No knowledge of
// casualties, structure damage, or power breakdowns beyond what it's handed.

'use strict';

const { LOOT_MODEL, BATTLE_PLAN_OBJECTIVE_BONUS, BATTLE_PLAN_OBJECTIVE } = require('../battleResolution.config');
const { sumMarchCapacityBonus } = require('./bonusAggregator');

/**
 * Attacker's total remaining carry capacity caps how much can physically be
 * hauled back, regardless of how much was exposed to looting. Research's
 * March Capacity bonus (Phase 5) scales this up permanently.
 */
function calculateCarryCapacity(remainingAttackerTroops = [], attackerResearch) {
  const baseCapacity = (remainingAttackerTroops || []).reduce(
    (sum, t) => sum + Number(t?.carry_capacity ?? 0) * Number(t?.remaining ?? t?.count ?? 0),
    0
  );
  const marchCapacityBonusPercent = Math.max(0, sumMarchCapacityBonus(attackerResearch));
  return baseCapacity * (1 + marchCapacityBonusPercent);
}

function resolveLootPercent(battlePlan) {
  const objective = battlePlan?.objective && BATTLE_PLAN_OBJECTIVE_BONUS[battlePlan.objective]
    ? battlePlan.objective
    : BATTLE_PLAN_OBJECTIVE.LOOT;

  const objectiveDefault = BATTLE_PLAN_OBJECTIVE_BONUS[objective].loot_percent ?? 0;
  const explicit = Number(battlePlan?.bonus_percent?.loot_percent);

  return Math.max(0, (Number.isFinite(explicit) ? explicit : 0) + LOOT_MODEL.BASE_LOOT_PERCENT + objectiveDefault);
}

/**
 * @param {string} winner - 'attacker' | 'defender' | 'draw'
 * @param {object} defenderResources - { gold, wood, stone, ... } stored amounts
 * @param {object} battlePlan - attacker's battle plan (affects loot %)
 * @param {Array} remainingAttackerTroops - post-casualty troop stacks with carry_capacity
 */
function calculateLoot({ winner, defenderResources, battlePlan, remainingAttackerTroops, attackerResearch }) {
  if (winner !== 'attacker') {
    return { looted: {}, total_value: 0, capped_by_carry_capacity: false };
  }

  const lootPercent = resolveLootPercent(battlePlan);
  const carryCapacity = calculateCarryCapacity(remainingAttackerTroops, attackerResearch);

  const resources = defenderResources && typeof defenderResources === 'object' ? defenderResources : {};
  const exposedByResource = {};
  let totalExposed = 0;

  Object.keys(resources).forEach((resourceKey) => {
    const stored = Math.max(LOOT_MODEL.DEFENDER_MIN_RESOURCE_FLOOR, Number(resources[resourceKey]) || 0);
    const exposed = stored * lootPercent;
    exposedByResource[resourceKey] = exposed;
    totalExposed += exposed;
  });

  const cappedByCarryCapacity = carryCapacity > 0 && totalExposed > carryCapacity;
  const scaleDown = cappedByCarryCapacity ? carryCapacity / totalExposed : 1;

  const looted = {};
  let totalValue = 0;
  Object.keys(exposedByResource).forEach((resourceKey) => {
    const amount = Math.floor(exposedByResource[resourceKey] * scaleDown);
    looted[resourceKey] = amount;
    totalValue += amount;
  });

  return {
    looted,
    total_value: totalValue,
    loot_percent_applied: lootPercent,
    carry_capacity: carryCapacity,
    capped_by_carry_capacity: cappedByCarryCapacity,
  };
}

module.exports = {
  calculateLoot,
  calculateCarryCapacity,
};
