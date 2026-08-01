module.exports = {
  key: 'elite_fortress',
  doc_type: 'castle',
  name: 'Elite Fortress',
  name_ar: 'قلعة نخبة',
  category: 'fortress',
  interaction_type: 'attackable', // NPC castles are always attackable - see World Object interactions fix
  level_range: [26, 30],
  appearance: { skin: 'elite_fortress', city_lighting: true },
  castle_skin: 'elite_fortress',
  garrison_multiplier: 2.4,
  wall_level_ratio: 1,
  tower_count_range: [5, 8],
  commander: { enabled: true },
  ai_behavior: 'aggressive',
  reward_multiplier: 3,
  spawn_weight: 1,
  // No max_ring: this is the fallback tier for every ring beyond stronghold.
  spawn_rules: { min_ring: 20.9, max_ring: null },
  allowed_regions: [],
  allowed_biomes: [],
  // city_decor removed: every NPC now always gets the full building set
  // (see ALL_CITY_DECOR_KEYS in castle/npcCastle.generator.js) instead of a
  // tier-dependent subset - fixes the "Tier problem" finding (Alliance Hall
  // used to only appear from elite_fortress upward - now every tier has it).
};
