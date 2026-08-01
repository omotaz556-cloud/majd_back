// ====== NPC Faction Registry ======
// Data-driven list of the "kingdoms" that own NPC castles across the world
// map. This does NOT introduce a new battle/army/march system - a faction
// is purely a bundle of flavor + generation-bias data (name pools, skin
// variant, troop-mix bias, reward modifier) that npcCastle.generator.js
// (buildNpcCastleDoc) and worldAdmin.service.js (buildCastleDocForDefinition)
// both read from when they build a castle document. Combat itself still
// goes entirely through the existing Castle/CastleDefense/Army/March/Battle
// services untouched - a faction castle is still just a Castle document
// with is_npc: true, an npc_tier, a garrison army, and a CastleDefense
// commander, exactly like before.
//
// To add a new faction: add an entry to FACTIONS below with a unique key -
// npcCastle.generator.js/worldAdmin.service.js pick it up automatically on
// next process start, no other file needs to change.
//
// tier_bias (optional): list of npc_tier ids this faction prefers. Leave
// empty/omit for "appears at any tier". Used only to make low-tier rings
// feel more "lawless outlaw" and high-tier rings feel more "organized
// kingdom", per the "different levels based on distance from the center"
// requirement - it does not restrict where a faction CAN appear, just
// biases the weighted pick.

const FACTIONS = [
  {
    key: 'bandits',
    name: 'Bandits',
    name_ar: 'قطاع الطرق',
    color: 'red',
    skin_variant: 'bandits',
    spawn_weight: 1.4,
    // Bandits are common everywhere but especially thick close to the
    // center (weak, disorganized raider camps rather than a real kingdom).
    tier_bias: ['village', 'town', 'fortified_town'],
    name_pool_a: ['عصابة', 'وكر', 'كمين', 'مخبأ', 'جماعة'],
    name_pool_b: ['الظلال', 'الصحراء القاحلة', 'الطريق المهجور', 'الذئاب الوحيدة', 'الرمال السوداء'],
    commander_pool_a: ['الزعيم', 'القاطع', 'السفاح', 'العين الواحدة'],
    commander_pool_b: ['الأشقر', 'ابن الصحراء', 'الأعرج', 'الصامت', 'المسعور'],
    // Bandits lean cheap/fast troops over disciplined cavalry.
    troop_weights: { swordsman: 1.3, archer: 1.1, cavalry: 0.6 },
    reward_modifier: 0.9,
  },
  {
    key: 'northern_kingdom',
    name: 'Northern Kingdom',
    name_ar: 'مملكة الشمال',
    color: 'sky',
    skin_variant: 'northern_kingdom',
    spawn_weight: 1,
    tier_bias: ['fortified_town', 'castle', 'stronghold'],
    name_pool_a: ['حامية', 'قلعة', 'معقل', 'برج', 'ثغر'],
    name_pool_b: ['الجليد الأبدي', 'الشمال البعيد', 'الرياح الباردة', 'التاج الفولاذي', 'الجبل الأبيض'],
    commander_pool_a: ['اللورد', 'الفارس', 'الحارس الأعلى', 'الأمير'],
    commander_pool_b: ['الحديدي', 'صاحب الدرع', 'ابن الثلج', 'العابس', 'المظفّر'],
    // Disciplined heavy infantry/defense-leaning kingdom.
    troop_weights: { swordsman: 1.4, archer: 0.9, cavalry: 0.9 },
    reward_modifier: 1.1,
  },
  {
    key: 'desert_empire',
    name: 'Desert Empire',
    name_ar: 'إمبراطورية الصحراء',
    color: 'amber',
    skin_variant: 'desert_empire',
    spawn_weight: 1,
    tier_bias: ['castle', 'stronghold', 'elite_fortress'],
    name_pool_a: ['قصر', 'واحة', 'حصن', 'مدينة', 'برج'],
    name_pool_b: ['الشمس الذهبية', 'الرمال الحمراء', 'السراب', 'الصولجان', 'النخيل الأخير'],
    commander_pool_a: ['الباشا', 'السلطان', 'القائد الأعلى', 'حامي الواحة'],
    commander_pool_b: ['الذهبي', 'صاحب الصولجان', 'ابن الشمس', 'العاصف', 'الماجد'],
    // Fast, cavalry-heavy raiding empire.
    troop_weights: { swordsman: 0.8, archer: 1, cavalry: 1.5 },
    reward_modifier: 1.2,
  },
  {
    key: 'eastern_clan',
    name: 'Eastern Clan',
    name_ar: 'عشيرة الشرق',
    color: 'emerald',
    skin_variant: 'eastern_clan',
    spawn_weight: 1,
    tier_bias: ['town', 'fortified_town', 'castle'],
    name_pool_a: ['معبد', 'قرية', 'مدرسة', 'حصن', 'دار'],
    name_pool_b: ['الطريق الشرقي', 'النهر الهادئ', 'الضباب البعيد', 'الأرز القديم', 'الفجر الأول'],
    commander_pool_a: ['المعلّم', 'الحكيم', 'الأستاذ', 'القائد'],
    commander_pool_b: ['الصامت', 'ذو السيفين', 'العادل', 'الرمادي', 'الحكيم'],
    // Balanced archer/swordsman clan, light on cavalry.
    troop_weights: { swordsman: 1.1, archer: 1.3, cavalry: 0.7 },
    reward_modifier: 1,
  },
  {
    key: 'rebel_lords',
    name: 'Rebel Lords',
    name_ar: 'لوردات التمرد',
    color: 'violet',
    skin_variant: 'rebel_lords',
    spawn_weight: 0.8,
    // Rare, only the strongest tiers - a defiant, dangerous splinter faction.
    tier_bias: ['stronghold', 'elite_fortress'],
    name_pool_a: ['معقل', 'قلعة', 'حصن', 'برج التمرد', 'ملجأ'],
    name_pool_b: ['الثورة الحمراء', 'العرش المكسور', 'الميثاق المنسي', 'الراية السوداء', 'الغضب الأخير'],
    commander_pool_a: ['اللورد المتمرد', 'الخائن', 'القائد المنشق', 'اللورد'],
    commander_pool_b: ['الحديدي', 'كاسر العهد', 'الأسود', 'الأخير', 'المارق'],
    // Elite mixed force with a slight edge across the board.
    troop_weights: { swordsman: 1.2, archer: 1.2, cavalry: 1.2 },
    reward_modifier: 1.35,
  },
];

