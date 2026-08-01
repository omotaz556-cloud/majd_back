// ====== NPC Registry (data-driven NPC type system) ======
// Central, self-loading registry of every NPC/world-entity type in the
// game. This is the ONLY place that knows how many NPC types exist and
// what they look like — the generation engine (npcCastle.generator.js,
// worldPopulation.generator.js, worldMap.service.js) never hardcodes a
// type name; it always asks this registry.
//
// Adding a brand-new NPC type (village/town/castle/fortress/barbarian
// camp/guard tower/ancient ruins/neutral city/boss castle/event NPC/
// seasonal NPC/anything future) requires ONLY dropping a new *.def.js
// file inside definitions/castles/ or definitions/objects/ — nothing in
// this file, in npcCastle.generator.js, or in worldPopulation.generator.js
// needs to change. Files are discovered automatically at require-time via
// fs.readdirSync, so a new definition is live on the next process start.
//
// Two "doc_type" families exist, matching the two storage shapes already
// in the schema:
//  - 'castle'       -> becomes a full Castle + CastleDefense document
//                      (village, town, fortified_town, castle, stronghold,
//                      elite_fortress, boss_castle, event/seasonal castles)
//  - 'world_object' -> becomes a WorldObject document (barbarian camps,
//                      resource nodes, ruins, temples, neutral villages,
//                      guard towers, neutral fortresses/cities, decor)
//
// Every definition may declare the full data-driven field set requested:
// name, category, level_range, appearance/castle_skin, buildings/
// defensive structures/wall_hp/gates/watch_towers (expressed as ratios &
// counts the generic engine scales by level — see each *.def.js file),
// garrison, troops, commander, ai_behavior, rewards/loot tables,
// spawn_weight, spawn_rules (min/max ring, min distance, manual_only),
// allowed_regions, allowed_biomes, resource_production, city_decor.

const fs = require('fs');
const path = require('path');

const registry = new Map();

function validateDefinition(def) {
  if (!def || typeof def !== 'object') {
    throw new Error('[NpcRegistry] Invalid NPC definition (not an object)');
  }
  if (!def.key || typeof def.key !== 'string') {
    throw new Error('[NpcRegistry] NPC definition is missing a unique "key"');
  }
  if (!def.doc_type || !['castle', 'world_object'].includes(def.doc_type)) {
    throw new Error(`[NpcRegistry] NPC definition "${def.key}" needs doc_type "castle" or "world_object"`);
  }
  if (registry.has(def.key)) {
    throw new Error(`[NpcRegistry] Duplicate NPC definition key: "${def.key}"`);
  }
}

function registerNpcType(def) {
  validateDefinition(def);
  registry.set(def.key, Object.freeze({ enabled: true, ...def }));
  return def;
}

function loadDefinitionsFrom(subdir) {
  const full = path.join(__dirname, 'definitions', subdir);
  if (!fs.existsSync(full)) return;
  const files = fs.readdirSync(full).filter((f) => f.endsWith('.def.js'));
  for (const file of files) {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const loaded = require(path.join(full, file));
    const defs = Array.isArray(loaded) ? loaded : [loaded];
    defs.forEach(registerNpcType);
  }
}

// ====== Auto-discovery - the only two lines that ever need to run when a
// brand-new definitions/ subfolder is introduced; adding files inside an
// existing folder needs zero code changes at all. ======
loadDefinitionsFrom('castles');
loadDefinitionsFrom('objects');

function getNpcType(key) {
  return registry.get(key);
}

function getAllNpcTypes() {
  return Array.from(registry.values());
}

function getEnabledNpcTypes() {
  return getAllNpcTypes().filter((d) => d.enabled !== false);
}

function getNpcTypesByDocType(docType) {
  return getAllNpcTypes().filter((d) => d.doc_type === docType);
}

function getEnabledNpcTypesByDocType(docType) {
  return getEnabledNpcTypes().filter((d) => d.doc_type === docType);
}

function getNpcTypesByCategory(category) {
  return getAllNpcTypes().filter((d) => d.category === category);
}

// Auto-spawn-eligible: enabled AND not manual_only (event/seasonal/boss
// definitions can set spawn_rules.manual_only=true so the regular
// procedural sweep never rolls them - they only appear via the admin
// service's spawnNpcType()/spawnBoss(), exactly like "Event NPCs" and
// "Seasonal NPCs" should behave).
function getAutoSpawnCastleTypes() {
  return getEnabledNpcTypesByDocType('castle').filter((d) => !d.spawn_rules?.manual_only);
}

function getAutoSpawnWorldObjectTypes() {
  return getEnabledNpcTypesByDocType('world_object').filter((d) => !d.spawn_rules?.manual_only);
}

module.exports = {
  registerNpcType,
  getNpcType,
  getAllNpcTypes,
  getEnabledNpcTypes,
  getNpcTypesByDocType,
  getEnabledNpcTypesByDocType,
  getNpcTypesByCategory,
  getAutoSpawnCastleTypes,
  getAutoSpawnWorldObjectTypes,
};
