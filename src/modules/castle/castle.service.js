const Castle = require('./castle.model');
const CastleDefense = require('../defense/defense.model');
const WorldObject = require('../world/worldObject.model');
const worldMapService = require('./worldMap.service');
// ====== AttackableTarget abstraction (راجع world/worldObjectCastleBridge.js)
// - نفس resolveAttackableCastle اللي march.service بتستخدمها، مستخدمة هنا
// عشان "دخول المملكة" (getCastleView) و"استكشاف" (scoutCastle) يشتغلوا على
// كائنات العالم المعادية بالظبط زي أي قلعة NPC تانية، من غير أي راوت أو
// نظام منفصل. ======
const { resolveAttackableCastle, respawnDueHostileObjects } = require('../world/worldObjectCastleBridge');
const { npcTierInfo } = require('./npcTiers.config');
const { getNpcType } = require('../world/npcRegistry');
const { factionInfo } = require('../world/factions.config');
const { isValidHeroKey, heroInfo } = require('./hero.config');
const inboxService = require('../inbox/inbox.service');
const walletService = require('../wallets/wallet.service');
const Alliance = require('../alliances/alliance.model');
const allianceService = require('../alliances/alliance.service');
const allianceReinforcementService = require('../alliances/allianceReinforcement.service');
const User = require('../users/user.model');
const counterService = require('../common/counter.service');
const { isAdmin } = require('../common/adminAccess.service');
// ====== نظام المهام اليومية - تسجيل تقدم لحظة ما ترقية/تدريب/حصاد يخلص.
// require متأخر (lazy) جوه الدوال نفسها بدل فوق هنا عشان نتفادى أي مشكلة
// ترتيب تحميل بين الموديولين (quest.service بيستورد castle.service كمان). ====== */

// ====== أساس أرقام "Kingdom ID" - بيبدأ من هنا بدل الصفر عشان يبان زي رقم
// تعريف حقيقي (6 أرقام) - نفس فكرة PLAYER_ID_OFFSET في auth.service.js. ======
const KINGDOM_ID_OFFSET = 100000;
const {
  RESOURCE_TYPES,
  BASE_FREE_CAPACITY,
  maxCityTilesForLevel,
  BUILDING_TYPES,
  INITIAL_BUILDINGS,
  TROOP_TYPES,
  MAX_TRAINING_BATCH,
  maxLevelForTownHall,
  unlockedSlotsForCategory,
  nextSlotUnlock,
  generateInitialTiles,
  generateSquareRingTiles,
  upgradeCost,
  upgradeSeconds,
  producerOutputPerHour,
  storageCapacity,
  maxQueueSize,
  trainingCost,
  trainingSeconds,
  isPremiumTroopType,
  premiumTrainingGemCost,
  speedupGemCost,
  VISION_RADIUS_SLOTS,
  BASE_DEFENSE_PER_TOWNHALL_LEVEL,
  armyStatTotal,
} = require('./castle.config');

// ====== بيحوّل كومة وحدات (جيش واقف) لشكل جاهز للعرض في تقرير الاستكشاف -
// نفس فكرة formatArmy في castle.controller بس هنا محتاجينها جوه service
// عشان scoutCastle يقدر يبنيها لجيش الهدف من غير ما يعتمد على الكونترولر ======
function formatArmyStacks(troops) {
  return (troops || []).map((t) => ({
    key: t.key,
    name: TROOP_TYPES[t.key]?.name || t.key,
    count: t.count,
  }));
}

// ====== إنشاء قلعة جديدة للاعب لأول مرة ======
async function createCastle(userId) {
  const mapSlot = await worldMapService.assignNextSlot();
  const kingdomId = await counterService.nextSequence('kingdom_id', KINGDOM_ID_OFFSET);

  const castle = await Castle.create({
    user_id: userId,
    map_slot: mapSlot,
    kingdom_id: kingdomId,
    buildings: INITIAL_BUILDINGS.map((b) => ({ key: b.key, level: 1, position: b.position })),
    unlocked_tiles: generateInitialTiles(),
    resources: {
      gold: { stored: 300, last_synced_at: new Date() },
      wood: { stored: 300, last_synced_at: new Date() },
      stone: { stored: 300, last_synced_at: new Date() },
    },
  });

  return castle;
}

// ====== اختيار الهيرو - مرة واحدة بس قبل ما اللاعب يبدأ يلعب فعليًا (أول
// دخول ليه، بعد ما قلعته تتعمل بـ createCastle فوق وقبل ما يشوف خريطة
// العالم). اختيار نهائي: لو القلعة عندها hero_key بالفعل، بيرفض من غير ما
// يغيّر حاجة - مفيش مسار "تغيير الهيرو" في اللعبة دلوقتي. ======
async function chooseHero(userId, heroKey) {
  if (!isValidHeroKey(heroKey)) {
    throw new Error('البطل ده مش موجود');
  }

  const castle = await Castle.findOne({ user_id: userId });
  if (!castle) throw new Error('القلعة مش موجودة');

  if (castle.hero_key) {
    throw new Error('اخترت بطلك بالفعل - الاختيار ده نهائي');
  }

  castle.hero_key = heroKey;
  await castle.save();
  return castle;
}

// ====== حساب سقف تخزين مورد معيّن من كل مباني التخزين بتاعته + السقف المجاني ======
function computeCapacity(castle, resource) {
  let cap = BASE_FREE_CAPACITY;
  for (const b of castle.buildings) {
    const cfg = BUILDING_TYPES[b.key];
    if (cfg?.category === 'storage' && cfg.resource === resource) {
      cap += storageCapacity(b.key, b.level);
    }
  }
  return cap;
}

// ====== حساب معدل الإنتاج بالثانية لمورد معيّن من كل مباني الإنتاج بتاعته ======
function computeProductionPerSecond(castle, resource) {
  let perHour = 0;
  for (const b of castle.buildings) {
    const cfg = BUILDING_TYPES[b.key];
    if (cfg?.category === 'producer' && cfg.resource === resource) {
      perHour += producerOutputPerHour(b.key, b.level);
    }
  }
  return perHour / 3600;
}

// ====== مزامنة الموارد: بتحسب اللي اتجمع من وقت آخر مزامنة لحد دلوقتي ======
// بنعمل الحساب ده وقت القراءة بس (lazy) - مفيش cron شغال كل ثانية، أخف وأبسط.
function syncResources(castle) {
  const now = new Date();
  for (const resource of RESOURCE_TYPES) {
    const state = castle.resources[resource];
    const elapsedSeconds = Math.max(0, (now - state.last_synced_at) / 1000);
    const perSecond = computeProductionPerSecond(castle, resource);
    const cap = computeCapacity(castle, resource);

    state.stored = Math.min(cap, state.stored + perSecond * elapsedSeconds);
    state.last_synced_at = now;
  }
}

// ====== استكمال أي ترقيات خلصت وقتها تلقائيًا - بترجع قائمة بالمباني اللي
// خلصت (key + المستوى الجديد) عشان اللي بينادي يقدر يبعت رسالة صندوق وارد
// عنها لو حابب، مش مجرد boolean زي الأول ======
function completeFinishedUpgrades(castle) {
  const now = new Date();
  const completed = [];
  for (const b of castle.buildings) {
    if (b.upgrade?.in_progress && b.upgrade.completes_at <= now) {
      completed.push({ key: b.key, level: b.upgrade.target_level });
      b.level = b.upgrade.target_level;
      b.upgrade.in_progress = false;
      b.upgrade.target_level = null;
      b.upgrade.started_at = null;
      b.upgrade.completes_at = null;
    }
  }

  // ====== أي ترقية للمبنى الرئيسي خلصت هنا معناها سقف مساحة المدينة زاد
  // (شوف maxCityTilesForLevel في castle.config) - بنوسّع unlocked_tiles
  // فورًا للسقف الجديد تلقائيًا، مفيش أي شراء أو أكشن إضافي مطلوب من اللاعب. ======
  if (completed.some((c) => c.key === 'town_hall')) {
    expandCityToLevelCap(castle);
  }

  return completed;
}

// ====== استكمال أي أوامر تدريب في طابور الثكنة خلصت وقتها - الطابور
// متسلسل (أمر واحد شغال فعليًا في كل لحظة) وcompletes_at كل أمر اتحسب
// وقت إنشائه بناءً على انتهاء اللي قبله، فبنشيل من أول الطابور بس (FIFO)
// لحد ما نلاقي أمر لسه معداش وقته. بترجع قائمة بالوحدات اللي خلصت (key +
// العدد) عشان اللي بينادي يقدر يبعت رسالة صندوق وارد عنها ======
function completeFinishedTraining(castle) {
  const now = new Date();
  const completed = [];
  while (castle.training_queue.length > 0 && castle.training_queue[0].completes_at <= now) {
    const order = castle.training_queue[0];
    completed.push({ key: order.key, quantity: order.quantity });

    const stack = castle.army.find((a) => a.key === order.key);
    if (stack) stack.count += order.quantity;
    else castle.army.push({ key: order.key, count: order.quantity });

    castle.training_queue.splice(0, 1);
  }
  return completed;
}

