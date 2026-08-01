// ====== Phase 7: Hospital & Recovery System - Configuration ======
// Same philosophy as castle.config.js/defense.config.js/battleResolution.config.js:
// every tunable number lives here only, no calculation logic in this file.

'use strict';

// ====== Base hospital capacity (beds) a castle has with no upgrades at all.
// Overflowed injured troops beyond total capacity die on admission - this is
// the only number that decides that cutoff. ======
const BASE_CAPACITY = 50;

// ====== Capacity gained per hospital upgrade level (Future Ready: "Hospital
// upgrades"). Nothing in this Phase actually grants levels yet (no
// upgrade-purchase flow) - `hospital.level` simply defaults to 0, so this
// multiplier is inert until an upgrade flow is wired in later. ======
const CAPACITY_PER_UPGRADE_LEVEL = 25;

// ====== Base healing time (seconds) per single injured troop in a batch -
// linear with batch size, same "linear cost/duration" philosophy used for
// TROOP_TYPES.train_seconds in castle.config.js. ======
const BASE_HEAL_SECONDS_PER_TROOP = 12;

// ====== Floor for any batch's healing duration so a tiny batch doesn't
// resolve instantly (same idea as MARCH_MIN_SECONDS in castle.config.js). ======
const MIN_BATCH_HEAL_SECONDS = 15;

// ====== Base resource cost per single injured troop healed - "healing may
// require resources" requirement. Kept intentionally cheap relative to
// TROOP_TYPES training cost (healing an existing troop should never cost
// more than training a brand new one). ======
const BASE_HEAL_RESOURCE_COST_PER_TROOP = { gold: 4, wood: 2, stone: 0 };

// ====== Upper bound so stacked future speed bonuses (hero + research +
// alliance + upgrade) can never make healing instantaneous - same
// "mitigation cap" philosophy as STRATEGY_TUNING.MAX_HP_LOSS_MITIGATION_PERCENT
// in battleResolution.config.js. ======
const MAX_HEAL_SPEED_BONUS_PERCENT = 0.75;

// ====== Future Ready bonus hooks ======
// None of these systems (Hero healing bonuses / Research bonuses / Alliance
// healing speed) exist yet in this codebase (verified with a full search
// before writing). recoveryCalculator.js reads bonus entries through the
// exact same tolerant shape used by battleResolution's bonusAggregator.js
// (`{ heal_speed_percent }` direct or nested under `.bonuses`), so wiring a
// real Hero/Research/Alliance module in later needs zero changes here or in
// recoveryCalculator.js - just pass real entries into the same parameter.
const HEAL_SPEED_BONUS_KEY = 'heal_speed_percent';

// ====== Bonus contributed by the hospital's own upgrade level (Future
// Ready: "Hospital upgrades" also speeding up healing, not just adding
// beds). Inert at level 0. ======
const HEAL_SPEED_BONUS_PER_UPGRADE_LEVEL = 0.02;

module.exports = {
  BASE_CAPACITY,
  CAPACITY_PER_UPGRADE_LEVEL,
  BASE_HEAL_SECONDS_PER_TROOP,
  MIN_BATCH_HEAL_SECONDS,
  BASE_HEAL_RESOURCE_COST_PER_TROOP,
  MAX_HEAL_SPEED_BONUS_PERCENT,
  HEAL_SPEED_BONUS_KEY,
  HEAL_SPEED_BONUS_PER_UPGRADE_LEVEL,
};
