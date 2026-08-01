// ====== Battle Calculator ======
// Single responsibility: orchestrate Attack Power + Defense Power
// calculation, apply the shared ±3% random modifier, and determine the
// winner + final scores. Does not compute casualties, loot, structure
// damage, or events — those are separate modules' jobs.

'use strict';

const { calculateAttackPower } = require('./calculators/attackPowerCalculator');
const { calculateDefensePower } = require('./calculators/defensePowerCalculator');
const { RANDOM_MODIFIER_MAX } = require('./battleResolution.config');

/**
 * Returns a random multiplier in the inclusive range
 * [1 - RANDOM_MODIFIER_MAX, 1 + RANDOM_MODIFIER_MAX] (i.e. max ±3%).
 * Isolated in its own function so a future deterministic-seed requirement
 * only needs to change this one place.
 */
function rollRandomModifier() {
  const range = RANDOM_MODIFIER_MAX * 2;
  return 1 - RANDOM_MODIFIER_MAX + Math.random() * range;
}

/**
 * @param {object} attacker - { troops, heroes, research, buffs, battlePlan }
 * @param {object} defender - { troops, heroes, research, buffs, buildings, wall, towers, reinforcements }
 *   `reinforcements` (Phase 14) - alliance reinforcement armies stationed in
 *   the defending city; see defensePowerCalculator.calculateDefensePower.
 * @returns {object} full power comparison result
 */
function calculateBattle(attacker, defender) {
  const attackPower = calculateAttackPower({
    troops: attacker.troops,
    heroes: attacker.heroes,
    research: attacker.research,
    buffs: attacker.buffs,
    battlePlan: attacker.battlePlan,
    defenderTroops: defender.troops,
    formation: attacker.formation,
  });

  const defensePower = calculateDefensePower({
    troops: defender.troops,
    heroes: defender.heroes,
    research: defender.research,
    buffs: defender.buffs,
    buildings: defender.buildings,
    wall: defender.wall,
    towers: defender.towers,
    attackerTroops: attacker.troops,
    formation: defender.formation,
    reinforcements: defender.reinforcements,
  });

  const randomModifier = rollRandomModifier();
  const finalAttackScore = attackPower.value * randomModifier;
  const finalDefenseScore = defensePower.value;

  let winner = 'draw';
  if (finalAttackScore > finalDefenseScore) winner = 'attacker';
  else if (finalDefenseScore > finalAttackScore) winner = 'defender';

  // Power ratio drives casualty severity and structure damage downstream -
  // clamped away from 0 to avoid division-by-zero for an empty defense.
  const powerRatio = finalAttackScore / Math.max(finalDefenseScore, 1);

  return {
    winner,
    power_ratio: powerRatio,
    random_modifier: randomModifier,
    attack_power: {
      raw: attackPower.value,
      final: finalAttackScore,
      breakdown: attackPower.breakdown,
    },
    defense_power: {
      raw: defensePower.value,
      final: finalDefenseScore,
      breakdown: defensePower.breakdown,
    },
  };
}

module.exports = {
  calculateBattle,
  rollRandomModifier,
};
