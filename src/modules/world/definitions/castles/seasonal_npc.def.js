// ====== NEW: example "Seasonal NPC" definition - same idea as
// event_npc.def.js but meant to be toggled enabled/disabled per season
// instead of per one-off event. Disabled by default. ======
module.exports = {
  key: 'seasonal_npc_example',
  doc_type: 'castle',
  name: 'Seasonal Outpost (example, disabled by default)',
  name_ar: 'موقع موسمي (مثال - متوقف افتراضيًا)',
  category: 'seasonal',
  interaction_type: 'attackable', // NPC castles are always attackable - see World Object interactions fix
  enabled: false,
  level_range: [8, 18],
  appearance: { skin: 'seasonal_outpost', city_lighting: false },
  castle_skin: 'seasonal_outpost',
  garrison_multiplier: 1.2,
  wall_level_ratio: 0.65,
  tower_count_range: [1, 3],
  commander: { enabled: false },
  ai_behavior: 'passive',
  reward_multiplier: 1.8,
  spawn_weight: 0,
  spawn_rules: { min_ring: 0, max_ring: null, manual_only: true },
  allowed_regions: [],
  allowed_biomes: [],
  // city_decor removed: every NPC now always gets the full building set
  // (see ALL_CITY_DECOR_KEYS in castle/npcCastle.generator.js) instead of a
  // tier-dependent subset - fixes the "Tier problem" finding.
};
