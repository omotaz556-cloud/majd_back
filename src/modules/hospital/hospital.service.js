// ====== Phase 7: Hospital & Recovery System - Service ======
// Single responsibility: everything that happens to troops *after* a
// battle is over. Two entry points feed this module:
//
//   1. battleConsequences.service.js's optional `admitCasualties` hook -
//      called automatically right after a battle's dead/survivors are
//      already applied to the world (see that file's "Hospital (اختياري)"
//      section). That file was written to require('../hospital/hospital.service')
//      defensively and call admitCasualties if it exists - this module is
//      that hook, added with zero changes to battleConsequences.service.js
//      or anything in battleResolution/*.
//
//   2. Player-facing recovery actions (heal one batch / heal all / cancel)
//      exposed through hospital.controller.js.
//
// Known limitation (inherited from the Battle Engine, not fixable here
// without touching it - explicitly out of scope for this Phase): the
// battle_result this module receives only carries an aggregated
// troops-lost *count* per side, not a per-troop-type breakdown (see
// casualtyCalculator.js - its typed `stacks` never leave
// battleResolution's internal result before resultBuilder.js flattens
// casualties down to `{ lost, remaining }` totals). Injured troops are
// therefore admitted and healed as an untyped pool and returned to the
// army under a reserved 'recovered_troops' stack key, rather than as their
// original troop type. TROOP_TYPES lookups elsewhere in the codebase are
// already tolerant of unknown army keys (`TROOP_TYPES[key]?.name || key`),
// so this displays safely; it simply can't be sent on a march until/unless
// the engine one day exposes typed casualties for Recovery to use instead.

'use strict';

const Castle = require('../castle/castle.model');
const Hospital = require('./hospital.model');
const { RESOURCE_TYPES } = require('../castle/castle.config');
const { BASE_CAPACITY, CAPACITY_PER_UPGRADE_LEVEL } = require('./hospital.config');
const queue = require('./healingQueue');
const recovery = require('./recoveryCalculator');

const RECOVERED_TROOP_KEY = 'recovered_troops';

function totalCapacity(hospital) {
  return BASE_CAPACITY + (Number(hospital.level) || 0) * CAPACITY_PER_UPGRADE_LEVEL;
}

// ====== Lazy creation, same philosophy as defense.service.getOrCreateDefense:
// a hospital document is created empty the first time it's needed, then any
// batch whose timer has already elapsed gets flipped to 'ready' before the
// caller sees it. ======
async function getOrCreateHospitalByCastleId(castleId) {
  let hospital = await Hospital.findOne({ castle_id: castleId });
  if (!hospital) {
    hospital = await Hospital.create({ castle_id: castleId });
  }

  const changed = queue.markFinishedBatchesReady(hospital);
  if (changed.length) {
    await hospital.save();
  }

  return hospital;
}

async function getHospitalByUserId(userId) {
  const castle = await Castle.findOne({ user_id: userId });
  if (!castle) throw new Error('القلعة مش موجودة');

  const hospital = await getOrCreateHospitalByCastleId(castle._id);
  return { castle, hospital };
}

function attemptDeductResources(castle, cost) {
  if (!castle) return { gold: 0, wood: 0, stone: 0 };

  // ====== Best-effort deduction - never blocks admission. Battle
  // consequences already treats hospital admission as fully non-blocking
  // (wrapped in try/catch, logged, never rethrown), so failing to charge
  // the full resource cost must not stop injured troops from being
  // admitted; they simply cost whatever the castle can actually afford,
  // capped at 0 per resource. ======
  const charged = { gold: 0, wood: 0, stone: 0 };
  for (const resource of RESOURCE_TYPES) {
    const available = castle.resources[resource].stored;
    const toCharge = Math.min(available, cost[resource] || 0);
    castle.resources[resource].stored = available - toCharge;
    charged[resource] = toCharge;
  }
  return charged;
}

/**
 * Admission hook called by battleConsequences.service.js right after a
 * battle resolves. `troopsLost` is the defender's total lost-troop count for
 * that battle (see the class comment above for why it isn't typed).
 * Overflow beyond the hospital's free capacity dies permanently - they are
 * simply never admitted (they were already removed from castle.army
 * upstream by applyStandingArmyConsequences, so doing nothing here already
 * satisfies "dead troops are permanently removed").
 */
