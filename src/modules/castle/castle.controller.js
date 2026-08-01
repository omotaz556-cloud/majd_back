const castleService = require('./castle.service');
const marchService = require('./march.service');
const March = require('./march.model');
const worldSearchService = require('./worldSearch.service');
const worldMapService = require('./worldMap.service');
// ====== Phase 1 (Reinforcement & Battle System) - Requirement 3: تعزيزات
// الحلفاء الواقفة في قلعة معيّنة لازم تبان "جوه القلعة" وقت زيارتها، مش
// بس في تبويب التحالف. مفيش أي دورة استيراد هنا (allianceReinforcement.service
// بيستورد castle.service بس، مش castle.controller). ======
const allianceReinforcementService = require('../alliances/allianceReinforcement.service');
const { npcTierInfo } = require('./npcTiers.config');
const { listHeroes, heroInfo } = require('./hero.config');
const {
  RESOURCE_TYPES,
  BUILDING_TYPES,
  TROOP_TYPES,
  maxLevelForTownHall,
  upgradeCost,
  upgradeSeconds,
  producerOutputPerHour,
  storageCapacity,
  maxQueueSize,
  computeCastlePower,
  speedupGemCost,
} = require('./castle.config');
// ====== Rewarded Ads Gameplay (Speed Up Construction) - الحد الأدنى للوقت
// المتبقي عشان زرار "سرّع بإعلان" يظهر أصلًا - نفس القيمة اللي
// rewardSession.service.js بيتحقق منها فعليًا وقت /start و/complete (مصدر
// واحد للحقيقة - rewardKinds.config.js - مفيش رقم مكرر هنا). ======
const { SPEEDUP_CONSTRUCTION_MIN_REMAINING_SECONDS } = require('../ads/rewardKinds.config');

// بيحوّل مبنى واحد من مستند القلعة لشكل جاهز لبانل معلومات المبنى في
// الفرونت إند - كل حاجة (الوصف، الإنتاج/التخزين الحالي، تكلفة ومدة الترقية
// الجاية) بتتحسب هنا من إعدادات الباك إند (castle.config.js) عشان الفرونت
// إند ميحتاجش يكرر أي معادلة أو يفترض أي رقم بنفسه.
function formatBuilding(b, castle) {
  const cfg = BUILDING_TYPES[b.key];
  const townHall = castle.buildings.find((tb) => tb.key === 'town_hall');
  const townHallLevel = townHall?.level || 1;

  const isMaxLevel = Boolean(cfg) && b.level >= cfg.max_level;
  const upgradeInProgress = Boolean(b.upgrade?.in_progress);

  let production = null;
  if (cfg?.category === 'producer') {
    production = {
      resource: cfg.resource,
      current_per_hour: producerOutputPerHour(b.key, b.level),
      next_per_hour: isMaxLevel ? null : producerOutputPerHour(b.key, b.level + 1),
    };
  }

  let storage = null;
  if (cfg?.category === 'storage') {
    storage = {
      resource: cfg.resource,
      current_capacity: storageCapacity(b.key, b.level),
      next_capacity: isMaxLevel ? null : storageCapacity(b.key, b.level + 1),
    };
  }

  let barracks = null;
  if (cfg?.category === 'military') {
    barracks = {
      max_queue_size: maxQueueSize(b.level),
      next_max_queue_size: isMaxLevel ? null : maxQueueSize(b.level + 1),
    };
  }

  let nextUpgrade = null;
  if (cfg && !isMaxLevel && !upgradeInProgress) {
    const nextLevel = b.level + 1;
    const cap = maxLevelForTownHall(townHallLevel);
    nextUpgrade = {
      target_level: nextLevel,
      cost: upgradeCost(b.key, nextLevel),
      duration_seconds: upgradeSeconds(b.key, nextLevel),
      within_town_hall_cap: cfg.category === 'headquarters' ? true : nextLevel <= cap,
    };
  }

  return {
    id: b._id,
    key: b.key,
    name: cfg?.name || b.key,
    description: cfg?.description || '',
    category: cfg?.category || null,
    resource: cfg?.resource || null,
    level: b.level,
    max_level: cfg?.max_level || null,
    is_max_level: isMaxLevel,
    position: b.position,
    production,
    storage,
    barracks,
    next_upgrade: nextUpgrade,
    upgrade: upgradeInProgress
      ? {
          target_level: b.upgrade.target_level,
          completes_at: b.upgrade.completes_at,
          // ====== تكلفة الجواهر لتسريع الترقية/الإنشاء ده فورًا - محسوبة
          // جاهزة هنا (بنفس speedupGemCost في castle.config) عشان الفرونت
          // إند ميكررش معادلة التسعير بنفسه. بتتغيّر تلقائيًا كل ما الوقت
          // يعدي (الثواني المتبقية بتقل)، فبتتحسب من جديد في كل استدعاء
          // لـ formatCastle مش قيمة ثابتة اتحسبت وقت بدء الترقية. ======
          speedup_gem_cost: speedupGemCost((b.upgrade.completes_at.getTime() - Date.now()) / 1000),
          // ====== Rewarded Ads Gameplay (Speed Up Construction) - نفس فلسفة
          // speedup_gem_cost فوق بالظبط: كل قيمة محسوبة جاهزة هنا (مش رقم
          // بيتفترض في الفرونت إند) عشان الفرونت إند يقرر بس "يعرض الزرار
          // ولا لأ" من غير ما يكرر نفس شرط الحد الأدنى الموجود في
          // rewardSession.service.js. ad_speedup_used بيتصفّر تلقائيًا مع كل
          // ترقية جديدة (شوف castle.model.js) - يعني إعلان واحد بس لكل
          // ترقية، مش مرة واحدة للمبنى طول عمره. ======
          ad_speedup_used: Boolean(b.upgrade.ad_speedup_used),
          ad_speedup_eligible:
            !b.upgrade.ad_speedup_used &&
            (b.upgrade.completes_at.getTime() - Date.now()) / 1000 >= SPEEDUP_CONSTRUCTION_MIN_REMAINING_SECONDS,
        }
      : null,
  };
}