// ====== نظام المهام اليومية - تتبع تقدم مهمة "رقّي مبنى" و"درّب قوات" لحظة
// ما ترقية/تدريب يخلص فعليًا (مش وقت البدء) - نفس فلسفة
// notifyBuildingsCompleted تمامًا: مغلّفة بـ try/catch عشان فشلها لوحده
// مايأثرش على عملية اللعب الأساسية (القلعة أصلًا اتحدثت بنجاح). ======
async function trackQuestsForCompletion(userId, completedBuildings, completedTraining) {
  try {
    if (completedBuildings.length > 0) {
      // eslint-disable-next-line global-require
      const questService = require('../quests/quest.service');
      await questService.recordQuestProgress(userId, 'upgrade_building', completedBuildings.length);
    }
    if (completedTraining.length > 0) {
      const totalTrained = completedTraining.reduce((sum, t) => sum + t.quantity, 0);
      // eslint-disable-next-line global-require
      const questService = require('../quests/quest.service');
      await questService.recordQuestProgress(userId, 'train_troops', totalTrained);
    }
  } catch (err) {
    console.error('[Castle] failed to track quest progress:', err.message);
  }
}

// ====== يبعت رسالة صندوق وارد للاعب عن كل مبنى خلصت ترقيته - بيتلف على أي
// error من غير ما يفشل العملية الأساسية (مزامنة القلعة)، لأن رسالة الصندوق
// دي "nice to have" مش جزء من منطق اللعبة الأساسي ======
async function notifyBuildingsCompleted(userId, completed) {
  for (const item of completed) {
    const cfg = BUILDING_TYPES[item.key];
    const buildingName = cfg?.name || item.key;
    try {
      await inboxService.createSystemMessage({
        userId,
        type: 'building_upgrade_complete',
        title: 'خلصت ترقية مبنى',
        body: `${buildingName} وصل لمستوى ${item.level} في قلعتك.`,
        metadata: { building_key: item.key, level: item.level },
      });
    } catch (err) {
      console.error('[Castle] failed to send inbox message for building completion:', err.message);
    }
  }
}

// ====== يبعت رسالة صندوق وارد للاعب عن كل أمر تدريب خلص - نفس فلسفة
// notifyBuildingsCompleted (بيتلف على أي error من غير ما يفشل العملية
// الأساسية لأنها "nice to have" مش جزء من منطق اللعبة الأساسي) ======
async function notifyTrainingCompleted(userId, completed) {
  for (const item of completed) {
    const cfg = TROOP_TYPES[item.key];
    const troopName = cfg?.name || item.key;
    try {
      await inboxService.createSystemMessage({
        userId,
        type: 'troop_training_complete',
        title: 'خلص تدريب وحدات',
        body: `اتدرب ${item.quantity} من ${troopName} وبقوا جاهزين في جيشك.`,
        metadata: { troop_key: item.key, quantity: item.quantity },
      });
    } catch (err) {
      console.error('[Castle] failed to send inbox message for training completion:', err.message);
    }
  }
}

// ====== تجهيز مشترك لأي عملية على القلعة: يجيب القلعة، يستكمل أي ترقيات
// مباني أو أوامر تدريب خلصت وقتها، ويزامن الموارد - من غير ما يتأكد من
// حالة "شغل جاري" (ده مسؤولية اللي بينادي حسب نوع العملية) ======
async function loadCastleCommon(userId) {
  const castle = await Castle.findOne({ user_id: userId });
  if (!castle) throw new Error('القلعة مش موجودة');

  const completedBuildings = completeFinishedUpgrades(castle);
  const completedTraining = completeFinishedTraining(castle);
  syncResources(castle);

  if (completedBuildings.length > 0) {
    await notifyBuildingsCompleted(userId, completedBuildings);
  }
  if (completedTraining.length > 0) {
    await notifyTrainingCompleted(userId, completedTraining);
  }
  await trackQuestsForCompletion(userId, completedBuildings, completedTraining);

  return castle;
}

// ====== جيب قلعة اللاعب (وأنشئها لو أول مرة)، بعد ما تتزامن الموارد وتتفحص الترقيات ======
async function getOrCreateCastle(userId) {
  let castle = await Castle.findOne({ user_id: userId });
  if (!castle) {
    castle = await createCastle(userId);
  }

  const completedBuildings = completeFinishedUpgrades(castle);
  const completedTraining = completeFinishedTraining(castle);
  syncResources(castle);
  await castle.save();

  if (completedBuildings.length > 0) {
    await notifyBuildingsCompleted(userId, completedBuildings);
  }
  if (completedTraining.length > 0) {
    await notifyTrainingCompleted(userId, completedTraining);
  }
  await trackQuestsForCompletion(userId, completedBuildings, completedTraining);

  return castle;
}

// ====== تجهيز مشترك قبل أي عملية بناء/ترقية: بيستخدم loadCastleCommon
// وبعدين يتأكد كمان إنه مفيش ترقية/بناء شغال حاليًا (شرط خاص بالمباني بس -
// التدريب في الثكنة مسار مستقل مش بيتأثر بيه) ======
async function loadCastleForAction(userId) {
  const castle = await loadCastleCommon(userId);

  // مبنى واحد بس شغال في نفس الوقت في كل القلعة (زي أغلب ألعاب البناء
  // الاستراتيجية - بانِ واحد أساسي) - ممكن نضيف "بناة إضافيين" كترقية لاحقًا.
  const anyInProgress = castle.buildings.some((b) => b.upgrade?.in_progress);
  if (anyInProgress) {
    throw new Error('في ترقية شغالة بالفعل - استنى لحد ما تخلص');
  }

  return castle;
}

// ====== Admin privilege (Unlimited Resources) - `adminBypass` (bool) لو
// true بيخلي الخصم ده no-op تمامًا: مفيش فحص "الموارد كفاية؟" ومفيش خصم
// فعلي خالص - يعني موارد الأدمن بتفضل زي ما هي مهما كانت التكلفة. القيمة
// دي بتتحسب مرة واحدة في كل عملية (startUpgrade/startNewBuilding/
// startTraining) عن طريق isAdmin(userId) وبتتمرر هنا - مفيش أي فحص role
// جوه الدالة دي نفسها عشان يفضل مصدر واحد بس للقرار ده (adminAccess.service). ======
function deductCost(castle, cost, adminBypass = false) {
  if (adminBypass) return;

  for (const resource of RESOURCE_TYPES) {
    if (castle.resources[resource].stored < cost[resource]) {
      throw new Error('الموارد مش كفاية للعملية دي');
    }
  }
  for (const resource of RESOURCE_TYPES) {
    castle.resources[resource].stored -= cost[resource];
  }
}

function isWithinTownHallCap(castle, cfg, nextLevel) {
  if (cfg.category === 'headquarters') return true;
  const townHall = castle.buildings.find((b) => b.key === 'town_hall');
  const cap = maxLevelForTownHall(townHall?.level || 1);
  return nextLevel <= cap;
}

function assertWithinTownHallCap(castle, cfg, nextLevel) {
  if (!isWithinTownHallCap(castle, cfg, nextLevel)) {
    throw new Error('لازم تطور المبنى الرئيسي الأول قبل ما تكمل هنا');
  }
}

// ====== "خانة أرض" (Tile) - نظام توسيع المدينة ======
function tileKey(x, y) {
  return `${x},${y}`;
}

function getUnlockedTileSet(castle) {
  return new Set((castle.unlocked_tiles || []).map((t) => tileKey(t.x, t.y)));
}

function isTileUnlocked(castle, x, y) {
  return getUnlockedTileSet(castle).has(tileKey(x, y));
}

// ====== أقصى مساحة (عدد خانات) مسموح بيها لمدينة القلعة دي دلوقتي - بتعتمد
// على مستوى المبنى الرئيسي الحالي (شوف maxCityTilesForLevel في
// castle.config) - كل ما تطوّر المبنى الرئيسي، السقف ده بيزيد أوتوماتيك
// وunlocked_tiles بتتوسّع لتغطيته (شوف expandCityToLevelCap تحت). ======
function getMaxCityTiles(castle) {
  const townHall = castle.buildings.find((b) => b.key === 'town_hall');
  return maxCityTilesForLevel(townHall?.level || 1);
}

// ====== توسيع مساحة المدينة تلقائيًا لتغطية السقف الحالي (getMaxCityTiles) -
// مفيش شراء ولا تكلفة هنا خالص، مجرد ملء أي خانات ناقصة. بتتنادى تلقائيًا
// أول ما ترقية المبنى الرئيسي تخلص (completeFinishedUpgrades) فاللاعب
// بيلاقي مساحة مدينته كبرت لوحدها من غير أي أكشن إضافي منه. بنستخدم
// generateSquareRingTiles عشان شكل المدينة يفضل مربع منتظم حوالين نفس
// المنتصف (زي شبكة البداية بالظبط) بدل ما يكبر بشكل عشوائي، وبنضيف بس
// الخانات الناقصة (اللي لسه مش موجودة في unlocked_tiles) عشان محدّش يفقد أي
// مبنى أو مكان بناه بالفعل. بترجع true لو فعلاً ضافت خانات جديدة. ======
function expandCityToLevelCap(castle) {
  const maxTiles = getMaxCityTiles(castle);
  if ((castle.unlocked_tiles?.length || 0) >= maxTiles) {
    return false;
  }

  const existing = getUnlockedTileSet(castle);
  const candidateShape = generateSquareRingTiles(maxTiles);
  const merged = [...(castle.unlocked_tiles || [])];

  for (const t of candidateShape) {
    if (merged.length >= maxTiles) break;
    const key = tileKey(t.x, t.y);
    if (!existing.has(key)) {
      merged.push(t);
      existing.add(key);
    }
  }

  castle.unlocked_tiles = merged;
  return true;
}

