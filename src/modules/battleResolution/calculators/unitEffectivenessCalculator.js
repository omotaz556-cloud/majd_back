// ====== Unit Effectiveness Calculator ======
// Single responsibility: given an attacking troop stack's type and the full
// list of defending troop stacks (or vice versa), return the counter
// multiplier that stack should apply. Pure functions only, no side effects,
// no knowledge of power totals, casualties, loot, or anything else.

'use strict';

const { TROOP_COUNTER_MATRIX, NEUTRAL_EFFECTIVENESS } = require('../battleResolution.config');

/**
 * Returns the counter multiplier for `attackerType` vs `defenderType`.
 * Unknown/missing types always fall back to a neutral 1.0 — this never
 * throws on partially-tagged data.
 */
function getEffectivenessMultiplier(attackerType, defenderType) {
  if (!attackerType || !defenderType) return NEUTRAL_EFFECTIVENESS;
  const row = TROOP_COUNTER_MATRIX[attackerType];
  if (!row) return NEUTRAL_EFFECTIVENESS;
  return row[defenderType] ?? NEUTRAL_EFFECTIVENESS;
}

/**
 * A troop stack faces a mixed enemy army, not a single type. This computes
 * a weighted-average multiplier across every opposing stack, weighted by
 * each opposing stack's troop count (a stack facing mostly infantry gets a
 * multiplier close to its infantry counter, etc).
 */
function getAverageEffectivenessAgainstArmy(attackerType, opposingTroops = []) {
  const validOpposing = (opposingTroops || []).filter((t) => Number(t?.count) > 0);
  const totalCount = validOpposing.reduce((sum, t) => sum + Number(t.count), 0);
  if (!attackerType || totalCount <= 0) return NEUTRAL_EFFECTIVENESS;

  const weightedSum = validOpposing.reduce((sum, t) => {
    const multiplier = getEffectivenessMultiplier(attackerType, t.type);
    return sum + multiplier * Number(t.count);
  }, 0);

  return weightedSum / totalCount;
}

module.exports = {
  getEffectivenessMultiplier,
  getAverageEffectivenessAgainstArmy,
};
