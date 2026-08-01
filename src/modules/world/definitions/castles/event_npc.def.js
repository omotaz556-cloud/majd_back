// ====== NEW: example "Event NPC" definition - disabled by default
// (enabled:false) and manual_only, demonstrating that adding a
// time-limited/event NPC type is purely a config change: copy this file,
// change the fields, flip enabled:true (and/or drop manual_only to let it
// join the normal procedural sweep) for the duration of the event. ======
module.exports = {
  key: 'event_npc_example',
  doc_type: 'castle',
  name: 'Event Camp (example, disabled by default)',
  name_ar: 'معسكر مناسبة (مثال - متوقف افتراضيًا)',
  category: 'event',
  interaction_type: 'attackable', // NPC castles are always attackable - see World Object interactions fix
  enabled: false,
  level_range: [10, 20],
  appearance: { skin: 'event_camp', city_lighting: true },
  castle_skin: 'event_camp',
  garrison_multiplier: 1.5,
  wall_level_ratio: 0.7,
  tower_count_range: [2, 4],
  commander: { enabled: true },
  ai_behavior: 'defensive',
  reward_multiplier: 2.5,
  spawn_weight: 0,
  spawn_rules: { min_ring: 0, max_ring: null, manual_only: true },
  allowed_regions: [],
  allowed_biomes: [],
  // city_decor removed: every NPC now always gets the full building set
  // (see ALL_CITY_DECOR_KEYS in castle/npcCastle.generator.js) instead of a
  // tier-dependent subset - fixes the "Tier problem" finding.
};