// ====== معلومات "خانات المباني" الجاهزة للعرض في الواجهة - لكل فئة
// (producer/military): كام خانة مستخدمة دلوقتي، كام أقصى خانة متاحة عند
// مستوى القلعة الحالي، وأقرب مستوى هيفتح خانة جديدة (لو موجود). ======
function getCitySlotsInfo(castle) {
  const townHall = castle.buildings.find((b) => b.key === 'town_hall');
  const castleLevel = townHall?.level || 1;

  return ['producer', 'military'].map((category) => {
    const used = castle.buildings.filter((b) => BUILDING_TYPES[b.key]?.category === category).length;
    const max = unlockedSlotsForCategory(category, castleLevel);
    const next = nextSlotUnlock(category, castleLevel);
    return {
      category,
      used,
      max,
      next_unlock_level: next?.castle_level ?? null,
      next_unlock_slots: next?.slots ?? null,
    };
  });
}

// ====== بدء ترقية مبنى موجود بالفعل في القلعة ======
// buildingKeyOrId: تاريخيًا كان دايمًا "مفتاح" (زي 'gold_mine') لأنه كان
// مينفعش يكون غير مبنى واحد بكل مفتاح. دلوقتي بعد نظام الخانات الإضافية
// (SLOT_UNLOCKS) ممكن يبقى عندك أكتر من منجم دهب مثلاً، فبنقبل هنا إما
// الـ _id الحقيقي بتاع المبنى (لو فيه أكتر من مبنى بنفس المفتاح) أو المفتاح
// نفسه لسه (للمباني اللي لسه واحدة بس زي المبنى الرئيسي والمخازن) - نفس
// راوت /buildings/:key/upgrade القديم شغال من غير تغيير.
async function startUpgrade(userId, buildingKeyOrId) {
  const adminBypass = await isAdmin(userId);
  const castle = await loadCastleForAction(userId);

  let building = null;
  if (/^[0-9a-fA-F]{24}$/.test(String(buildingKeyOrId))) {
    building = castle.buildings.id(buildingKeyOrId);
  }
  if (!building) {
    building = castle.buildings.find((b) => b.key === buildingKeyOrId);
  }
  if (!building) {
    throw new Error('المبنى ده لسه مش مبني - استخدم مسار بناء مبنى جديد الأول');
  }

  const cfg = BUILDING_TYPES[building.key];
  if (!cfg) throw new Error('نوع مبنى غير معروف');

  const nextLevel = building.level + 1;
  if (nextLevel > cfg.max_level) {
    throw new Error('المبنى ده وصل لأقصى مستوى');
  }
  assertWithinTownHallCap(castle, cfg, nextLevel);

  const cost = upgradeCost(building.key, nextLevel);
  deductCost(castle, cost, adminBypass);

  if (adminBypass) {
    // ====== Admin privilege (Unlimited Build Speed) - النتيجة النهائية
    // بتتطبق فورًا، من غير أي مؤقّت (upgrade.in_progress يفضل false) - نفس
    // أثر completeFinishedUpgrades لكن لحظيًا، بما في ذلك توسيع مساحة
    // المدينة لو المبنى الرئيسي هو اللي اترقّى. اللاعبين العاديين مش
    // بيمروا من هنا خالص (adminBypass = false ليهم دايمًا). ======
    building.level = nextLevel;
    if (building.key === 'town_hall') {
      expandCityToLevelCap(castle);
    }
  } else {
    const seconds = upgradeSeconds(building.key, nextLevel);
    const now = new Date();
    building.upgrade = {
      in_progress: true,
      target_level: nextLevel,
      started_at: now,
      completes_at: new Date(now.getTime() + seconds * 1000),
    };
  }

  await castle.save();
  return castle;
}

// ====== بناء مبنى جديد مش موجود في القلعة أصلاً (زي أول مخزن، أو منجم
// دهب ثاني لو فاتح خانة موارد إضافية) ======
async function startNewBuilding(userId, buildingKey, position) {
  const adminBypass = await isAdmin(userId);
  const cfg = BUILDING_TYPES[buildingKey];
  if (!cfg) throw new Error('نوع مبنى غير معروف');
  if (cfg.category === 'headquarters') {
    throw new Error('المبنى الرئيسي موجود بالفعل، مينفعش تتبني تاني');
  }

  const { x, y } = position || {};
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    !Number.isInteger(x) ||
    !Number.isInteger(y)
  ) {
    throw new Error('مكان غير صحيح على شبكة القلعة');
  }

  const castle = await loadCastleForAction(userId);

  // ====== الخانة لازم تكون جوه أرض مدينتك المفتوحة فعليًا (ابتدائية أو
  // مشتراة) - مش مجرد جوه حدود GRID_SIZE الثابتة زي الأول، عشان الأرض
  // المشتراة حديثًا (خارج الشبكة الابتدائية) تفضل صالحة لأي مبنى برضه. ======
  if (!isTileUnlocked(castle, x, y)) {
    throw new Error('الخانة دي لسه مش مفتوحة في مدينتك - افتحها الأول أو اختار مكان تاني');
  }

  if (castle.buildings.some((b) => b.position.x === x && b.position.y === y)) {
    throw new Error('المكان ده متشغول بمبنى تاني');
  }

  // ====== Admin privilege (Unlimited Build Placement) - خانات الفئة
  // (producer/military) والقيد اللي بيمنع بناء تاني نسخة من مبنى "واحد بس"
  // (زي المخازن) اتنين قيود بناء بحتة (مش موارد ولا مؤقّت) - بيتم تجاوزهم
  // للأدمن فقط عشان يقدر يحط أي مبنى لأغراض الاختبار، من غير ما يأثر على
  // نفس الفحص لللاعبين العاديين (adminBypass = false ليهم دايمًا). ======
  if (!adminBypass) {
    // ====== مباني الموارد والمباني العسكرية بقى ممكن يكون منها أكتر من
    // واحدة (خانات إضافية بتتفتح مع مستوى القلعة - شوف SLOT_UNLOCKS في
    // castle.config)، عكس مباني التخزين والمبنى الرئيسي اللي لسه واحد بس من
    // كل نوع. ======
    if (cfg.category === 'producer' || cfg.category === 'military') {
      const townHall = castle.buildings.find((b) => b.key === 'town_hall');
      const castleLevel = townHall?.level || 1;
      const used = castle.buildings.filter((b) => BUILDING_TYPES[b.key]?.category === cfg.category).length;
      const max = unlockedSlotsForCategory(cfg.category, castleLevel);
      if (used >= max) {
        const next = nextSlotUnlock(cfg.category, castleLevel);
        throw new Error(
          next
            ? `مفيش خانات فاضية من الفئة دي - رقّي المبنى الرئيسي لمستوى ${next.castle_level} عشان تفتح خانة جديدة`
            : 'مفيش خانات فاضية من الفئة دي حاليًا'
        );
      }
    } else if (castle.buildings.some((b) => b.key === buildingKey)) {
      throw new Error('المبنى ده موجود بالفعل في قلعتك - رقّيه بدل ما تبنيه تاني');
    }
  }

  assertWithinTownHallCap(castle, cfg, 1);

  const cost = upgradeCost(buildingKey, 1);
  deductCost(castle, cost, adminBypass);

  if (adminBypass) {
    // ====== Admin privilege (Unlimited Build Speed) - المبنى بيتحط جاهز
    // على مستوى 1 فورًا، مفيش upgrade.in_progress ولا مؤقّت خالص. ======
    castle.buildings.push({
      key: buildingKey,
      level: 1,
      position: { x, y },
    });
  } else {
    const seconds = upgradeSeconds(buildingKey, 1);
    const now = new Date();

    castle.buildings.push({
      key: buildingKey,
      level: 0,
      position: { x, y },
      upgrade: {
        in_progress: true,
        target_level: 1,
        started_at: now,
        completes_at: new Date(now.getTime() + seconds * 1000),
      },
    });
  }

  await castle.save();
  return castle;
}

// ====== نقل مبنى موجود بالفعل لخانة فاضية تانية على نفس شبكة القلعة ======
// النقل مجاني وفوري (مفيش تكلفة ولا مدة انتظار) - بس مينفعش وانت جوه
// ترقية/بناء شغالة (loadCastleForAction بتتأكد من كده)، والمبنى الرئيسي
// (town_hall) مينفعش يتنقل عشان هو نقطة الأساس اللي كل حاجة تانية بتتبني حواليه.
async function moveBuilding(userId, buildingId, position) {
  const { x, y } = position || {};
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    !Number.isInteger(x) ||
    !Number.isInteger(y)
  ) {
    throw new Error('مكان غير صحيح على شبكة القلعة');
  }

  const castle = await loadCastleForAction(userId);

  if (!isTileUnlocked(castle, x, y)) {
    throw new Error('الخانة دي لسه مش مفتوحة في مدينتك - افتحها الأول أو اختار مكان تاني');
  }

  const building = castle.buildings.id(buildingId);
  if (!building) {
    throw new Error('المبنى ده مش موجود');
  }

  const cfg = BUILDING_TYPES[building.key];
  if (cfg?.category === 'headquarters') {
    throw new Error('المبنى الرئيسي مينفعش يتنقل');
  }

  if (building.position.x === x && building.position.y === y) {
    throw new Error('المبنى موجود في المكان ده بالفعل');
  }

  const occupied = castle.buildings.some(
    (b) => b._id.toString() !== building._id.toString() && b.position.x === x && b.position.y === y
  );
  if (occupied) {
    throw new Error('المكان ده متشغول بمبنى تاني');
  }

  building.position = { x, y };

  await castle.save();
  return castle;
}

