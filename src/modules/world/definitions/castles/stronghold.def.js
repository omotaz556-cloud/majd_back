module.exports = {
  key: 'stronghold',
  doc_type: 'castle',
  name: 'Stronghold',
  name_ar: 'حصن',
  category: 'fortress',
  interaction_type: 'attackable', // NPC castles are always attackable - see World Object interactions fix
  level_range: [21, 25],
  appearance: { skin: 'stronghold', city_lighting: true },
  castle_skin: 'stronghold',
  garrison_multiplier: 1.8,
  wall_level_ratio: 0.9,
  tower_count_range: [4, 6],
  commander: { enabled: true },
  ai_behavior: 'aggressive',
  reward_multiplier: 2.1,
  spawn_weight: 1,
  spawn_rules: { min_ring: 16.36, max_ring: 20.9 },
  allowed_regions: [],
  allowed_biomes: [],
  // city_decor removed: every NPC now always gets the full building set
  // (see ALL_CITY_DECOR_KEYS in castle/npcCastle.generator.js) instead of a
  // tier-dependent subset - fixes the "Tier problem" finding.
};
