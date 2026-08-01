// ====== Repair Queue ======
// Single responsibility: operations on one CastleDefense document's
// `structures` array - starting/cancelling/completing a structure's repair
// timer, and deriving read-only progress view data. No mongoose queries,
// no resource/cost decisions (that's repair.service.js) - mirrors the
// calculators/queue split used elsewhere in this codebase
// (hospital's healingQueue.js, battleResolution's calculators/).
//
// Unlike Hospital's healing queue (a separate `queue[]` array holding
// synthetic batches), Repair reuses the `repair` sub-document that already
// exists on every CastleDefense structure (repair.state/started_at/
// completes_at - see defense.model.js repairStateSchema). Each *damaged
// structure itself* is the queue item; nothing new needs to be stored.

'use strict';

function missingHp(structure) {
  return Math.max(0, Math.round((Number(structure.max_hp) || 0) - (Number(structure.hp) || 0)));
}

function isDamaged(structure) {
  return missingHp(structure) > 0;
}

function isUnderRepair(structure) {
  return Boolean(structure.repair?.completes_at);
}

/**
 * Every structure with missing HP that isn't already being repaired -
 * candidates for a new repair to be started on.
 */
function listRepairableStructures(defense) {
  return (defense.structures || []).filter((s) => isDamaged(s) && !isUnderRepair(s));
}

/**
 * Every structure currently mid-repair (timer running or already elapsed
 * but not yet lazily completed).
 */
function listActiveRepairs(defense) {
  return (defense.structures || []).filter((s) => isUnderRepair(s));
}

function findStructure(defense, structureId) {
  return (defense.structures || []).find((s) => s._id.toString() === String(structureId));
}

/**
 * Starts a repair timer on one structure. Deliberately does not touch
 * repair.state - a structure stays 'damaged' or 'destroyed' (whichever it
 * already was) while its repair is in progress, exactly like it was before
 * repair started; only completeIfFinished below transitions it to
 * 'intact'. This keeps a cancelled repair trivially revertible (see
 * cancelRepair) with nothing to "undo" on the state itself.
 */
function startRepairOnStructure(structure, { seconds, now = new Date() }) {
  structure.repair.started_at = now;
  structure.repair.completes_at = new Date(now.getTime() + seconds * 1000);
  return structure;
}

/**
 * Cancels an in-progress repair - clears the timer only. The structure
 * simply remains as damaged/destroyed as it already was; no resources are
 * refunded (same "in-progress queue item is either finished or fully
 * discarded, no partial refund" stance as castle.service.cancelTraining /
 * hospital's cancelHealing).
 */
function cancelRepairOnStructure(structure) {
  structure.repair.started_at = null;
  structure.repair.completes_at = null;
  return structure;
}

/**
 * Lazy completion, same pattern as defense.service.completeFinishedRepairs
 * (intentionally re-implemented here rather than imported - Repair Queue
 * stays a fully self-contained module per Phase 8's architecture
 * requirement). Restores hp to max_hp, flips repair.state back to
 * 'intact', and - for gates specifically - clears the destroyed flag so a
 * fully repaired gate can be opened/closed again.
 */
function completeIfFinished(structure, now = new Date()) {
  if (!structure.repair?.completes_at || structure.repair.completes_at > now) return false;

  structure.hp = structure.max_hp;
  structure.repair.state = 'intact';
  structure.repair.started_at = null;
  structure.repair.completes_at = null;

  if (structure.type === 'gate' && structure.gate_state) {
    structure.gate_state.destroyed = false;
  }

  return true;
}

/**
 * Runs completeIfFinished across every structure in the defense document.
 * Returns the structures that changed so the caller can decide whether a
 * `.save()` is needed.
 */
function completeFinishedRepairs(defense, now = new Date()) {
  const completed = [];
  for (const structure of defense.structures || []) {
    if (completeIfFinished(structure, now)) completed.push(structure);
  }
  return completed;
}

/**
 * Read-only progress view of one structure - Current HP, Maximum HP,
 * Repair State, and (while a repair is running) remaining time. Repair
 * Cost/Time for a not-yet-started repair is computed by the caller via
 * repairCalculator.js using this structure's current missing HP.
 */
function formatProgress(structure, now = new Date()) {
  const underRepair = isUnderRepair(structure);
  const remainingMs = underRepair
    ? Math.max(0, new Date(structure.repair.completes_at).getTime() - now.getTime())
    : 0;

  return {
    id: structure._id,
    type: structure.type,
    category: structure.category,
    hp: structure.hp,
    max_hp: structure.max_hp,
    missing_hp: missingHp(structure),
    repair_state: structure.repair?.state || 'intact',
    in_progress: underRepair,
    started_at: underRepair ? structure.repair.started_at : null,
    remaining_repair_seconds: underRepair ? Math.ceil(remainingMs / 1000) : 0,
  };
}

module.exports = {
  missingHp,
  isDamaged,
  isUnderRepair,
  listRepairableStructures,
  listActiveRepairs,
  findStructure,
  startRepairOnStructure,
  cancelRepairOnStructure,
  completeIfFinished,
  completeFinishedRepairs,
  formatProgress,
};