// ====== بدء تدريب دفعة وحدات جديدة في الثكنة ======
// مسار مستقل عن ترقيات المباني (بيستخدم loadCastleCommon مش
// loadCastleForAction) عشان تقدر تدرب وحدات وانت في نفس الوقت بتطور مبنى
// تاني في القلعة - الاتنين مواردهم مشتركة (بيتخصموا من نفس المخزون) بس
// "شغلهم" مستقل تمامًا (بانِ المباني ≠ مدرِّب الثكنة).
async function startTraining(userId, troopKey, quantity) {
  const troopCfg = TROOP_TYPES[troopKey];
  if (!troopCfg) throw new Error('نوع وحدة غير معروف');

  const qty = Number(quantity);
  if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty < 1) {
    throw new Error('عدد الوحدات غير صحيح');
  }
  if (qty > MAX_TRAINING_BATCH) {
    throw new Error(`أقصى عدد وحدات في أمر تدريب واحد هو ${MAX_TRAINING_BATCH}`);
  }

  const castle = await loadCastleCommon(userId);

  const barracks = castle.buildings.find((b) => b.key === 'barracks');
  if (!barracks || barracks.level < 1) {
    throw new Error('لازم تبني الثكنة الأول قبل ما تقدر تدرب أي وحدات');
  }
  if (barracks.level < troopCfg.requires_barracks_level) {
    throw new Error(`لازم ترقّي الثكنة لمستوى ${troopCfg.requires_barracks_level} الأول عشان تدرب الوحدة دي`);
  }

  const adminBypass = await isAdmin(userId);

  if (!adminBypass) {
    const maxQueue = maxQueueSize(barracks.level);
    if (castle.training_queue.length >= maxQueue) {
      throw new Error('طابور التدريب مليان - استنى أمر يخلص الأول أو رقّي الثكنة عشان تزود مكان الطابور');
    }
  }

  const cost = trainingCost(troopKey, qty);
  deductCost(castle, cost, adminBypass);

  if (adminBypass) {
    // ====== Admin privilege (Instant Construction Timers) - الوحدات
    // بتتضاف مباشرة للجيش الواقف من غير ما تمر على طابور التدريب خالص (مفيش
    // completes_at ولا started_at) - نفس أثر completeFinishedTraining لكن
    // لحظيًا. اللاعبين العاديين مش بيمروا من هنا خالص. ======
    const stack = castle.army.find((a) => a.key === troopKey);
    if (stack) stack.count += qty;
    else castle.army.push({ key: troopKey, count: qty });
  } else {
    // ====== ميزة البطل "الجنرال رستم" (training_speed_percent) - بتقلّل
    // وقت تدريب أي وحدة عادية (مش الوحدة المميّزة بالجواهر - دي أصلًا
    // train_seconds: 0 ومبتمرش من هنا خالص). نسبة مئوية بسيطة بتتطبّق على
    // seconds المحسوبة أصلًا من trainingSeconds - لو اللاعب مختارش بطل، أو
    // اختار بطل تاني غير رستم، القيمة صفر ومفيش أي تغيير. ======
    const hero = heroInfo(castle.hero_key);
    const speedBonus = Number(hero?.bonuses?.training_speed_percent) || 0;
    const seconds = Math.max(1, Math.round(trainingSeconds(troopKey, qty) * (1 - speedBonus)));
    const now = new Date();
    const lastOrder = castle.training_queue[castle.training_queue.length - 1];
    const startedAt = lastOrder ? lastOrder.completes_at : now;
    const completesAt = new Date(startedAt.getTime() + seconds * 1000);

    castle.training_queue.push({
      key: troopKey,
      quantity: qty,
      started_at: startedAt,
      completes_at: completesAt,
    });
  }

  await castle.save();
  return castle;
}

// ====== تدريب وحدة مميّزة (Premium Troop) - بالجواهر (رصيد المحفظة/الكوينز)
// بدل الموارد العادية، ومن غير أي طابور تدريب: بيتخصم الرصيد أولًا (عن طريق
// wallet.service.recordTransaction بنفس نمط game.service.js::startRound -
// دي بترمي error لو الرصيد مش كفاية، فبتوقف العملية هنا قبل أي تعديل على
// القلعة)، وبعدين الوحدات بتتضاف لجيش القلعة الواقف فورًا.
//
// ====== Admin privilege (Unlimited Gems) - نفس فكرة adminBypass في
// deductCost بالظبط، بس هنا بتلغي خصم رصيد المحفظة نفسه بدل خصم الموارد.
// لو adminBypass=true بيتجاهل استدعاء recordTransaction بالكامل (no-op) -
// يعني رصيد الأدمن مبيتأثرش خالص، من غير ما يتعمل أي transaction وهمية في
// الـ wallet ledger. القرار بييجي حصريًا من isAdmin(userId) (نفس مصدر القرار
// الوحيد المستخدم في startUpgrade/startNewBuilding/startTraining). ======
async function startPremiumTraining(userId, troopKey, quantity) {
  const troopCfg = TROOP_TYPES[troopKey];
  if (!troopCfg || !isPremiumTroopType(troopKey)) {
    throw new Error('نوع وحدة مميّزة غير معروف');
  }

  const qty = Number(quantity);
  if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty < 1) {
    throw new Error('عدد الوحدات غير صحيح');
  }
  if (qty > MAX_TRAINING_BATCH) {
    throw new Error(`أقصى عدد وحدات في أمر تدريب واحد هو ${MAX_TRAINING_BATCH}`);
  }

  const castle = await loadCastleCommon(userId);

  const barracks = castle.buildings.find((b) => b.key === 'barracks');
  if (!barracks || barracks.level < 1) {
    throw new Error('لازم تبني الثكنة الأول قبل ما تقدر تدرب أي وحدات');
  }
  if (barracks.level < troopCfg.requires_barracks_level) {
    throw new Error(`لازم ترقّي الثكنة لمستوى ${troopCfg.requires_barracks_level} الأول عشان تدرب الوحدة دي`);
  }

  const gemCost = premiumTrainingGemCost(troopKey, qty);

  // ====== الخصم من رصيد المحفظة أولًا - recordTransaction بترمي error لو
  // الرصيد مش كفاية (Insufficient wallet balance)، فلو فشلت هنا القلعة
  // مبتتغيرش خالص، زي ما هو الحال بالظبط في game.service.js::startRound.
  // الأدمن (adminBypass) بيتجاوز الخصم ده تمامًا - رصيده يفضل زي ما هو. ======
  const adminBypass = await isAdmin(userId);
  if (!adminBypass) {
    await walletService.recordTransaction({
      userId,
      type: 'spend',
      amount: gemCost,
      taxMode: 'not_applicable',
      category: 'premium_troop_training',
    });
  }

  const stack = castle.army.find((a) => a.key === troopKey);
  if (stack) stack.count += qty;
  else castle.army.push({ key: troopKey, count: qty });

  await castle.save();
  return castle;
}

// ====== إلغاء أمر تدريب لسه في الطابور (شغال أو مستني دوره) - بيرجّع
// التكلفة كاملة، وبيقرّب مواعيد الأوامر اللي بعده في الطابور بمقدار مدة
// الأمر الملغي (عشان يفضل كل أمر يبدأ فعليًا وقت ما اللي قبله يخلص) ======
async function cancelTraining(userId, orderId) {
  const castle = await loadCastleCommon(userId);

  const index = castle.training_queue.findIndex((o) => o._id.toString() === orderId);
  if (index === -1) {
    throw new Error('أمر التدريب ده مش موجود');
  }

  const order = castle.training_queue[index];
  const refund = trainingCost(order.key, order.quantity);
  for (const resource of RESOURCE_TYPES) {
    const cap = computeCapacity(castle, resource);
    castle.resources[resource].stored = Math.min(cap, castle.resources[resource].stored + refund[resource]);
  }

  const durationMs = order.completes_at.getTime() - order.started_at.getTime();
  castle.training_queue.splice(index, 1);
  for (let i = index; i < castle.training_queue.length; i += 1) {
    castle.training_queue[i].started_at = new Date(castle.training_queue[i].started_at.getTime() - durationMs);
    castle.training_queue[i].completes_at = new Date(castle.training_queue[i].completes_at.getTime() - durationMs);
  }

  await castle.save();
  return castle;
}

