// ====== AttackableTarget Bridge (hostile WorldObjects -> shadow Castle) ======
// المشكلة: نظام الهجوم/المسير/المعركة كله (march.service, battle.service,
// battle.snapshot.service, battleConsequences.service) مبني على افتراض واحد
// ثابت من أول سطر فيه: أي هدف هجوم هو مستند Castle حقيقي
// (Castle.findById(targetId)). ده تمامًا نفس الحل اللي المشروع ده أصلًا
// مستخدمه لقلاع الـ NPC الإجرائية (npcCastle.generator.buildNpcCastleDoc +
// worldMap.service.saveCastleDoc): أي "معسكر عدو" على الخريطة هو فعليًا
// مستند Castle حقيقي (is_npc: true) بجيش/موارد/مبنى رئيسي، مش نظام قتال
// موازي.
//
// الحل هنا: بدل ما نعمل نظام قتال تاني لكائنات العالم المعادية (Barbarian
// Camp, Military Camp, Tribal Camp, Guard Tower, Rebel Outpost, Desert
// Settlement...)، بنطبّق نفس المبدأ عليهم - "AttackableTarget" abstraction:
// كل WorldObject معادي (category: 'hostile' أو has_garrison) بيتربط بمستند
// Castle "ظل" (shadow castle) خفيف جدًا (مبنى رئيسي واحد بس + الحامية/الغنيمة
// المنسوخة من الـ WorldObject نفسه) - بيتولّد lazy (أول مرة اللاعب يهاجم/
// يستكشف الهدف ده) ومربوط بيه بعلاقة 1:1 دائمة (world_object_id على القلعة،
// وshadow_castle_id على الـ WorldObject - راجع worldObject.model.js).
//
// من اللحظة دي، march.service/battle.service/battleConsequences.service
// بيشتغلوا على الـ shadow castle دي **من غير أي تعديل عليهم خالص** - هي
// Castle حقيقية 100% بالنسبة لهم. الفرق الوحيد: بعد ما المعركة تتحسم، بنزامن
// (sync) نتيجة الـ shadow castle (جيش الحامية الناجي + الموارد المتبقية)
// رجوع لمستند الـ WorldObject الأصلي (garrison/loot)، وبنعلّم الكائن
// "منهوب" (depleted_at) لو خلص - نفس فلسفة "منهوب - بينتظر التجدد" اللي
// الفرونت إند أصلًا بيعرضها (WorldObjectMarker tooltip).
//
// النتيجة: "The only thing that should differ is the defender data" -
// محرك القتال نفسه (march/battle/battleConsequences/reward) واحد بالظبط،
// مفيش أي فرع (if is_world_object) جوه أي منهم.

const mongoose = require('mongoose');
const Castle = require('../castle/castle.model');
const CastleDefense = require('../defense/defense.model');
const WorldObject = require('./worldObject.model');
const { getNpcType } = require('./npcRegistry');
const { BUILDING_TYPES } = require('../castle/castle.config');

// ====== كام ساعة قبل ما كائن معادي "منهوب" يتجدد (respawn) - بيتقرا من
// respawns الأصلية بتاعة الـ WorldObject (نفس السلوك القديم لو respawns=false:
// مبيرجعش خالص لحد ما حد يعيد توليده يدويًا/إجرائيًا). Placeholder بسيط
// (قابل للتعديل من هنا بس) زي باقي أرقام castle.config. ======
const RESPAWN_HOURS = 6;

// ====== مبنى رئيسي وحيد بمستوى مشتق من level الـ WorldObject - كافي عشان
// resolveAttackArrival/buildDefenderSnapshot يلاقوا "town_hall" زي أي قلعة
// تانية (BASE_DEFENSE_PER_TOWNHALL_LEVEL بيتحسب منه). مفيش أي مبنى موارد/
// عسكري تاني - معسكر عدو مش مدينة، مفيش داعي يبان بمباني إضافية. ======
function buildShadowBuildings(level) {
  const townHallLevel = Math.max(1, Math.min(BUILDING_TYPES.town_hall.max_level, level || 1));
  return [{ key: 'town_hall', level: townHallLevel, position: { x: 3, y: 3 } }];
}

