module.exports = {
  key: 'resource_node',
  doc_type: 'world_object',
  name: 'Resource Node',
  name_ar: 'عقدة موارد',
  category: 'gatherable',
  interaction_type: 'gatherable', // no garrison, can be harvested directly - see World Object interactions fix
  spawn_weight: 5,
  spawn_rules: { min_distance_slots: 1 },
  level_range: [1, 10],
  has_garrison: false,
  respawns: true,
  allowed_regions: [],
  allowed_biomes: [],
};
