module.exports = {
  key: 'ruins',
  doc_type: 'world_object',
  name: 'Ancient Ruins',
  name_ar: 'أطلال',
  category: 'exploration',
  interaction_type: 'attackable', // has a garrison to fight through - see World Object interactions fix
  spawn_weight: 1,
  spawn_rules: { min_distance_slots: 2 },
  level_range: [5, 20],
  has_garrison: true,
  respawns: false,
  allowed_regions: [],
  allowed_biomes: [],
};
