// ====== Battle Resolution Core — config/constants ======
// Pure data only, no calculation logic here. This module is intentionally
// self-contained: it does not import anything from modules/battle/engines/*
// (the existing tick-based Simulation/Rule/Combat system) so this new
// synchronous resolver stays fully independent, per Phase 1 scope.

'use strict';

// ====== Max random modifier applied to the final power comparison (±3%) ======
const RANDOM_MODIFIER_MAX = 0.03;

// ====== Troop type counters (rock-paper-scissors), same philosophy as the
// existing engine's TROOP_COUNTER_MATRIX but a private copy — this module
// must not depend on modules/battle/engines/damage.config.js. Unknown/missing
// troop types simply fall back to a neutral 1.0 multiplier. ======
const TROOP_TYPE = {
  INFANTRY: 'infantry',
  ARCHER: 'archer',
  CAVALRY: 'cavalry',
  SIEGE: 'siege',
};

// ====== Phase 5 — full rock-paper-scissors-plus-siege matrix. Every type
// keeps one clear strength and one clear weakness so Battle Events (e.g.
// "Cavalry Flanked Enemy", "Archers Eliminated Siege Units") have something
// concrete to point at. Unlisted matchups fall back to NEUTRAL_EFFECTIVENESS. ======
const TROOP_COUNTER_MATRIX = {
  [TROOP_TYPE.INFANTRY]: { [TROOP_TYPE.ARCHER]: 0.85, [TROOP_TYPE.CAVALRY]: 1.2 },
  [TROOP_TYPE.ARCHER]: { [TROOP_TYPE.INFANTRY]: 1.2, [TROOP_TYPE.SIEGE]: 1.2, [TROOP_TYPE.CAVALRY]: 0.8 },
  [TROOP_TYPE.CAVALRY]: { [TROOP_TYPE.ARCHER]: 1.2, [TROOP_TYPE.SIEGE]: 1.15, [TROOP_TYPE.INFANTRY]: 0.8 },
  [TROOP_TYPE.SIEGE]: { [TROOP_TYPE.INFANTRY]: 1.15, [TROOP_TYPE.CAVALRY]: 0.7 },
};

// Threshold above which a stack's weighted counter multiplier is considered
// a decisive strategic advantage worth surfacing as its own Battle Event
// (as opposed to just quietly contributing to the power totals).
const STRATEGY_EVENT_EFFECTIVENESS_THRESHOLD = 1.1;

const NEUTRAL_EFFECTIVENESS = 1.0;

// ====== Phase 5 — Formations. Each formation is a light-touch modifier on
// top of the base troop math: an overall attack/defense percent plus,
// optionally, a per-troop-type override (`by_type`) for formations that lean
// into a specific unit type. Unknown/missing formation keys fall back to
// BALANCED (all zeros) rather than throwing. ======
const FORMATION = {
  BALANCED: 'balanced',
  FRONTLINE: 'frontline',
  DEFENSIVE: 'defensive',
  AGGRESSIVE: 'aggressive',
  ARCHER_FOCUS: 'archer_focus',
  CAVALRY_CHARGE: 'cavalry_charge',
};

const DEFAULT_FORMATION_MODIFIER = { attack_percent: 0, defense_percent: 0, by_type: {} };

const FORMATION_MODIFIERS = {
  [FORMATION.BALANCED]: { attack_percent: 0, defense_percent: 0, by_type: {} },
  [FORMATION.FRONTLINE]: {
    attack_percent: 0,
    defense_percent: 0.05,
    by_type: { [TROOP_TYPE.INFANTRY]: { defense_percent: 0.15 } },
  },
  [FORMATION.DEFENSIVE]: { attack_percent: -0.1, defense_percent: 0.2, by_type: {} },
  [FORMATION.AGGRESSIVE]: { attack_percent: 0.2, defense_percent: -0.1, by_type: {} },
  [FORMATION.ARCHER_FOCUS]: {
    attack_percent: 0,
    defense_percent: 0,
    by_type: {
      [TROOP_TYPE.ARCHER]: { attack_percent: 0.25 },
      [TROOP_TYPE.CAVALRY]: { defense_percent: -0.1 },
    },
  },
  [FORMATION.CAVALRY_CHARGE]: {
    attack_percent: 0,
    defense_percent: -0.05,
    by_type: {
      [TROOP_TYPE.CAVALRY]: { attack_percent: 0.3 },
      [TROOP_TYPE.INFANTRY]: { attack_percent: -0.05 },
    },
  },
};

// ====== Phase 5 — Hero bonus keys. Heroes are still the same "generic
// placeholder" object as Phase 1 (no real Hero system backing them), just
// with a richer, recognized set of stat keys so bonuses can target a
// specific troop type instead of only a flat attack/defense percent.
// `leadership_percent` is the one flat, army-wide bonus (and what powers the
// "Hero Inspired Troops" event); the rest are per-troop-type. ======
const HERO_BONUS_KEY = {
  INFANTRY_ATTACK: 'infantry_attack_percent',
  CAVALRY_DEFENSE: 'cavalry_defense_percent',
  ARCHER_DAMAGE: 'archer_damage_percent',
  SIEGE_SPEED: 'siege_speed_percent',
  LEADERSHIP: 'leadership_percent',
};

