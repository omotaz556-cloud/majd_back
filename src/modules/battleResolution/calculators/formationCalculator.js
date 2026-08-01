// ====== Formation Calculator (Phase 5) ======
// Single responsibility: resolve a formation key (Balanced, Frontline,
// Defensive, Aggressive, Archer Focus, Cavalry Charge, ...) into the flat
// army-wide modifier plus any per-troop-type override it carries. Pure
// lookup/derivation only — no power totals computed here. Unknown/missing
// formation keys always fall back to the neutral BALANCED modifier rather
// than throwing, same "no invented data" philosophy as the rest of this
// module.

'use strict';

const { FORMATION_MODIFIERS, DEFAULT_FORMATION_MODIFIER, FORMATION } = require('../battleResolution.config');

/**
 * Returns the full modifier object for a formation key: { attack_percent,
 * defense_percent, by_type }. Falls back to Balanced (all zeros) when the
 * key is missing/unrecognized.
 */
function getFormationModifier(formationKey) {
  return FORMATION_MODIFIERS[formationKey] || FORMATION_MODIFIERS[FORMATION.BALANCED] || DEFAULT_FORMATION_MODIFIER;
}

/**
 * Returns the flat army-wide percent this formation grants for the given
 * stat ('attack_percent' | 'defense_percent').
 */
function getFormationFlatPercent(formationKey, statKey) {
  const modifier = getFormationModifier(formationKey);
  return Number(modifier[statKey]) || 0;
}

/**
 * Returns the per-troop-type override percent this formation grants a
 * specific troop type for the given stat, or 0 if this formation has no
 * targeted bonus for that type/stat combination.
 */
function getFormationTypePercent(formationKey, troopType, statKey) {
  const modifier = getFormationModifier(formationKey);
  const typeOverride = modifier.by_type?.[troopType];
  return Number(typeOverride?.[statKey]) || 0;
}

module.exports = {
  getFormationModifier,
  getFormationFlatPercent,
  getFormationTypePercent,
};
