// ====== Battle Resolution Engine ======
// The single public entry point for Phase 1 — Battle Resolution Core.
// resolveBattle(attacker, defender) takes two full army descriptions and
// synchronously returns one complete battle result. This file only
// orchestrates calls to the independent modules below in the right order
// and passes data between them — it contains no calculation logic itself.
//
// Deliberately NOT wired into any route/controller/API in this step (see
// modules/battleResolution/README.md) — this is a standalone, importable
// module for a future integration step to call.

'use strict';

const { calculateBattle } = require('./battleCalculator');
const { calculateCasualties } = require('./calculators/casualtyCalculator');
const { calculateLoot } = require('./calculators/lootCalculator');
const { calculateStructureDamage } = require('./calculators/structureDamageCalculator');
const { calculateBattleDuration } = require('./calculators/durationCalculator');
const { generateBattleEvents } = require('./calculators/eventGenerator');
const { buildBattleResult } = require('./resultBuilder');

/**
 * @param {object} attacker
 * @param {Array} attacker.troops   - [{ key, type ('infantry'|'archer'|'cavalry'|'siege'), count, stats: { attack, defense, hp }, carry_capacity }]
 * @param {string} [attacker.formation] - Phase 5: 'balanced'|'frontline'|'defensive'|'aggressive'|'archer_focus'|'cavalry_charge'
 * @param {Array} [attacker.heroes]  - [{ bonuses: { attack_percent, defense_percent, infantry_attack_percent,
 *   cavalry_defense_percent, archer_damage_percent, siege_speed_percent, leadership_percent } }] (Phase 5 keys, all optional)
 * @param {Array|object} [attacker.research] - flat/array carrying attack_percent/defense_percent/hp_percent/
 *   march_capacity_percent/siege_efficiency_percent (Phase 5 keys, all optional)
 * @param {Array} [attacker.buffs]
 * @param {object} [attacker.battlePlan] - { objective, bonus_percent, notes }
 *
 * @param {object} defender
 * @param {Array} defender.troops   - same shape as attacker.troops
 * @param {string} [defender.formation] - Phase 5, same enum as attacker.formation
 * @param {Array} [defender.heroes] - same Phase 5 shape as attacker.heroes
 * @param {Array|object} [defender.research] - same Phase 5 shape as attacker.research
 * @param {Array} [defender.buffs]
 * @param {Array} [defender.buildings] - [{ key, hp, defense_power, defense_bonus_percent }]
 * @param {Array|object} [defender.wall] - single segment or array of segments, same shape as buildings
 * @param {Array} [defender.towers]     - same shape as buildings, plus `damage`
 * @param {object} [defender.resources] - { gold, wood, stone, ... } stored amounts
 * @param {Array} [defender.reinforcements] - Phase 14: alliance reinforcement
 *   armies stationed in the defending city, automatically included in
 *   defense power and casualties. Each entry: { id, label, troops (same
 *   shape as defender.troops), heroes, research, buffs, formation } — all
 *   optional except `troops`. Reinforcements never carry buildings/wall/
 *   towers (those belong to the castle) and are surfaced separately in the
 *   result so the Battle Report can show every participant on its own.
 *
 * @returns {object} complete battle result (see resultBuilder.buildBattleResult)
 */
function resolveBattle(attacker, defender) {
  if (!attacker || !defender) {
    throw new Error('Both attacker and defender inputs are required to resolve a battle');
  }

  // 1. Attack Power / Defense Power / Unit Effectiveness / Hero / Research /
  //    Building / Wall / Battle Plan bonuses + the shared ±3% random modifier
  //    + winner determination.
  const battle = calculateBattle(attacker, defender);

  // 2. Casualties + remaining troops for both sides. Research's Health bonus
  //    (Phase 5) mitigates each side's own losses.
  const casualties = calculateCasualties({
    winner: battle.winner,
    powerRatio: battle.power_ratio,
    attackerTroops: attacker.troops,
    defenderTroops: defender.troops,
    attackerResearch: attacker.research,
    defenderResearch: defender.research,
    defenderReinforcements: defender.reinforcements,
  });

  // 3. Loot — only the attacker ever loots, and only on a win. Research's
  //    March Capacity bonus (Phase 5) scales carry capacity.
  const loot = calculateLoot({
    winner: battle.winner,
    defenderResources: defender.resources,
    battlePlan: attacker.battlePlan,
    remainingAttackerTroops: casualties.attacker.stacks,
    attackerResearch: attacker.research,
  });

  // 4. Building/Wall/Tower damage. Siege troop presence + Research Siege
  //    Efficiency bonus (Phase 5) add extra damage.
  const structureDamage = calculateStructureDamage({
    winner: battle.winner,
    buildings: defender.buildings,
    wall: defender.wall,
    towers: defender.towers,
    attackerTroops: attacker.troops,
    attackerResearch: attacker.research,
  });

  // 5. Presentational battle duration estimate. Hero Siege Speed bonus
  //    (Phase 5) shortens it.
  const durationSeconds = calculateBattleDuration({
    finalAttackScore: battle.attack_power.final,
    finalDefenseScore: battle.defense_power.final,
    attackerHeroes: attacker.heroes,
  });

  // 6. Key battle events narrative, derived from everything above, including
  //    the new Phase 5 strategy events (troop counters, formations, heroes).
  const events = generateBattleEvents({
    winner: battle.winner,
    casualties,
    structureDamage,
    loot,
    powerRatio: battle.power_ratio,
    attackPerStack: battle.attack_power.breakdown.per_stack,
    defensePerStack: battle.defense_power.breakdown.per_stack,
    heroes: { attacker: attacker.heroes, defender: defender.heroes },
    defenderReinforcements: battle.defense_power.breakdown.reinforcements,
  });

  // 7. Assemble the final, consistently-shaped result.
  return buildBattleResult({ battle, casualties, loot, structureDamage, durationSeconds, events });
}

module.exports = {
  resolveBattle,
};
