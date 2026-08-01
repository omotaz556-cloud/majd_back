// ====== Phase 8: Building Repair System - Controller ======
// Thin HTTP layer only - all real logic lives in repair.service.js.

'use strict';

const repairService = require('./repair.service');

async function getOverview(req, res) {
  try {
    const overview = await repairService.getRepairOverview(req.user._id);
    return res.json(overview);
  } catch (err) {
    console.error('[Repair] getOverview error:', err.message);
    return res.status(500).json({ error: 'تعذر تحميل حالة الإصلاح' });
  }
}

async function repairOne(req, res) {
  try {
    const progress = await repairService.repairOne(req.user._id, req.params.structureId);
    return res.json(progress);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function repairAll(req, res) {
  try {
    const result = await repairService.repairAll(req.user._id);
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function cancelRepair(req, res) {
  try {
    const progress = await repairService.cancelRepair(req.user._id, req.params.repairId);
    return res.json(progress);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

module.exports = {
  getOverview,
  repairOne,
  repairAll,
  cancelRepair,
};
