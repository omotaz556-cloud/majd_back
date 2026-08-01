// ====== مستويات صعوبة معسكرات الـ NPC (NPC Tiers) ======
// ====== REBUILT: data-driven compatibility layer ======
// This file no longer hardcodes the tier list - it derives NPC_TIERS (and
// tierForLevel/tierForRing) from the central NPC Registry
// (world/npcRegistry.js), which auto-discovers every castle-shaped NPC
// definition from world/definitions/castles/*.def.js. All exports below
// keep their EXACT original names/shapes so npcCastle.generator.js and
// anything else that already requires this file keeps working with zero
// changes - the only thing that changed is *where the data comes from*.
//
// To add a new auto-spawning castle tier: drop a new *.def.js file in
// world/definitions/castles/ with a unique key, a level_range, and
// spawn_rules {min_ring, max_ring} - it appears here automatically on next
// process start. Definitions with spawn_rules.manual_only (event/seasonal/
// boss castles) are intentionally excluded from this auto-spawn list; they
// are still registered and reachable via world/worldAdmin.service.js.

const { getAutoSpawnCastleTypes } = require('../world/npcRegistry');

// ====== يبني NPC_TIERS بنفس الشكل القديم بالظبط من تعريفات الـ registry،
// مرتبة حسب أول مستوى في level_range (نفس ترتيب الملف الأصلي: قرية ->
// ... -> قلعة نخبة). ======
const NPC_TIERS = getAutoSpawnCastleTypes()
  .slice()
  .sort((a, b) => a.level_range[0] - b.level_range[0])
  .map((def) => ({
    id: def.key,
    name_ar: def.name_ar || def.name,
    level_range: def.level_range,
    skin: def.castle_skin || def.appearance?.skin || def.key,
    garrison_multiplier: def.garrison_multiplier,
    wall_level_ratio: def.wall_level_ratio,
    tower_count_range: def.tower_count_range,
    reward_multiplier: def.reward_multiplier,
    ai_posture: def.ai_behavior,
    city_decor: def.city_decor || [],
    city_lighting: def.appearance?.city_lighting !== false,
    commander_enabled: def.commander?.enabled !== false,
    min_ring: def.spawn_rules?.min_ring ?? 0,
    max_ring: def.spawn_rules?.max_ring ?? null,
  }));

// أسماء قادة دفاعيين عشوائيين (عربي) - يتخصصوا حسب tier في generator
const COMMANDER_NAME_PARTS_A = ['القائد', 'الحارس', 'الفارس', 'الحاجب', 'أمير'];
const COMMANDER_NAME_PARTS_B = ['المظفّر', 'الصارم', 'الحديدي', 'الأشقر', 'ابن الصحراء', 'الرمادي'];

// يرجّع أول tier مستواها يغطي level المطلوب - fallback لآخر tier لو المستوى
// أعلى من كل المدى المعرّف
function tierForLevel(level) {
  const found = NPC_TIERS.find((t) => level >= t.level_range[0] && level <= t.level_range[1]);
  return found || NPC_TIERS[NPC_TIERS.length - 1];
}

// ====== حدود الحلقات (ring) لكل tier - بتيجي دلوقتي من spawn_rules نفسها
// جوه كل تعريف (world/definitions/castles/*.def.js) بدل ثابت منفصل هنا -
// نفس القيم المحسوبة أصلًا (ring~2.7 نهاية village، الخ) لسه موجودة، بس
// دلوقتي جزء من بيانات التعريف نفسه مش قائمة منفصلة لازم تتزامن يدويًا. ======
function tierForRing(ring) {
  for (const tier of NPC_TIERS) {
    if (tier.max_ring == null || ring <= tier.max_ring) return tier;
  }
  return NPC_TIERS[NPC_TIERS.length - 1];
}

// ====== NEW: معلومات درجة الصعوبة الجاهزة للعرض (اسم عربي + ترتيب الدرجة
// بين كل الـ tiers) - مبنية على ترتيب NPC_TIERS نفسه (اللي أصلًا مرتب حسب
// أول مستوى في level_range، يعني من الأسهل للأصعب). بترجع null لو الـ id
// مش موجود (مثلاً tier يدوي زي event/seasonal/boss مش من الـ auto-spawn
// list) عشان الاستدعاء يفضل آمن من غير أي throw. ======
function npcTierInfo(tierId) {
  if (!tierId) return null;
  const index = NPC_TIERS.findIndex((t) => t.id === tierId);
  if (index === -1) return null;
  const tier = NPC_TIERS[index];
  return {
    id: tier.id,
    name_ar: tier.name_ar,
    difficulty_rank: index + 1,
    difficulty_out_of: NPC_TIERS.length,
  };
}

module.exports = {
  NPC_TIERS,
  COMMANDER_NAME_PARTS_A,
  COMMANDER_NAME_PARTS_B,
  tierForLevel,
  tierForRing,
  npcTierInfo,
};
