// ====== Rebel Outpost - hostile world object (requested type).
module.exports = {
  key: 'rebel_outpost',
  doc_type: 'world_object',
  name: 'Rebel Outpost',
  name_ar: 'معقل متمردين',
  category: 'hostile',
  interaction_type: 'attackable', // has a garrison to fight through - see World Object interactions fix
  enabled: true,
  spawn_weight: 1.5,
  spawn_rules: { min_distance_slots: 2 },
  level_range: [10, 28],
  has_garrison: true,
  respawns: true,
  allowed_regions: [],
  allowed_biomes: [],
};
