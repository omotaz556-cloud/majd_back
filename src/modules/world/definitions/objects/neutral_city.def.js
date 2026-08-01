// ====== NEW: Neutral City - a bigger, calmer neutral settlement than
// neutral_village (no garrison, purely a landmark/backdrop point of
// interest), demonstrating the registry can host new categories the
// user asks for without touching worldPopulation.generator.js at all. ======
module.exports = {
  key: 'neutral_city',
  doc_type: 'world_object',
  name: 'Neutral City',
  name_ar: 'مدينة محايدة',
  category: 'neutral',
  interaction_type: 'interactable', // no garrison, peaceful visit only - see World Object interactions fix
  spawn_weight: 0.6,
  spawn_rules: { min_distance_slots: 2 },
  level_range: [10, 25],
  has_garrison: false,
  respawns: false,
  allowed_regions: [],
  allowed_biomes: [],
};