// ====== موارد القلعة الظل - بتتاخد مباشرة من WorldObject.loot (نفس الغنيمة
// اللي worldPopulation.generator.buildWorldObjectDoc ولّدها وقت إنشاء
// الكائن) - عشان march.service.resolveAttackArrival ينهبها زي أي قلعة NPC
// تانية من غير أي تعديل في منطق النهب نفسه. ======
function buildShadowResources(loot) {
  const now = new Date();
  const toResourceState = (amount) => ({ stored: Math.max(0, Math.round(amount || 0)), last_synced_at: now });
  return {
    gold: toResourceState(loot?.gold),
    wood: toResourceState(loot?.wood),
    stone: toResourceState(loot?.stone),
  };
}

// ====== اسم/شكل بصري وصفي بس - مأخوذ من تعريف النوع في npcRegistry (نفس
// تعريف الـ WorldObject نفسه: name_ar, category) عشان تقرير المعركة/قايمة
// السياق يعرضوا اسم حقيقي ("معسكر برابرة") مش ID خام. ======
function shadowDisplayName(worldObject) {
  const def = getNpcType(worldObject.type);
  return def?.name_ar || def?.name || worldObject.type;
}

// ====== يبني ويحفظ مستند Castle+CastleDefense ظل جديد لكائن عالم معادي -
// نفس نمط worldMap.service.saveCastleDoc بالظبط (Castle.create ثم
// CastleDefense.create مربوطة بنفس castle_id) عشان أي كود تاني بيفترض وجود
// CastleDefense (defenseService.getDefenseByCastleId) يفضل شغال من غير أي
// تعديل. map_slot بينسخ من الكائن نفسه - نفس مكانه على الخريطة بالظبط، عشان
// حساب المسافة/مدة المسير (march.service.distanceInSlots) يفضل صحيح. ======
async function createShadowCastle(worldObject) {
  const buildings = buildShadowBuildings(worldObject.level);
  const resources = buildShadowResources(worldObject.loot);

  const castle = await Castle.create({
    map_slot: worldObject.map_slot,
    is_npc: true,
    npc_name: shadowDisplayName(worldObject),
    // ====== npc_tier مفيش نظام درجات مخصص لكائنات العالم (مش قلاع كاملة) -
    // بنسيبه null، الفرونت إند بيعتمد بدلها على has_garrison/type العادية
    // اللي أصلًا بتعرضها من /castle/nearby-world-objects. ======
    npc_tier: null,
    npc_faction: null,
    reward_multiplier: 1,
    city_decor: [],
    city_lighting: false,
    buildings,
    resources,
    unlocked_tiles: [{ x: 3, y: 3 }],
    army: (worldObject.garrison || []).filter((s) => s && s.key && s.count > 0),
    training_queue: [],
    // ====== الحقلين الجديدين اللي بيربطوا القلعة الظل بالـ WorldObject
    // الأصلي - راجع castle.model.js (is_world_object/world_object_id). ======
    is_world_object: true,
    world_object_id: worldObject._id,
  });

  await CastleDefense.create({
    castle_id: castle._id,
    structures: [],
    commander: null,
    ai_posture: 'defensive',
  });

  worldObject.shadow_castle_id = castle._id;
  await worldObject.save();

  return castle;
}

// ====== نقطة الدخول الرئيسية - "هات لي القلعة القابلة للهجوم المقابلة لكائن
// العالم ده"، بتتصرف idempotent بالكامل:
//   1) لو الكائن عنده shadow_castle_id بالفعل ومستندها لسه موجود -> بترجعه
//      زي ما هو (مفيش إعادة توليد، عشان أي هجوم سابق لسه شغال عليها ميتكسرش).
//   2) لو مفيش (أول هجوم/استكشاف على الكائن ده) -> بتولّد واحدة جديدة
//      وتربطها بشكل دائم.
// النتيجة مستند Castle حقيقي 100% - أي كود بينادي عليها (march.service,
// castle.service.scoutCastle, getCastleView) مش محتاج يعرف إنها أصلًا كانت
// WorldObject. ======
async function getOrCreateShadowCastle(worldObjectId) {
  const worldObject = await WorldObject.findById(worldObjectId);
  if (!worldObject) return null;

  // ====== FIX (Attack must only apply to attackable world objects) - كان
  // ممكن نظريًا حد يبعت targetId بتاع كائن gatherable/interactable/decorative
  // (wobj:<id>) مباشرة على /army/march أو /:id/scout ويتولّدله قلعة ظل عليها
  // زي أي هدف معادي، رغم إن الفرونت إند مبيعرضش زرار هجوم/استكشاف ليها خالص
  // - القيد كان على الواجهة بس مش على الخدمة نفسها. دلوقتي المصدر الوحيد
  // للحقيقة (interaction_type من تعريف النوع - نفس اللي الفرونت إند بيعتمد
  // عليه) بيتفحص هنا كمان، فمفيش أي طريق (UI أو API مباشر) يهاجم/يستكشف كائن
  // مش attackable. ======
  const def = getNpcType(worldObject.type);
  if (def?.interaction_type !== 'attackable') return null;

  if (worldObject.shadow_castle_id) {
    const existing = await Castle.findById(worldObject.shadow_castle_id);
    if (existing) return existing;
    // ====== مرجع يتيم (نادر جدًا - القلعة الظل اتمسحت يدويًا مثلًا) -
    // بنتعامل معاه زي "لسه معملناش واحدة" ونولّد وحدة جديدة بدل ما نفشل. ======
  }

  return createShadowCastle(worldObject);
}

