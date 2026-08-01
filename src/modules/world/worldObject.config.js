// ====== إعدادات "كائنات العالم" (World Objects) ======
// ====== REBUILT: data-driven compatibility layer ======
// This file no longer hardcodes WORLD_OBJECT_TYPES - it derives it from
// the central NPC Registry (npcRegistry.js), which auto-discovers every
// world-object-shaped definition from definitions/objects/*.def.js.
// worldPopulation.generator.js (WORLD_OBJECT_TYPES, pickWeightedType) and
// anything else that already requires this file keep working with zero
// changes - only the data source moved.
//
// To add a new auto-spawning world object (a new barbarian-camp variant,
// a new landmark, a new decoration...), drop a new *.def.js file in
// definitions/objects/ with a unique key and a spawn_weight - it appears
// here automatically on next process start, no engine change required.
// (Continuous background terrain - trees/mountains/rivers/roads/bridges -
// is still handled entirely by the existing frontend chunk/biome renderer
// and intentionally out of scope here, same as the original file.)

const { getAutoSpawnWorldObjectTypes } = require('./npcRegistry');

const WORLD_OBJECT_TYPES = Object.fromEntries(
  getAutoSpawnWorldObjectTypes().map((def) => [
    def.key,
    {
      key: def.key,
      name_ar: def.name_ar || def.name,
      category: def.category,
      spawn_weight: def.spawn_weight,
      min_distance_slots: def.spawn_rules?.min_distance_slots ?? 1,
      level_range: def.level_range,
      has_garrison: !!def.has_garrison,
      respawns: !!def.respawns,
      ...(def.subtypes ? { subtypes: def.subtypes } : {}),
    },
  ])
);

const WEIGHTED_TYPE_POOL = Object.values(WORLD_OBJECT_TYPES).flatMap((t) =>
  Array(Math.round(t.spawn_weight * 10)).fill(t.key)
);

function pickWeightedType(rand) {
  return WEIGHTED_TYPE_POOL[Math.floor(rand() * WEIGHTED_TYPE_POOL.length)];
}

module.exports = {
  WORLD_OBJECT_TYPES,
  pickWeightedType,
};
