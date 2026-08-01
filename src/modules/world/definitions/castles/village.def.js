// Data-driven NPC definition — replaces the old hardcoded NPC_TIERS[0] entry.
module.exports = {
  key: 'village',
  doc_type: 'castle',
  name: 'Village',
  name_ar: 'قرية',
  category: 'village',
  interaction_type: 'attackable', // NPC castles are always attackable - see World Object interactions fix
  level_range: [1, 5],
  appearance: { skin: 'village', city_lighting: false },
  castle_skin: 'village',
  garrison_multiplier: 0.6,
  wall_level_ratio: 0.5,
  tower_count_range: [0, 1],
  commander: { enabled: false },
  ai_behavior: 'passive',
  reward_multiplier: 0.8,
  spawn_weight: 1,
  spawn_rules: { min_ring: 0, max_ring: 2.73 },
  allowed_regions: [],
  allowed_biomes: [],
  // city_decor removed: every NPC now always gets the full building set
  // (see ALL_CITY_DECOR_KEYS in castle/npcCastle.generator.js) instead of a
  // tier-dependent subset - fixes the "Tier problem" finding.
};