// ====== تسريع فوري بالجواهر (Instant Speedup) - مبنى قيد الترقية/الإنشاء
// ======
// نفس فلسفة startPremiumTraining بالظبط: بنخصم من رصيد المحفظة أولًا
// (recordTransaction بترمي error لو الرصيد مش كفاية، فمفيش أي تعديل على
// القلعة لو الخصم فشل)، وبعدين بنطبّق نتيجة completeFinishedUpgrades يدويًا
// على المبنى ده بس (بدل ما ننتظر الوقت الطبيعي أو أي استدعاء تاني
// للقلعة). التكلفة بتتحسب على الثواني المتبقية *الفعلية* وقت الطلب (مش
// المدة الكلية الأصلية) - عشان لو جزء من المدة خلص لوحده، اللاعب يدفع على
// الباقي بس مش على الرحلة كاملة من الأول.
async function speedupBuildingUpgrade(userId, buildingKeyOrId) {
  // ملحوظة: هنا لازم نستخدم loadCastleCommon مش loadCastleForAction.
  // loadCastleForAction بترمي error "في ترقية شغالة بالفعل" لو أي مبنى upgrade.in_progress = true،
  // وده شرط مخصوص لبدء ترقية جديدة (startUpgrade) - لكن هنا إحنا أصلاً بنسرّع مبنى
  // upgrade.in_progress بتاعه true (ده هو المفروض يحصل!)، فلو استخدمنا loadCastleForAction
  // هيرمي error دايمًا مهما كان المبنى، ويمنع التسريع نهائيًا.
  const castle = await loadCastleCommon(userId);

  let building = null;
  if (/^[0-9a-fA-F]{24}$/.test(String(buildingKeyOrId))) {
    building = castle.buildings.id(buildingKeyOrId);
  }
  if (!building) {
    building = castle.buildings.find((b) => b.key === buildingKeyOrId);
  }
  if (!building) {
    throw new Error('المبنى ده مش موجود');
  }
  if (!building.upgrade?.in_progress) {
    throw new Error('المبنى ده مفيهوش أي ترقية أو إنشاء شغال دلوقتي');
  }

  const now = new Date();
  const remainingSeconds = Math.max(0, (building.upgrade.completes_at.getTime() - now.getTime()) / 1000);
  const gemCost = speedupGemCost(remainingSeconds);

  // ====== Admin privilege (Unlimited Gems) - نفس منطق startPremiumTraining
  // بالظبط: لو الأدمن، بيتخصمش رصيد خالص. ======
  const adminBypass = await isAdmin(userId);
  if (gemCost > 0 && !adminBypass) {
    await walletService.recordTransaction({
      userId,
      type: 'spend',
      amount: gemCost,
      taxMode: 'not_applicable',
      category: 'building_speedup',
    });
  }

  const targetLevel = building.upgrade.target_level;
  building.level = targetLevel;
  building.upgrade.in_progress = false;
  building.upgrade.target_level = null;
  building.upgrade.started_at = null;
  building.upgrade.completes_at = null;

  if (building.key === 'town_hall') {
    expandCityToLevelCap(castle);
  }

  await castle.save();
  return castle;
}

// ====== تسريع فوري بالجواهر - أمر تدريب واقف في طابور الثكنة ======
// مختلف عن speedupBuildingUpgrade في حاجة واحدة مهمة: الطابور متسلسل
// (FIFO)، فتسريع أمر معيّن لازم "يزحزح" كل الأوامر اللي بعده في الطابور
// بمقدار المدة المتبقية اللي اتلغت - نفس منطق cancelTraining بالظبط
// (started_at/completes_at لكل أمر بعده بيتقلّلوا بنفس durationMs) عشان كل
// أمر يفضل بيبدأ فعليًا وقت ما اللي قبله يخلص. التكلفة بتتحسب على الثواني
// المتبقية الفعلية لنفس الأمر ده بس (مش أي أمر تاني قدامه في الطابور).
async function speedupTraining(userId, orderId) {
  const castle = await loadCastleCommon(userId);

  const index = castle.training_queue.findIndex((o) => o._id.toString() === orderId);
  if (index === -1) {
    throw new Error('أمر التدريب ده مش موجود');
  }

  const order = castle.training_queue[index];
  const now = new Date();
  const remainingSeconds = Math.max(0, (order.completes_at.getTime() - now.getTime()) / 1000);
  const gemCost = speedupGemCost(remainingSeconds);

  // ====== Admin privilege (Unlimited Gems) - نفس منطق startPremiumTraining
  // بالظبط: لو الأدمن، بيتخصمش رصيد خالص. ======
  const adminBypass = await isAdmin(userId);
  if (gemCost > 0 && !adminBypass) {
    await walletService.recordTransaction({
      userId,
      type: 'spend',
      amount: gemCost,
      taxMode: 'not_applicable',
      category: 'training_speedup',
    });
  }

  const stack = castle.army.find((a) => a.key === order.key);
  if (stack) stack.count += order.quantity;
  else castle.army.push({ key: order.key, count: order.quantity });

  const durationMs = order.completes_at.getTime() - now.getTime();
  castle.training_queue.splice(index, 1);
  for (let i = index; i < castle.training_queue.length; i += 1) {
    castle.training_queue[i].started_at = new Date(castle.training_queue[i].started_at.getTime() - durationMs);
    castle.training_queue[i].completes_at = new Date(castle.training_queue[i].completes_at.getTime() - durationMs);
  }

  await castle.save();
  return castle;
}

function listBuildingTypes() {
  return Object.values(BUILDING_TYPES);
}

function listTroopTypes() {
  return Object.values(TROOP_TYPES);
}

// ====== ملخص عام لقلعة (بتاعة اللاعب أو NPC) جاهز للعرض على خريطة العالم
// - مقصود يبقى معلومات محدودة (مستوى المبنى الرئيسي + عدد المباني) مش كل
// تفاصيل القلعة الكاملة زي formatCastle، لأن دي قلعة حد تاني/معسكر مش قلعتك
// - alliance_tag/is_same_alliance بييجوا من allianceMap (خريطة user_id ->
// {tag, alliance_id} جاهزة مسبقًا) عشان نتفادى استعلام تحالف منفصل لكل
// قلعة قريبة (راجع buildAllianceMap). ======
function formatNearbyCastle(castle, viewerMapSlot, allianceMap, viewerAllianceId, ownerNameMap) {
  const townHall = castle.buildings.find((b) => b.key === 'town_hall');
  const dx = castle.map_slot.x - viewerMapSlot.x;
  const dy = castle.map_slot.y - viewerMapSlot.y;
  const ownerAlliance = !castle.is_npc && castle.user_id ? allianceMap?.get(castle.user_id.toString()) : null;
  const ownerName = !castle.is_npc && castle.user_id ? ownerNameMap?.get(castle.user_id.toString()) || null : null;

  return {
    id: castle._id,
    map_slot: castle.map_slot,
    is_npc: castle.is_npc,
    name: castle.is_npc ? castle.npc_name : null,
    // ====== اسم صاحب القلعة (لاعب حقيقي) - جاي من ownerNameMap (راجع
    // buildOwnerNameMap) عشان يتعرض على الخريطة وفي قايمة "معاينة"/"ملف
    // اللاعب" بدل النص الثابت "قلعة لاعب". null للـ NPC (اسمها في name). ======
    owner_name: ownerName,
    town_hall_level: townHall?.level || 1,
    building_count: castle.buildings.length,
    distance_slots: Math.round(Math.max(Math.abs(dx), Math.abs(dy)) / worldMapService.SLOT_SPACING),
    alliance_tag: ownerAlliance?.tag || null,
    is_same_alliance: Boolean(ownerAlliance && viewerAllianceId && ownerAlliance.id.toString() === viewerAllianceId.toString()),
    // ====== NEW: نفس منطق formatCastle بالظبط (npc_tier/reward_multiplier)
    // بس هنا من غير أي استعلام إضافي (npcTierInfo بيدور جوه NPC_TIERS في
    // الميموري بس) - عشان قائمة القلاع القريبة/قائمة السياق على الخريطة
    // تقدر تعرض درجة الصعوبة والمكافآت من غير ما تحتاج تفتح "دخول المملكة"
    // الأول. ======
    npc_tier: castle.is_npc ? npcTierInfo(castle.npc_tier) : null,
    // ====== NEW (NPC Faction System) - نفس منطق npc_tier بالظبط - معلومات
    // الفصيل (اسم + لون) جاهزة للعرض على الخريطة/قائمة السياق من غير أي
    // استعلام إضافي (factionInfo بيدور جوه FACTIONS في الميموري بس). ======
    npc_faction: castle.is_npc ? factionInfo(castle.npc_faction) : null,
    reward_multiplier: castle.is_npc ? castle.reward_multiplier : null,
  };
}

// ====== خريطة user_id -> {id, tag} تحالف بتاعه - بتتحسب مرة واحدة لكل
// استدعاء getNearbyCastles بدل ما نستعلم عن تحالف كل قلعة لوحده (N+1) ======
async function buildAllianceMap(ownerUserIds) {
  const map = new Map();
  if (ownerUserIds.length === 0) return map;

  const alliances = await Alliance.find({ 'members.user_id': { $in: ownerUserIds } }).select('tag members.user_id');
  for (const alliance of alliances) {
    for (const member of alliance.members) {
      map.set(member.user_id.toString(), { id: alliance._id, tag: alliance.tag });
    }
  }
  return map;
}

// ====== خريطة user_id -> اسم اللاعب - نفس فكرة buildAllianceMap بالظبط
// (استعلام واحد لكل أصحاب القلاع القريبة بدل N+1) - مستخدمة عشان الخريطة
// تعرض اسم صاحب كل قلعة حقيقي بدل نص ثابت. ======
async function buildOwnerNameMap(ownerUserIds) {
  const map = new Map();
  if (ownerUserIds.length === 0) return map;

  const users = await User.find({ _id: { $in: ownerUserIds } }).select('name');
  for (const u of users) {
    map.set(u._id.toString(), u.name);
  }
  return map;
}

