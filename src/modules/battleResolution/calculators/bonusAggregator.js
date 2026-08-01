// ====== Bonus Aggregator ======
// Single responsibility: normalize the free-form Heroes / Research / Buffs
// inputs (none of these have a real game system yet — same "generic
// placeholder" philosophy as commander_snapshot_schema in the existing
// battle module) into a flat percentage number for a given stat
// ('attack_percent' | 'defense_percent' | 'hp_percent'). Pure aggregation,
// no power-calculation logic lives here.

'use strict';

/**
 * Accepts either:
 *  - an array of entries, each optionally carrying a `bonuses` object
 *    (heroes: [{ bonuses: { attack_percent } }]) or the stat directly
 *    (buffs: [{ attack_percent }]), or
 *  - a single flat object with the stat directly (research: { attack_percent }),
 *  - null/undefined (treated as no bonus).
 * Always returns a plain sum as a fraction (0.1 == +10%), never throws on
 * malformed/missing data.
 */
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
 * Convenience: sums the same stat across heroes + research + buffs at once,
 * returning the individual breakdown as well as the combined total — the
 * breakdown is what Result Builder surfaces for transparency.
 */
function aggregateBonuses({ heroes, research, buffs }, statKey) {
  const heroBonus = sumPercentBonus(heroes, statKey);
  const researchBonus = sumPercentBonus(research, statKey);
  const buffBonus = sumPercentBonus(buffs, statKey);

  return {
    hero_bonus_percent: heroBonus,
    research_bonus_percent: researchBonus,
    buff_bonus_percent: buffBonus,
    total_percent: heroBonus + researchBonus + buffBonus,
  };
}

// ====== Phase 5 additions below — Heroes/Research now also carry
// recognized, troop-type-targeted or special-purpose stat keys (see
// HERO_BONUS_KEY / HERO_TYPED_BONUS_MAP / RESEARCH_BONUS_KEY in the config).
// These helpers stay just as tolerant of missing/malformed data as the
// Phase 1 helpers above — everything defaults to 0. ======

const { HERO_TYPED_BONUS_MAP, HERO_BONUS_KEY, RESEARCH_BONUS_KEY } = require('../battleResolution.config');

/**
 * Sums the hero bonus targeted at a specific troop type + stat (e.g.
 * infantry_attack_percent for troopType='infantry', statKey='attack_percent').
 * Returns 0 for type/stat combinations with no targeted hero bonus key.
 */
function sumTypedHeroBonus(heroes, troopType, statKey) {
  const heroKey = HERO_TYPED_BONUS_MAP[troopType]?.[statKey];
  if (!heroKey) return 0;
  return sumPercentBonus(heroes, heroKey);
}

/**
 * Leadership is the one flat, army-wide hero bonus (applies to every troop
 * type, on top of any type-targeted bonus) and is also what powers the
 * "Hero Inspired Troops" battle event.
 */
function sumLeadershipBonus(heroes) {
  return sumPercentBonus(heroes, HERO_BONUS_KEY.LEADERSHIP);
}

function sumSiegeSpeedBonus(heroes) {
  return sumPercentBonus(heroes, HERO_BONUS_KEY.SIEGE_SPEED);
}

function sumHealthBonus(research) {
  return sumPercentBonus(research, RESEARCH_BONUS_KEY.HEALTH);
}

function sumMarchCapacityBonus(research) {
  return sumPercentBonus(research, RESEARCH_BONUS_KEY.MARCH_CAPACITY);
}

function sumSiegeEfficiencyBonus(research) {
  return sumPercentBonus(research, RESEARCH_BONUS_KEY.SIEGE_EFFICIENCY);
}

module.exports = {
  sumPercentBonus,
  aggregateBonuses,
  sumTypedHeroBonus,
  sumLeadershipBonus,
  sumSiegeSpeedBonus,
  sumHealthBonus,
  sumMarchCapacityBonus,
  sumSiegeEfficiencyBonus,
};
