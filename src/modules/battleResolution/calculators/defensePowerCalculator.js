// ====== Defense Power Calculator ======
// Single responsibility: turn the defender's raw inputs (Troops, Heroes,
// Research, Buffs, Buildings, Wall, Towers) into a single Defense Power
// number, plus a full breakdown. Never computes attacker-side numbers.

'use strict';

const { getAverageEffectivenessAgainstArmy } = require('./unitEffectivenessCalculator');
const { aggregateBonuses, sumTypedHeroBonus, sumLeadershipBonus } = require('./bonusAggregator');
const { getFormationFlatPercent, getFormationTypePercent } = require('./formationCalculator');

/**
 * @param {Array} troops - [{ key, type, count, stats: { attack, defense, hp } }]
 * @param {Array} attackerTroops - used only to compute unit-type
 *   effectiveness multipliers per defending stack (a counter works both ways).
 * @param {string} formation - defender's formation key (Phase 5)
 * @param {Array} heroes - defender's heroes, for per-troop-type bonuses (Phase 5)
 */
function calculateBaseDefensePower(troops = [], attackerTroops = [], formation, heroes) {
  const perStack = (troops || [])
    .filter((t) => t && Number(t.count) > 0)
    .map((t) => {
      const rawDefense = Number(t.stats?.defense ?? 0) * Number(t.count);
      const effectiveness = getAverageEffectivenessAgainstArmy(t.type, attackerTroops);
      const formationTypeBonus = getFormationTypePercent(formation, t.type, 'defense_percent');
      const heroTypeBonus = sumTypedHeroBonus(heroes, t.type, 'defense_percent');
      const strategyMultiplier = 1 + formationTypeBonus + heroTypeBonus;
      return {
        key: t.key ?? null,
        type: t.type ?? null,
        count: Number(t.count),
        raw_defense: rawDefense,
        effectiveness_multiplier: effectiveness,
        formation_type_bonus_percent: formationTypeBonus,
        hero_type_bonus_percent: heroTypeBonus,
        effective_defense: rawDefense * effectiveness * strategyMultiplier,
      };
    });

  const basePower = perStack.reduce((sum, s) => sum + s.effective_defense, 0);
  return { basePower, perStack };
}

/**
 * Buildings contribute a flat, small defense bonus per building — a real
 * fortification/building-HP system doesn't exist yet (same gap noted in the
 * existing modules/battle/README.md), so each building here optionally
 * carries its own `defense_bonus_percent`/`defense_power`; missing values
 * default to 0 rather than being invented.
 */
function calculateBuildingBonus(buildings = []) {
  const list = Array.isArray(buildings) ? buildings : [];
  const flatPower = list.reduce((sum, b) => sum + Number(b?.defense_power ?? 0), 0);
  const percent = list.reduce((sum, b) => sum + Number(b?.defense_bonus_percent ?? 0), 0);
  return { flatPower, percent, count: list.length };
}

/**
 * Wall can be provided as a single object or an array of wall segments —
 * normalized here. Contributes both a flat power value and a percent bonus
 * applied to the rest of the defense power. Real defense structures (Phase
 * 14.x City Defense integration) now carry their own tuned `defense_power`
 * (see defense.config.js base_defense_power) and are used as-is; only the
 * legacy fallback (a segment with no real defense_power yet, i.e. hp used as
 * a rough stand-in) gets the 0.1 dampener, since raw hp is a much bigger
 * number than a real tuned defense_power and would otherwise dominate.
 */
function calculateWallBonus(wall) {
  const segments = Array.isArray(wall) ? wall : wall ? [wall] : [];
  const flatPower = segments.reduce((sum, w) => {
    if (w && Number.isFinite(Number(w.defense_power))) return sum + Number(w.defense_power);
    return sum + Number(w?.hp ?? 0) * 0.1;
  }, 0);
  const percent = segments.reduce((sum, w) => sum + Number(w?.defense_bonus_percent ?? 0), 0);
  return { flatPower, percent, segment_count: segments.length };
}

/**
 * Towers add both a flat defense power contribution (their own combat
 * stats) and count toward building damage/casualty context downstream —
 * this module only computes the defense-power side of that.
 */
function calculateTowerBonus(towers = []) {
  const list = Array.isArray(towers) ? towers : [];
  const flatPower = list.reduce((sum, t) => sum + Number(t?.damage ?? 0) + Number(t?.defense_power ?? 0), 0);
  const percent = list.reduce((sum, t) => sum + Number(t?.defense_bonus_percent ?? 0), 0);
  return { flatPower, percent, count: list.length };
}

