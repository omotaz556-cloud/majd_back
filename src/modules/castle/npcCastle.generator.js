// ====== محرك توليد قلاع الـ NPC الإجرائي (v2 - Tier System) ======
// نفس الفلسفة الأصلية (seed ثابت من الإحداثيات، صعوبة بتزيد مع البعد عن
// المركز) بس دلوقتي مبنية على نظام "درجات صعوبة" واضح (npcTiers.config:
// قرية -> بلدة -> بلدة محصّنة -> قلعة -> حصن -> قلعة نخبة، مستوى 1-30) بدل
// معادلة خطية وحيدة، زي ما بتعمل ألعاب Rise of Kingdoms/Lords Mobile -
// فيه درجات واضحة تحدد شكل المدينة وقوتها ومكافآتها مش نمو مستمر بس.
//
// إضافات جديدة عن النسخة الأصلية: قائد دفاعي (commander)، مباني ديكور
// بصرية (city_decor - ثكنة/إسطبل/ميدان رماية/ورشة حصار/مخزن/مستشفى/
// أكاديمية/دار تحالف)، إنارة المدينة، وتوزيع أبراج أوسع من 4 أركان بس.
// التوقيعات (exports) القديمة كلها متسيبة زي ما هي عشان worldMap.service
// والاستدعاءات التانية تفضل شغالة من غير أي تعديل إضافي مطلوب فيها.

const {
  GRID_SIZE,
  BUILDING_TYPES,
  TROOP_TYPES,
  maxLevelForTownHall,
  storageCapacity,
} = require('./castle.config');
const {
  DEFENSE_STRUCTURE_TYPES,
  structureMaxHp,
} = require('../defense/defense.config');
const {
  NPC_TIERS,
  COMMANDER_NAME_PARTS_A,
  COMMANDER_NAME_PARTS_B,
  tierForRing,
} = require('./npcTiers.config');
const { pickFaction } = require('../world/factions.config');

const NPC_NAME_PARTS_A = ['معسكر', 'حصن', 'برج', 'خط دفاع', 'مستوطنة', 'قلعة'];
const NPC_NAME_PARTS_B = ['الغزاة', 'الرمال', 'الظل', 'الحدود', 'الذئاب', 'الصحراء', 'النسر', 'العاصفة'];

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInt(rand, min, max) {
  return Math.floor(rand() * (max - min + 1)) + min;
}

function pick(rand, arr) {
  return arr[Math.floor(rand() * arr.length)];
}

// ====== لو القلعة تابعة لفصيل (faction)، اسمها بيتبني من قوائم اسم الفصيل
// نفسه (شوف world/factions.config.js) عشان كل فصيل يحس بشخصية مختلفة على
// الخريطة - fallback للقوائم العامة القديمة لو مفيش فصيل (مثلاً قلاع
// event/seasonal اليدوية اللي مش بتمر على pickFaction). ======
function randomNpcName(rand, faction) {
  if (faction) {
    return `${pick(rand, faction.name_pool_a)} ${pick(rand, faction.name_pool_b)}`;
  }
  return `${pick(rand, NPC_NAME_PARTS_A)} ${pick(rand, NPC_NAME_PARTS_B)}`;
}

function randomCommanderName(rand, faction) {
  if (faction) {
    return `${pick(rand, faction.commander_pool_a)} ${pick(rand, faction.commander_pool_b)}`;
  }
  return `${pick(rand, COMMANDER_NAME_PARTS_A)} ${pick(rand, COMMANDER_NAME_PARTS_B)}`;
}

function ringForMapSlot(mapSlot, slotSpacing) {
  return Math.max(Math.abs(mapSlot.x), Math.abs(mapSlot.y)) / slotSpacing;
}

// ====== يحدد مستوى المبنى الرئيسي جوه مدى الـ tier نفسه (مش خارجه خالص) -
// بديل rollTownHallLevel القديمة، بس مقيّد بالـ tier عشان "درجة الصعوبة"
// تفضل متسقة مع شكل المدينة (skin) والمكافآت. ======
function rollLevelWithinTier(tier, rand) {
  const [min, max] = tier.level_range;
  const roll = min + Math.floor(rand() * (max - min + 1));
  return Math.min(BUILDING_TYPES.town_hall.max_level, Math.max(1, roll));
}

function randomFreePosition(rand, occupied) {
  for (let attempts = 0; attempts < 40; attempts += 1) {
    const x = randomInt(rand, 0, GRID_SIZE - 1);
    const y = randomInt(rand, 0, GRID_SIZE - 1);
    const key = `${x},${y}`;
    if (!occupied.has(key)) {
      occupied.add(key);
      return { x, y };
    }
  }
  return null;
}

