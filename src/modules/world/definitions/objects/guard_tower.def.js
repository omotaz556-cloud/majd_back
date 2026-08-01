// ====== Guard Tower - hostile world object, fully attackable via the
// shared AttackableTarget bridge (world/worldObjectCastleBridge.js).
// Re-enabled (was temporarily turned off during the NPC Faction System
// rebuild).
module.exports = {
  key: 'guard_tower',
  doc_type: 'world_object',
  name: 'Guard Tower',
  name_ar: 'برج حراسة',
  category: 'hostile',
  interaction_type: 'attackable', // see World Object interactions fix
  enabled: true,
  spawn_weight: 1.5,
  spawn_rules: { min_distance_slots: 1 },
  level_range: [5, 15],
  has_garrison: true,
  respawns: true,
  allowed_regions: [],
  allowed_biomes: [],
};