// ====== قلاع حواليك على خريطة العالم (ضباب الحرب / Fog of War) ======
// بترجّع تفاصيل القلاع (لاعبين حقيقيين + NPC) اللي جوه نصف قطر رؤيتك
// (VISION_RADIUS_SLOTS) بس - أي قلعة برّه نصف القطر ده مش موجودة في الرد
// أصلًا (مش حتى id أو مكانها)، يعني مخفية تمامًا زي أي ضباب حرب حقيقي.
//
// نصف قطر الرؤية دايمًا متحسوب من مكان قلعة اللاعب نفسه (myCastle.map_slot)
// - مفيش أي راديوس بييجي من الفرونت إند أو من أي مصدر تاني، ومفيش نظام
// استكشاف (Scout) بيغيّره مؤقتًا. كل لاعب شايف حوالين قلعته بس - حتى لو
// أعضاء تحالفه شايفين مناطق تانية، الرؤية ديه مبتتشاركش بينهم (مفيش
// alliance shared vision).
//
// بتولّد قلاع NPC جديدة أول مرة لو المنطقة حوالين قلعتك لسه فاضية (lazy)
// قبل ما نحسب الرؤية، عشان الخانات الفاضية تتملي بمعسكرات طبيعية بدل ما
// تفضل فاضية للأبد.
// ====== NEW (World exploration fix) - `exploreCenter` اختياري: إحداثية
// map_slot تانية غير قلعة اللاعب نفسه (مثلًا مركز الكاميرا الحالي وهو
// بيستكشف الخريطة بعيد عن قلعته). لو معدّاش، السلوك القديم بالظبط (نفس
// نطاق رؤية اللاعب حوالين قلعته) - Backward compatible 100%. الهدف: منطقة
// العالم اللي اللاعب شايفها فعليًا على الشاشة (مش بس حوالين قلعته) لازم
// تتولّد وترجع NPCs بنفس الطريقة، عشان العالم يفضل مأهول أينما استكشف
// اللاعب، مش بس قرب نقطة البداية. ======
async function getNearbyCastles(userId, radiusInSlots = VISION_RADIUS_SLOTS, exploreCenter = null) {
  const myCastle = await getOrCreateCastle(userId);
  const center = exploreCenter || myCastle.map_slot;

  await worldMapService.ensureNpcNeighbors(center, radiusInSlots);
  const nearby = await worldMapService.getNearbySlots(center, radiusInSlots);

  const others = nearby.filter((c) => c._id.toString() !== myCastle._id.toString());
  const ownerUserIds = others.filter((c) => !c.is_npc && c.user_id).map((c) => c.user_id);
  const allianceMap = await buildAllianceMap(ownerUserIds);
  const ownerNameMap = await buildOwnerNameMap(ownerUserIds);
  const viewerAllianceId = allianceMap.get(userId.toString())?.id || null;

  // ====== فلترة دفاعية إضافية (defense-in-depth) بالنسبة لمركز الاستعلام
  // الفعلي (center - ممكن يكون مكان الكاميرا وهي بعيدة عن قلعتك، مش
  // بالضرورة myCastle.map_slot) - getNearbySlots بيرجّع صندوق مربع حوالين
  // center أصلًا، بس بنتأكد هنا كمان صراحة إن أي قلعة خارج نصف قطر
  // الاستكشاف الفعلي متترجعش. لازم تتحسب بالنسبة لـ center نفسه (مش
  // myCastle.map_slot) وإلا أي استكشاف بعيد عن قلعتك هيترفض بالكامل هنا. ======
  return others
    .filter((c) => {
      const dx = c.map_slot.x - center.x;
      const dy = c.map_slot.y - center.y;
      const distFromCenter = Math.round(Math.max(Math.abs(dx), Math.abs(dy)) / worldMapService.SLOT_SPACING);
      return distFromCenter <= radiusInSlots;
    })
    .map((c) => formatNearbyCastle(c, myCastle.map_slot, allianceMap, viewerAllianceId, ownerNameMap))
    .sort((a, b) => a.distance_slots - b.distance_slots);
}

// ====== NEW (World Manager fix) - كائنات العالم القريبة (معسكرات بربر/أبراج
// حراسة/آثار/قرى ومدن وحصون محايدة/عقد موارد/ديكور) اللي جوه نفس نطاق رؤية
// اللاعب المستخدم في getNearbyCastles بالظبط - قبل كده كانت الكائنات دي
// بتتولّد وتتخزن في MongoDB (worldMap.service.ensureRegionPopulated) بس
// معملش ليها أي راوت يرجّعها للفرونت إند خالص، فالعالم كان يبان "فاضي" من
// نص المحتوى المولّد فعليًا (كل حاجة غير القلاع). الراوت ده إضافي بحت -
// معملش أي تعديل على /castle/nearby الموجودة أو شكل ردّها. ======
async function getNearbyWorldObjects(userId, radiusInSlots = VISION_RADIUS_SLOTS, exploreCenter = null) {
  const myCastle = await getOrCreateCastle(userId);
  const center = exploreCenter || myCastle.map_slot;

  await worldMapService.ensureNpcNeighbors(center, radiusInSlots);

  // ====== NEW (Attackable World Objects) - نفس فلسفة resolveDueMarches
  // (بتتنادى lazy قبل أي قراءة/كتابة مرتبطة بالمسايرات): أي كائن عالم
  // معادي "منهوب" وعدّى عليه وقت كافي بيتجدد هنا قبل ما نرجّع القايمة -
  // فمفيش داعي لأي job/cron منفصل، ومفيش حاجة بتتاخر أكتر من أول طلب
  // /castle/nearby-world-objects بعد انتهاء مدة التجدد. مغلّفة بـ try/catch
  // عشان فشلها لوحده ميوقفش عرض الخريطة. ======
  try {
    await respawnDueHostileObjects();
  } catch (err) {
    console.error('[Castle] respawnDueHostileObjects error:', err.message);
  }

  const radiusUnits = radiusInSlots * worldMapService.SLOT_SPACING;
  const objects = await WorldObject.find({
    'map_slot.x': { $gte: center.x - radiusUnits, $lte: center.x + radiusUnits },
    'map_slot.y': { $gte: center.y - radiusUnits, $lte: center.y + radiusUnits },
  }).select('type subtype level map_slot garrison loot respawns depleted_at shadow_castle_id');

  return objects
    .map((o) => {
      const dx = o.map_slot.x - myCastle.map_slot.x;
      const dy = o.map_slot.y - myCastle.map_slot.y;
      const cdx = o.map_slot.x - center.x;
      const cdy = o.map_slot.y - center.y;
      const npcDef = getNpcType(o.type);
      return {
        id: o._id,
        type: o.type,
        name: npcDef?.name_ar || npcDef?.name || o.type,
        // ====== NEW (Attackable World Objects) - الفرونت إند بيستخدم category
        // (مش type نفسه) عشان يقرر يعرض زرار "هجوم" ولا لأ - أي نوع جديد
        // بـ category: 'hostile' في definitions/objects/*.def.js بيبقى قابل
        // للهجوم أوتوماتيك من غير أي تعديل في worldObjectRenderers.js. ======
        category: npcDef?.category || null,
        // ====== interaction_type (attackable|interactable|gatherable|decorative) -
        // المصدر الوحيد للحقيقة اللي الفرونت إند لازم يعتمد عليه عشان يقرر
        // نوع التفاعل (زرار هجوم/قائمة سياق/توولتيب بس)، بدل ما يشتق ده من
        // category بس - راجع definitions/objects/*.def.js وattackableWorldObject.js. ======
        interaction_type: npcDef?.interaction_type || null,
        subtype: o.subtype,
        level: o.level,
        map_slot: o.map_slot,
        has_garrison: (o.garrison || []).length > 0,
        respawns: o.respawns,
        depleted: !!o.depleted_at,
        // ====== NEW (World Object Under Attack) - رقم القلعة الشبح (shadow
        // castle) المرتبطة بالكائن ده لو موجود - نفس target_castle_id اللي
        // listLiveBattles بيرجّعه للمعارك اللي هدفها كائن عالم (شوف
        // worldObjectCastleBridge.js/resolveAttackableCastle). ده اللي بيخلي
        // الفرونت إند يقدر يربط أي معركة لايف بكائن العالم الصح على الخريطة
        // ويطلّع عليه نفس تأثير "تحت الهجوم" (UnderAttackEffect) المستخدم مع
        // القلاع - مفيش حد لنوع الكائن هنا (معسكر برابرة/برج حراسة/أي نوع
        // جديد يتضاف بعدين) طول ما عنده shadow_castle_id فعلي. null لأي كائن
        // مفيش له قلعة شبح (ديكور/موارد/كائنات مش قابلة للهجوم أصلًا). ======
        shadow_castle_id: o.shadow_castle_id || null,
        distance_slots: Math.round(Math.max(Math.abs(dx), Math.abs(dy)) / worldMapService.SLOT_SPACING),
        _distance_from_center: Math.round(Math.max(Math.abs(cdx), Math.abs(cdy)) / worldMapService.SLOT_SPACING),
      };
    })
    .filter((o) => o._distance_from_center <= radiusInSlots)
    .map(({ _distance_from_center, ...rest }) => rest)
    .sort((a, b) => a.distance_slots - b.distance_slots);
}

