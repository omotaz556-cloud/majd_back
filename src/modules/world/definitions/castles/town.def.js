module.exports = {
  key: 'town',
  doc_type: 'castle',
  name: 'Town',
  name_ar: 'بلدة',
  category: 'town',
  interaction_type: 'attackable', // NPC castles are always attackable - see World Object interactions fix
  level_range: [6, 10],
  appearance: { skin: 'town', city_lighting: false },
  castle_skin: 'town',
  garrison_multiplier: 0.85,
  wall_level_ratio: 0.6,
  tower_count_range: [1, 2],
  commander: { enabled: false },
  ai_behavior: 'passive',
  reward_multiplier: 1,
  spawn_weight: 1,
  spawn_rules: { min_ring: 2.73, max_ring: 7.27 },
  allowed_regions: [],
  allowed_biomes: [],
  // city_decor removed: every NPC now always gets the full building set
  // (see ALL_CITY_DECOR_KEYS in castle/npcCastle.generator.js) instead of a
  // tier-dependent subset - fixes the "Tier problem" finding.
};
