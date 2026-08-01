// ====== Phase 8: Building Repair System - Configuration ======
// Same philosophy as hospital.config.js/castle.config.js: every tunable
// number lives here only, no calculation logic in this file.

'use strict';

// ====== Repair time (seconds) per single point of missing HP - linear with
// how damaged the structure is, same "linear per-unit" philosophy as
// hospital.config.js's BASE_HEAL_SECONDS_PER_TROOP. ======
const BASE_REPAIR_SECONDS_PER_MISSING_HP = 0.6;

// ====== Floor so a barely-scratched structure doesn't repair instantly
// (same idea as hospital's MIN_BATCH_HEAL_SECONDS / castle's
// MARCH_MIN_SECONDS). ======
const MIN_REPAIR_SECONDS = 20;

// ====== Resource cost per single point of missing HP repaired. Kept
// deliberately cheap relative to a full structure build/upgrade cost - a
// full repair from 0 hp should never cost more than rebuilding from
// scratch would. ======
const BASE_REPAIR_RESOURCE_COST_PER_MISSING_HP = { gold: 0.6, wood: 0.9, stone: 0.6 };

// ====== Upper bound so stacked future speed bonuses (Research + Heroes +
// Castle Level + Alliance Help) can never make repair instantaneous - same
// "mitigation cap" philosophy used throughout this codebase
// (battleResolution's MAX_HP_LOSS_MITIGATION_PERCENT, hospital's
// MAX_HEAL_SPEED_BONUS_PERCENT). ======
const MAX_REPAIR_SPEED_BONUS_PERCENT = 0.7;

// ====== Future Ready bonus hooks ======
// None of Research / Heroes / Alliance Help exist as real systems in this
// codebase yet (verified with a full search before writing) - repairCalculator.js
// reads bonus entries through the same tolerant shape used by
// battleResolution's bonusAggregator.js / hospital's recoveryCalculator.js
// (`{ repair_speed_percent }` direct or nested under `.bonuses`), so wiring
// a real Research/Hero/Alliance module in later needs zero changes here or
// in repairCalculator.js - just pass real entries into the same parameter.
const REPAIR_SPEED_BONUS_KEY = 'repair_speed_percent';

// ====== Future Ready: "Castle Level" bonus - derived from the castle's
// town_hall building level (already tracked by the existing castle module,
// nothing new to add there). Inert at town_hall level 1 (no bonus at the
// starting level). ======
const REPAIR_SPEED_BONUS_PER_TOWN_HALL_LEVEL = 0.015;

module.exports = {
  BASE_REPAIR_SECONDS_PER_MISSING_HP,
  MIN_REPAIR_SECONDS,
  BASE_REPAIR_RESOURCE_COST_PER_MISSING_HP,
  MAX_REPAIR_SPEED_BONUS_PERCENT,
  REPAIR_SPEED_BONUS_KEY,
  REPAIR_SPEED_BONUS_PER_TOWN_HALL_LEVEL,
};
