module.exports = {
  key: 'neutral_fortress',
  doc_type: 'world_object',
  name: 'Neutral Fortress',
  name_ar: 'حصن محايد',
  category: 'landmark',
  interaction_type: 'attackable', // has a garrison to fight through - see World Object interactions fix
  spawn_weight: 0.3,
  spawn_rules: { min_distance_slots: 3 },
  level_range: [20, 30],
  has_garrison: true,
  respawns: false,
  allowed_regions: [],
  allowed_biomes: [],
};
