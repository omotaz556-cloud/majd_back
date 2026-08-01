// ====== World Initialization Service ======
// Called once from server.js right after the MongoDB connection is
// established. Fully idempotent and safe to run on every process start
// (including multiple server instances behind a load balancer):
//
//  - World already generated  -> logs "World already initialized." and
//    returns immediately (one findOne query, no region work at all).
//  - World never generated    -> logs "Generating world...", populates a
//    starting radius of regions via the SAME ensureRegionPopulated() path
//    used by normal lazy player exploration (so there is only one
//    generation code path, never two to keep in sync), then logs
//    "World generation completed successfully."
//  - Another instance is already generating -> logs and returns without
//    doing any duplicate work (claimed via an atomic status update).
//
// No manual script run is required after deployment - this replaces the
// old "run backfillWorldRegions.js by hand" step for the initial seed.
// The manual script still exists for expanding the world later (see
// backend/scripts/world-gen/backfillWorldRegions.js) and now shares this
// same underlying regenerateMissingNpcs() helper (see worldAdmin.service.js).

const WorldMeta = require('./worldMeta.model');
const worldMapService = require('../castle/worldMap.service');

const DEFAULT_RADIUS_REGIONS = Number(process.env.WORLD_INIT_RADIUS_REGIONS) || 6;
const CONCURRENCY = 8;
// If a previous process died mid-generation, don't let its stale
// "generating" claim block startup forever.
const STALE_LOCK_MS = 15 * 60 * 1000;

function regionCoordsInRadius(radius) {
  const coords = [];
  for (let rx = -radius; rx <= radius; rx += 1) {
    for (let ry = -radius; ry <= radius; ry += 1) {
      coords.push([rx, ry]);
    }
  }
  return coords;
}

async function runInBatches(items, concurrency, worker) {
  let totalCastles = 0;
  let totalObjects = 0;
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    // eslint-disable-next-line no-await-in-loop
    const results = await Promise.all(batch.map(worker));
    for (const r of results) {
      totalCastles += r?.npc_castles_created || 0;
      totalObjects += r?.world_objects_created || 0;
    }
  }
  return { totalCastles, totalObjects };
}

// ====== يحاول "يحجز" مهمة التوليد ذريًا - عشان لو أكتر من نسخة سيرفر
// بتشتغل في نفس الوقت (خلف load balancer)، نسخة واحدة بس هي اللي بتولّد
// والباقي بيرجع فورًا من غير أي تكرار عمل. ======
async function claimGenerationLock(desiredRadius) {
  const existing = await WorldMeta.findOne({ _id: 'world' });

  // ====== NEW: العالم "جاهز" فعلًا بس بنصف قطر أصغر من المطلوب دلوقتي (مثلاً
  // اتعمّر أول مرة بقيمة افتراضية أقدم، أو قبل ما WORLD_INIT_RADIUS_REGIONS
  // يتزوّد لاحقًا) - بدل ما نرجع فورًا للأبد ونسيب المناطق الجديدة فاضية،
  // بنطلب "توسعة" (نفس قفل الـ generating العادي) بس من غير ما نلمس حالة
  // العالم القديمة لو حد تاني بالفعل بيعمل توسعة دلوقتي. ensureRegionPopulated
  // idempotent وسريع جدًا (findOne واحد) لأي منطقة اتعمّرت قبل كده، فإعادة
  // تشغيل نفس نطاق النصف قطر القديم تاني مجانية تقريبًا. ======
  if (existing && existing.status === 'ready') {
    const alreadyCoveredRadius = existing.initialized_radius_regions ?? 0;
    if (desiredRadius <= alreadyCoveredRadius) {
      return { claimed: false, alreadyReady: true };
    }
    const reclaimed = await WorldMeta.findOneAndUpdate(
      { _id: 'world', status: 'ready' },
      { $set: { status: 'generating', started_at: new Date(), last_error: null } },
      { new: true }
    );
    return { claimed: !!reclaimed, alreadyReady: false, expanding: true };
  }

  if (existing && existing.status === 'generating') {
    const age = existing.started_at ? Date.now() - existing.started_at.getTime() : Infinity;
    if (age < STALE_LOCK_MS) {
      return { claimed: false, alreadyReady: false, inProgressElsewhere: true };
    }
    // Stale lock left by a crashed process - reclaim it.
    const reclaimed = await WorldMeta.findOneAndUpdate(
      { _id: 'world', status: 'generating', started_at: existing.started_at },
      { $set: { status: 'generating', started_at: new Date(), last_error: null } },
      { new: true }
    );
    return { claimed: !!reclaimed, alreadyReady: false };
  }

  if (existing && existing.status === 'failed') {
    const reclaimed = await WorldMeta.findOneAndUpdate(
      { _id: 'world', status: 'failed' },
      { $set: { status: 'generating', started_at: new Date(), last_error: null } },
      { new: true }
    );
    return { claimed: !!reclaimed, alreadyReady: false };
  }

  // No document at all yet - first server ever to boot against this DB.
  try {
    await WorldMeta.create({ _id: 'world', status: 'generating', started_at: new Date() });
    return { claimed: true, alreadyReady: false };
  } catch (err) {
    if (err.code === 11000) {
      // Another process created it in the same instant - it owns generation.
      return { claimed: false, alreadyReady: false, inProgressElsewhere: true };
    }
    throw err;
  }
}