// بيحوّل جيش القلعة الحالي (الوحدات المدرَّبة فعلًا) لشكل جاهز للعرض - اسم
// كل نوع بييجي من castle.config عشان الفرونت إند ميحتاجش ينسخه بنفسه.
function formatArmy(castle) {
  return (castle.army || []).map((stack) => ({
    key: stack.key,
    name: TROOP_TYPES[stack.key]?.name || stack.key,
    count: stack.count,
  }));
}

// بيحوّل طابور أوامر التدريب الحالي لشكل جاهز للعرض - نفس فكرة upgrade في
// formatBuilding (target_level/completes_at) بس لأوامر التدريب.
function formatTrainingQueue(castle) {
  return (castle.training_queue || []).map((order) => ({
    id: order._id,
    key: order.key,
    name: TROOP_TYPES[order.key]?.name || order.key,
    quantity: order.quantity,
    started_at: order.started_at,
    completes_at: order.completes_at,
    // ====== تكلفة تسريع أمر التدريب ده فورًا بالجواهر - نفس فلسفة
    // speedup_gem_cost في formatBuilding بالظبط. ======
    speedup_gem_cost: speedupGemCost((order.completes_at.getTime() - Date.now()) / 1000),
  }));
}

// بيحوّل مستند القلعة لشكل مفيد للفرونت إند - كل مورد بسقفه ومعدل إنتاجه
// الحاليين محسوبين جاهزين (الفرونت إند مش محتاج يعيد المنطق ده تاني).
// owner (اختياري): مستند User بتاع صاحب القلعة - لو اتبعت، بيضيف بيانات
// "بانل معلومات القلعة" (Castle Info) الجاهزة للعرض في الفرونت إند من غير
// ما يحتاج طلب تاني: اسم اللاعب/رقمه، اسم القلعة (افتراضي "قلعة <اسم
// اللاعب>" - مفيش تخصيص اسم لسه)، الإحداثيات بوحدة "خانة" المقروءة (نفس
// وحدة /castle/search بالظبط)، والقوة التقديرية (computeCastlePower). لو
// اتنادت من غير owner (باقي استدعاءات formatCastle في الملف ده بعد أي
// أكشن زي ترقية/تدريب)، الحقول دي بترجع null بدل ما توقّع.
// ====== Admin privilege (Unlimited Resources) - قيمة "مخزون" ظاهرية كبيرة
// بتتعرض بدل الرقم الحقيقي المخزّن لما صاحب القلعة يكون أدمن، عشان أي فحص
// "الموارد كفاية؟" في الفرونت إند (BuildMenu/BuildingInfoModal/
// TrainingPanel/DefenseBuildMenu... كلهم بيقارنوا resources[k].stored محليًا
// قبل ما يبعتوا الطلب أصلًا) يعدي دايمًا وميمنعش الأدمن من الضغط على الزرار
// من الأساس - البايباس الحقيقي (خصم الموارد) أصلًا مطبّق في castle.service،
// الرقم ده مجرد "واجهة" متسقة معاه (JSON مبيقبلش Infinity فعليًا، فبنستخدم
// رقم كبير جدًا كبديل عملي). ======
const ADMIN_UNLIMITED_RESOURCE_DISPLAY = 999999999999;

