// ====== World Admin Routes (NEW) ======
// Mounted at /api/admin/world in app.js. Same protection pattern as
// modules/admin/admin.routes.js: every route requires a valid token
// (protect) AND the 'admin' role (authorize('admin')) - no exceptions.

const express = require('express');
const { protect, authorize } = require('../../middleware/auth.middleware');
const {
  verifyWorld,
  repairWorld,
  regenerateRegion,
  populateRegion,
  spawnNpc,
  spawnBoss,
  removeNpc,
  countNpcTypes,
  listRegisteredNpcTypes,
  getWorldStatistics,
} = require('./worldAdmin.controller');

const router = express.Router();

// كل الـ routes هنا لازم تكون protected + admin role بس، مفيش أي استثناء
router.use(protect, authorize('admin'));

// التحقق من سلامة العالم / إصلاحه
router.post('/verify', verifyWorld);
router.post('/repair', repairWorld);

// إدارة المناطق (Regions)
router.post('/regions/:regionX/:regionY/regenerate', regenerateRegion);
router.post('/regions/:regionX/:regionY/populate', populateRegion);

// إدارة الـ NPCs (إنشاء/حذف)
router.post('/npcs/spawn', spawnNpc);
router.post('/npcs/spawn-boss', spawnBoss);
router.delete('/npcs/:id', removeNpc);

// معلومات/إحصائيات الـ NPCs والعالم
router.get('/npcs/count', countNpcTypes);
router.get('/npcs/types', listRegisteredNpcTypes);
router.get('/stats', getWorldStatistics);

module.exports = router;
