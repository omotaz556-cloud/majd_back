// ====== Phase 8: Building Repair System - Service ======
// Single responsibility: restoring already-damaged structures over time.
// Deliberately independent from Battle Consequences - this module never
// requires anything from modules/battleConsequences or
// modules/battleResolution, and battle_result plumbing keeps writing hp
// damage the same way it always has (battleConsequences.service.js's
// applyStructureDamage, untouched). Repair Service only ever *reads*
// whatever hp/max_hp state is on CastleDefense.structures right now and
// restores it - "Battle Consequences only applies damage, Repair System
// restores structures" per Phase 8's own boundary.
//
// Reuses defense.service.getOrCreateDefense (existing, unmodified) purely
// to load { castle, defense } with the same lazy-creation/lazy-completion
// guarantees every other defense consumer already relies on - this is
// composition, not a change to that module.

'use strict';

const defenseService = require('../defense/defense.service');
const { RESOURCE_TYPES } = require('../castle/castle.config');
const { isAdmin } = require('../common/adminAccess.service');
const queue = require('./repairQueue');
const calculator = require('./repairCalculator');

function getTownHallLevel(castle) {
  const townHall = (castle.buildings || []).find((b) => b.key === 'town_hall');
  return townHall ? townHall.level : 1;
}

async function loadForUser(userId) {
  const { castle, defense } = await defenseService.getOrCreateDefense(userId);

  const completed = queue.completeFinishedRepairs(defense);
  if (completed.length) {
    await defense.save();
  }

  return { castle, defense };
}

// ====== Admin privilege (Unlimited Resources) - adminBypass=true بيخلي
// اللاعب "دايمًا معاه الموارد كفاية" من غير ما يتغير سلوك اللاعبين
// العاديين (adminBypass=false ليهم دايمًا). ======
function hasEnoughResources(castle, cost, adminBypass = false) {
  if (adminBypass) return true;
  return RESOURCE_TYPES.every((resource) => castle.resources[resource].stored >= (cost[resource] || 0));
}

function deductResources(castle, cost, adminBypass = false) {
  if (adminBypass) return;
  for (const resource of RESOURCE_TYPES) {
    castle.resources[resource].stored -= cost[resource] || 0;
  }
}

function addResourceCosts(a, b) {
  return {
    gold: (a.gold || 0) + (b.gold || 0),
    wood: (a.wood || 0) + (b.wood || 0),
    stone: (a.stone || 0) + (b.stone || 0),
  };
}

// ====== Admin privilege (Instant Construction Timers) - نفس أثر
// repairQueue.completeIfFinished بالظبط لكن بيتنادى فورًا وقت طلب الإصلاح
// (مفيش repair.completes_at بيتحط أصلًا لو adminBypass، فمفيش داعي نستنى
// أي مؤقّت). ======
function completeRepairInstantly(structure) {
  structure.hp = structure.max_hp;
  structure.repair.state = 'intact';
  structure.repair.started_at = null;
  structure.repair.completes_at = null;

  if (structure.type === 'gate' && structure.gate_state) {
    structure.gate_state.destroyed = false;
  }
}

function estimateForStructure(structure, bonuses) {
  const missing = calculator.missingHp(structure);
  return {
    seconds: calculator.computeRepairSeconds(missing, bonuses),
    cost: calculator.computeRepairCost(missing),
  };
}

// ====== GET /api/repair - Current HP / Maximum HP / Repair Cost / Repair
// Time / Repair State for every damaged structure, plus remaining time for
// any repair already in progress. ======
async function getRepairOverview(userId) {
  const { castle, defense } = await loadForUser(userId);
  const bonuses = calculator.aggregateRepairSpeedBonus({ townHallLevel: getTownHallLevel(castle) });

  const structures = (defense.structures || [])
    .filter((s) => queue.isDamaged(s) || queue.isUnderRepair(s))
    .map((s) => {
      const progress = queue.formatProgress(s);
      if (progress.in_progress) return progress;
      const estimate = estimateForStructure(s, bonuses);
      return { ...progress, estimated_repair_seconds: estimate.seconds, estimated_repair_cost: estimate.cost };
    });

  return {
    speed_bonus: bonuses,
    damaged_structures: structures.filter((s) => !s.in_progress),
    active_repairs: structures.filter((s) => s.in_progress),
  };
}