// ====== جلب أي قلعة (لاعب حقيقي أو NPC) كاملة للعرض - "دخول المملكة" ======
// بترجّع مستند القلعة الحقيقي بالكامل (كل المباني بمستوياتها ومواقعها
// الحقيقية + الجيش + الموارد) - مش نسخة مصغّرة/تقريبية زي formatNearbyCastle.
// الهدف إن الفرونت إند يقدر يرسمها بنفس مشهد القلعة (IsometricWorld)
// المستخدم أصلًا لعرض قلعة اللاعب نفسه، يعني "ادخل مملكة اللاعب التاني" مش
// "معاينة مصغّرة/تقريبية". بتكمّل أي ترقية/تدريب خلص وقته الأول (نفس فلسفة
// loadCastleCommon) عشان اللي بيزور يشوف الحالة الحقيقية المحدّثة، وبترجع
// كمان بيانات صاحب القلعة (اسم/تحالف/مسافة) عشان الواجهة تعرضها من غير ما
// تحتاج طلب إضافي. أي حد مسجّل دخول يقدر يزور أي قلعة (مفيش قيد رؤية هنا -
// القيد الوحيد على البيانات هو نفس نطاق الرؤية بتاع /castle/nearby اللي
// بيحدد أصلًا أي قلعة تبان كماركر قابل للضغط على الخريطة).
async function getCastleView(viewerUserId, targetCastleId) {
  const target = await resolveAttackableCastle(targetCastleId);
  if (!target) throw new Error('القلعة دي مش موجودة');

  const completedBuildings = completeFinishedUpgrades(target);
  const completedTraining = completeFinishedTraining(target);
  syncResources(target);
  await target.save();

  if (!target.is_npc && target.user_id) {
    if (completedBuildings.length > 0) await notifyBuildingsCompleted(target.user_id, completedBuildings);
    if (completedTraining.length > 0) await notifyTrainingCompleted(target.user_id, completedTraining);
  }

  const viewerCastle = await getOrCreateCastle(viewerUserId);

  let ownerName = null;
  let allianceTag = null;
  let isSameAlliance = false;
  if (!target.is_npc && target.user_id) {
    const relevantUserIds = [target.user_id, viewerUserId];
    const [ownerNameMap, allianceMap] = await Promise.all([
      buildOwnerNameMap([target.user_id]),
      buildAllianceMap(relevantUserIds),
    ]);
    ownerName = ownerNameMap.get(target.user_id.toString()) || null;
    const ownerAlliance = allianceMap.get(target.user_id.toString()) || null;
    const viewerAlliance = allianceMap.get(viewerUserId.toString()) || null;
    allianceTag = ownerAlliance?.tag || null;
    isSameAlliance = Boolean(
      ownerAlliance && viewerAlliance && ownerAlliance.id.toString() === viewerAlliance.id.toString()
    );
  }

  const dx = target.map_slot.x - viewerCastle.map_slot.x;
  const dy = target.map_slot.y - viewerCastle.map_slot.y;
  const distanceSlots = Math.round(Math.max(Math.abs(dx), Math.abs(dy)) / worldMapService.SLOT_SPACING);

  return {
    castle: target,
    isOwn: target._id.toString() === viewerCastle._id.toString(),
    ownerId: !target.is_npc && target.user_id ? target.user_id : null,
    ownerName,
    allianceTag,
    isSameAlliance,
    distanceSlots,
  };
}

// ====== استكشاف (Scout) قلعة تانية - تقرير استخباراتي فوري ومجاني: مواردها
// الحالية، جيشها الواقف، وقوة دفاعها الكلية (تحصينات + جيش) مقابل قوة هجوم
// جيشك الواقف حاليًا في قلعتك - نفس معادلة resolveAttackArrival بالظبط بس
// من غير أي جيش بيتحرك فعليًا ومن غير أي خطر أو مدة انتظار. بيتسجل تقرير في
// صندوق واردك كمان عشان يفضل محفوظ ترجعله بعدين. ======
async function scoutCastle(userId, targetCastleId) {
  const target = await resolveAttackableCastle(targetCastleId);
  if (!target) throw new Error('الهدف ده مش موجود');

  const viewer = await getOrCreateCastle(userId);
  if (target._id.toString() === viewer._id.toString()) {
    throw new Error('متقدرش تستكشف قلعتك انت');
  }

  const completedBuildings = completeFinishedUpgrades(target);
  const completedTraining = completeFinishedTraining(target);
  syncResources(target);
  await target.save();
  if (!target.is_npc && target.user_id) {
    if (completedBuildings.length > 0) await notifyBuildingsCompleted(target.user_id, completedBuildings);
    if (completedTraining.length > 0) await notifyTrainingCompleted(target.user_id, completedTraining);
  }

  // ====== *** فيكس Bug 3 (Scout reports ignore stationed reinforcements) ***
  // السبب الحقيقي: defensePower هنا كان بيحسب تحصينات + جيش القلعة بس، من
  // غير ما يضيف تعزيزات الحلفاء الواقفة فيها - عكس معادلة الدفاع الحقيقية
  // المستخدمة وقت المعركة الفعلية (march.service.computeDefensePower) اللي
  // بتضيف allianceReinforcementService.stationedDefensePower. نفس الفلسفة
  // هنا بالظبط (بدون أي حساب قتال جديد) + دمج جنود التعزيز في قايمة الجيش
  // المعروضة عشان "reported military power must reflect the real defending
  // force" فعليًا، مش بس في الرقم النهائي. القلاع الآلية (NPC) مالهاش نظام
  // تحالفات فمفيش داعي نستعلم عنها (نفس الشرط المستخدم أصلًا في
  // castle.controller.js::viewCastle). ======
  let stationedReinforcements = [];
  if (!target.is_npc) {
    try {
      stationedReinforcements = await allianceReinforcementService.getStationedForCastle(target._id);
    } catch (err) {
      console.error('[Castle] failed to load stationed reinforcements for scout report:', err.message);
    }
  }
  const reinforcementDefensePower = allianceReinforcementService.stationedDefensePower(stationedReinforcements, 'defense');

  // ====== *** فيكس (Scout report ignores real defense structures) ***
  // السبب الحقيقي: defensePower هنا كان بيتجاهل مباني الدفاع الحقيقية
  // (سور/برج/بوابة/فخ) خالص - نفس المعادلة القديمة (مستوى مبنى القيادة × 9
  // + دفاع الجيش + تعزيزات) من غير أي استعلام عن CastleDefense.structures،
  // فمهما بنى اللاعب مباني دفاع، الرقم المعروض هنا مكانش بيتغيّر. دلوقتي
  // بنضيف defenseStructuresPower (defense.service.js - مجموع combat_stats.
  // defense الحقيقي بتاع كل قطعة واقفة) لنفس المجموع، نفس فلسفة إضافة
  // reinforcementDefensePower بالظبط - القلاع الآلية (NPC) ممكن يكون ليها
  // مستند دفاع كمان (npcCastle.generator) فمفيش استثناء هنا.
  //
  // ====== lazy require عشان نتجنب دورة استيراد: defense.service.js بيعمل
  // require لـ castle.service.js (getOrCreateDefense بيستخدم
  // loadCastleCommon) - لو حطينا require لـ defense.service.js فوق مع باقي
  // imports castle.service.js هيتحمّل الأول في بعض ترتيبات التحميل، فيرجّع
  // نسخة ناقصة من castleService لـ defense.service.js (loadCastleCommon مش
  // موجودة لسه) - نفس فلسفة lazy require في castleBattleBroadcaster.js
  // بالظبط. ******
  const defenseService = require('../defense/defense.service');
  const defenseStructuresPower = await defenseService.getStructuresDefensePowerByCastleId(target._id);

  const townHall = target.buildings.find((b) => b.key === 'town_hall');
  const townHallLevel = townHall?.level || 1;
  const defensePower =
    townHallLevel * BASE_DEFENSE_PER_TOWNHALL_LEVEL +
    armyStatTotal(target.army, 'defense') +
    reinforcementDefensePower +
    defenseStructuresPower;
  const attackerPower = armyStatTotal(viewer.army, 'attack');

  const resources = {};
  for (const resource of RESOURCE_TYPES) {
    resources[resource] = Math.floor(target.resources[resource].stored);
  }

  // ====== دمج كومات جنود التعزيز مع جيش القلعة نفسه لعرض واحد موحّد (نفس
  // شكل formatArmyStacks تحت) - بنجمع العدد لو نفس نوع الوحدة already موجود
  // في جيش القلعة، عشان القايمة المعروضة تفضل "قوة دفاع واحدة" مفهومة زي ما
  // هي دلوقتي في الواجهة (ScoutReportModal.jsx) من غير أي تعديل عليها. ======
  const combinedArmy = target.army.map((t) => ({ key: t.key, count: t.count }));
  for (const reinforcement of stationedReinforcements) {
    for (const t of reinforcement.troops || []) {
      const stack = combinedArmy.find((a) => a.key === t.key);
      if (stack) stack.count += t.count;
      else combinedArmy.push({ key: t.key, count: t.count });
    }
  }

  // ====== NEW: اسم القائد الدفاعي (لو القلعة دي NPC وليها مستند دفاع مخزّن
  // فيه commander - شوف npcCastle.generator.generateNpcCommander) - نفس
  // فكرة getDefenseByCastleId بس هنا بس عشان اسم القائد يبان في تقرير
  // الاستكشاف (Read-only، مفيش تأثير على أي حساب موجود فوق). ======
  let commanderName = null;
  if (target.is_npc) {
    const defense = await CastleDefense.findOne({ castle_id: target._id }).select('commander');
    commanderName = defense?.commander?.name || null;
  }

  const report = {
    target_name: target.is_npc ? target.npc_name : null,
    is_npc: target.is_npc,
    town_hall_level: townHallLevel,
    npc_tier: target.is_npc ? npcTierInfo(target.npc_tier) : null,
    npc_faction: target.is_npc ? factionInfo(target.npc_faction) : null,
    commander_name: commanderName,
    resources,
    army: formatArmyStacks(combinedArmy),
    defense_power: defensePower,
    attacker_power: attackerPower,
    would_win: attackerPower >= defensePower,
  };

  try {
    await inboxService.createSystemMessage({
      userId,
      type: 'scout_report',
      title: `تقرير استكشاف: ${report.target_name || (target.is_npc ? 'معسكر آلي' : 'قلعة لاعب')}`,
      body: `قوة دفاعها التقديرية ${defensePower} مقابل قوة هجومك الحالية ${attackerPower}.`,
      metadata: { target_castle_id: target._id, resources, defense_power: defensePower, attacker_power: attackerPower },
    });
  } catch (err) {
    console.error('[Castle] failed to send inbox message for scout report:', err.message);
  }

  return report;
}