// ====== Phase 14 — Alliance Defense ======
// Renamed-but-unmodified Phase 1/5 body, extracted so it can be reused both
// for the defending city's own army (with its structures) and for each
// alliance reinforcement army stationed in that city (no structures of its
// own — buildings/wall/towers belong to the castle, not the reinforcement).
function calculateSingleDefensePower({ troops, heroes, research, buffs, buildings, wall, towers, attackerTroops, formation }) {
  const { basePower, perStack } = calculateBaseDefensePower(troops, attackerTroops, formation, heroes);
  const bonuses = aggregateBonuses({ heroes, research, buffs }, 'defense_percent');

  const buildingBonus = calculateBuildingBonus(buildings);
  const wallBonus = calculateWallBonus(wall);
  const towerBonus = calculateTowerBonus(towers);

  const flatStructureBonus = buildingBonus.flatPower + wallBonus.flatPower + towerBonus.flatPower;
  const structurePercent = buildingBonus.percent + wallBonus.percent + towerBonus.percent;

  const formationBonusPercent = getFormationFlatPercent(formation, 'defense_percent');
  const leadershipBonusPercent = sumLeadershipBonus(heroes);

  const totalBonusPercent =
    bonuses.total_percent + structurePercent + formationBonusPercent + leadershipBonusPercent;
  const value = (basePower + flatStructureBonus) * (1 + totalBonusPercent);

  return {
    value,
    breakdown: {
      base_power: basePower,
      per_stack: perStack,
      hero_bonus_percent: bonuses.hero_bonus_percent,
      research_bonus_percent: bonuses.research_bonus_percent,
      buff_bonus_percent: bonuses.buff_bonus_percent,
      building_bonus: buildingBonus,
      wall_bonus: wallBonus,
      tower_bonus: towerBonus,
      formation: formation ?? null,
      formation_bonus_percent: formationBonusPercent,
      leadership_bonus_percent: leadershipBonusPercent,
      total_bonus_percent: totalBonusPercent,
    },
  };
}

/**
 * @param {Array} [reinforcements] - Phase 14: alliance reinforcement armies
 *   stationed in the defending city. Each entry: { id, label, troops (same
 *   shape as the defender's own troops), heroes, research, buffs, formation }
 *   — all fields except `troops` are optional and, when present, apply only
 *   to that reinforcement's own stacks (a reinforcement does not inherit the
 *   defending city's heroes/research/formation, or vice versa). Entries with
 *   no troops are ignored rather than throwing.
 */
function calculateDefensePower({ troops, heroes, research, buffs, buildings, wall, towers, attackerTroops, formation, reinforcements }) {
  const own = calculateSingleDefensePower({ troops, heroes, research, buffs, buildings, wall, towers, attackerTroops, formation });

  const reinforcementResults = (Array.isArray(reinforcements) ? reinforcements : [])
    .filter((r) => r && Array.isArray(r.troops) && r.troops.length > 0)
    .map((r, idx) => {
      const result = calculateSingleDefensePower({
        troops: r.troops,
        heroes: r.heroes,
        research: r.research,
        buffs: r.buffs,
        buildings: [], // structures belong to the castle, never to a reinforcement
        wall: null,
        towers: [],
        attackerTroops,
        formation: r.formation,
      });
      return {
        id: r.id ?? `reinforcement_${idx + 1}`,
        label: r.label ?? null,
        value: result.value,
        breakdown: result.breakdown,
      };
    });

  const reinforcementsTotal = reinforcementResults.reduce((sum, r) => sum + r.value, 0);
  const value = own.value + reinforcementsTotal;

  // Every participant tagged so the Battle Report can attribute each stack
  // (and each army's contribution) to whoever it belongs to.
  const participants = [
    { id: 'defender', label: 'defender', is_reinforcement: false, value: own.value, per_stack: own.breakdown.per_stack },
    ...reinforcementResults.map((r) => ({
      id: r.id,
      label: r.label,
      is_reinforcement: true,
      value: r.value,
      per_stack: r.breakdown.per_stack,
    })),
  ];

  return {
    value,
    breakdown: {
      ...own.breakdown,
      reinforcements: reinforcementResults,
      participants,
    },
  };
}

module.exports = {
  calculateDefensePower,
  calculateSingleDefensePower,
};
