module.exports = {
  key: 'fortified_town',
  doc_type: 'castle',
  name: 'Fortified Town',
  name_ar: 'بلدة محصّنة',
  category: 'town',
  interaction_type: 'attackable', // NPC castles are always attackable - see World Object interactions fix
  level_range: [11, 15],
  appearance: { skin: 'fortified_town', city_lighting: true },
  castle_skin: 'fortified_town',
  garrison_multiplier: 1.1,
  wall_level_ratio: 0.7,
  tower_count_range: [2, 3],
  commander: { enabled: true },
  ai_behavior: 'defensive',
  reward_multiplier: 1.25,
  spawn_weight: 1,
  spawn_rules: { min_ring: 7.27, max_ring: 11.8 },
  allowed_regions: [],
  allowed_biomes: [],
  // city_decor removed: every NPC now always gets the full building set
  // (see ALL_CITY_DECOR_KEYS in castle/npcCastle.generator.js) instead of a
  // tier-dependent subset - fixes the "Tier problem" finding.
};
