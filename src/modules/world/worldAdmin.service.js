// ====== World Admin Service ======
// Internal-only helper functions (no routes/UI - call these directly from
// a REPL, a one-off script, or a future admin controller). Every function
// here reuses the SAME generation engine as normal gameplay
// (worldMapService.ensureRegionPopulated, npcCastle.generator, the NPC
// registry) - there is no separate "admin" generation path to keep in
// sync with the real one.
//
// Available operations:
//  - regenerateMissingNpcs(radiusInRegions)   -> fills any never-seeded
//    region in the radius; already-seeded regions are skipped instantly.
//  - regenerateRegion(regionX, regionY)       -> same, for one region.
//  - resetRegion(regionX, regionY)            -> wipes NPC-owned data in
//    one region (never player castles) and regenerates it from scratch.
//  - spawnNpcType(key, mapSlot)               -> spawns one specific
//    registered NPC definition at an exact map_slot.
//  - spawnBoss(mapSlot)                       -> convenience wrapper
//    around spawnNpcType('boss_castle', mapSlot).
//  - removeNpc(id)                            -> deletes one NPC-owned
//    Castle+CastleDefense or WorldObject by id (never a real player's
//    castle). Added for the admin API's "Remove NPC" endpoint.
//  - verifyWorldIntegrity()                   -> returns a report object
//    (duplicate NPCs, duplicate world objects, per-region distribution,
//    average nearest-neighbor spacing, world-object overlap).
//  - countNpcsByType()                        -> counts grouped by tier
//    (castles) and by type (world objects).
//  - detectDuplicateWorldObjects()            -> exact-overlap map_slot
//    check across the WorldObject collection.

const Castle = require('../castle/castle.model');
const CastleDefense = require('../defense/defense.model');
const WorldObject = require('./worldObject.model');
const WorldRegionState = require('./worldRegionState.model');
const WorldMeta = require('./worldMeta.model');
const worldMapService = require('../castle/worldMap.service');
const {
  rollLevelWithinTier,
  generateNpcBuildings,
  generateCityDecor,
  generateNpcResources,
  generateNpcGarrison,
  generateNpcCommander,
  generateNpcDefenseStructures,
} = require('../castle/npcCastle.generator');
const { mulberry32 } = require('./worldPopulation.generator');
const { getNpcType, getAllNpcTypes } = require('./npcRegistry');
const { pickFaction } = require('./factions.config');

const { SLOT_SPACING, REGION_SIZE_UNITS } = worldMapService;

function regionBounds(regionX, regionY) {
  const minX = regionX * REGION_SIZE_UNITS;
  const minY = regionY * REGION_SIZE_UNITS;
  return { minX, minY, maxX: minX + REGION_SIZE_UNITS - SLOT_SPACING, maxY: minY + REGION_SIZE_UNITS - SLOT_SPACING };
}

// ====== يحوّل تعريف "قلعة" من الـ registry (أي واحد، حتى لو manual_only
// زي boss_castle) لنفس شكل "tier" اللي دوال npcCastle.generator المصدّرة
// أصلًا (generateNpcBuildings...) بتستنى - نفس التحويل المستخدم جوه
// npcTiers.config.js بالظبط، من غير أي تعديل على تلك الدوال. ======
function defToTierShape(def) {
  return {
    id: def.key,
    name_ar: def.name_ar || def.name,
    level_range: def.level_range,
    skin: def.castle_skin || def.appearance?.skin || def.key,
    garrison_multiplier: def.garrison_multiplier,
    wall_level_ratio: def.wall_level_ratio,
    tower_count_range: def.tower_count_range,
    reward_multiplier: def.reward_multiplier,
    ai_posture: def.ai_behavior,
    city_decor: def.city_decor || [],
    city_lighting: def.appearance?.city_lighting !== false,
  };
}