async function admitCasualties({ castleId, troopsLost }) {
  const injuredCount = Math.max(0, Math.round(Number(troopsLost) || 0));
  if (injuredCount <= 0) {
    return { admitted: 0, died_from_overflow: 0, batch: null };
  }

  const [castle, hospital] = await Promise.all([
    Castle.findById(castleId),
    getOrCreateHospitalByCastleId(castleId),
  ]);

  const capacity = totalCapacity(hospital);
  const free = queue.freeCapacity(hospital, capacity);
  const admitted = Math.min(injuredCount, free);
  const diedFromOverflow = injuredCount - admitted;

  if (admitted <= 0) {
    return { admitted: 0, died_from_overflow: diedFromOverflow, batch: null };
  }

  const bonuses = recovery.aggregateHealSpeedBonus({ hospitalLevel: hospital.level });
  const healSeconds = recovery.computeHealSeconds(admitted, bonuses);
  const resourceCost = recovery.computeResourceCost(admitted);
  const charged = attemptDeductResources(castle, resourceCost);

  const batch = queue.addBatch(hospital, {
    count: admitted,
    healSeconds,
    resourceCost: charged,
    troopKey: null,
  });

  await Promise.all([hospital.save(), castle ? castle.save() : null]);

  return { admitted, died_from_overflow: diedFromOverflow, batch: queue.formatBatch(batch) };
}

// ====== Read-only Hospital Features overview: Current Capacity, Occupied
// Beds, Healing Queue, Remaining Healing Time per batch. ======
function formatOverview(hospital) {
  const capacity = totalCapacity(hospital);
  const occupied = queue.occupiedBeds(hospital);

  return {
    level: hospital.level,
    capacity,
    occupied_beds: occupied,
    free_beds: Math.max(0, capacity - occupied),
    healing_queue: hospital.queue.map((b) => queue.formatBatch(b)),
  };
}

async function getHospitalOverview(userId) {
  const { hospital } = await getHospitalByUserId(userId);
  return formatOverview(hospital);
}

// ====== Moves one already-'ready' batch's troops back into the live army
// under the reserved recovered-troops stack key, then removes the batch
// from the queue (freeing its beds). Shared by healBatch/healAllPossible. ======
function collectBatchIntoArmy(castle, hospital, batch) {
  let stack = castle.army.find((s) => s.key === RECOVERED_TROOP_KEY);
  if (!stack) {
    stack = { key: RECOVERED_TROOP_KEY, count: 0 };
    castle.army.push(stack);
  }
  stack.count += batch.count;
  queue.removeBatch(hospital, batch._id);
}

/**
 * Heal one batch - the earliest ready batch (FIFO) unless a specific
 * batchId is given. Throws if that batch hasn't finished healing yet.
 */
async function healOneBatch(userId, batchId = null) {
  const { castle, hospital } = await getHospitalByUserId(userId);

  const target = batchId ? queue.findBatch(hospital, batchId) : queue.getReadyBatches(hospital)[0];

  if (!target) throw new Error('مفيش جنود جاهزين للعلاج دلوقتي');
  if (target.status !== 'ready') throw new Error('الدفعة دي لسه بتتعالج - مخلصتش وقتها');

  collectBatchIntoArmy(castle, hospital, target);

  await Promise.all([hospital.save(), castle.save()]);
  return formatOverview(hospital);
}

/**
 * Heals every currently-ready batch at once.
 */
async function healAllPossible(userId) {
  const { castle, hospital } = await getHospitalByUserId(userId);

  const readyBatches = queue.getReadyBatches(hospital);
  if (readyBatches.length === 0) {
    return { healed_batches: 0, troops_recovered: 0, ...formatOverview(hospital) };
  }

  let troopsRecovered = 0;
  for (const batch of readyBatches) {
    troopsRecovered += batch.count;
    collectBatchIntoArmy(castle, hospital, batch);
  }

  await Promise.all([hospital.save(), castle.save()]);
  return { healed_batches: readyBatches.length, troops_recovered: troopsRecovered, ...formatOverview(hospital) };
}

/**
 * Cancels a batch still healing (or ready but not yet collected). Cancelled
 * troops are not recoverable - Cancel Healing discards the batch entirely
 * rather than partially healing it, freeing its beds immediately. This
 * mirrors cancelTraining's "no partial refund" stance in castle.service.js
 * for the same "an in-progress queue item is either finished or fully
 * discarded" philosophy.
 */
async function cancelHealing(userId, batchId) {
  const { hospital } = await getHospitalByUserId(userId);

  const removed = queue.removeBatch(hospital, batchId);
  if (!removed) throw new Error('الدفعة دي مش موجودة في طابور العلاج');

  await hospital.save();
  return formatOverview(hospital);
}

module.exports = {
  RECOVERED_TROOP_KEY,
  totalCapacity,
  getOrCreateHospitalByCastleId,
  getHospitalOverview,
  admitCasualties,
  healOneBatch,
  healAllPossible,
  cancelHealing,
};
