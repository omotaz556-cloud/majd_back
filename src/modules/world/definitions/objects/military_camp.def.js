// ====== Military Camp - hostile world object (requested type). Same shape
// as barbarian_camp - garrison + loot generated generically by
// worldPopulation.generator.buildWorldObjectDoc, attackable via the shared
// AttackableTarget bridge, no separate combat system.
module.exports = {
  key: 'military_camp',
  doc_type: 'world_object',
  name: 'Military Camp',
  name_ar: 'معسكر عسكري',
  category: 'hostile',
  interaction_type: 'attackable', // see World Object interactions fix
  enabled: true,
  spawn_weight: 2,
  spawn_rules: { min_distance_slots: 1 },
  level_range: [5, 25],
  has_garrison: true,
  respawns: true,
  allowed_regions: [],
  allowed_biomes: [],
};
