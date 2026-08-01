// ====== World Admin Controller (NEW) ======
// Thin HTTP layer over the already-existing worldAdmin.service.js - every
// handler here just calls a function that was already implemented and
// tested; no generation/verification logic lives in this file. Mounted
// under /api/admin/world and protected by protect + authorize('admin') at
// the router level (see worldAdmin.routes.js), same pattern as
// modules/admin/admin.routes.js.

const worldAdminService = require('./worldAdmin.service');
const { getAllNpcTypes } = require('./npcRegistry');

// ====== POST /api/admin/world/verify - integrity report (duplicates,
// region distribution, nearest-neighbor spacing, pass/fail) ======
async function verifyWorld(req, res) {
  try {
    const report = await worldAdminService.verifyWorldIntegrity();
    return res.json({ report });
  } catch (err) {
    console.error('[WorldAdmin] verifyWorld error:', err.message);
    return res.status(500).json({ error: 'تعذر التحقق من سلامة العالم' });
  }
}

// ====== POST /api/admin/world/repair - fills any never-seeded region
// inside the given radius (default 6); already-seeded regions are left
// untouched, so this is safe to call repeatedly. ======
async function repairWorld(req, res) {
  try {
    const radiusInRegions = Number.isFinite(Number(req.body?.radiusInRegions))
      ? Number(req.body.radiusInRegions)
      : undefined;
    const result = await worldAdminService.regenerateMissingNpcs(radiusInRegions);
    return res.json({ result });
  } catch (err) {
    console.error('[WorldAdmin] repairWorld error:', err.message);
    return res.status(500).json({ error: 'تعذر إصلاح العالم' });
  }
}

// ====== POST /api/admin/world/regions/:regionX/:regionY/regenerate -
// destructive: wipes all NPC-owned data (never a player castle) in the
// region then regenerates it from scratch. ======
async function regenerateRegion(req, res) {
  try {
    const regionX = Number(req.params.regionX);
    const regionY = Number(req.params.regionY);
    if (!Number.isFinite(regionX) || !Number.isFinite(regionY)) {
      return res.status(400).json({ error: 'regionX/regionY لازم يكونوا أرقام' });
    }
    const result = await worldAdminService.resetRegion(regionX, regionY);
    return res.json({ result });
  } catch (err) {
    console.error('[WorldAdmin] regenerateRegion error:', err.message);
    return res.status(500).json({ error: 'تعذر إعادة توليد المنطقة' });
  }
}

// ====== POST /api/admin/world/regions/:regionX/:regionY/populate -
// idempotent: only fills the region if it was never seeded before. ======
async function populateRegion(req, res) {
  try {
    const regionX = Number(req.params.regionX);
    const regionY = Number(req.params.regionY);
    if (!Number.isFinite(regionX) || !Number.isFinite(regionY)) {
      return res.status(400).json({ error: 'regionX/regionY لازم يكونوا أرقام' });
    }
    const result = await worldAdminService.regenerateRegion(regionX, regionY);
    return res.json({ result });
  } catch (err) {
    console.error('[WorldAdmin] populateRegion error:', err.message);
    return res.status(500).json({ error: 'تعذر تعمير المنطقة' });
  }
}

// ====== POST /api/admin/world/npcs/spawn - body: { key, mapSlot: {x,y} } -
// spawns one specific registered NPC/world-object definition. ======
async function spawnNpc(req, res) {
  try {
    const { key, mapSlot } = req.body || {};
    if (!key || !mapSlot || typeof mapSlot.x !== 'number' || typeof mapSlot.y !== 'number') {
      return res.status(400).json({ error: 'محتاج key و mapSlot {x, y}' });
    }
    const doc = await worldAdminService.spawnNpcType(key, mapSlot);
    return res.status(201).json({ doc });
  } catch (err) {
    console.error('[WorldAdmin] spawnNpc error:', err.message);
    return res.status(400).json({ error: err.message || 'تعذر إنشاء الـ NPC' });
  }
}

// ====== POST /api/admin/world/npcs/spawn-boss - body: { mapSlot: {x,y} } ======
async function spawnBoss(req, res) {
  try {
    const { mapSlot } = req.body || {};
    if (!mapSlot || typeof mapSlot.x !== 'number' || typeof mapSlot.y !== 'number') {
      return res.status(400).json({ error: 'محتاج mapSlot {x, y}' });
    }
    const doc = await worldAdminService.spawnBoss(mapSlot);
    return res.status(201).json({ doc });
  } catch (err) {
    console.error('[WorldAdmin] spawnBoss error:', err.message);
    return res.status(400).json({ error: err.message || 'تعذر إنشاء الـ Boss' });
  }
}

// ====== DELETE /api/admin/world/npcs/:id - removes one NPC castle or
// world object by id (never touches a real player's castle). ======
async function removeNpc(req, res) {
  try {
    const { id } = req.params;
    const result = await worldAdminService.removeNpc(id);
    return res.json({ result });
  } catch (err) {
    console.error('[WorldAdmin] removeNpc error:', err.message);
    return res.status(400).json({ error: err.message || 'تعذر حذف الـ NPC' });
  }
}

// ====== GET /api/admin/world/npcs/count - counts grouped by castle tier
// and by world-object type. ======
async function countNpcTypes(req, res) {
  try {
    const counts = await worldAdminService.countNpcsByType();
    return res.json({ counts });
  } catch (err) {
    console.error('[WorldAdmin] countNpcTypes error:', err.message);
    return res.status(500).json({ error: 'تعذر حساب أعداد الـ NPCs' });
  }
}

// ====== GET /api/admin/world/npcs/types - every NPC/world-object
// definition currently registered (auto-discovered from
// definitions/castles/ + definitions/objects/ at process start) - no
// hardcoded list here, so newly dropped *.def.js files show up
// automatically with zero controller changes. ======
async function listRegisteredNpcTypes(req, res) {
  try {
    const types = getAllNpcTypes();
    return res.json({ types });
  } catch (err) {
    console.error('[WorldAdmin] listRegisteredNpcTypes error:', err.message);
    return res.status(500).json({ error: 'تعذر تحميل أنواع الـ NPCs المسجّلة' });
  }
}

// ====== GET /api/admin/world/stats - WorldMeta init snapshot + live
// counts (regions seeded, player castles, NPC breakdown). ======
async function getWorldStatistics(req, res) {
  try {
    const stats = await worldAdminService.getWorldStatistics();
    return res.json({ stats });
  } catch (err) {
    console.error('[WorldAdmin] getWorldStatistics error:', err.message);
    return res.status(500).json({ error: 'تعذر تحميل إحصائيات العالم' });
  }
}

module.exports = {
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
};
