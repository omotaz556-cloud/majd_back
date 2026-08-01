// ====== Desert Settlement - hostile world object (requested type).
module.exports = {
  key: 'desert_settlement',
  doc_type: 'world_object',
  name: 'Desert Settlement',
  name_ar: 'مستوطنة صحراوية',
  category: 'hostile',
  interaction_type: 'attackable', // see World Object interactions fix
  enabled: true,
  spawn_weight: 1.5,
  spawn_rules: { min_distance_slots: 2 },
  level_range: [8, 26],
  has_garrison: true,
  respawns: true,
  allowed_regions: [],
  allowed_biomes: [],
};