// ====== العكس - "دي قلعة ظل، هات لي كائن العالم الأصلي بتاعها" - مستخدمة
// وقت مزامنة نتيجة المعركة بعد الحسم (راجع syncShadowCastleToWorldObject
// تحت) وفي أي مكان محتاج يعرف "هل القلعة دي أصلها كائن عالم؟". ======
async function findWorldObjectForShadowCastle(castleId) {
  return WorldObject.findOne({ shadow_castle_id: castleId });
}

// ====== بعد ما معركة على قلعة ظل تتحسم فعليًا (battleConsequences.service
// أو march.service.resolveAttackArrival بيحفظوا الـ shadow castle بنتيجتها
// زي أي قلعة NPC تانية بالظبط)، بنزامن (sync) النتيجة دي رجوع لمستند
// WorldObject الأصلي - نفس فلسفة "الجيش الناجي هو حالة القلعة الحالية"
// المستخدمة في كل المشروع. لو الحامية اتصفّرت والموارد خلصت، بنعلّم الكائن
// "منهوب" (depleted_at) - الفرونت إند أصلًا عارض الحالة دي (تولتيب "منهوب -
// بينتظر التجدد" في WorldObjectMarker). لو respawns=false، بيفضل منهوب
// للأبد زي أي resource_node اتنهب قبل كده (نفس السلوك الحالي - مفيش تعديل). ======
async function syncShadowCastleToWorldObject(shadowCastle) {
  if (!shadowCastle?.is_world_object || !shadowCastle.world_object_id) return null;

  const worldObject = await WorldObject.findById(shadowCastle.world_object_id);
  if (!worldObject) return null;

  worldObject.garrison = (shadowCastle.army || [])
    .filter((s) => s && s.key && s.count > 0)
    .map((s) => ({ key: s.key, count: s.count }));

  worldObject.loot = {
    gold: Math.max(0, Math.round(shadowCastle.resources?.gold?.stored ?? 0)),
    wood: Math.max(0, Math.round(shadowCastle.resources?.wood?.stored ?? 0)),
    stone: Math.max(0, Math.round(shadowCastle.resources?.stone?.stored ?? 0)),
  };

  const garrisonWiped = worldObject.garrison.length === 0;
  const lootGone = worldObject.loot.gold === 0 && worldObject.loot.wood === 0 && worldObject.loot.stone === 0;

  if (garrisonWiped && lootGone) {
    worldObject.depleted_at = worldObject.depleted_at || new Date();
  } else {
    worldObject.depleted_at = null;
  }

  await worldObject.save();
  return worldObject;
}