// ====== POST /api/repair/:structureId - repair one structure. Rejects
// outright (no partial charge) if the castle can't afford the full cost. ======
async function repairOne(userId, structureId) {
  const adminBypass = await isAdmin(userId);
  const { castle, defense } = await loadForUser(userId);
  const structure = queue.findStructure(defense, structureId);
  if (!structure) throw new Error('القطعة الدفاعية دي مش موجودة');

  if (!queue.isDamaged(structure)) throw new Error('القطعة دي سليمة أصلًا، مفيش داعي لإصلاحها');
  if (queue.isUnderRepair(structure)) throw new Error('في إصلاح شغال بالفعل لهذه القطعة');

  const bonuses = calculator.aggregateRepairSpeedBonus({ townHallLevel: getTownHallLevel(castle) });
  const { seconds, cost } = estimateForStructure(structure, bonuses);

  if (!hasEnoughResources(castle, cost, adminBypass)) {
    throw new Error('الموارد مش كفاية لإصلاح القطعة دي');
  }

  deductResources(castle, cost, adminBypass);
  if (adminBypass) {
    completeRepairInstantly(structure);
  } else {
    queue.startRepairOnStructure(structure, { seconds });
  }

  await Promise.all([defense.save(), castle.save()]);
  return queue.formatProgress(structure);
}

// ====== POST /api/repair/all - repair every currently-damaged, not-yet-
// repairing structure. All-or-nothing: the combined cost of every
// structure is checked up front and the whole batch is rejected if the
// castle can't afford it in full, matching the same "reject the repair
// request" rule a single repair follows - Repair All is just one request
// covering many structures, not a per-structure best-effort pass. ======
async function repairAll(userId) {
  const adminBypass = await isAdmin(userId);
  const { castle, defense } = await loadForUser(userId);
  const bonuses = calculator.aggregateRepairSpeedBonus({ townHallLevel: getTownHallLevel(castle) });

  const repairable = queue.listRepairableStructures(defense);
  if (repairable.length === 0) {
    return { repaired_count: 0, total_cost: { gold: 0, wood: 0, stone: 0 }, structures: [] };
  }

  const plan = repairable.map((structure) => ({ structure, ...estimateForStructure(structure, bonuses) }));
  const totalCost = plan.reduce((acc, p) => addResourceCosts(acc, p.cost), { gold: 0, wood: 0, stone: 0 });

  if (!hasEnoughResources(castle, totalCost, adminBypass)) {
    throw new Error('الموارد مش كفاية لإصلاح كل القطع المتضررة دفعة واحدة');
  }

  deductResources(castle, totalCost, adminBypass);
  for (const p of plan) {
    if (adminBypass) {
      completeRepairInstantly(p.structure);
    } else {
      queue.startRepairOnStructure(p.structure, { seconds: p.seconds });
    }
  }

  await Promise.all([defense.save(), castle.save()]);
  return {
    repaired_count: plan.length,
    total_cost: totalCost,
    structures: plan.map((p) => queue.formatProgress(p.structure)),
  };
}

// ====== DELETE /api/repair/:repairId - cancel an in-progress repair.
// `repairId` is the structure's own id (the repair queue item *is* the
// structure - see repairQueue.js header comment); no resources are
// refunded. ======
async function cancelRepair(userId, repairId) {
  const { defense } = await loadForUser(userId);
  const structure = queue.findStructure(defense, repairId);
  if (!structure) throw new Error('القطعة الدفاعية دي مش موجودة');
  if (!queue.isUnderRepair(structure)) throw new Error('مفيش إصلاح شغال على القطعة دي أصلًا');

  queue.cancelRepairOnStructure(structure);

  await defense.save();
  return queue.formatProgress(structure);
}

module.exports = {
  getRepairOverview,
  repairOne,
  repairAll,
  cancelRepair,
};