function formatCastle(castle, owner) {
  const isAdminOwner = owner?.role === 'admin';
  const resources = {};
  for (const resource of RESOURCE_TYPES) {
    resources[resource] = {
      stored: isAdminOwner ? ADMIN_UNLIMITED_RESOURCE_DISPLAY : Math.floor(castle.resources[resource].stored),
      capacity: castleService.computeCapacity(castle, resource),
      per_hour: Math.round(castleService.computeProductionPerSecond(castle, resource) * 3600),
    };
  }

  const buildings = castle.buildings.map((b) => formatBuilding(b, castle));

  return {
    id: castle._id,
    kingdom_id: castle.kingdom_id ?? null,
    player_name: owner?.name ?? null,
    player_id: owner?.player_id ?? null,
    castle_name: owner ? `قلعة ${owner.name}` : null,
    coordinates: {
      x: Math.round(castle.map_slot.x / worldMapService.SLOT_SPACING),
      y: Math.round(castle.map_slot.y / worldMapService.SLOT_SPACING),
    },
    power: computeCastlePower(castle),
    map_slot: castle.map_slot,
    resources,
    buildings,
    army: formatArmy(castle),
    training_queue: formatTrainingQueue(castle),
    // ====== مساحة المدينة - كل ده من قاعدة البيانات (castle document)، مفيش
    // شراء أرض ولا تكلفة خالص: unlocked_tiles بتكبر أوتوماتيك كل ما المبنى
    // الرئيسي يترقّى (شوف expandCityToLevelCap في castle.service)، وmax_tiles
    // هنا بس معلومة للعرض (توضيح للاعب السقف الحالي/القادم). ======
    city: {
      unlocked_tiles: castle.unlocked_tiles || [],
      max_tiles: castleService.getMaxCityTiles(castle),
      slots: castleService.getCitySlotsInfo(castle),
    },
    // ====== NEW: معلومات NPC جاهزة للعرض (لو القلعة دي معسكر آلي) - اسم
    // الدرجة/ترتيب الصعوبة (من npcTierInfo) ومضاعف المكافآت الحقيقي
    // (reward_multiplier) - null للاعبين الحقيقيين دايمًا. بتستخدم في شريط
    // "زيارة مملكة" وبانل معلومات القلعة عشان تبان "قلعة NPC حقيقية" ليها
    // درجة صعوبة ومكافآت واضحة قبل الهجوم، مش بس اسم ومستوى. ======
    npc_tier: castle.is_npc ? npcTierInfo(castle.npc_tier) : null,
    reward_multiplier: castle.is_npc ? castle.reward_multiplier : null,
    // ====== FIX (city_decor rendering) - مباني الديكور البصرية بس (ثكنة
    // قديمة الاسم بس دلوقتي إسطبل/ميدان رماية/ورشة حصار/مخزن/مستشفى/
    // أكاديمية/دار تحالف - راجع npcCastle.generator.generateCityDecor) -
    // كانت متخزّنة في القلعة (castle.model city_decor) بس معملهاش formatCastle
    // أي إرجاع ليها خالص، فالفرونت إند (IsometricWorld) كان مستحيل يعرضها.
    // بترجع زي ما هي (key/level/position) - نفس الشكل بالظبط اللي
    // IsometricWorld بيتوقعه لأي مبنى عادي (building.position) عشان تتغذى
    // لنفس بايبلاين BuildingSprite/IsometricWorld من غير أي تحويل إضافي. ======
    city_decor: castle.city_decor || [],
    city_lighting: !!castle.city_lighting,
    // ====== الهيرو اللي اللاعب اختاره (null لحد ما يختار - شوف
    // /castle/heroes و/castle/choose-hero). بيرجع بيانات العرض الجاهزة
    // (الاسم واللقب والوصف والبونص) عشان الفرونت إند ميحتاجش يكرر قايمة
    // الأبطال بنفسه. ======
    hero: castle.hero_key ? heroInfo(castle.hero_key) : null,
  };
}

