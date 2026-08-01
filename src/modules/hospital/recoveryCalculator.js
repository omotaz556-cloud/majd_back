// ====== Recovery Calculator ======
// Single responsibility: pure math for "how long does healing N troops
// take" and "what does it cost" - given whatever speed bonuses currently
// apply. No persistence, no mongoose, no queue mutation lives here (that's
// healingQueue.js) - mirrors the calculators/ split used by
// battleResolution (e.g. casualtyCalculator.js / bonusAggregator.js).

'use strict';

const {
  BASE_HEAL_SECONDS_PER_TROOP,
  MIN_BATCH_HEAL_SECONDS,
  BASE_HEAL_RESOURCE_COST_PER_TROOP,
  MAX_HEAL_SPEED_BONUS_PERCENT,
  HEAL_SPEED_BONUS_KEY,
  HEAL_SPEED_BONUS_PER_UPGRADE_LEVEL,
} = require('./hospital.config');

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// ====== Tolerant bonus reader - identical shape/behaviour to
// bonusAggregator.sumPercentBonus in battleResolution/calculators: accepts
// an array of entries, a single flat object, or null/undefined, and never
// throws on malformed input. Reused here (independently, not imported - the
// two modules stay decoupled per Phase 7's "do not modify Battle Engine"
// boundary) so that a future Hero/Research/Alliance module can hand its
// entries straight in without any change on either side. ======
function sumPercentBonus(source, statKey) {
  if (!source) return 0;

  const entries = Array.isArray(source) ? source : [source];

  return entries.reduce((total, entry) => {
    if (!entry || typeof entry !== 'object') return total;
    const direct = Number(entry[statKey]);
    const nested = Number(entry.bonuses?.[statKey]);
    const value = Number.isFinite(direct) ? direct : Number.isFinite(nested) ? nested : 0;
    return total + value;
  }, 0);
}

/**
 * Aggregates every current + Future Ready healing-speed bonus source into
 * one clamped fraction (0.2 == healing 20% faster). `hero`/`research`/
 * `alliance` are optional and default to "no bonus" - none of those systems
 * exist in the codebase yet, so callers simply omit them today.
 */
function aggregateHealSpeedBonus({ hospitalLevel = 0, hero, research, alliance } = {}) {
  const upgradeBonus = clamp(Number(hospitalLevel) || 0, 0, Infinity) * HEAL_SPEED_BONUS_PER_UPGRADE_LEVEL;
  const heroBonus = sumPercentBonus(hero, HEAL_SPEED_BONUS_KEY);
  const researchBonus = sumPercentBonus(research, HEAL_SPEED_BONUS_KEY);
  const allianceBonus = sumPercentBonus(alliance, HEAL_SPEED_BONUS_KEY);

  const totalPercent = clamp(
    upgradeBonus + heroBonus + researchBonus + allianceBonus,
    0,
    MAX_HEAL_SPEED_BONUS_PERCENT
  );

  return {
    upgrade_bonus_percent: upgradeBonus,
    hero_bonus_percent: heroBonus,
    research_bonus_percent: researchBonus,
    alliance_bonus_percent: allianceBonus,
    total_percent: totalPercent,
  };
}

/**
 * Healing duration (seconds) for a batch of `count` troops, after applying
 * the aggregated speed bonus. Floored at MIN_BATCH_HEAL_SECONDS so a
 * one-troop batch can never resolve instantly.
 */
function computeHealSeconds(count, bonuses) {
  const safeCount = Math.max(0, Number(count) || 0);
  const baseSeconds = safeCount * BASE_HEAL_SECONDS_PER_TROOP;
  const speedBonus = bonuses?.total_percent ?? 0;
  const adjusted = baseSeconds * (1 - speedBonus);
  return Math.max(MIN_BATCH_HEAL_SECONDS, Math.round(adjusted));
}

/**
 * Resource cost to heal a batch of `count` troops. Kept separate from speed
 * bonuses on purpose - a future "Research bonus" might cut healing time
 * without touching cost, or vice versa, so this never reads the same
 * total_percent used for duration.
 */
function computeResourceCost(count) {
  const safeCount = Math.max(0, Number(count) || 0);
  return {
    gold: Math.round(BASE_HEAL_RESOURCE_COST_PER_TROOP.gold * safeCount),
    wood: Math.round(BASE_HEAL_RESOURCE_COST_PER_TROOP.wood * safeCount),
    stone: Math.round(BASE_HEAL_RESOURCE_COST_PER_TROOP.stone * safeCount),
  };
}

module.exports = {
  aggregateHealSpeedBonus,
  computeHealSeconds,
  computeResourceCost,
};
