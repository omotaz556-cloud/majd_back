// ====== Casualty Calculator ======
// Single responsibility: given the battle outcome (winner + power ratio)
// and each side's troop stacks, compute casualties and remaining troops.
// Deterministic given its inputs — the only randomness in the whole engine
// already happened once, upstream, in battleCalculator's random modifier.

'use strict';

const { CASUALTY_MODEL, STRATEGY_TUNING } = require('../battleResolution.config');
const { sumHealthBonus } = require('./bonusAggregator');

/**
 * Clamp a fraction into [min, max].
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * The more lopsided the power ratio, the closer each side's loss percent
 * moves toward its model's max/min bound. `isWinnerSide` picks which bound
 * pair (winner vs loser) to interpolate between.
 */
function resolveLossPercent({ isWinnerSide, powerRatio }) {
  // lopsidedness in [0, 1): 0 = even fight, closer to 1 = total mismatch.
  const lopsidedness = clamp(Math.abs(Math.log(Math.max(powerRatio, 0.0001))) / 3, 0, 1);

  if (isWinnerSide) {
    const { WINNER_MIN_LOSS_PERCENT, WINNER_MAX_LOSS_PERCENT } = CASUALTY_MODEL;
    // A winner that won by a landslide loses fewer troops, not more.
    return WINNER_MAX_LOSS_PERCENT - lopsidedness * (WINNER_MAX_LOSS_PERCENT - WINNER_MIN_LOSS_PERCENT);
  }

  const { LOSER_MIN_LOSS_PERCENT, LOSER_MAX_LOSS_PERCENT } = CASUALTY_MODEL;
  return LOSER_MIN_LOSS_PERCENT + lopsidedness * (LOSER_MAX_LOSS_PERCENT - LOSER_MIN_LOSS_PERCENT);
}

/**
 * Computes casualties for one side's troop stacks.
 * @param {Array} troops - [{ key, type, count }]
 * @param {number} lossPercent - fraction of each stack's count that is lost
 */
function calculateSideCasualties(troops = [], lossPercent) {
  const safePercent = clamp(lossPercent, 0, 1);

  const stacks = (troops || [])
    .filter((t) => t && Number(t.count) > 0)
    .map((t) => {
      const count = Number(t.count);
      const lost = Math.round(count * safePercent);
      const remaining = Math.max(0, count - lost);
      return {
        key: t.key ?? null,
        type: t.type ?? null,
        starting_count: count,
        lost,
        remaining,
      };
    });

  const totals = stacks.reduce(
    (acc, s) => ({
      lost: acc.lost + s.lost,
      remaining: acc.remaining + s.remaining,
    }),
    { lost: 0, remaining: 0 }
  );

  return { loss_percent_applied: safePercent, stacks, totals };
}

/**
 * Research's Health bonus (hp_percent) mitigates a side's own loss percent —
 * capped so a large research stack can never make a side immune to losses.
 */
function applyHealthMitigation(lossPercent, research) {
  const healthBonusPercent = clamp(sumHealthBonus(research), 0, STRATEGY_TUNING.MAX_HP_LOSS_MITIGATION_PERCENT);
  return clamp(lossPercent * (1 - healthBonusPercent), 0, 1);
}

/**
 * Main entry point: computes casualties for both attacker and defender
 * given the battle outcome. `attackerResearch`/`defenderResearch` (Phase 5)
 * are optional — missing/malformed research defaults to 0 mitigation.
 *
 * @param {Array} [defenderReinforcements] - Phase 14: alliance reinforcement
 *   armies stationed in the defending city, same entries passed to
 *   defensePowerCalculator's `reinforcements`. The shared defender loss
 *   percent (same lopsidedness-driven fraction used for the defender's own
 *   troops) is applied independently to each reinforcement's stacks — the
 *   same approach already used by
 *   alliances/allianceReinforcement.service.js::applyBattleLossesToStationedTroops
 *   for the existing tick-based engine — rather than pooling every army's
 *   troops together first. Each reinforcement mitigates its own loss percent
 *   with its own `research` (if provided); it never inherits the defending
 *   city's research.
 */
function calculateCasualties({
  winner,
  powerRatio,
  attackerTroops,
  defenderTroops,
  attackerResearch,
  defenderResearch,
  defenderReinforcements,
}) {
  let attackerBaseLossPercent;
  let defenderBaseLossPercent;

  if (winner === 'draw') {
    attackerBaseLossPercent = CASUALTY_MODEL.DRAW_LOSS_PERCENT;
    defenderBaseLossPercent = CASUALTY_MODEL.DRAW_LOSS_PERCENT;
  } else {
    const attackerIsWinner = winner === 'attacker';
    attackerBaseLossPercent = resolveLossPercent({ isWinnerSide: attackerIsWinner, powerRatio });
    defenderBaseLossPercent = resolveLossPercent({ isWinnerSide: !attackerIsWinner, powerRatio });
  }

  const attackerLossPercent = applyHealthMitigation(attackerBaseLossPercent, attackerResearch);
  const defenderLossPercent = applyHealthMitigation(defenderBaseLossPercent, defenderResearch);

  const defenderOwn = calculateSideCasualties(defenderTroops, defenderLossPercent);

  const reinforcementParticipants = (Array.isArray(defenderReinforcements) ? defenderReinforcements : [])
    .filter((r) => r && Array.isArray(r.troops) && r.troops.length > 0)
    .map((r, idx) => {
      const reinforcementLossPercent = applyHealthMitigation(defenderBaseLossPercent, r.research);
      const result = calculateSideCasualties(r.troops, reinforcementLossPercent);
      return {
        id: r.id ?? `reinforcement_${idx + 1}`,
        label: r.label ?? null,
        is_reinforcement: true,
        ...result,
      };
    });

  // Combined view across the defending castle's own army plus every
  // reinforcement army, so existing consumers of casualties.defender.totals/
  // stacks keep seeing one aggregate picture (identical to Phase 1 output
  // when there are no reinforcements) — `.participants` is the new,
  // additive per-army breakdown for the Battle Report.
  const combinedStacks = [...defenderOwn.stacks, ...reinforcementParticipants.flatMap((r) => r.stacks)];
  const combinedTotals = [defenderOwn, ...reinforcementParticipants].reduce(
    (acc, side) => ({ lost: acc.lost + side.totals.lost, remaining: acc.remaining + side.totals.remaining }),
    { lost: 0, remaining: 0 }
  );

  return {
    attacker: calculateSideCasualties(attackerTroops, attackerLossPercent),
    defender: {
      loss_percent_applied: defenderLossPercent,
      stacks: combinedStacks,
      totals: combinedTotals,
      participants: [
        { id: 'defender', label: 'defender', is_reinforcement: false, ...defenderOwn },
        ...reinforcementParticipants,
      ],
    },
  };
}

module.exports = {
  calculateCasualties,
  calculateSideCasualties,
  resolveLossPercent,
};
