module.exports = {
  key: 'decoration',
  doc_type: 'world_object',
  name: 'Decoration',
  name_ar: 'زخرفة',
  category: 'decorative',
  interaction_type: 'decorative', // not a target at all - see World Object interactions fix
  spawn_weight: 6,
  spawn_rules: { min_distance_slots: 0 },
  level_range: null,
  has_garrison: false,
  respawns: false,
  allowed_regions: [],
  allowed_biomes: [],
  subtypes: ['tree_cluster', 'rock_formation', 'banner', 'ruined_cart', 'well'],
};