// ====== FIX (NPC kingdoms must always contain every player building) - كل
// قلعة NPC دلوقتي بتاخد نفس مجموعة المباني اللي أي لاعب حقيقي يقدر يبنيها
// بالظبط (BUILDING_TYPES كامل - مش قايمة مكتوبة يدوي هنا ممكن تنسى مبنى
// جديد)، من غير أي "تخطي عشوائي" (كان فيه `if (rand() > 0.6) continue`
// على مباني التخزين بس - ده اتشال تمامًا). ده بيضمن:
//  - "Every NPC kingdom always contains all player buildings" - مفيش قلعة
//    NPC تفضل من غير مخزن دهب/خشب/حجر أو من غير ثكنة أبدًا.
//  - "Barracks is a real building" - الثكنة (barracks) بقت جزء أساسي من
//    اللوب زي أي مبنى تاني (مكانها مش مجرد ديكور بصري - عندها مستوى حقيقي
//    وbuilding.category: 'military' زي castle.config، فبانل معلومات المبنى
//    (BuildingInfoModal) والفرونت إند بيتعاملوا معاها كمبنى حقيقي 100%).
//  - أي مبنى لاعب جديد يتضاف مستقبلًا لـ BUILDING_TYPES (castle.config.js)
//    بيبقى موجود أوتوماتيك في كل قلعة NPC جديدة من غير أي تعديل هنا خالص. ======
function generateNpcBuildings(townHallLevel, rand) {
  const cap = maxLevelForTownHall(townHallLevel);
  const occupied = new Set();
  const buildings = [];

  function randomLevelFor(cfg) {
    const ceiling = Math.max(1, Math.min(cfg.max_level, cap));
    const low = Math.max(1, Math.floor(ceiling * 0.35));
    return randomInt(rand, low, ceiling);
  }

  const townHallPos = { x: 3, y: 3 };
  occupied.add('3,3');
  buildings.push({ key: 'town_hall', level: townHallLevel, position: townHallPos });

  // ====== كل مبنى لاعب تاني غير المبنى الرئيسي - مأخوذ مباشرة من
  // BUILDING_TYPES (مش قايمة مكتوبة يدوي)، بترتيب ثابت (Object.keys) عشان
  // الـ seed العشوائي يفضل deterministic لنفس الإحداثية بالظبط. كل مبنى
  // فيهم بيتحط دايمًا (مفيش أي `continue` عشوائي) - لو الشبكة (8x8) خلصت
  // خانات فاضية (احتمال نظري بعيد جدًا مع 7 مباني بس فوق 64 خانة)، بترجع
  // null وبتتجاهل المبنى ده بس - نفس سلوك الأمان الأصلي لـ randomFreePosition. ======
  for (const key of Object.keys(BUILDING_TYPES)) {
    if (key === 'town_hall') continue;
    const cfg = BUILDING_TYPES[key];
    const position = randomFreePosition(rand, occupied);
    if (!position) continue;
    buildings.push({ key, level: randomLevelFor(cfg), position });
  }

  return { buildings, occupied };
}

// ====== FIX (city_decor rebuild) - مباني ديكور بصرية بس (إسطبل/ميدان
// رماية/ورشة حصار/مخزن/مستشفى/أكاديمية/دار تحالف) - بدون أي تأثير اقتصادي
// أو قتالي حقيقي (لا max_level ولا upgrade queue ولا تكلفة، مش موجودة في
// BUILDING_TYPES خالص). ملحوظة: الثكنة (barracks) اتشالت من القايمة دي -
// بقت مبنى حقيقي كامل (شوف generateNpcBuildings فوق)، مش ديكور. القايمة
// دلوقتي ثابتة هنا (مش جايه من tier.city_decor بعد ما اتشالت من كل
// definitions/castles/*.def.js - "every NPC now always gets the full
// building set") - كل معسكر NPC (غير القرية الأبسط) بياخد نفس المجموعة
// كاملة من غير أي تخطي عشوائي، عشان يبان مدينة كاملة فعلًا مش أيقونة فاضية.
// مستوى الديكور بس بيوزّن حجمها المرسوم في الفرونت إند - القيمة نفسها مش
// بتتغذى لأي حساب قوة/دفاع. ======
const CITY_DECOR_TYPES = [
  'stable',
  'archery_range',
  'siege_workshop',
  'warehouse',
  'hospital',
  'academy',
  'alliance_hall',
];

function generateCityDecor(tier, townHallLevel, occupied, rand) {
  // ====== القرية (أصغر tier) بتفضل مدينة بسيطة - نصف الديكور بس، عشان
  // شكلها البصري يفرّق فعليًا عن باقي الـ tiers الأكبر. أي tier تاني بياخد
  // المجموعة كاملة، دايمًا، من غير استثناء. ======
  const decorKeys = tier.id === 'village' ? CITY_DECOR_TYPES.slice(0, Math.ceil(CITY_DECOR_TYPES.length / 2)) : CITY_DECOR_TYPES;

  return decorKeys
    .map((key) => {
      const position = randomFreePosition(rand, occupied);
      if (!position) return null;
      const level = Math.max(1, Math.min(5, Math.round(1 + (townHallLevel / 30) * 4)));
      return { key, level, position };
    })
    .filter(Boolean);
}

