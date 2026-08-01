// Renamed from the old bare key "village" to avoid colliding with the
// castle-shaped "village" tier (registry keys are unique across both
// families) - behavior/data are unchanged from the original.
module.exports = {
  key: 'neutral_village',
  doc_type: 'world_object',
  name: 'Neutral Village',
  name_ar: 'قرية',
  category: 'neutral',
  interaction_type: 'interactable', // peaceful visit only, no garrison - see World Object interactions fix
  spawn_weight: 2,
  spawn_rules: { min_distance_slots: 1 },
  level_range: [1, 5],
  has_garrison: false,
  respawns: false,
  allowed_regions: [],
  allowed_biomes: [],
};
