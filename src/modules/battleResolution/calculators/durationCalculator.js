// ====== Duration Calculator ======
// Single responsibility: produce a presentational "battle duration" figure
// (seconds) from the two final power scores. This is not a real tick
// simulation (that already exists separately in modules/battle/engines) —
// it's a deterministic estimate purely for display purposes.

'use strict';

const { DURATION_MODEL } = require('../battleResolution.config');
const { sumSiegeSpeedBonus } = require('./bonusAggregator');

function calculateBattleDuration({ finalAttackScore, finalDefenseScore, attackerHeroes }) {
  const combinedPower = Math.max(finalAttackScore, 0) + Math.max(finalDefenseScore, 0);
  // log scale so huge armies don't produce absurdly long durations linearly
  const logPower = combinedPower > 1 ? Math.log10(combinedPower) : 0;

  const seconds = DURATION_MODEL.BASE_SECONDS + logPower * DURATION_MODEL.SCALE_SECONDS_PER_LOG_POWER;

  // Phase 5 — Hero Siege Speed bonus shortens the estimate, capped so a
  // stacked bonus can never collapse it to (near) zero.
  const siegeSpeedBonusPercent = Math.min(
    DURATION_MODEL.MAX_SIEGE_SPEED_DURATION_CUT_PERCENT,
    Math.max(0, sumSiegeSpeedBonus(attackerHeroes))
  );
  const adjustedSeconds = seconds * (1 - siegeSpeedBonusPercent);

  return Math.min(DURATION_MODEL.MAX_SECONDS, Math.round(adjustedSeconds));
}

module.exports = {
  calculateBattleDuration,
};
