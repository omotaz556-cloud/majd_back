// ====== Healing Queue ======
// Single responsibility: operations on one hospital document's `queue`
// array - adding a batch, lazily flipping finished batches to 'ready',
// removing a batch, and deriving read-only view data (occupied beds,
// remaining time). No mongoose queries, no resource/capacity decisions
// (that's hospital.service.js) - mirrors the calculators/ split elsewhere
// in this codebase.

'use strict';

/**
 * Any batch still sitting in the hospital counts against capacity, whether
 * its timer has finished or not - a 'ready' batch still occupies its beds
 * until Recovery explicitly heals it out (heal one batch / heal all), same
 * as a finished-but-uncollected training order still holding its place.
 */
function occupiedBeds(hospital) {
  return (hospital.queue || []).reduce((total, batch) => total + (Number(batch.count) || 0), 0);
}

function freeCapacity(hospital, totalCapacity) {
  return Math.max(0, totalCapacity - occupiedBeds(hospital));
}

/**
 * Lazy completion, same pattern as
 * defense.service.completeFinishedStructureUpgrades: flips any 'healing'
 * batch whose timer has elapsed to 'ready', in place. Returns the batches
 * that changed so the caller can decide whether a `.save()` is needed.
 */
function markFinishedBatchesReady(hospital, now = new Date()) {
  const changed = [];
  for (const batch of hospital.queue || []) {
    if (batch.status === 'healing' && batch.heal_completes_at <= now) {
      batch.status = 'ready';
      changed.push(batch);
    }
  }
  return changed;
}

function addBatch(hospital, { count, healSeconds, resourceCost, troopKey = null, now = new Date() }) {
  const healCompletesAt = new Date(now.getTime() + healSeconds * 1000);
  const batch = {
    troop_key: troopKey,
    count,
    status: 'healing',
    resource_cost_charged: resourceCost,
    admitted_at: now,
    heal_started_at: now,
    heal_completes_at: healCompletesAt,
  };
  hospital.queue.push(batch);
  return hospital.queue[hospital.queue.length - 1];
}

function getReadyBatches(hospital) {
  return (hospital.queue || []).filter((b) => b.status === 'ready');
}

function findBatch(hospital, batchId) {
  return (hospital.queue || []).find((b) => b._id.toString() === String(batchId));
}

/**
 * Removes a batch from the queue entirely - used both when Recovery heals a
 * ready batch out (troops already moved back to the army by the caller) and
 * when Cancel Healing discards one (troops are not recoverable once
 * cancelled - see hospital.service.cancelHealing for the rationale).
 */
function removeBatch(hospital, batchId) {
  const before = hospital.queue.length;
  hospital.queue = hospital.queue.filter((b) => b._id.toString() !== String(batchId));
  return hospital.queue.length < before;
}

/**
 * Read-only view of one batch with remaining time computed on the fly -
 * never stored, always derived from heal_completes_at vs now.
 */
function formatBatch(batch, now = new Date()) {
  const remainingMs = Math.max(0, new Date(batch.heal_completes_at).getTime() - now.getTime());
  return {
    id: batch._id,
    troop_key: batch.troop_key,
    count: batch.count,
    status: batch.status,
    resource_cost_charged: batch.resource_cost_charged,
    admitted_at: batch.admitted_at,
    heal_completes_at: batch.heal_completes_at,
    remaining_healing_seconds: batch.status === 'ready' ? 0 : Math.ceil(remainingMs / 1000),
  };
}

module.exports = {
  occupiedBeds,
  freeCapacity,
  markFinishedBatchesReady,
  addBatch,
  getReadyBatches,
  findBatch,
  removeBatch,
  formatBatch,
};
