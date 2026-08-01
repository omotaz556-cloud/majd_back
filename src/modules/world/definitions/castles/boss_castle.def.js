// ====== NEW: Boss Castle - a rare, very strong NPC castle. Not part of
// the normal procedural ring sweep (spawn_rules.manual_only) - it only
// appears through worldAdmin.service's spawnBoss()/spawnNpcType(), the
// same way "Spawn a Boss" is expected to work as an internal admin tool.
// Reuses the exact same generic castle-generation engine as every other
// tier (buildings/garrison/defense/commander all scale off level_range +
// the multiplier fields below) - no engine changes needed to add it. ======
module.exports = {
  key: 'boss_castle',
  doc_type: 'castle',
  name: 'Boss Castle',
  name_ar: 'قلعة الزعيم',
  category: 'boss',
  interaction_type: 'attackable', // NPC castles are always attackable - see World Object interactions fix
  level_range: [31, 40],
  appearance: { skin: 'boss_castle', city_lighting: true },
  castle_skin: 'boss_castle',
  garrison_multiplier: 4,
  wall_level_ratio: 1,
  tower_count_range: [8, 12],
  commander: { enabled: true, is_boss: true },
  ai_behavior: 'aggressive',
  reward_multiplier: 6,
  spawn_weight: 0, // never rolled automatically
  spawn_rules: { min_ring: 0, max_ring: null, manual_only: true },
  allowed_regions: [],
  allowed_biomes: [],
  // city_decor removed: every NPC now always gets the full building set
  // (see ALL_CITY_DECOR_KEYS in castle/npcCastle.generator.js) instead of a
  // tier-dependent subset - fixes the "Tier problem" finding.
};
