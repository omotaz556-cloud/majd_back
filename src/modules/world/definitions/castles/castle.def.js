module.exports = {
  key: 'castle',
  doc_type: 'castle',
  name: 'Castle',
  name_ar: 'قلعة',
  category: 'castle',
  interaction_type: 'attackable', // NPC castles are always attackable - see World Object interactions fix
  level_range: [16, 20],
  appearance: { skin: 'castle', city_lighting: true },
  castle_skin: 'castle',
  garrison_multiplier: 1.4,
  wall_level_ratio: 0.8,
  tower_count_range: [3, 5],
  commander: { enabled: true },
  ai_behavior: 'defensive',
  reward_multiplier: 1.6,
  spawn_weight: 1,
  spawn_rules: { min_ring: 11.8, max_ring: 16.36 },
  allowed_regions: [],
  allowed_biomes: [],
  // city_decor removed: every NPC now always gets the full building set
  // (see ALL_CITY_DECOR_KEYS in castle/npcCastle.generator.js) instead of a
  // tier-dependent subset - fixes the "Tier problem" finding.
};
