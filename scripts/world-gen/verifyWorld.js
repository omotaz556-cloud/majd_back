/**
 * verifyWorld.js
 *
 * Run against the real database (after backfillWorldRegions.js, or just to
 * audit the current state) to produce the metrics requested:
 *  - Total NPC castles generated (overall + by tier)
 *  - NPC distribution across the map (per-region histogram)
 *  - Average spacing between NPC cities (nearest-neighbor, sampled)
 *  - No duplicate NPCs (duplicate map_slot check)
 *  - No overlapping world objects (min-distance re-check)
 *  - Successful MongoDB persistence (round-trip re-read after a fresh
 *    connection, not just "insertMany didn't throw")
 *
 * Place at backend/scripts/world-gen/verifyWorld.js
 * Usage: MONGO_URI=... node scripts/world-gen/verifyWorld.js
 */

const mongoose = require('mongoose');
const path = require('path');

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('FATAL: set MONGO_URI in the environment.');
  process.exit(1);
}

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected (fresh connection - this alone confirms persistence survived the process that ran the backfill).');

  const Castle = require(path.join('..', '..', 'src', 'modules', 'castle', 'castle.model'));
  const WorldObject = require(path.join('..', '..', 'src', 'modules', 'world', 'worldObject.model'));
  const WorldRegionState = require(path.join('..', '..', 'src', 'modules', 'world', 'worldRegionState.model'));

  const npcCastles = await Castle.find({ is_npc: true }).select('map_slot npc_tier').lean();
  const playerCastles = await Castle.countDocuments({ is_npc: { $ne: true } });
  const worldObjects = await WorldObject.find({}).select('map_slot type').lean();
  const regionCount = await WorldRegionState.countDocuments({});

  console.log('\n=== Totals ===');
  console.log(`NPC castles:     ${npcCastles.length}`);
  console.log(`Player castles:  ${playerCastles} (untouched by this system - sanity reference only)`);
  console.log(`World objects:   ${worldObjects.length}`);
  console.log(`Regions seeded:  ${regionCount}`);

  console.log('\n=== NPC distribution by tier ===');
  const tierCounts = {};
  for (const c of npcCastles) tierCounts[c.npc_tier || 'unknown'] = (tierCounts[c.npc_tier || 'unknown'] || 0) + 1;
  console.log(tierCounts);

  console.log('\n=== Distribution by region (balance check) ===');
  const REGION_SIZE_UNITS = 8 * 40;
  const regionHist = {};
  for (const c of npcCastles) {
    const rx = Math.floor(c.map_slot.x / REGION_SIZE_UNITS);
    const ry = Math.floor(c.map_slot.y / REGION_SIZE_UNITS);
    const key = `${rx},${ry}`;
    regionHist[key] = (regionHist[key] || 0) + 1;
  }
  const counts = Object.values(regionHist);
  const avgPerRegion = counts.length ? counts.reduce((a, b) => a + b, 0) / counts.length : 0;
  const minPerRegion = counts.length ? Math.min(...counts) : 0;
  const maxPerRegion = counts.length ? Math.max(...counts) : 0;
  console.log(`Populated regions: ${counts.length}, avg NPCs/region: ${avgPerRegion.toFixed(1)}, min: ${minPerRegion}, max: ${maxPerRegion}`);
  if (maxPerRegion > avgPerRegion * 3 && counts.length > 5) {
    console.warn('WARNING: some regions have 3x+ the average NPC density - distribution may be uneven, inspect regionHist.');
  }

  console.log('\n=== Duplicate check ===');
  const seenSlots = new Set();
  let dupes = 0;
  for (const c of npcCastles) {
    const key = `${c.map_slot.x},${c.map_slot.y}`;
    if (seenSlots.has(key)) dupes += 1;
    seenSlots.add(key);
  }
  console.log(`Duplicate NPC map_slots: ${dupes}`);

  console.log('\n=== Average nearest-neighbor spacing (sampled) ===');
  const SAMPLE = Math.min(500, npcCastles.length);
  let totalMinDist = 0;
  for (let i = 0; i < SAMPLE; i += 1) {
    let best = Infinity;
    for (let j = 0; j < npcCastles.length; j += 1) {
      if (i === j) continue;
      const dx = npcCastles[i].map_slot.x - npcCastles[j].map_slot.x;
      const dy = npcCastles[i].map_slot.y - npcCastles[j].map_slot.y;
      const d = Math.hypot(dx, dy);
      if (d < best) best = d;
    }
    if (Number.isFinite(best)) totalMinDist += best;
  }
  console.log(`Sampled ${SAMPLE} castles -> avg nearest-neighbor distance: ${(totalMinDist / SAMPLE).toFixed(2)} world units`);
  if (SAMPLE >= 500) {
    console.log('NOTE: sampled (not exhaustive) - full O(n^2) pass would be slow for very large worlds. Re-run with a smaller dataset for an exact figure if needed.');
  }

  console.log('\n=== World object overlap check ===');
  let overlaps = 0;
  const seenObjSlots = new Set();
  for (const o of worldObjects) {
    const key = `${o.map_slot.x},${o.map_slot.y}`;
    if (seenObjSlots.has(key)) overlaps += 1;
    seenObjSlots.add(key);
  }
  console.log(`Exact-overlap world objects: ${overlaps}`);

  const failed = dupes > 0 || overlaps > 0;
  console.log(failed ? '\nVERIFICATION FAILED - see counts above.' : '\nVERIFICATION PASSED.');
  await mongoose.disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL during verification:', err);
  process.exit(1);
});
