// ====== Phase 7: Hospital & Recovery System - Controller ======
// Thin HTTP layer only - all real logic lives in hospital.service.js.

'use strict';

const hospitalService = require('./hospital.service');

async function getOverview(req, res) {
  try {
    const overview = await hospitalService.getHospitalOverview(req.user._id);
    return res.json(overview);
  } catch (err) {
    console.error('[Hospital] getOverview error:', err.message);
    return res.status(500).json({ error: 'تعذر تحميل المستشفى' });
  }
}

async function healBatch(req, res) {
  try {
    const overview = await hospitalService.healOneBatch(req.user._id, req.params.batchId || null);
    return res.json(overview);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function healAll(req, res) {
  try {
    const result = await hospitalService.healAllPossible(req.user._id);
    return res.json(result);
  } catch (err) {
    console.error('[Hospital] healAll error:', err.message);
    return res.status(500).json({ error: 'تعذر إتمام العلاج' });
  }
}

async function cancelHealing(req, res) {
  try {
    const overview = await hospitalService.cancelHealing(req.user._id, req.params.batchId);
    return res.json(overview);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

module.exports = {
  getOverview,
  healBatch,
  healAll,
  cancelHealing,
};