// ====== تجدد (respawn) كائنات العالم المعادية المنهوبة اللي عدّى عليها وقت
// كافي (RESPAWN_HOURS) - بترجّع الحامية/الغنيمة الأصلية بنفس منطق التوليد
// الإجرائي الأول (worldPopulation.generator.buildWorldObjectDoc)، وبتصفّر
// جيش/موارد القلعة الظل المرتبطة (لو موجودة) عشان الهجوم الجاي يواجه حامية
// كاملة تاني. respawns=false بيفضل متجاهَل تمامًا (مفيش تجدد خالص) - نفس
// السلوك الحالي المعتمد عليه resource_node/ruins. ======
async function respawnDueHostileObjects() {
  const cutoff = new Date(Date.now() - RESPAWN_HOURS * 60 * 60 * 1000);
  const due = await WorldObject.find({ respawns: true, depleted_at: { $ne: null, $lte: cutoff } });

  for (const worldObject of due) {
    const budget = Math.round(10 + (worldObject.level || 1) * 6);
    worldObject.garrison = [
      { key: 'swordsman', count: Math.round(budget * 0.5) },
      { key: 'archer', count: Math.round(budget * 0.5) },
    ];
    const richness = 50 + (worldObject.level || 1) * 25;
    worldObject.loot = {
      gold: Math.round(richness * 0.8),
      wood: Math.round(richness * 0.8),
      stone: Math.round(richness * 0.8),
    };
    worldObject.depleted_at = null;

    // eslint-disable-next-line no-await-in-loop
    await worldObject.save();

    if (worldObject.shadow_castle_id) {
      // eslint-disable-next-line no-await-in-loop
      const shadow = await Castle.findById(worldObject.shadow_castle_id);
      if (shadow) {
        shadow.army = worldObject.garrison;
        shadow.resources = buildShadowResources(worldObject.loot);
        // eslint-disable-next-line no-await-in-loop
        await shadow.save();
      }
    }
  }

  return due.length;
}

// ====== بادئة (prefix) بسيطة بيستخدمها الفرونت إند عشان يميّز "هدف هجوم هو
// كائن عالم" عن "هدف هجوم هو قلعة عادية" وهو بيبعت target id واحد لنفس
// endpoint الموجود (POST /castle/army/march، GET /castle/:id/view، POST
// /castle/:id/scout) - بدل ما نضيف endpoint منفصل بالكامل لكائنات العالم
// (اللي كان هيبقى فعليًا "نظام قتال تاني"، بالظبط اللي المطلوب يتجنبه).
// الشكل: "wobj:<worldObjectId>". أي id من غير البادئة دي بيتعامل معاه زي ما
// كان بالظبط - Castle ID خام - فمفيش أي تغيير في سلوك الهجوم على قلعة لاعب/
// قلعة NPC عادية. ======
const WORLD_OBJECT_TARGET_PREFIX = 'wobj:';

function isWorldObjectTargetId(targetId) {
  return typeof targetId === 'string' && targetId.startsWith(WORLD_OBJECT_TARGET_PREFIX);
}

function encodeWorldObjectTargetId(worldObjectId) {
  return `${WORLD_OBJECT_TARGET_PREFIX}${worldObjectId}`;
}

function decodeWorldObjectTargetId(targetId) {
  return targetId.slice(WORLD_OBJECT_TARGET_PREFIX.length);
}

// ====== نقطة الدخول الموحّدة لأي كود محتاج "يحل" targetId جاي من الفرونت
// إند لمستند Castle قابل للهجوم فعليًا - سواء كان ده Castle ID عادي (قلعة
// لاعب/NPC حقيقية) أو "wobj:<id>" (كائن عالم معادي). ده بالظبط الـ
// "AttackableTarget abstraction" المطلوب: march.service/castle.service
// بينادوا على الدالة دي بدل Castle.findById مباشرة، ومن ساعتها بيشتغلوا على
// نفس مستند Castle زي أي هدف تاني - الفرق الوحيد (بيانات الحامية/المكافأة)
// بقى محسوم خلاص جوه القلعة الظل نفسها وقت توليدها. ======
async function resolveAttackableCastle(targetId) {
  if (isWorldObjectTargetId(targetId)) {
    const worldObjectId = decodeWorldObjectTargetId(targetId);
    if (!mongoose.Types.ObjectId.isValid(worldObjectId)) return null;
    return getOrCreateShadowCastle(worldObjectId);
  }
  if (!mongoose.Types.ObjectId.isValid(targetId)) return null;
  return Castle.findById(targetId);
}

module.exports = {
  getOrCreateShadowCastle,
  findWorldObjectForShadowCastle,
  syncShadowCastleToWorldObject,
  respawnDueHostileObjects,
  isWorldObjectTargetId,
  encodeWorldObjectTargetId,
  decodeWorldObjectTargetId,
  resolveAttackableCastle,
  WORLD_OBJECT_TARGET_PREFIX,
  // exported for tests / potential reuse - not part of the required public API
  buildShadowBuildings,
  buildShadowResources,
};
