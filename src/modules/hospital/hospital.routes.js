// ====== Phase 7: Hospital & Recovery System - Routes ======

'use strict';

const express = require('express');
const { protect } = require('../../middleware/auth.middleware');
const { getOverview, healBatch, healAll, cancelHealing } = require('./hospital.controller');

const router = express.Router();

// ====== Overview: Current Capacity / Occupied Beds / Healing Queue /
// Remaining Healing Time per batch. ======
router.get('/', protect, getOverview);

// ====== Recovery actions ======
router.post('/heal-all', protect, healAll);
// ====== Express 5's router (path-to-regexp v8) dropped the old ':param?'
// optional-segment syntax ('/heal/:batchId?' throws PathError at startup) -
// two explicit routes to the same handler achieve the same thing (batchId
// omitted = heal earliest ready batch), and work on any path-to-regexp
// version. ======
router.post('/heal', protect, healBatch);
router.post('/heal/:batchId', protect, healBatch);
router.delete('/queue/:batchId', protect, cancelHealing);

module.exports = router;
