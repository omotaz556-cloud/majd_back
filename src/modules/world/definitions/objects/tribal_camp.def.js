// ====== Tribal Camp - hostile world object (requested type).
module.exports = {
  key: 'tribal_camp',
  doc_type: 'world_object',
  name: 'Tribal Camp',
  name_ar: 'معسكر قبلي',
  category: 'hostile',
  interaction_type: 'attackable', // has a garrison to fight through - see World Object interactions fix
  enabled: true,
  spawn_weight: 2,
  spawn_rules: { min_distance_slots: 1 },
  level_range: [1, 20],
  has_garrison: true,
  respawns: true,
  allowed_regions: [],
  allowed_biomes: [],
};
