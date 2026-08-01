module.exports = {
  key: 'ancient_temple',
  doc_type: 'world_object',
  name: 'Ancient Temple',
  name_ar: 'معبد قديم',
  category: 'landmark',
  interaction_type: 'attackable', // has a garrison to fight through - see World Object interactions fix
  spawn_weight: 0.4,
  spawn_rules: { min_distance_slots: 3 },
  level_range: [15, 30],
  has_garrison: true,
  respawns: false,
  allowed_regions: [],
  allowed_biomes: [],
};
