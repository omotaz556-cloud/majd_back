/**
 * backfillWorldRegions.js
 *
 * Proactively seeds NPC castles + world objects across a configurable radius
 * of regions around the map center, instead of relying only on lazy
 * per-player exploration (ensureNpcNeighbors). Safe to run repeatedly:
 * every region goes through the same ensureRegionPopulated() path used by
 * normal gameplay, which is idempotent (WorldRegionState-gated) and never
 * touches an already-seeded region or an existing player castle.
 *
 * Place this file at backend/scripts/world-gen/backfillWorldRegions.js
 * (so the relative requires below resolve into backend/src/modules).
 *
 * Usage:
 *   MONGO_URI=... node scripts/world-gen/backfillWorldRegions.js [radiusInRegions]
 *
 * Default radius is 15 regions (= 15 * 8 * 40 = 4800 world units in every
 * direction from center) - adjust to match how far your current players
 * have actually spread (check Castle.map_slot max distance first).
 */

const mongoose = require('mongoose');
const path = require('path');

const RADIUS_IN_REGIONS = parseInt(process.argv[2], 10) || 15;
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('FATAL: set MONGO_URI in the environment before running.');
  process.exit(1);
}

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log(`Connected. Backfilling regions in radius ${RADIUS_IN_REGIONS} around (0,0)...`);

  // required relative to this script's real location: backend/scripts/world-gen/
  const worldMapService = require(path.join('..', '..', 'src', 'modules', 'castle', 'worldMap.service'));

  let seededNow = 0;
  let alreadySeeded = 0;
  let totalNpc = 0;
  let totalObjects = 0;
  let processed = 0;
  const totalRegions = (RADIUS_IN_REGIONS * 2 + 1) ** 2;

  for (let rx = -RADIUS_IN_REGIONS; rx <= RADIUS_IN_REGIONS; rx += 1) {
    for (let ry = -RADIUS_IN_REGIONS; ry <= RADIUS_IN_REGIONS; ry += 1) {
      // eslint-disable-next-line no-await-in-loop
      const result = await worldMapService.ensureRegionPopulated(rx, ry);
      processed += 1;
      if (result.alreadySeeded) {
        alreadySeeded += 1;
      } else {
        seededNow += 1;
        totalNpc += result.npc_castles_created;
        totalObjects += result.world_objects_created;
      }
      if (processed % 25 === 0 || processed === totalRegions) {
        console.log(`  ${processed}/${totalRegions} regions processed (newly seeded: ${seededNow}, already seeded: ${alreadySeeded})`);
      }
    }
  }

  console.log('\n=== Backfill summary ===');
  console.log(`Regions processed:      ${processed}`);
  console.log(`Newly seeded regions:   ${seededNow}`);
  console.log(`Already-seeded regions: ${alreadySeeded} (skipped, no writes - fill-only)`);
  console.log(`NPC castles created:    ${totalNpc}`);
  console.log(`World objects created:  ${totalObjects}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('FATAL during backfill:', err);
  process.exit(1);
});