async function getMyCastle(req, res) {
  try {
    await marchService.resolveDueMarches(req.user._id);
    const castle = await castleService.getOrCreateCastle(req.user._id);
    return res.json(formatCastle(castle, req.user));
  } catch (err) {
    console.error('[Castle] getMyCastle error:', err.message);
    return res.status(500).json({ error: 'تعذر تحميل القلعة' });
  }
}

async function upgradeBuilding(req, res) {
  try {
    const { key } = req.params;
    const castle = await castleService.startUpgrade(req.user._id, key);
    return res.json(formatCastle(castle, req.user));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

// ====== تسريع فوري بالجواهر - ترقية/إنشاء مبنى شغال بالفعل ====== نفس شكل
// upgradeBuilding فوق بالظبط (بيرجع القلعة كاملة بعد ما التسريع يتطبّق)، بس
// بينادي castleService.speedupBuildingUpgrade بدل startUpgrade (خصم من
// المحفظة مش من الموارد، والترقية بتخلص فورًا من غير ما نستنى الوقت الطبيعي).
async function speedupBuilding(req, res) {
  try {
    const { key } = req.params;
    const castle = await castleService.speedupBuildingUpgrade(req.user._id, key);
    return res.json(formatCastle(castle, req.user));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function buildNewBuilding(req, res) {
  try {
    const { key } = req.params;
    const { x, y } = req.body || {};
    const castle = await castleService.startNewBuilding(req.user._id, key, { x, y });
    return res.json(formatCastle(castle, req.user));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function moveBuilding(req, res) {
  try {
    const { id } = req.params;
    const { x, y } = req.body || {};
    const castle = await castleService.moveBuilding(req.user._id, id, { x, y });
    return res.json(formatCastle(castle, req.user));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function trainTroops(req, res) {
  try {
    const { key } = req.params;
    const { quantity } = req.body || {};
    const castle = await castleService.startTraining(req.user._id, key, quantity);
    return res.json(formatCastle(castle, req.user));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

// ====== تدريب وحدة مميّزة (بالجواهر/رصيد المحفظة) - نفس شكل trainTroops
// بالظبط (بيرجع القلعة كاملة بعد ما الوحدات تتضاف فورًا)، بس بينادي
// startPremiumTraining بدل startTraining (خصم من المحفظة مش من الموارد،
// ومفيش طابور تدريب). ======
async function trainPremiumTroops(req, res) {
  try {
    const { key } = req.params;
    const { quantity } = req.body || {};
    const castle = await castleService.startPremiumTraining(req.user._id, key, quantity);
    return res.json(formatCastle(castle, req.user));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function cancelTrainingOrder(req, res) {
  try {
    const { id } = req.params;
    const castle = await castleService.cancelTraining(req.user._id, id);
    return res.json(formatCastle(castle, req.user));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

// ====== تسريع فوري بالجواهر - أمر تدريب واقف في طابور الثكنة ====== نفس
// شكل cancelTrainingOrder فوق بالظبط، بس بينادي castleService.speedupTraining
// بدل ما يلغي الأمر - الوحدات بتتضاف للجيش فورًا وباقي الطابور بيتزحزح
// لقدام بمقدار المدة اللي اتلغت (راجع castle.service.js للتفاصيل).
async function speedupTrainingOrder(req, res) {
  try {
    const { id } = req.params;
    const castle = await castleService.speedupTraining(req.user._id, id);
    return res.json(formatCastle(castle, req.user));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

// ====== قائمة كل أنواع المباني جاهزة لقائمة "وضع البناء" (Build Menu) ======
// بترجع لكل نوع: الاسم/الوصف (من castle.config)، تكلفة ومدة البناء الأول
// (مستوى 1 - بنفس معادلات الترقية العادية)، وهل هو مبني بالفعل في قلعة
// اللاعب ده، وهل شرط مستوى المبنى الرئيسي متحقق. الفرونت إند مش محتاج
// يحسب أو يفترض أي رقم - كله جاهز من هنا عشان يفضل كل حاجة data-driven.
async function listBuildingTypes(req, res) {
  try {
    const castle = await castleService.getOrCreateCastle(req.user._id);
    const slotsInfo = castleService.getCitySlotsInfo(castle);

    const types = Object.values(BUILDING_TYPES).map((cfg) => {
      const isMultiInstance = cfg.category === 'producer' || cfg.category === 'military';
      const existing = castle.buildings.find((b) => b.key === cfg.key);

      // ====== لمباني الموارد/العسكرية (ممكن يبقى منها أكتر من واحدة): مش
      // "مبني بالفعل" (already_built) اللي بيمنع البناء زي الأول، دلوقتي
      // المنع بيبقى بس لما خانات الفئة كلها تتملي (category_slots_used >=
      // category_slots_max) - الفرونت إند يقدر يعرض الاتنين. ======
      const categorySlots = isMultiInstance ? slotsInfo.find((s) => s.category === cfg.category) : null;
      const alreadyBuilt = isMultiInstance ? false : Boolean(existing);

      return {
        key: cfg.key,
        name: cfg.name,
        description: cfg.description,
        category: cfg.category,
        resource: cfg.resource || null,
        max_level: cfg.max_level,
        cost: alreadyBuilt ? null : upgradeCost(cfg.key, 1),
        build_seconds: alreadyBuilt ? null : upgradeSeconds(cfg.key, 1),
        already_built: alreadyBuilt,
        current_level: existing?.level ?? 0,
        within_town_hall_cap: castleService.isWithinTownHallCap(castle, cfg, 1),
        category_slots_used: categorySlots?.used ?? null,
        category_slots_max: categorySlots?.max ?? null,
      };
    });

    return res.json({ building_types: types });
  } catch (err) {
    console.error('[Castle] listBuildingTypes error:', err.message);
    return res.status(500).json({ error: 'تعذر تحميل أنواع المباني' });
  }
}

// ====== قائمة كل أنواع الوحدات جاهزة لبانل تدريب الثكنة ====== 
// بترجع لكل نوع: الاسم/الوصف/الإحصائيات (من castle.config)، التكلفة ومدة
// تدريب وحدة واحدة، وهل شرط مستوى الثكنة متحقق - الفرونت إند بيضرب
// cost_per_unit/seconds_per_unit في العدد اللي اختاره اللاعب بنفسه عشان
// يعرض المجموع لحظيًا من غير ما يحتاج طلب جديد لكل تغيير في العدّاد.
async function listTroopTypes(req, res) {
  try {
    const castle = await castleService.getOrCreateCastle(req.user._id);
    const barracks = castle.buildings.find((b) => b.key === 'barracks');
    const barracksLevel = barracks?.level || 0;
    // ====== ميزة البطل "الجنرال رستم" (training_speed_percent) - بتخلي كل
    // وحدة عادية تتدرب أسرع. نفس الحساب المستخدم فعليًا في
    // castleService.startTraining (راجعه هناك)، هنا بس عشان الفرونت إند
    // يعرض المدة الصحيحة قبل ما اللاعب يبعت طلب التدريب. ======
    const hero = heroInfo(castle.hero_key);
    const trainingSpeedBonus = Number(hero?.bonuses?.training_speed_percent) || 0;

    const types = Object.values(TROOP_TYPES).map((cfg) => ({
      key: cfg.key,
      name: cfg.name,
      description: cfg.description,
      cost_per_unit: cfg.cost,
      seconds_per_unit: cfg.is_premium ? cfg.train_seconds : Math.max(1, Math.round(cfg.train_seconds * (1 - trainingSpeedBonus))),
      stats: cfg.stats,
      requires_barracks_level: cfg.requires_barracks_level,
      unlocked: barracksLevel >= cfg.requires_barracks_level,
      // ====== وحدة مميّزة (بالجواهر/رصيد المحفظة) - `gem_cost_per_unit`
      // موجودة بس لو is_premium (undefined غير كده)، الفرونت إند بيستخدمها
      // بدل cost_per_unit العادية لعرض/حساب تكلفة الوحدة دي. ======
      is_premium: Boolean(cfg.is_premium),
      gem_cost_per_unit: cfg.is_premium ? cfg.gem_cost_per_unit : undefined,
    }));

    return res.json({
      troop_types: types,
      barracks_level: barracksLevel,
      max_queue_size: maxQueueSize(barracksLevel),
      queue_used: castle.training_queue.length,
    });
  } catch (err) {
    console.error('[Castle] listTroopTypes error:', err.message);
    return res.status(500).json({ error: 'تعذر تحميل أنواع الوحدات' });
  }
}

// ====== قائمة الأبطال المتاحين للاختيار قبل بداية اللعب - بترجع بيانات
// العرض الجاهزة لكل بطل (الاسم/اللقب/الوصف/البونص) من hero.config.js، زائد
// hero_key بتاع القلعة الحالية (null لحد ما اللاعب يختار) عشان الفرونت إند
// يعرف يفرّق "لسه ماخترتش" عن "اخترت الأول" من غير طلب تاني. ======
async function getHeroes(req, res) {
  try {
    const castle = await castleService.getOrCreateCastle(req.user._id);
    return res.json({ heroes: listHeroes(), chosen_hero_key: castle.hero_key || null });
  } catch (err) {
    console.error('[Castle] getHeroes error:', err.message);
    return res.status(500).json({ error: 'تعذر تحميل الأبطال' });
  }
}

// ====== اختيار بطل - مرة واحدة بس لكل قلعة (اختيار نهائي، راجع
// castleService.chooseHero). بيرجّع القلعة كاملة بنفس شكل /castle/me عشان
// الفرونت إند يقدر يقفل مودال الاختيار ويكمل مباشرة بنفس البيانات. ======
async function chooseHero(req, res) {
  try {
    const { hero_key } = req.body;
    await castleService.chooseHero(req.user._id, hero_key);
    const castle = await castleService.getOrCreateCastle(req.user._id);
    return res.json(formatCastle(castle, req.user));
  } catch (err) {
    return res.status(400).json({ error: err.message || 'تعذر اختيار البطل' });
  }
}


// بس القلاع (لاعبين حقيقيين + معسكرات NPC) اللي جوه نصف قطر رؤية اللاعب
// الحالي (castleService.getNearbyCastles)؛ نصف القطر ده ثابت من السيرفر
// ومحسوب من مكان قلعة اللاعب نفسه بس - الراوت مبيقبلش أي راديوس من العميل
// عشان محدّش يقدر يوسّع رؤيته. بتولّد معسكرات NPC جديدة أول مرة لو المنطقة
// حوالين قلعتك لسه فاضية ======
// ====== NEW (World exploration fix) - بيقرا center_x/center_y اختياريين من
// الكويري (مكان الكاميرا الحالي وهي بعيدة عن قلعة اللاعب، مبعوتة من
// الفرونت إند وقت الاستكشاف - شوف WorldMapPage.jsx) ويتأكد إنهم أرقام
// حقيقية (finite) قبل ما يستخدمهم، وإلا بيرجع null (يبقى السلوك زي الأول
// تمامًا - حوالين قلعة اللاعب). نصف قطر الرؤية نفسه ثابت من السيرفر زي ما
// هو (VISION_RADIUS_SLOTS جوه castleService) - العميل بس بيغيّر *فين* بيبص،
// مش *لحد فين* بيشوف. ======
function parseExploreCenter(req) {
  const x = Number(req.query.center_x);
  const y = Number(req.query.center_y);
  if (Number.isFinite(x) && Number.isFinite(y)) {
    return { x, y };
  }
  return null;
}

async function getNearbyCastles(req, res) {
  try {
    const castles = await castleService.getNearbyCastles(req.user._id, undefined, parseExploreCenter(req));
    return res.json({ castles });
  } catch (err) {
    console.error('[Castle] getNearbyCastles error:', err.message);
    return res.status(500).json({ error: 'تعذر تحميل القلاع القريبة' });
  }
}

// ====== NEW (World Manager fix) - كائنات العالم القريبة (barbarian camps,
// guard towers, ruins, neutral villages/cities/fortresses, resource nodes,
// decoration) جوه نفس نطاق رؤية اللاعب المستخدم في /castle/nearby - راوت
// إضافي مستقل، معملش أي تعديل على getNearbyCastles أو شكل ردّها. ======
async function getNearbyWorldObjects(req, res) {
  try {
    const objects = await castleService.getNearbyWorldObjects(req.user._id, undefined, parseExploreCenter(req));
    return res.json({ objects });
  } catch (err) {
    console.error('[Castle] getNearbyWorldObjects error:', err.message);
    return res.status(500).json({ error: 'تعذر تحميل كائنات العالم القريبة' });
  }
}

// ====== يحوّل مسير هجوم "قادم" أو "شغال لايف" لهدف معيّن لشكل مختصر جاهز
// للعرض وقت زيارة قلعة تانية (شوف viewCastle) - id هنا هو march_id نفسه،
// يستخدمه الفرونت إند مباشرة كـ /battles/:marchId (صفحة المتابعة اللايف
// العامة - متاحة لأي زائر، مش بس صاحب القلعة أو حليفه). status بتفرّق بين
// 'traveling' (لسه ماشي) و'battling' (المعركة بدأت فعليًا لايف). ======
function formatIncomingMarch(march) {
  return {
    id: march._id,
    direction: march.direction,
    status: march.status,
    troops: (march.troops || []).map((s) => ({ key: s.key, name: TROOP_TYPES[s.key]?.name || s.key, count: s.count })),
    departed_at: march.departed_at,
    arrives_at: march.arrives_at,
    battle_ends_at: march.battle_ends_at,
  };
}

// ====== Requirement 3 (Reinforcement & Battle System): تعزيزات الحلفاء
// الواقفة حاليًا جوه القلعة دي - بتبان لأي زائر (مش بس صاحب القلعة نفسه)
// عشان يوضح فعليًا إن القلعة دي متحصّنة بجنود حلفاء، بالظبط زي ما جيش
// القلعة نفسه بيبان. ownerNameMap هنا لازم يشمل origin_user_id بتاع كل
// تعزيز (مش بس صاحب القلعة) عشان الفرونت إند يعرف يعرض "تعزيز من فلان". ======
function formatStationedReinforcements(reinforcements, ownerNameMap) {
  return (reinforcements || []).map((r) => ({
    id: r._id,
    origin_user_id: r.origin_user_id,
    origin_name: ownerNameMap.get(r.origin_user_id.toString()) || null,
    stationed_at: r.stationed_at,
    troops: (r.troops || []).map((s) => ({ key: s.key, name: TROOP_TYPES[s.key]?.name || s.key, count: s.count })),
  }));
}

// ====== بحث العالم (World Search) - بحث عالمي حقيقي بيتخطى ضباب الحرب
// تمامًا (عكس /castle/nearby): باسم اللاعب (جزئي)، رقم اللاعب (Player ID)،
// أو رقم المملكة (Kingdom ID) - شوف worldSearch.service للتفاصيل الكاملة.
// q هو نص البحث، type اختياري (name/player_id/kingdom_id) لو الفرونت إند
// عايز يقصر البحث على نوع واحد بس - الافتراضي 'auto' بيفحص كل الأنواع. ======
async function searchWorld(req, res) {
  try {
    const { q, type } = req.query;
    const results = await worldSearchService.searchWorld(q, type || 'auto');
    return res.json({ results });
  } catch (err) {
    console.error('[Castle] searchWorld error:', err.message);
    return res.status(500).json({ error: 'تعذر تنفيذ البحث' });
  }
}

// ====== "دخول مملكة" لاعب/معسكر تاني - بيرجّع نفس شكل formatCastle بالظبط
// (كل المباني الحقيقية بمستوياتها ومواقعها + الجيش + الموارد) بدل نسخة
// مصغّرة/تقريبية، عشان الفرونت إند يرسمها بنفس مشهد القلعة (IsometricWorld)
// المستخدم أصلًا لقلعة اللاعب نفسه - مش بوب أب معاينة منفصل. بيضيف كمان
// بيانات صاحب القلعة (اسم/تحالف/مسافة/NPC) وأي جيوش "ماشية" حاليًا تجاه
// القلعة دي (هجوم لسه في الطريق) عشان تبان على الخريطة وقت الزيارة. ======
async function viewCastle(req, res) {
  try {
    const { id } = req.params;
    const view = await castleService.getCastleView(req.user._id, id);
    // ====== NEW (Attackable World Objects) - `id` جاي من الراوت ممكن يكون
    // "wobj:<worldObjectId>" (راجع world/worldObjectCastleBridge.js) مش
    // Castle ID خام - march.target_castle_id دايمًا Castle ID حقيقي (حتى
    // لكائنات العالم، بيبقى ده id القلعة الظل)، فلازم نستخدم view.castle._id
    // (اللي getCastleView أصلًا حلّته لقلعة حقيقية) بدل id الخام هنا. ======
    // ====== *** تعديل: بقينا نجيب traveling وbattling مع بعض (مش
    // traveling بس زي قبل كده) - عشان أي زائر لقلعة تحت هجوم شغال لايف
    // فعليًا (مش بس لسه في الطريق) يقدر يشوف ده ويتابعه، مش بس وقت ما الجيش
    // لسه ماشي. ******
    const incomingMarches = await March.find({
      target_castle_id: view.castle._id,
      status: { $in: ['traveling', 'battling'] },
      direction: 'attack',
    }).sort({ arrives_at: 1 });

    // ====== Requirement 3: تعزيزات الحلفاء الواقفة في القلعة دي دلوقتي -
    // القلاع الآلية (NPC) مالهاش نظام تحالفات فمفيش داعي نستعلم عنها أصلًا. ======
    let stationedReinforcements = [];
    if (!view.castle.is_npc) {
      try {
        stationedReinforcements = await allianceReinforcementService.getStationedForCastle(view.castle._id);
      } catch (err) {
        console.error('[Castle] failed to load stationed reinforcements for view:', err.message);
      }
    }
    const reinforcementOwnerIds = [...new Set(stationedReinforcements.map((r) => r.origin_user_id.toString()))];
    const reinforcementOwnerNameMap =
      reinforcementOwnerIds.length > 0 ? await castleService.buildOwnerNameMap(reinforcementOwnerIds) : new Map();

    return res.json({
      ...formatCastle(view.castle),
      is_npc: view.castle.is_npc,
      name: view.castle.is_npc ? view.castle.npc_name : null,
      owner_id: view.ownerId,
      owner_name: view.ownerName,
      alliance_tag: view.allianceTag,
      is_same_alliance: view.isSameAlliance,
      distance_slots: view.distanceSlots,
      is_own: view.isOwn,
      incoming_marches: incomingMarches.map(formatIncomingMarch),
      reinforcements: formatStationedReinforcements(stationedReinforcements, reinforcementOwnerNameMap),
    });
  } catch (err) {
    console.error('[Castle] viewCastle error:', err.message);
    return res.status(400).json({ error: err.message || 'تعذر تحميل القلعة' });
  }
}

// ====== استكشاف (Scout) قلعة تانية من جوه وضع الزيارة - تقرير استخباراتي
// فوري (موارد/جيش/قوة دفاع مقابل قوة هجومك) من غير أي جيش بيتحرك ومن غير
// خطر على جيشك. ======
async function scoutCastle(req, res) {
  try {
    const { id } = req.params;
    const report = await castleService.scoutCastle(req.user._id, id);
    return res.json(report);
  } catch (err) {
    return res.status(400).json({ error: err.message || 'تعذر تنفيذ الاستكشاف' });
  }
}

// ====== إرسال موارد فورية لقلعة حليف (لازم يكونوا في نفس التحالف) - بيرجع
// قلعتك المحدّثة (بعد الخصم) + الكمية اللي وصلت فعليًا للهدف (ممكن تبقى أقل
// من المطلوب لو مخازنه قريبة من السقف). ======
async function sendResources(req, res) {
  try {
    const { id } = req.params;
    const { resources } = req.body || {};
    const result = await castleService.sendResources(req.user._id, id, resources);
    return res.json({ castle: formatCastle(result.castle, req.user), delivered: result.delivered });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'تعذر إرسال الموارد' });
  }
}

// ====== FIX (Gather action for gatherable world objects) - حصاد فوري لعقدة
// موارد (resource_node) - بيرجّع قلعة اللاعب المحدّثة (formatCastle - نفس
// شكل أي رد فيه موارد) + الكمية اللي اتحصدت فعليًا (gained، ممكن تبقى أقل
// من الغنيمة الأصلية لو مخازن اللاعب قريبة من السقف). ======
async function gatherWorldObject(req, res) {
  try {
    const { id } = req.params;
    const result = await castleService.gatherWorldObject(req.user._id, id);
    return res.json({ castle: formatCastle(result.castle, req.user), gained: result.gained });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'تعذر الحصاد' });
  }
}

module.exports = {
  getMyCastle,
  getHeroes,
  chooseHero,
  upgradeBuilding,
  speedupBuilding,
  buildNewBuilding,
  moveBuilding,
  listBuildingTypes,
  getNearbyCastles,
  getNearbyWorldObjects,
  trainTroops,
  trainPremiumTroops,
  cancelTrainingOrder,
  speedupTrainingOrder,
  listTroopTypes,
  viewCastle,
  scoutCastle,
  sendResources,
  searchWorld,
  formatCastle,
  gatherWorldObject,
};
