// ====== Phase 7: Hospital & Recovery System - Model ======
// One Hospital document per castle (same 1:1-with-castle pattern as
// CastleDefense in defense.model.js). Holds capacity/upgrade state and the
// live healing queue - everything else (occupied beds, remaining time) is
// derived at read time by healingQueue.js/recoveryCalculator.js, never
// stored redundantly.

'use strict';

const mongoose = require('mongoose');

const resourceCostSchema = new mongoose.Schema(
  {
    gold: { type: Number, default: 0 },
    wood: { type: Number, default: 0 },
    stone: { type: Number, default: 0 },
  },
  { _id: false }
);

// ====== One admitted batch of injured troops healing together. Batches
// heal in parallel (each with its own timer) rather than a single
// sequential queue like the training queue - a hospital's "beds" are
// occupied concurrently, not one-order-at-a-time. `troop_key` stays
// optional/null: battleResolution's final battle_result only exposes an
// aggregated troops-lost count (no per-type breakdown survives past
// casualtyCalculator's internal stacks - see battleConsequences.service.js's
// hospital hand-off), so troops admitted from battle are generic "wounded"
// counts. The field is kept here (not omitted) so any future admission path
// that *does* know the type (e.g. a manual admit endpoint) can set it
// without a schema change. ======
const healingBatchSchema = new mongoose.Schema(
  {
    troop_key: { type: String, default: null },
    count: { type: Number, required: true },
    status: { type: String, enum: ['healing', 'ready'], default: 'healing' },
    resource_cost_charged: { type: resourceCostSchema, default: () => ({}) },
    admitted_at: { type: Date, default: Date.now },
    heal_started_at: { type: Date, default: Date.now },
    heal_completes_at: { type: Date, required: true },
  },
  { _id: true }
);

const hospitalSchema = new mongoose.Schema(
  {
    castle_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Castle',
      required: true,
      unique: true,
    },
    // ====== Future Ready: "Hospital upgrades" - a building-level-like
    // number nothing in this Phase increments yet (no purchase/upgrade flow
    // wired in), same as CastleDefense structures starting at level 1 before
    // any upgrade system used them. Capacity/heal-speed math already reads
    // this (hospital.config.js CAPACITY_PER_UPGRADE_LEVEL /
    // HEAL_SPEED_BONUS_PER_UPGRADE_LEVEL) so a future upgrade endpoint only
    // needs to increment this field. ======
    level: { type: Number, default: 0 },
    queue: [healingBatchSchema],
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

module.exports = mongoose.model('Hospital', hospitalSchema);
