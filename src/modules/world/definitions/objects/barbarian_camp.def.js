// ====== Barbarian Camp - core hostile world object, fully attackable via
// the shared AttackableTarget bridge (world/worldObjectCastleBridge.js).
// Re-enabled (was temporarily turned off during the NPC Faction System
// rebuild) - "hostile" category is exactly what makes it show the Attack
// button on the frontend (worldObjectRenderers.js + WorldObjectMarker).
module.exports = {
  key: 'barbarian_camp',
  doc_type: 'world_object',
  name: 'Barbarian Camp',
  name_ar: 'معسكر برابرة',
  category: 'hostile',
  interaction_type: 'attackable', // see World Object interactions fix
  enabled: true,
  spawn_weight: 3,
  spawn_rules: { min_distance_slots: 1 },
  level_range: [1, 30],
  has_garrison: true,
  respawns: true,
  allowed_regions: [],
  allowed_biomes: [],
};