// ====== إرسال موارد فورية لقلعة حليف (لازم يكونوا في نفس التحالف فعليًا) -
// بيخصم من قلعتك وبيوصّل لقلعة الهدف فورًا (مقفول بسقف تخزينه الحالي - أي
// زيادة عن السقف بتتفقد زي أي إنتاج عادي بيوصل وهو مليان)، وبيبعت إشعار
// صندوق وارد للمستقبِل. ======
// ====== FIX (Gather action for gatherable world objects) - كان مفيش أي
// راوت/خدمة بتخلي زرار "حصاد" يشتغل فعليًا لعقد الموارد (resource_node -
// interaction_type: 'gatherable') - الفرونت إند كان عنده helper
// (isGatherableWorldObject) بس مستخدَمش في أي مكان، فالكائنات دي كانت
// بترتسم على الخريطة بس من غير أي فعل ممكن عليها خالص. الحصاد هنا فوري
// (مفيش وقت مسير/جيش زي الهجوم)، بيضيف الغنيمة (loot) المولّدة أصلًا وقت
// إنشاء الكائن لموارد قلعة اللاعب (مقفول بسقف تخزينه الحالي)، وبيصفّر
// غنيمة الكائن ويعلّمه "منهوب" (depleted_at) - نفس الحقل اللي
// respawnDueHostileObjects أصلًا بيتابعه لأي كائن respawns:true. ======
async function gatherWorldObject(userId, worldObjectId) {
  const worldObject = await WorldObject.findById(worldObjectId);
  if (!worldObject) throw new Error('كائن العالم ده مش موجود');

  const def = getNpcType(worldObject.type);
  if (def?.interaction_type !== 'gatherable') {
    throw new Error('الكائن ده مش قابل للحصاد');
  }
  if (worldObject.depleted_at) {
    throw new Error('الكائن ده منهوب حاليًا - بينتظر التجدد');
  }

  const castle = await loadCastleCommon(userId);

  const gained = {};
  for (const resource of RESOURCE_TYPES) {
    const available = Math.max(0, Math.round(worldObject.loot?.[resource] || 0));
    const cap = computeCapacity(castle, resource);
    const before = castle.resources[resource].stored;
    castle.resources[resource].stored = Math.min(cap, before + available);
    gained[resource] = Math.round(castle.resources[resource].stored - before);
  }

  worldObject.loot = { gold: 0, wood: 0, stone: 0 };
  worldObject.depleted_at = new Date();

  await Promise.all([castle.save(), worldObject.save()]);

  try {
    const totalGained = Object.values(gained).reduce((sum, v) => sum + v, 0);
    if (totalGained > 0) {
      // eslint-disable-next-line global-require
      const questService = require('../quests/quest.service');
      await questService.recordQuestProgress(userId, 'gather_resource', totalGained);
    }
  } catch (err) {
    console.error('[Castle] failed to track quest progress for gathering:', err.message);
  }

  return { castle, gained };
}

async function sendResources(userId, targetCastleId, amounts) {
  const target = await Castle.findById(targetCastleId);
  if (!target) throw new Error('الهدف ده مش موجود');
  if (target.is_npc || !target.user_id) {
    throw new Error('متقدرش تبعت موارد لمعسكر آلي');
  }
  if (target.user_id.toString() === userId.toString()) {
    throw new Error('متقدرش تبعت موارد لقلعتك انت');
  }

  const allied = await allianceService.areAllied(userId, target.user_id);
  if (!allied) {
    throw new Error('لازم تكون في نفس تحالف اللاعب ده الأول عشان تقدر تبعتله موارد');
  }

  const sanitized = {};
  let totalRequested = 0;
  for (const resource of RESOURCE_TYPES) {
    const raw = Number(amounts?.[resource] || 0);
    const amount = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
    sanitized[resource] = amount;
    totalRequested += amount;
  }
  if (totalRequested <= 0) {
    throw new Error('لازم تحدد كمية موارد أكبر من صفر');
  }

  const origin = await loadCastleCommon(userId);
  for (const resource of RESOURCE_TYPES) {
    if (sanitized[resource] > origin.resources[resource].stored) {
      throw new Error('الموارد مش كفاية في قلعتك');
    }
  }

  syncResources(target);

  const delivered = {};
  for (const resource of RESOURCE_TYPES) {
    origin.resources[resource].stored -= sanitized[resource];
    const cap = computeCapacity(target, resource);
    const before = target.resources[resource].stored;
    target.resources[resource].stored = Math.min(cap, before + sanitized[resource]);
    delivered[resource] = Math.round(target.resources[resource].stored - before);
  }

  await Promise.all([origin.save(), target.save()]);

  const totalDelivered = RESOURCE_TYPES.reduce((sum, r) => sum + delivered[r], 0);
  try {
    await inboxService.createSystemMessage({
      userId: target.user_id,
      type: 'resources_received',
      title: 'استلمت موارد من حليف',
      body:
        totalDelivered > 0
          ? `استلمت ${totalDelivered} وحدة موارد من حليفك في التحالف.`
          : 'حليفك حاول يبعتلك موارد بس مخازنك كانت مليانة بالفعل.',
      metadata: { delivered },
    });
  } catch (err) {
    console.error('[Castle] failed to send inbox message for resources received:', err.message);
  }

  return { castle: origin, delivered };
}

// ====== منح موارد مباشرة لقلعة اللاعب - نفس قواعد التحقق والتخزين
// المستخدمة في كل مكان تاني في اللعبة (loadCastleCommon بيزامن الموارد
// ويستكمل أي ترقيات/تدريب خلص وقته الأول، وcomputeCapacity بيحدد السقف
// المسموح بيه لكل مورد - بالظبط زي gatherWorldObject فوق). مفيش أي منطق
// تخزين جديد هنا خالص - ده بس نقطة دخول عامة لأي موديول تاني (زي
// ads/rewardSession.service.js) يحتاج يضيف مورد لقلعة اللاعب من غير ما
// يكرر منطق المزامنة/السقف بنفسه. الزيادة بتتقف عند سقف التخزين الحالي
// (نفس فلسفة gatherWorldObject/sendResources) - أي فايض بيضيع، مش بيتراكم.
async function grantResources(userId, resource, amount) {
  if (!RESOURCE_TYPES.includes(resource)) {
    throw new Error(`مورد غير معروف: ${resource}`);
  }
  const requested = Math.max(0, Math.floor(Number(amount) || 0));
  if (requested <= 0) {
    throw new Error('لازم تحدد كمية مورد أكبر من صفر');
  }

  const castle = await loadCastleCommon(userId);

  const cap = computeCapacity(castle, resource);
  const before = castle.resources[resource].stored;
  castle.resources[resource].stored = Math.min(cap, before + requested);
  const granted = Math.round(castle.resources[resource].stored - before);

  await castle.save();

  return { castle, resource, granted, requested };
}

module.exports = {
  getOrCreateCastle,
  chooseHero,
  startUpgrade,
  startNewBuilding,
  moveBuilding,
  listBuildingTypes,
  getNearbyCastles,
  getNearbyWorldObjects,
  getCastleView,
  scoutCastle,
  sendResources,
  gatherWorldObject,
  grantResources,
  computeCapacity,
  computeProductionPerSecond,
  isWithinTownHallCap,
  startTraining,
  startPremiumTraining,
  cancelTraining,
  speedupBuildingUpgrade,
  speedupTraining,
  listTroopTypes,
  loadCastleCommon,
  syncResources,
  // ====== نظام توسيع المدينة (تلقائي بالكامل - مفيش شراء) ======
  isTileUnlocked,
  getCitySlotsInfo,
  getMaxCityTiles,
  expandCityToLevelCap,
  // ====== متصدّرين برضه عشان march.service يقدر يبني نفس خرائط اسم/تحالف
  // صاحب المسير من غير ما يكرر نفس منطق الاستعلام (N+1) هنا تاني. ======
  buildAllianceMap,
  buildOwnerNameMap,
};