const registry = new Map(FACTIONS.map((f) => [f.key, f]));

function getAllFactions() {
  return FACTIONS;
}

function getFaction(key) {
  return registry.get(key) || null;
}

// ====== يبني قايمة موزونة (weighted pool) لاختيار فصيل - لو الـ tier عنده
// فصائل بتفضّله (tier_bias بيشمله)، دول بس اللي بيدخلوا القايمة (بوزنهم
// spawn_weight العادي). لو مفيش أي فصيل بيفضّل الـ tier ده، كل الفصائل
// بتدخل القايمة (fallback - "أي فصيل ممكن يظهر في أي درجة"). ======
function pickFaction(tierId, rand) {
  const preferring = FACTIONS.filter((f) => !f.tier_bias || f.tier_bias.length === 0 || f.tier_bias.includes(tierId));
  const pool = preferring.length > 0 ? preferring : FACTIONS;

  const weighted = pool.flatMap((f) => Array(Math.max(1, Math.round(f.spawn_weight * 10))).fill(f));
  return weighted[Math.floor(rand() * weighted.length)] || pool[0];
}

function factionInfo(key) {
  const f = getFaction(key);
  if (!f) return null;
  return { key: f.key, name: f.name, name_ar: f.name_ar, color: f.color };
}

module.exports = {
  FACTIONS,
  getAllFactions,
  getFaction,
  pickFaction,
  factionInfo,
};
