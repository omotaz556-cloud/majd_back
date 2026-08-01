// ====== Structure Damage Calculator ======
// Single responsibility: given the battle outcome and the defender's
// buildings/wall, compute how much damage each structure takes. No troop
// casualties, loot, or power breakdowns are computed here.

'use strict';

const { STRUCTURE_DAMAGE_MODEL, STRATEGY_TUNING, TROOP_TYPE } = require('../battleResolution.config');
const { sumSiegeEfficiencyBonus } = require('./bonusAggregator');

function resolveDamagePercent(winner) {
  return winner === 'attacker'
    ? STRUCTURE_DAMAGE_MODEL.WIN_DAMAGE_PERCENT
    : STRUCTURE_DAMAGE_MODEL.LOSS_DAMAGE_PERCENT;
}

/**
 * Phase 5: fielding Siege troops adds extra structure damage, scaled by
 * their share of the attacking army's total count and boosted further by
 * any Research Siege Efficiency bonus — capped so it can never dominate the
 * base win/loss damage percent above.
 */
function resolveSiegePresenceBonusPercent(attackerTroops = [], attackerResearch) {
  const troops = (attackerTroops || []).filter((t) => Number(t?.count) > 0);
  const totalCount = troops.reduce((sum, t) => sum + Number(t.count), 0);
  if (totalCount <= 0) return 0;

  const siegeCount = troops
    .filter((t) => t.type === TROOP_TYPE.SIEGE)
    .reduce((sum, t) => sum + Number(t.count), 0);
  const siegeShare = siegeCount / totalCount;
  if (siegeShare <= 0) return 0;

  const siegeEfficiencyBonusPercent = Math.max(0, sumSiegeEfficiencyBonus(attackerResearch));
  const scaled = siegeShare * (1 + siegeEfficiencyBonusPercent);
  return Math.min(STRATEGY_TUNING.SIEGE_PRESENCE_MAX_DAMAGE_BONUS_PERCENT, scaled);
}

/**
 * Applies a damage percent to a list of structures that each carry an `hp`
 * field. Structures without a real numeric hp (fortification/building-HP
 * system not modeled yet for that item) are skipped rather than given a
 * made-up value — same "no invented hp" rule the existing battle module
 * follows.
 */
function damageStructureList(structures = [], damagePercent) {
  return (structures || [])
    .filter((s) => s && s.hp !== null && s.hp !== undefined && Number.isFinite(Number(s.hp)))
    .map((s) => {
      const hp = Number(s.hp);
      const damage = Math.round(hp * damagePercent);
      const remainingHp = Math.max(0, hp - damage);
      return {
        key: s.key ?? null,
        starting_hp: hp,
        damage,
        remaining_hp: remainingHp,
        destroyed: remainingHp <= 0,
      };
    });
}

/**
 * @param {string} winner - 'attacker' | 'defender' | 'draw'
 * @param {Array} buildings - defender's buildings
 * @param {Array|object} wall - defender's wall (single segment or array of segments)
 * @param {Array} towers - defender's towers (also structures that can take damage)
 */
function calculateStructureDamage({ winner, buildings, wall, towers, attackerTroops, attackerResearch }) {
  const baseDamagePercent = resolveDamagePercent(winner);
  const siegePresenceBonusPercent = resolveSiegePresenceBonusPercent(attackerTroops, attackerResearch);
  const damagePercent = baseDamagePercent + siegePresenceBonusPercent;
  const wallSegments = Array.isArray(wall) ? wall : wall ? [wall] : [];

  const buildingDamage = damageStructureList(buildings, damagePercent);
  const wallDamage = damageStructureList(wallSegments, damagePercent);
  const towerDamage = damageStructureList(towers, damagePercent);

  return {
    damage_percent_applied: damagePercent,
    siege_presence_bonus_percent: siegePresenceBonusPercent,
    buildings: buildingDamage,
    wall: wallDamage,
    towers: towerDamage,
    buildings_destroyed: buildingDamage.filter((b) => b.destroyed).length,
    wall_segments_breached: wallDamage.filter((w) => w.destroyed).length,
    towers_destroyed: towerDamage.filter((t) => t.destroyed).length,
    wall_segment_count: wallSegments.length,
  };
}

module.exports = {
  calculateStructureDamage,
};
