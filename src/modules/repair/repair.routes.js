// ====== Phase 8: Building Repair System - Routes ======

'use strict';

const express = require('express');
const { protect } = require('../../middleware/auth.middleware');
const { getOverview, repairOne, repairAll, cancelRepair } = require('./repair.controller');

const router = express.Router();

// ====== View: Current HP / Maximum HP / Repair Cost / Repair Time / Repair
// State for every damaged structure + progress on any active repair. ======
router.get('/', protect, getOverview);

// ====== '/all' must be registered before '/:structureId' - otherwise
// Express would match POST /api/repair/all as structureId === 'all'. ======
router.post('/all', protect, repairAll);
router.post('/:structureId', protect, repairOne);

router.delete('/:repairId', protect, cancelRepair);

module.exports = router;