function generateNpcResources(buildings, townHallLevel, rand) {
  const resources = {};
  const capacities = { gold: 0, wood: 0, stone: 0 };

  for (const b of buildings) {
    const cfg = BUILDING_TYPES[b.key];
    if (cfg?.category === 'storage') {
      capacities[cfg.resource] += storageCapacity(b.key, b.level);
    }
  }

  const now = new Date();
  for (const resource of ['gold', 'wood', 'stone']) {
    const cap = 500 + capacities[resource];
    const fill = 0.25 + Math.min(0.55, townHallLevel * 0.02) + rand() * 0.2;
    resources[resource] = {
      stored: Math.round(cap * Math.min(1, fill)),
      last_synced_at: now,
    };
  }

  return resources;
}

// ====== حامية القلعة - budget بيتضرب دلوقتي في tier.garrison_multiplier
// (بدل معادلة ring خام) عشان الفرق بين الـ tiers يبان واضح في اللعب مش بس
// في الاسم. ======
function generateNpcGarrison(townHallLevel, tier, rand, faction) {
  const troopKeys = Object.keys(TROOP_TYPES);
  const budget = Math.round((20 + townHallLevel * 18) * tier.garrison_multiplier);
  // ====== كل فصيل عنده تركيبة جيش مختلفة (troop_weights في
  // world/factions.config.js) - بيتضرب في نفس عشوائية الـ weight الأصلية
  // بدل ما يستبدلها، عشان يفضل في تنويع طبيعي بين قلاع الفصيل الواحد مش
  // كل قلاعه بنفس التركيبة بالظبط. ======
  const weights = troopKeys.map((key) => (0.4 + rand() * 0.6) * (faction?.troop_weights?.[key] ?? 1));
  const weightSum = weights.reduce((a, b) => a + b, 0);

  const army = [];
  troopKeys.forEach((key, i) => {
    const share = weights[i] / weightSum;
    const count = Math.round(budget * share);
    if (count > 0) army.push({ key, count });
  });
  return army;
}

// ====== NEW: قائد دفاعي - كيان وصفي بس (نفس فلسفة garrisonCommanderSchema
// الموجودة أصلًا في defense.model) مربوط بمستوى الـ tier، جاهز يتخزن على
// CastleDefense.commander (شوف worldMap.service). ======
function generateNpcCommander(tier, townHallLevel, rand, faction) {
  return {
    commander_key: faction ? `npc_${tier.id}_${faction.key}` : `npc_${tier.id}`,
    name: randomCommanderName(rand, faction),
    level: Math.max(1, Math.round(townHallLevel * 0.6)),
  };
}

function perimeterPositions() {
  const positions = [];
  for (let x = 0; x < GRID_SIZE; x += 1) {
    positions.push({ x, y: 0, side: 'top' });
    positions.push({ x, y: GRID_SIZE - 1, side: 'bottom' });
  }
  for (let y = 1; y < GRID_SIZE - 1; y += 1) {
    positions.push({ x: 0, y, side: 'left' });
    positions.push({ x: GRID_SIZE - 1, y, side: 'right' });
  }
  return positions;
}

function buildStructureDoc(type, level, position, rotation) {
  const cfg = DEFENSE_STRUCTURE_TYPES[type];
  const hp = structureMaxHp(type, level);
  return {
    type,
    category: cfg.category,
    level,
    hp,
    max_hp: hp,
    position: { x: position.x, y: position.y },
    rotation,
    build: { state: 'complete', started_at: null, completes_at: null },
  };
}

