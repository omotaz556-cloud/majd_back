// ====== Repair Calculator ======
// Single responsibility: pure math for "how long does repairing this much
// missing HP take" and "what does it cost" - given whatever speed bonuses
// currently apply. No persistence, no mongoose, no queue mutation lives
// here (that's repairQueue.js) - mirrors hospital's recoveryCalculator.js
// split exactly.

'use strict';

const {
  BASE_REPAIR_SECONDS_PER_MISSING_HP,
  MIN_REPAIR_SECONDS,
  BASE_REPAIR_RESOURCE_COST_PER_MISSING_HP,
  MAX_REPAIR_SPEED_BONUS_PERCENT,
  REPAIR_SPEED_BONUS_KEY,
  REPAIR_SPEED_BONUS_PER_TOWN_HALL_LEVEL,
} = require('./repair.config');

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// ====== Tolerant bonus reader - identical shape/behaviour to
// battleResolution's bonusAggregator.sumPercentBonus and hospital's
// recoveryCalculator.sumPercentBonus: accepts an array of entries, a single
// flat object, or null/undefined, and never throws on malformed input.
// Reused here independently (not imported from either module - Repair
// stays fully decoupled per Phase 8's "keep the system independent"
// requirement) so a future Research/Hero/Alliance module can hand its
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

function missingHp(structure) {
  return Math.max(0, Math.round((Number(structure.max_hp) || 0) - (Number(structure.hp) || 0)));
}

/**
 * Aggregates every current + Future Ready repair-speed bonus source into
 * one clamped fraction (0.2 == repairing 20% faster). `hero`/`research`/
 * `allianceHelp` are optional and default to "no bonus" - none of those
 * systems exist in the codebase yet, so callers simply omit them today.
 * `townHallLevel` is the one bonus source already available (the castle
 * module already tracks it) - level 1 contributes 0 bonus.
 */
function aggregateRepairSpeedBonus({ townHallLevel = 1, hero, research, allianceHelp } = {}) {
  const castleLevelBonus =
    Math.max(0, (Number(townHallLevel) || 1) - 1) * REPAIR_SPEED_BONUS_PER_TOWN_HALL_LEVEL;
  const heroBonus = sumPercentBonus(hero, REPAIR_SPEED_BONUS_KEY);
  const researchBonus = sumPercentBonus(research, REPAIR_SPEED_BONUS_KEY);
  const allianceBonus = sumPercentBonus(allianceHelp, REPAIR_SPEED_BONUS_KEY);

  const totalPercent = clamp(
    castleLevelBonus + heroBonus + researchBonus + allianceBonus,
    0,
    MAX_REPAIR_SPEED_BONUS_PERCENT
  );

  return {
    castle_level_bonus_percent: castleLevelBonus,
    hero_bonus_percent: heroBonus,
    research_bonus_percent: researchBonus,
    alliance_help_bonus_percent: allianceBonus,
    total_percent: totalPercent,
  };
}

/**
 * Repair duration (seconds) for a given amount of missing HP, after
 * applying the aggregated speed bonus. Floored at MIN_REPAIR_SECONDS so a
 * barely-damaged structure can never resolve instantly.
 */
function computeRepairSeconds(missingHpAmount, bonuses) {
  const safeMissing = Math.max(0, Number(missingHpAmount) || 0);
  const baseSeconds = safeMissing * BASE_REPAIR_SECONDS_PER_MISSING_HP;
  const speedBonus = bonuses?.total_percent ?? 0;
  const adjusted = baseSeconds * (1 - speedBonus);
  return Math.max(MIN_REPAIR_SECONDS, Math.round(adjusted));
}

/**
 * Resource cost to repair a given amount of missing HP. Kept separate from
 * speed bonuses on purpose - a future "Research bonus" might cut repair
 * time without touching cost, or vice versa, so this never reads
 * total_percent.
 */
function computeRepairCost(missingHpAmount) {
  const safeMissing = Math.max(0, Number(missingHpAmount) || 0);
  return {
    gold: Math.round(BASE_REPAIR_RESOURCE_COST_PER_MISSING_HP.gold * safeMissing),
    wood: Math.round(BASE_REPAIR_RESOURCE_COST_PER_MISSING_HP.wood * safeMissing),
    stone: Math.round(BASE_REPAIR_RESOURCE_COST_PER_MISSING_HP.stone * safeMissing),
  };
}

module.exports = {
  missingHp,
  aggregateRepairSpeedBonus,
  computeRepairSeconds,
  computeRepairCost,
};