async function initializeWorldOnStartup(options = {}) {
  const radiusInRegions = options.radiusInRegions ?? DEFAULT_RADIUS_REGIONS;

  const claim = await claimGenerationLock(radiusInRegions);

  if (claim.alreadyReady) {
    console.log('[World] World already initialized.');
    return { alreadyInitialized: true };
  }
  if (claim.inProgressElsewhere) {
    console.log('[World] World generation already in progress (started elsewhere) - skipping.');
    return { alreadyInitialized: false, skipped: true };
  }
  if (!claim.claimed) {
    console.log('[World] World already initialized.');
    return { alreadyInitialized: true };
  }

  console.log(
    claim.expanding
      ? `[World] Expanding world coverage... (radius = ${radiusInRegions} regions around center, previously-seeded regions are skipped instantly)`
      : `[World] Generating world... (radius = ${radiusInRegions} regions around center)`
  );

  try {
    const coords = regionCoordsInRadius(radiusInRegions);
    const { totalCastles, totalObjects } = await runInBatches(coords, CONCURRENCY, ([rx, ry]) =>
      worldMapService.ensureRegionPopulated(rx, ry)
    );

    await WorldMeta.updateOne(
      { _id: 'world' },
      {
        $set: {
          status: 'ready',
          total_npc_castles_created: totalCastles,
          total_world_objects_created: totalObjects,
          finished_at: new Date(),
          last_error: null,
        },
        // ====== أعلى نصف قطر اتغطى فعليًا لحد دلوقتي - $max (بدل $set) عشان
        // لو حد شغّل initializeWorldOnStartup بـ options.radiusInRegions أصغر
        // من المسجّل قبل كده لسبب ما، القيمة المخزّنة متصغّرش وتخلي أي إعادة
        // تشغيل تانية تفتكر إن مناطق اتغطّت فعلًا لسه محتاجة توسعة من غير داعي. ======
        $max: { initialized_radius_regions: radiusInRegions },
      }
    );

    console.log(
      `[World] World generation completed successfully. (${totalCastles} NPC castles, ${totalObjects} world objects across ${coords.length} regions)`
    );
    return { alreadyInitialized: false, totalCastles, totalObjects };
  } catch (err) {
    console.error('[World] World generation failed:', err.message);
    await WorldMeta.updateOne(
      { _id: 'world' },
      { $set: { status: 'failed', last_error: err.message } }
    ).catch(() => {});
    // Never crash the server over world generation - the API/gameplay for
    // already-existing players must keep working; the next process start
    // (or an admin regenerateMissingNpcs() call) will retry.
    return { alreadyInitialized: false, failed: true, error: err.message };
  }
}

module.exports = { initializeWorldOnStartup };