// ====== خط الدفاع - مبني على tier.wall_level_ratio/tower_count_range دلوقتي
// (بدل ring خام) عشان يفضل متسق مع garrison_multiplier وreward_multiplier
// لنفس الـ tier. الأبراج بقت بتتوزع على كل محيط الشبكة (مش 4 أركان بس) لما
// عددها يزيد عشان "شكل مدينة أكبر" فعليًا للـ tiers العالية. ======
function generateNpcDefenseStructures(townHallLevel, tier, rand) {
  const structures = [];
  const perimeter = perimeterPositions();

  const gateIndex = Math.floor(rand() * perimeter.length);
  const wallLevel = Math.max(
    1,
    Math.min(DEFENSE_STRUCTURE_TYPES.wall.max_level, Math.round(townHallLevel * tier.wall_level_ratio))
  );
  const gateLevel = Math.max(
    1,
    Math.min(DEFENSE_STRUCTURE_TYPES.gate.max_level, Math.round(townHallLevel * tier.wall_level_ratio))
  );

  const towerTypes = ['watch_tower', 'archer_tower', 'ballista_tower', 'catapult_tower'];
  const [minTowers, maxTowers] = tier.tower_count_range;
  const towerCount = randomInt(rand, minTowers, maxTowers);

  // نختار خانات الأبراج من محيط الشبكة نفسه (موزعة بالتساوي تقريبًا حواليه)
  // بدل ما نقتصر على 4 أركان بس - كل خانة برج مش هتاخد بوابة تانية.
  const towerSlotIndexes = new Set();
  if (towerCount > 0) {
    const step = Math.max(1, Math.floor(perimeter.length / towerCount));
    for (let i = 0; i < towerCount; i += 1) {
      let idx = (i * step) % perimeter.length;
      let guard = 0;
      while ((idx === gateIndex || towerSlotIndexes.has(idx)) && guard < perimeter.length) {
        idx = (idx + 1) % perimeter.length;
        guard += 1;
      }
      towerSlotIndexes.add(idx);
    }
  }

  const towerLevel = Math.max(1, Math.min(4, Math.round(1 + townHallLevel * 0.3)));

  perimeter.forEach((cell, i) => {
    if (i === gateIndex) {
      structures.push(buildStructureDoc('gate', gateLevel, cell, 0));
    } else if (towerSlotIndexes.has(i)) {
      const type = pick(rand, towerTypes);
      structures.push(buildStructureDoc(type, towerLevel, cell, 0));
    } else {
      structures.push(buildStructureDoc('wall', wallLevel, cell, 0));
    }
  });

  return structures;
}

// ====== الدالة الرئيسية - نفس التوقيع القديم بالظبط (mapSlot, slotSpacing)
// عشان أي كود موجود بينادي buildNpcCastleDoc يفضل شغال من غير تعديل. ======
function buildNpcCastleDoc(mapSlot, slotSpacing) {
  const seed = Math.abs((mapSlot.x * 73856093) ^ (mapSlot.y * 19349663)) >>> 0;
  const rand = mulberry32(seed || 1);

  const ring = ringForMapSlot(mapSlot, slotSpacing);
  const tier = tierForRing(ring);
  const townHallLevel = rollLevelWithinTier(tier, rand);
  // ====== كل قلعة NPC بتتبع فصيل (kingdom) - شوف world/factions.config.js.
  // الفصيل بيأثر بس على العرض/التركيبة (اسم، شكل بصري، تركيبة جيش، مكافأة)
  // مش على محرك القتال نفسه - نفس Castle/CastleDefense/Army/March/Battle
  // بالظبط. ======
  const faction = pickFaction(tier.id, rand);

  const { buildings, occupied } = generateNpcBuildings(townHallLevel, rand);
  const cityDecor = generateCityDecor(tier, townHallLevel, occupied, rand);
  const resources = generateNpcResources(buildings, townHallLevel, rand);
  const army = generateNpcGarrison(townHallLevel, tier, rand, faction);
  const commander = generateNpcCommander(tier, townHallLevel, rand, faction);
  const defenseStructures = generateNpcDefenseStructures(townHallLevel, tier, rand);

  return {
    map_slot: mapSlot,
    is_npc: true,
    npc_name: randomNpcName(rand, faction),
    npc_tier: tier.id,
    npc_faction: faction.key,
    // ====== شكل بصري مركّب: درجة الصعوبة (tier.skin) + تنويع الفصيل
    // (faction.skin_variant) - الفرونت إند يقدر يستخدم أي جزء منهم (لسه
    // بيرجع لنفس "Castle model" الموجود، بس بيلوّنه/يزوّقه حسب الفصيل). ======
    npc_skin: tier.skin,
    npc_skin_variant: faction.skin_variant,
    reward_multiplier: Math.round(tier.reward_multiplier * faction.reward_modifier * 100) / 100,
    city_decor: cityDecor,
    city_lighting: tier.id !== 'village',
    buildings,
    resources,
    army,
    // ====== حقول مؤقتة (temp) مش جزء من castleSchema - بتتشال قبل أي
    // insertMany فعلي وبتتنقل لـ worldMap.service عشان تتخزن في مستندات
    // منفصلة (CastleDefense.structures + CastleDefense.commander) بعد ما
    // نعرف الـ _id الحقيقي للقلعة المتولّدة. ======
    _defenseStructures: defenseStructures,
    _commander: commander,
    _aiPosture: tier.ai_posture,
  };
}

module.exports = {
  ringForMapSlot,
  tierForRing,
  rollLevelWithinTier,
  generateNpcBuildings,
  generateCityDecor,
  generateNpcResources,
  generateNpcGarrison,
  generateNpcCommander,
  generateNpcDefenseStructures,
  buildNpcCastleDoc,
};