// Maps a troop type + stat ('attack_percent'|'defense_percent') to the hero
// bonus key that targets it. Types/stats with no targeted hero bonus simply
// get 0 (leadership_percent still applies on top, flat, for every type).
const HERO_TYPED_BONUS_MAP = {
  [TROOP_TYPE.INFANTRY]: { attack_percent: HERO_BONUS_KEY.INFANTRY_ATTACK },
  [TROOP_TYPE.CAVALRY]: { defense_percent: HERO_BONUS_KEY.CAVALRY_DEFENSE },
  [TROOP_TYPE.ARCHER]: { attack_percent: HERO_BONUS_KEY.ARCHER_DAMAGE },
};

// ====== Phase 5 — Research bonus keys. Research is likewise still a
// generic placeholder input; these are the recognized permanent-bonus stat
// keys it may carry. attack/defense_percent reuse the existing flat
// aggregation; the rest are consumed by their own specific calculator. ======
const RESEARCH_BONUS_KEY = {
  ATTACK: 'attack_percent',
  DEFENSE: 'defense_percent',
  HEALTH: 'hp_percent',
  MARCH_CAPACITY: 'march_capacity_percent',
  SIEGE_EFFICIENCY: 'siege_efficiency_percent',
};

// ====== Battle Plan objectives — mirrors the enum already used in
// battle.model.js's battlePlanSnapshotSchema, kept as a private copy for the
// same independence reason as above. ======
const BATTLE_PLAN_OBJECTIVE = {
  LOOT: 'loot',
  RAZE: 'raze',
  CONQUER: 'conquer',
  CUSTOM: 'custom',
};

// ====== Flat bonus each objective grants toward its own goal — deliberately
// small/simple placeholders (a real Battle Planner can override via
// battlePlan.bonus_percent on the input). ======
const BATTLE_PLAN_OBJECTIVE_BONUS = {
  [BATTLE_PLAN_OBJECTIVE.LOOT]: { attack_percent: 0, loot_percent: 0.15 },
  [BATTLE_PLAN_OBJECTIVE.RAZE]: { attack_percent: 0.05, building_damage_percent: 0.2 },
  [BATTLE_PLAN_OBJECTIVE.CONQUER]: { attack_percent: 0.1, loot_percent: -0.1 },
  [BATTLE_PLAN_OBJECTIVE.CUSTOM]: { attack_percent: 0, loot_percent: 0 },
};

// ====== Casualty model tuning — deliberately simple/deterministic (aside
// from the shared ±3% random modifier applied once at the power-comparison
// stage). Winner side loses a smaller fraction, loser side a larger one,
// scaled by how lopsided the final scores were. ======
const CASUALTY_MODEL = {
  WINNER_MIN_LOSS_PERCENT: 0.05,
  WINNER_MAX_LOSS_PERCENT: 0.35,
  LOSER_MIN_LOSS_PERCENT: 0.4,
  LOSER_MAX_LOSS_PERCENT: 0.95,
  DRAW_LOSS_PERCENT: 0.5,
};

// ====== Loot model tuning ======
const LOOT_MODEL = {
  // Base fraction of the defender's stored resources exposed to looting.
  BASE_LOOT_PERCENT: 0.25,
  // Winning attacker only loots up to its surviving troops' total carry_capacity.
  DEFENDER_MIN_RESOURCE_FLOOR: 0, // never loot below this stored amount
};

// ====== Building/Wall damage model tuning ======
const STRUCTURE_DAMAGE_MODEL = {
  WIN_DAMAGE_PERCENT: 0.3, // % of structure hp damaged on an attacker win
  LOSS_DAMAGE_PERCENT: 0.05, // small damage even on an attacker loss (partial breach attempt)
};

// ====== Battle duration model — purely a presentational estimate derived
// from the two final power scores, not a real tick simulation. ======
const DURATION_MODEL = {
  BASE_SECONDS: 30,
  MAX_SECONDS: 600,
  // extra seconds per point of (log) power scale, so bigger battles read as
  // longer without needing to actually simulate ticks.
  SCALE_SECONDS_PER_LOG_POWER: 25,
  // Phase 5 — Siege Speed hero bonus shortens the estimate; capped so a
  // stacked bonus can never collapse duration to (near) zero.
  MAX_SIEGE_SPEED_DURATION_CUT_PERCENT: 0.6,
};

// ====== Phase 5 — Research/Strategy tuning knobs shared by the calculators
// below. Kept here, alongside the rest of the config, so every numeric knob
// in the engine lives in one place. ======
const STRATEGY_TUNING = {
  // Research hp_percent reduces a side's casualty loss percent, capped so it
  // can never make a side immune to losses outright.
  MAX_HP_LOSS_MITIGATION_PERCENT: 0.5,
  // Extra structure-damage percent added on top of STRUCTURE_DAMAGE_MODEL
  // when the attacker fields siege troops, scaled by their share of the
  // attacking army and by any siege_efficiency_percent research bonus.
  SIEGE_PRESENCE_MAX_DAMAGE_BONUS_PERCENT: 0.25,
};

module.exports = {
  RANDOM_MODIFIER_MAX,
  TROOP_TYPE,
  TROOP_COUNTER_MATRIX,
  STRATEGY_EVENT_EFFECTIVENESS_THRESHOLD,
  NEUTRAL_EFFECTIVENESS,
  FORMATION,
  DEFAULT_FORMATION_MODIFIER,
  FORMATION_MODIFIERS,
  HERO_BONUS_KEY,
  HERO_TYPED_BONUS_MAP,
  RESEARCH_BONUS_KEY,
  BATTLE_PLAN_OBJECTIVE,
  BATTLE_PLAN_OBJECTIVE_BONUS,
  CASUALTY_MODEL,
  LOOT_MODEL,
  STRUCTURE_DAMAGE_MODEL,
  DURATION_MODEL,
  STRATEGY_TUNING,
};