function buildCastleDocForDefinition(def, mapSlot) {
  const seed = Math.abs((mapSlot.x * 73856093) ^ (mapSlot.y * 19349663) ^ 0x9e3779b9) >>> 0;
  const rand = mulberry32(seed || 1);
  const tier = defToTierShape(def);
  // Same faction system as the normal procedural sweep (npcCastle.generator
  // buildNpcCastleDoc) - manual/admin-spawned castles (boss castles, event
  // NPCs, spawnNpcType) get a faction too, for the same name/skin/troop-mix/
  // reward flavor, without any change to the combat engine.
  const faction = pickFaction(tier.id, rand);

  const townHallLevel = rollLevelWithinTier(tier, rand);
  const { buildings, occupied } = generateNpcBuildings(townHallLevel, rand);
  const cityDecor = generateCityDecor(tier, townHallLevel, occupied, rand);
  const resources = generateNpcResources(buildings, townHallLevel, rand);
  const army = generateNpcGarrison(townHallLevel, tier, rand, faction);
  const commander = def.commander?.enabled === false ? null : generateNpcCommander(tier, townHallLevel, rand, faction);
  const defenseStructures = generateNpcDefenseStructures(townHallLevel, tier, rand);

  return {
    map_slot: mapSlot,
    is_npc: true,
    npc_name: `${def.name || def.key} #${Math.floor(rand() * 9000 + 1000)}`,
    npc_tier: tier.id,
    npc_faction: faction.key,
    npc_skin: tier.skin,
    npc_skin_variant: faction.skin_variant,
    reward_multiplier: Math.round(tier.reward_multiplier * faction.reward_modifier * 100) / 100,
    city_decor: cityDecor,
    city_lighting: tier.city_lighting,
    buildings,
    resources,
    army,
    _defenseStructures: defenseStructures,
    _commander: commander,
    _aiPosture: tier.ai_posture,
  };
}

// ====== NEW: مفيش نسخة تانية من الدالة دي هنا خالص - saveCastleDoc بقت
// معرّفة مرة واحدة بس في worldMap.service.js (نفس الكود بالظبط اللي كان
// هنا قبل كده) عشان "مفيش نظام NPC منفصل" - القلاع اللي بتتولّد يدويًا من
// هنا (spawnNpcType) والقلاع اللي بتتولّد تلقائيًا وهي بتعمّر منطقة جديدة
// (ensureRegionPopulated) بيستخدموا نفس الدالة نفسها بالظبط، مش نسخة
// متطابقة منفصلة ممكن تتفرق عنها لاحقًا بالغلط. ======
const { saveCastleDoc } = worldMapService;

// ====== Regenerate missing NPCs / regions ======

async function regenerateMissingNpcs(radiusInRegions = 6) {
  let totalCastles = 0;
  let totalObjects = 0;
  let regionsProcessed = 0;
  for (let rx = -radiusInRegions; rx <= radiusInRegions; rx += 1) {
    for (let ry = -radiusInRegions; ry <= radiusInRegions; ry += 1) {
      // eslint-disable-next-line no-await-in-loop
      const result = await worldMapService.ensureRegionPopulated(rx, ry);
      regionsProcessed += 1;
      totalCastles += result.npc_castles_created || 0;
      totalObjects += result.world_objects_created || 0;
    }
  }
  return { regionsProcessed, npc_castles_created: totalCastles, world_objects_created: totalObjects };
}

async function regenerateRegion(regionX, regionY) {
  return worldMapService.ensureRegionPopulated(regionX, regionY);
}

// ====== Reset one region: removes only NPC-owned data (never a real
// player's Castle document, per the hard "player data is never modified"
// requirement) then regenerates the region from scratch. ======
async function resetRegion(regionX, regionY) {
  const bounds = regionBounds(regionX, regionY);
  const npcQuery = {
    is_npc: true,
    'map_slot.x': { $gte: bounds.minX, $lte: bounds.maxX },
    'map_slot.y': { $gte: bounds.minY, $lte: bounds.maxY },
  };

  const npcCastles = await Castle.find(npcQuery).select('_id');
  const npcCastleIds = npcCastles.map((c) => c._id);

  await Promise.all([
    CastleDefense.deleteMany({ castle_id: { $in: npcCastleIds } }),
    Castle.deleteMany(npcQuery),
    WorldObject.deleteMany({
      'map_slot.x': { $gte: bounds.minX, $lte: bounds.maxX },
      'map_slot.y': { $gte: bounds.minY, $lte: bounds.maxY },
    }),
    WorldRegionState.deleteOne({ region_x: regionX, region_y: regionY }),
  ]);

  return regenerateRegion(regionX, regionY);
}

// ====== Spawn one specific registered NPC type at an exact map_slot -
// works for both doc_type families (castle-shaped or world-object-shaped),
// including manual_only definitions (boss castles, event/seasonal NPCs)
// that the normal procedural sweep never rolls on its own. ======
async function spawnNpcType(key, mapSlot) {
  const def = getNpcType(key);
  if (!def) {
    throw new Error(`[WorldAdmin] Unknown NPC type "${key}" - is it registered under world/definitions/?`);
  }

  const taken = await Castle.exists({ 'map_slot.x': mapSlot.x, 'map_slot.y': mapSlot.y });
  const takenObj = taken || (await WorldObject.exists({ 'map_slot.x': mapSlot.x, 'map_slot.y': mapSlot.y }));
  if (takenObj) {
    throw new Error(`[WorldAdmin] map_slot (${mapSlot.x}, ${mapSlot.y}) is already occupied`);
  }

  if (def.doc_type === 'castle') {
    const doc = buildCastleDocForDefinition(def, mapSlot);
    return saveCastleDoc(doc);
  }

  // world_object - build directly from the definition (forced type,
  // instead of worldPopulation.generator's weighted pickWeightedType).
  const rand = mulberry32(Math.abs((mapSlot.x * 2654435761) ^ (mapSlot.y * 40503)) >>> 0 || 1);
  const level = def.level_range
    ? def.level_range[0] + Math.floor(rand() * (def.level_range[1] - def.level_range[0] + 1))
    : 1;
  const { regionX, regionY } = worldMapService.regionForMapSlot(mapSlot);
  const richness = 50 + level * 25;

  return WorldObject.create({
    type: def.key,
    subtype: def.subtypes ? def.subtypes[Math.floor(rand() * def.subtypes.length)] : null,
    level,
    map_slot: mapSlot,
    region_x: regionX,
    region_y: regionY,
    garrison: def.has_garrison
      ? [
          { key: 'swordsman', count: Math.round(10 + level * 3) },
          { key: 'archer', count: Math.round(10 + level * 3) },
        ]
      : [],
    loot:
      def.category === 'gatherable' || def.category === 'hostile'
        ? { gold: Math.round(richness * 0.8), wood: Math.round(richness * 0.8), stone: Math.round(richness * 0.8) }
        : { gold: 0, wood: 0, stone: 0 },
    respawns: !!def.respawns,
  });
}

async function spawnBoss(mapSlot) {
  return spawnNpcType('boss_castle', mapSlot);
}

// ====== Remove one NPC (castle-shaped or world-object-shaped) by its
// document id. Mirrors spawnNpcType's two doc_type families in reverse -
// tries an NPC-only Castle first (never touches a real player's castle),
// then falls back to WorldObject. Used only by the admin API; the normal
// generation/gameplay path never deletes anything on its own. ======
async function removeNpc(id) {
  const npcCastle = await Castle.findOne({ _id: id, is_npc: true });
  if (npcCastle) {
    await CastleDefense.deleteOne({ castle_id: npcCastle._id });
    await Castle.deleteOne({ _id: npcCastle._id });
    return { removed: true, doc_type: 'castle', id };
  }

  const worldObject = await WorldObject.findOne({ _id: id });
  if (worldObject) {
    await WorldObject.deleteOne({ _id: id });
    return { removed: true, doc_type: 'world_object', id };
  }

  throw new Error(`[WorldAdmin] No NPC castle or world object found with id "${id}"`);
}

// ====== Reporting / verification (importable version of
// scripts/world-gen/verifyWorld.js's checks - returns a plain object
// instead of printing + exiting, so it can be called from a running
// server process without disconnecting its DB connection). ======

async function countNpcsByType() {
  const castleAgg = await Castle.aggregate([
    { $match: { is_npc: true } },
    { $group: { _id: '$npc_tier', count: { $sum: 1 } } },
  ]);
  const objectAgg = await WorldObject.aggregate([{ $group: { _id: '$type', count: { $sum: 1 } } }]);

  return {
    registeredTypes: getAllNpcTypes().map((d) => d.key),
    castlesByTier: Object.fromEntries(castleAgg.map((r) => [r._id || 'unknown', r.count])),
    objectsByType: Object.fromEntries(objectAgg.map((r) => [r._id || 'unknown', r.count])),
  };
}

async function detectDuplicateWorldObjects() {
  const dupes = await WorldObject.aggregate([
    { $group: { _id: '$map_slot', count: { $sum: 1 }, ids: { $push: '$_id' } } },
    { $match: { count: { $gt: 1 } } },
  ]);
  return dupes;
}

async function detectDuplicateNpcCastles() {
  const dupes = await Castle.aggregate([
    { $match: { is_npc: true } },
    { $group: { _id: '$map_slot', count: { $sum: 1 }, ids: { $push: '$_id' } } },
    { $match: { count: { $gt: 1 } } },
  ]);
  return dupes;
}

async function verifyWorldIntegrity({ sampleSize = 500 } = {}) {
  const npcCastles = await Castle.find({ is_npc: true }).select('map_slot npc_tier').lean();
  const playerCastleCount = await Castle.countDocuments({ is_npc: { $ne: true } });
  const worldObjects = await WorldObject.find({}).select('map_slot type').lean();
  const regionsSeeded = await WorldRegionState.countDocuments({});

  const tierCounts = {};
  for (const c of npcCastles) tierCounts[c.npc_tier || 'unknown'] = (tierCounts[c.npc_tier || 'unknown'] || 0) + 1;

  const regionHist = {};
  for (const c of npcCastles) {
    const { regionX, regionY } = worldMapService.regionForMapSlot(c.map_slot);
    const key = `${regionX},${regionY}`;
    regionHist[key] = (regionHist[key] || 0) + 1;
  }
  const counts = Object.values(regionHist);
  const avgPerRegion = counts.length ? counts.reduce((a, b) => a + b, 0) / counts.length : 0;

  const duplicateNpcCastles = await detectDuplicateNpcCastles();
  const duplicateWorldObjects = await detectDuplicateWorldObjects();

  const sample = Math.min(sampleSize, npcCastles.length);
  let totalMinDist = 0;
  for (let i = 0; i < sample; i += 1) {
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
  const avgNearestNeighborDistance = sample > 0 ? totalMinDist / sample : null;

  const passed = duplicateNpcCastles.length === 0 && duplicateWorldObjects.length === 0;

  return {
    totals: {
      npcCastles: npcCastles.length,
      playerCastles: playerCastleCount,
      worldObjects: worldObjects.length,
      regionsSeeded,
    },
    npcCastlesByTier: tierCounts,
    regionDistribution: { populatedRegions: counts.length, avgPerRegion, min: counts.length ? Math.min(...counts) : 0, max: counts.length ? Math.max(...counts) : 0 },
    avgNearestNeighborDistance,
    duplicateNpcCastles,
    duplicateWorldObjects,
    passed,
  };
}

// ====== High-level "world statistics" snapshot for the admin API - combines
// the one-row WorldMeta init record (status/started/finished/last_error)
// written by worldInit.service on server boot with a live count of
// everything currently in the DB. No new counting logic: reuses
// countNpcsByType() and WorldRegionState.countDocuments() as-is. ======
async function getWorldStatistics() {
  const [meta, npcCounts, regionsSeeded, playerCastles] = await Promise.all([
    WorldMeta.findById('world').lean(),
    countNpcsByType(),
    WorldRegionState.countDocuments({}),
    Castle.countDocuments({ is_npc: { $ne: true } }),
  ]);

  return {
    meta: meta || null,
    regionsSeeded,
    playerCastles,
    ...npcCounts,
  };
}

module.exports = {
  regenerateMissingNpcs,
  regenerateRegion,
  resetRegion,
  spawnNpcType,
  spawnBoss,
  removeNpc,
  countNpcsByType,
  detectDuplicateWorldObjects,
  detectDuplicateNpcCastles,
  verifyWorldIntegrity,
  getWorldStatistics,
};
