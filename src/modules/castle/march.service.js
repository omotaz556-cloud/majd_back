const Castle = require('./castle.model');
const March = require('./march.model');
const castleService = require('./castle.service');
const worldMapService = require('./worldMap.service');
const inboxService = require('../inbox/inbox.service');
const allianceService = require('../alliances/alliance.service');
// ====== Phase 12: Alliance Reinforcements - بتتستخدم هنا (أ) وقت وصول مسير
// تعزيز (direction: 'reinforcement') عشان "يقف" جوه قلعة الهدف بدل ما يدخل
// معركة أو يرجع لصاحبه، و(ب) وقت حسم مسير هجوم وصل عشان جيش الدفاع الفعلي
// يشمل تعزيزات الحلفاء الواقفة مش بس جيش صاحب القلعة - راجع
// resolveReinforcementArrival وresolveAttackArrival تحت. ======
const allianceReinforcementService = require('../alliances/allianceReinforcement.service');
const battleService = require('../battle/battle.service');
// ====== Phase 1 (Reinforcement & Battle System) - الويب سوكيت: نفس تنبيهات
// notify()/notifyAllianceOfAttack تحت بالظبط، بس فورية (push) بدل ما تستنى
// دورة الـ polling القديمة في الفرونت إند - راجع realtime/socket.js. ======
const { emitToUser, emitToAlliance, emitToBattle } = require('../../realtime/socket');
// ====== AttackableTarget abstraction (راجع world/worldObjectCastleBridge.js
// للشرح الكامل) - resolveAttackableCastle بتفهم كل من "Castle ID عادي" و
// "wobj:<worldObjectId>" وترجع مستند Castle حقيقي في الحالتين (لكائنات
// العالم، بتتولّد/تترجع "قلعة ظل" أول مرة). من هنا لحد نهاية المسير، الكود
// كله شغال على Castle عادي زي ما كان - مفيش أي فرع إضافي تحت. ======
const { resolveAttackableCastle, syncShadowCastleToWorldObject } = require('../world/worldObjectCastleBridge');
const {
  RESOURCE_TYPES,
  TROOP_TYPES,
  MARCH_MIN_SECONDS,
  ATTACK_LOOT_FRACTION,
  BASE_DEFENSE_PER_TOWNHALL_LEVEL,
  VISION_RADIUS_SLOTS,
  marchSeconds,
  armyCarryCapacity,
  armyStatTotal,
  resolveBattle,
  applyLossFraction,
  battleDurationSeconds,
} = require('./castle.config');

// ====== المسافة بين إحداثيتين على خريطة العالم بوحدة "خانة توزيع" (نفس
// وحدة SLOT_SPACING المستخدمة في worldMap.service وformatNearbyCastle) -
// هنا من غير تقريب (raw) عشان مدة المسير تتحسب بدقة أكتر من رقم العرض
// المقرّب اللي بيشوفه اللاعب في قايمة القلاع القريبة. ======
function distanceInSlots(a, b) {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return Math.max(dx, dy) / worldMapService.SLOT_SPACING;
}

// ====== Requirement 1 (One Active Battle) - بيدمج كومتين وحدات ({key,count})
// في مصفوفة واحدة (نفس شكل march.troops بالظبط)، بيجمع العدد لو نفس النوع
// موجود في الاتنين. مستخدمة وقت ما تعزيز جديد بينضم لمسير هجوم "شغال" أصلًا
// (traveling/battling) على نفس الهدف - بدل ما نعمل مسير/معركة جداد، بندمج
// الجيش الجديد جوه نفس المسير القديم. ======
function mergeTroopStacks(existingTroops, addedTroops) {
  const merged = existingTroops.map((t) => ({ key: t.key, count: t.count }));
  for (const added of addedTroops) {
    const stack = merged.find((m) => m.key === added.key);
    if (stack) stack.count += added.count;
    else merged.push({ key: added.key, count: added.count });
  }
  return merged;
}

// ====== بدء مسير هجوم جديد: بيتحقق من صحة الوحدات المطلوبة، يخصمها من جيش
// قلعتك (بتفضل "ماشية" لحد ما توصل أو ترجع)، ويحسب مدة المسير حسب المسافة
// وأبطأ وحدة في الجيش المرسَل ======
async function startMarch(userId, targetCastleId, requestedTroops, battlePlanId = null) {
  if (!Array.isArray(requestedTroops) || requestedTroops.length === 0) {
    throw new Error('لازم تختار وحدات تبعتها في المسير');
  }

  const troops = [];
  for (const item of requestedTroops) {
    const key = item?.key;
    const qty = Number(item?.quantity);
    if (!TROOP_TYPES[key]) throw new Error('نوع وحدة غير معروف');
    if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty < 1) {
      throw new Error('عدد الوحدات غير صحيح');
    }
    troops.push({ key, count: qty });
  }

  await resolveDueMarches(userId);

  const origin = await castleService.loadCastleCommon(userId);

  const target = await resolveAttackableCastle(targetCastleId);
  if (!target) throw new Error('الهدف ده مش موجود');
  if (target._id.toString() === origin._id.toString()) {
    throw new Error('متقدرش تهاجم قلعتك انت');
  }

  // ====== حماية "النار الصديقة": مينفعش تهاجم قلعة لاعب في نفس التحالف
  // بتاعك - القلاع الآلية (NPC) مالهاش user_id فالفحص بيتخطاها تلقائيًا ======
  if (!target.is_npc && target.user_id) {
    const allied = await allianceService.areAllied(userId, target.user_id);
    if (allied) {
      throw new Error('متقدرش تهاجم عضو في نفس تحالفك');
    }
  }

  // ====== ملحوظة: مفيش داعي نستثني الجيش الاحتياطي المخصص للدفاع
  // (reserved_army) أو جنود الحاميات (garrisons) هنا صراحة - نظام الدفاع
  // (defense.service: reserveArmy/assignGarrison) بيخصم الجنود دول فعليًا
  // من castle.army وقت التخصيص (مش مجرد "علم" عليهم جوه نفس المصفوفة)،
  // فـ origin.army هنا أصلًا بيعكس الجيش "المتاح" الحقيقي بس - نفس مبدأ
  // "جيش واحد بيتحرك بين حالات" المذكور في defense.service. ======
  for (const t of troops) {
    const stack = origin.army.find((a) => a.key === t.key);
    if (!stack || stack.count < t.count) {
      throw new Error('معندكش وحدات كفاية من النوع ده جاهزة في قلعتك');
    }
  }

  for (const t of troops) {
    const stack = origin.army.find((a) => a.key === t.key);
    stack.count -= t.count;
  }
  origin.army = origin.army.filter((a) => a.count > 0);

  // ====== Requirement 1 (One Active Battle): لو المهاجم ده أصلًا عنده مسير
  // هجوم "شغال" (لسه في الطريق أو دخل المعركة فعليًا) لنفس الهدف بالذات، مش
  // هنعمل مسير/معركة جداد - هندمج الجيش الجديد (تعزيز) جوه نفس المسير
  // الموجود بدل كده. لازم يكون نفس المهاجم ونفس الهدف بالظبط (target_castle_id) -
  // لاعبين مختلفين بيهاجموا نفس الهدف لسه بيتعاملوا كمعارك منفصلة تمامًا،
  // زي ما هو موضّح في ملاحظة "simultaneous multi-attacker" (مش Alliance
  // Rally). ======
  // ====== *** فيكس (تجنّب سلسلة تعزيزات - Requirement 1): لو أصلًا فيه
  // مسير تعزيز "ماشي" لنفس الهدف اتبعت قبل كده (direction:'attack' بس
  // reinforces_march_id مش null - شوف sendReinforcementMarchToActiveAttack
  // تحت)، بنلاقي المسير "الجذر" (root) اللي هو بيتجه له هو نفسه بدل ما
  // نخليه يشاور على مسير تعزيز تاني (سلسلة تعزيزات فوق بعض - كانت هتشتغل
  // صح برضه بفضل mergeReinforcementIntoBattle، بس بتعقيد وترتيب وصول مش
  // لازم). ======
  const activeMarch = await March.findOne({
    user_id: userId,
    target_castle_id: target._id,
    direction: 'attack',
    status: { $in: ['traveling', 'battling'] },
  });

  const rootActiveMarch =
    activeMarch && activeMarch.reinforces_march_id
      ? (await March.findById(activeMarch.reinforces_march_id)) || activeMarch
      : activeMarch;

  if (rootActiveMarch) {
    await origin.save();
    // ====== ملحوظة: أي battlePlanId اتبعت مع التعزيز ده بيتجاهل عمدًا -
    // المسير الأصلي بيفضل محتفظ بخطته هو (activeMarch.battle_plan_id) زي
    // ما هي، عشان مايحصلش تبديل خطة مربك في نص المعركة.
    // ====== *** فيكس (Reinforcements must march, not teleport): بدل ما
    // ندمج الجيش الجديد فورًا جوه activeMarch (زي ما كان)، بنبعته كمسير
    // هجوم عادي تمامًا (direction: 'attack') بيماشي فعليًا على الخريطة -
    // نفس مسافة/سرعة/سبرايت أي هجوم تاني - وبس بنعلّمه (reinforces_march_id)
    // إنه تعزيز لمسير شغال أصلًا. الدمج الفعلي (زيادة عدد الجنود في المعركة)
    // بيحصل بس لما المسير الجديد ده يوصل فعليًا (mergeReinforcementIntoBattle
    // تحت) - مش دلوقتي. ======
    return sendReinforcementMarchToActiveAttack(origin, target, troops, rootActiveMarch);
  }

  const distance = distanceInSlots(origin.map_slot, target.map_slot);
  const seconds = marchSeconds(troops, distance);
  const now = new Date();

  const march = await March.create({
    user_id: userId,
    origin_castle_id: origin._id,
    target_castle_id: target._id,
    origin_map_slot: origin.map_slot,
    target_map_slot: target.map_slot,
    target_name: target.is_npc ? target.npc_name : null,
    target_is_npc: Boolean(target.is_npc),
    direction: 'attack',
    status: 'traveling',
    troops,
    battle_plan_id: battlePlanId || null,
    departed_at: now,
    arrives_at: new Date(now.getTime() + seconds * 1000),
  });

  await origin.save();

  // ====== "Create a Battle Instance whenever an attack starts": بمجرد ما
  // مسير الهجوم يتسجّل فعليًا، بنسجّل معاه لقطة معركة كاملة (Battle
  // Foundation) - المعركة نفسها هتفضل بحالة "preparing" لحد ما الأنظمة
  // الجاية (Simulation/Combat Engine) تتبنى وتاخد بالها منها وقت وصول
  // المسير. مغلّفة بـ try/catch عشان فشل تسجيل الأساس ده لوحده ميوقفش
  // مسار الهجوم الحالي (نفس فلسفة notify() تحت). ======
  await registerBattleFoundation(origin, target, troops, march._id, battlePlanId);

  // ====== *** تعديل: الإشعار (رسالة + ويب سوكيت "تحت الهجوم") بقى بيتبعت من
  // هنا - لحظة ما الجيش يتحرك فعليًا من قلعة المهاجم - بدل ما يستنى وصوله
  // لقلعة الهدف (زي ما كان في beginBattle). لايف المعركة نفسه (حالة
  // 'battling' وشريط الباور castle:power_update) لسه بيبدأ فقط لما الجيش
  // يوصل فعليًا (راجع beginBattle تحت) - ده لسه من غير أي تغيير. ******
  await notifyIncomingAttack(origin, target, troops, march);

  return { castle: origin, march };
}

// ====== *** بديل beginBattle القديم لإرسال إشعار "تحت الهجوم" - بتتنادى
// دلوقتي وقت انطلاق الجيش (startMarch) مش وقت وصوله. بتحسب مدة المعركة
// المتوقعة بناءً على قوة الطرفين *وقت الإرسال* (تقدير أولي فقط - المدة
// الفعلية النهائية لسه بتتحسب تاني وقت الوصول في beginBattle نفسها، لأي
// تغيّر في قوة الدفاع حصل أثناء رحلة الجيش زي وصول تعزيزات جديدة). ******
async function notifyIncomingAttack(origin, target, troops, march) {
  const { defenderPower } = await computeDefensePower(target);
  const attackerPower = armyStatTotal(troops, 'attack');
  // ====== المسافة الحقيقية بين المهاجم والهدف (نفس وحدة "خانة" المستخدمة في
  // marchSeconds) - بتضاف كعامل إضافي بسيط فوق حجم المعركة (راجع تعليق
  // battleDurationSeconds في castle.config.js). ده مجرد تقدير أولي وقت
  // الإرسال - beginBattle بتعيد حسابها تاني وقت الوصول الفعلي. ======
  const distance = distanceInSlots(origin.map_slot, target.map_slot);
  const durationSeconds = battleDurationSeconds(attackerPower, defenderPower, distance);
  const durationLabel = formatSecondsArabic(durationSeconds);

  await notify(
    march.user_id,
    'march_departed_attack',
    'جيشك اتحرك للهجوم',
    `جيشك بدأ يتحرك ناحية هدفه - المفروض يوصل خلال ${formatSecondsArabic(
      Math.max(0, Math.round((new Date(march.arrives_at).getTime() - Date.now()) / 1000))
    )}.`,
    { march_id: march._id, arrives_at: march.arrives_at }
  );

  if (!target.is_npc && target.user_id) {
    await notify(
      target.user_id,
      'march_under_attack_started',
      'قلعتك تحت الهجوم',
      `جيش معادي اتحرك ناحية قلعتك دلوقتي وهيوصلها قريب. أي تعزيزات حلفاء تقدر تبعتها هتوصل قبل الجيش المعادي لو استعجلت.`,
      { march_id: march._id, arrives_at: march.arrives_at }
    );

    // ====== الويب سوكيت: نفس تنبيه "قلعتك تحت الهجوم" فوق بس فوري (push) -
    // بيوصل لصاحب القلعة في نفس لحظة انطلاق الجيش المعادي بالظبط (مش لما
    // يوصلها زي ما كان قبل كده). ======
    emitToUser(target.user_id, 'battle:under_attack', {
      march_id: march._id,
      arrives_at: march.arrives_at,
      duration_label: durationLabel,
    });

    // ====== تنبيه فوري لباقي أعضاء تحالف المدافع - نفس لحظة انطلاق الجيش
    // بالظبط، عشان أي حليف يقدر يبعت تعزيزات أو يتابع المسير لايف من غير ما
    // يستنى المدافع يبلغهم بنفسه. ======
    await notifyAllianceOfAttack(target.user_id, march._id, 'departed', march.arrives_at, durationLabel);
  }
}

async function registerBattleFoundation(originCastle, targetCastle, troops, marchId, battlePlanId) {
  try {
    // ====== Phase 12: أي تعزيزات حلفاء واقفة في قلعة الهدف وقت بدء الهجوم
    // بالظبط بتتحط جوه لقطة المعركة (Battle Foundation) من الأول - نفس فلسفة
    // "لقطة مجمّدة وقت البدء" المستخدمة أصلًا لجيش/مباني/دفاعات الهدف. ======
    let reinforcements = [];
    try {
      reinforcements = await allianceReinforcementService.getStationedForCastle(targetCastle._id);
    } catch (err) {
      console.error('[March] failed to load stationed reinforcements for battle snapshot:', err.message);
    }

    await battleService.createBattleFromAttack({
      attackerCastle: originCastle,
      defenderCastle: targetCastle,
      troops,
      marchId,
      battlePlanId: battlePlanId || null,
      reinforcements,
    });
  } catch (err) {
    console.error('[March] failed to register battle foundation:', err.message);
  }
}

// ====== *** فيكس (Reinforcements must march, not teleport - Requirement 1)
// *** بتتنادى من startMarch لما اللاعب يبعت هجوم جديد على هدف عنده أصلًا
// مسير هجوم "شغال" (traveling أو battling) لنفس الهدف بالظبط. بدل الدمج
// الفوري القديم (كان بيحصل هنا لحظة الإرسال - نفس bug الطلب: "troop count
// is added to the battle immediately")، دلوقتي بنعمل مسير هجوم عادي تمامًا
// (direction: 'attack'، نفس مسافة/سرعة/سبرايت "هجومي" أي هجوم تاني على
// الخريطة - marchColor/marchSprite في IsometricWorld.jsx بيتعرفوا عليه
// تلقائيًا من غير أي تعديل هناك لأنه direction: 'attack' زي أي مسير تاني)،
// وبس بنحط reinforces_march_id عليه يشاور على المسير الأصلي (activeMarch).
// الدمج الفعلي (زيادة عدد الجنود + تمديد وقت المعركة لو شغالة فعلًا) بيحصل
// بس لما المسير الجديد ده يوصل فعليًا - راجع mergeReinforcementIntoBattle
// تحت واللي resolveDueMarchesQuery بتنادي عليها بدل beginBattle العادية لأي
// مسير معلّم بـ reinforces_march_id. ======
async function sendReinforcementMarchToActiveAttack(origin, target, addedTroops, activeMarch) {
  const distance = distanceInSlots(origin.map_slot, target.map_slot);
  const seconds = marchSeconds(addedTroops, distance);
  const now = new Date();

  const march = await March.create({
    user_id: origin.user_id,
    origin_castle_id: origin._id,
    target_castle_id: target._id,
    origin_map_slot: origin.map_slot,
    target_map_slot: target.map_slot,
    target_name: target.is_npc ? target.npc_name : null,
    target_is_npc: Boolean(target.is_npc),
    direction: 'attack',
    status: 'traveling',
    troops: addedTroops,
    // ====== خطة المعركة لأي تعزيز جديد بتتجاهل عمدًا (null) - نفس فلسفة
    // الملحوظة القديمة فوق: المسير الأصلي (activeMarch) هو اللي بيفضل
    // محتفظ بخطته، مش التعزيز. ======
    battle_plan_id: null,
    reinforces_march_id: activeMarch._id,
    departed_at: now,
    arrives_at: new Date(now.getTime() + seconds * 1000),
  });

  await notify(
    march.user_id,
    'march_reinforcement_departed',
    'تعزيزك اتحرك',
    `تعزيزك بدأ يتحرك ناحية جيشك اللي شغال هناك دلوقتي - المفروض يوصل خلال ${formatSecondsArabic(
      Math.max(0, Math.round((new Date(march.arrives_at).getTime() - Date.now()) / 1000))
    )} وينضم للمعركة وقتها.`,
    { march_id: march._id, reinforces_march_id: activeMarch._id, arrives_at: march.arrives_at }
  );

  // ====== الويب سوكيت: نفس فلسفة battle:under_attack وقت انطلاق أي هجوم -
  // غرفة المعركة الأصلية (نفس marchId القديم) بتتبلغ إن تعزيز جديد اتحرك،
  // عشان أي حد فاتح صفحة المعركة (المدافع، حلفاؤه، أو المهاجم نفسه في تبويب
  // تاني) يشوف السهم الجديد على الخريطة فورًا من غير ما يستنى الـ polling. ======
  emitToBattle(activeMarch._id, 'battle:reinforcement_departed', {
    march_id: activeMarch._id,
    reinforcement_march_id: march._id,
    arrives_at: march.arrives_at,
  });

  return { castle: origin, march };
}

// ====== *** فيكس (Reinforcements must march, not teleport - Requirement 1)
// *** بتتنادى من resolveDueMarchesQuery بدل beginBattle العادية لحظة ما
// مسير معلّم بـ reinforces_march_id يوصل فعليًا - هنا بس (وقت الوصول، مش
// وقت الإرسال) بيتم الدمج الحقيقي:
//
// - لو المسير الأصلي (targetMarch) لسه 'traveling': بندمج الجنود بس - مفيش
//   معركة بدأت أصلًا فمفيش "وقت متبقي" نعدّله؛ التعزيز هيشارك في المعركة
//   زي ما هي وقت ما الجيش الأصلي يوصل ويبدأها (beginBattle بتاخد
//   march.troops كامل وقتها، يعني هتلاقي الجيش المدموج تلقائيًا).
// - لو المسير الأصلي بقى 'battling' (المعركة بدأت فعليًا وعندها
//   battle_ends_at): بندمج الجنود وكمان بنعيد حساب مدة المعركة المتبقية
//   بناءً على "حجم المعركة" الجديد (نفس معادلة battleDurationSeconds اللي
//   beginBattle بتستخدمها بالظبط) - المدة المتبقية بتتمدد لو الجيش المدموج
//   بقى أكبر. أي خسائر/نتيجة فعلية لسه مبتتحسبش هنا خالص - ده لسه بيحصل مرة
//   واحدة بس في finalizeAttackBattle وقت battle_ends_at الجديد.
// - لو المسير الأصلي خلاص 'resolved' (نادر - سباق: المعركة الأصلية اتحسمت
//   في نفس اللحظة تقريبًا اللي التعزيز وصل فيها) - التعزيز نفسه بيتحول
//   لمسير عودة فورًا (نفس فلسفة "الهدف مختفي") عشان الجنود ميضيعوش في مسير
//   معلّق مالوش معركة يشاركها.
//
// مفيش أي معركة (Battle document) جديدة بتتعمل هنا - بس تحديث لقطة الجيش
// المهاجم بتاعة المعركة الموجودة أصلًا (battleService.reinforceBattleForMarch)
// عشان تفضل متسقة مع troops المسير الأصلي الجديد. ======
async function mergeReinforcementIntoBattle(march) {
  const targetMarch = await March.findById(march.reinforces_march_id);

  // ====== المسير الأصلي مبقاش موجود خالص (نادر جدًا) - نتعامل معاه زي "الهدف
  // مختفي": مفيش حاجة ندمج فيها، الجنود ترجع لصاحبها. ======
  if (!targetMarch) {
    await resolveMissingTarget(march);
    return;
  }

  // ====== المسير الأصلي خلص (resolved) قبل ما التعزيز يوصل - سباق نادر.
  // مفيش معركة نضيف ليها التعزيز، فبنرجّع الجنود فورًا لصاحبها كمسير عودة،
  // بدل ما يفضلوا معلّقين في مسير 'processing' من غير أي حسم. ======
  if (targetMarch.status === 'resolved') {
    march.status = 'resolved';
    march.report = {
      outcome: 'recalled',
      loot: { gold: 0, wood: 0, stone: 0 },
      troops_sent: march.troops,
      troops_lost: [],
      troops_survived: march.troops,
    };
    await march.save();

    const now = new Date();
    const distance = distanceInSlots(march.target_map_slot, march.origin_map_slot);
    const seconds = marchSeconds(march.troops, distance);
    await March.create({
      user_id: march.user_id,
      origin_castle_id: march.target_castle_id,
      target_castle_id: march.origin_castle_id,
      origin_map_slot: march.target_map_slot,
      target_map_slot: march.origin_map_slot,
      target_name: null,
      target_is_npc: false,
      direction: 'return',
      status: 'traveling',
      troops: march.troops,
      departed_at: now,
      arrives_at: new Date(now.getTime() + seconds * 1000),
    });

    await notify(
      march.user_id,
      'march_reinforcement_missed',
      'تعزيزك رجع من غير ما يشارك',
      'المعركة الأصلية خلصت قبل ما تعزيزك يوصل، فجيشك رجع لقلعتك.',
      { march_id: march._id }
    );
    return;
  }

  const target = await Castle.findById(targetMarch.target_castle_id);
  if (!target) {
    march.status = 'resolved';
    await march.save();
    return resolveMissingTarget(targetMarch);
  }

  const mergedTroops = mergeTroopStacks(targetMarch.troops, march.troops);
  targetMarch.troops = mergedTroops;

  let durationLabel = null;

  if (targetMarch.status === 'battling') {
    const { defenderPower } = await computeDefensePower(target);
    const attackerPower = armyStatTotal(mergedTroops, 'attack');
    const distance = distanceInSlots(targetMarch.origin_map_slot, targetMarch.target_map_slot);
    const durationSeconds = battleDurationSeconds(attackerPower, defenderPower, distance);

    const now = new Date();
    targetMarch.battle_started_at = now;
    targetMarch.battle_ends_at = new Date(now.getTime() + durationSeconds * 1000);
    durationLabel = formatSecondsArabic(durationSeconds);
  }

  await targetMarch.save();

  // ====== المسير الجديد (التعزيز) نفسه خلص رحلته - بيتحول لـ'resolved' من
  // غير أي "تقرير" (report=null): مفيش خسائر ولا غنيمة له بشكل منفصل، جيشه
  // بقى فعليًا جزء من targetMarch.troops من دلوقتي. ======
  march.status = 'resolved';
  await march.save();

  // ====== نفس مستند Battle الأصلي المرتبط بالمسير الأصلي (march_id ثابت) -
  // بنحدّث بس لقطة جيش المهاجم عشان تعكس الإجمالي المدموج، من غير أي حسم
  // نتيجة أو تغيير حالة. ======
  try {
    await battleService.reinforceBattleForMarch(targetMarch._id, mergedTroops);
  } catch (err) {
    console.error('[March] failed to update battle snapshot with reinforcements:', err.message);
  }

  if (targetMarch.status === 'battling') {
    await notify(
      targetMarch.user_id,
      'march_reinforcement_merged',
      'وصل تعزيزك وانضم للمعركة',
      `تعزيزك وصل وانضم لجيشك اللي شغال في المعركة دلوقتي - المدة المتبقية اتحدّثت لحوالين ${durationLabel}.`,
      { march_id: targetMarch._id, battle_ends_at: targetMarch.battle_ends_at }
    );

    if (!target.is_npc && target.user_id) {
      emitToBattle(targetMarch._id, 'battle:reinforced', {
        march_id: targetMarch._id,
        battle_ends_at: targetMarch.battle_ends_at,
        duration_label: durationLabel,
      });
    }
  } else {
    await notify(
      targetMarch.user_id,
      'march_reinforcement_merged',
      'وصل تعزيزك',
      'تعزيزك وصل وانضم لجيشك اللي لسه في الطريق - هيوصلوا ويحاربوا مع بعض.',
      { march_id: targetMarch._id, arrives_at: targetMarch.arrives_at }
    );
  }
}

// ====== Phase 2: Battle Integration & Persistence - بينادي على
// battleService.resolveBattleForMarch لحظة ما مسير الهجوم يوصل فعليًا (راجع
// resolveAttackArrival تحت). مغلّفة بـ try/catch زي registerBattleFoundation
// فوق بالظبط - فشل تسجيل نتيجة المعركة "الرسمية" لوحده ميوقفش حسم المسير نفسه. ======
async function finalizeBattleResolution(marchId) {
  try {
    await battleService.resolveBattleForMarch(marchId);
  } catch (err) {
    console.error('[March] failed to resolve Battle Resolution Engine result:', err.message);
  }
}

// ====== سحب مسير هجوم لسه ماشي (لسه ما وصلش) - بيرجّع الوحدات فورًا لقلعة
// صاحبها من غير معركة ولا غنيمة، زي فلسفة إلغاء أمر التدريب (استرجاع فوري) ======
async function recallMarch(userId, marchId) {
  const march = await March.findById(marchId);
  if (!march || march.user_id.toString() !== userId.toString()) {
    throw new Error('المسير ده مش موجود');
  }
  if (march.status !== 'traveling' || march.direction !== 'attack') {
    throw new Error('متقدرش تسحب المسير ده دلوقتي');
  }

  const origin = await Castle.findById(march.origin_castle_id);
  if (!origin) throw new Error('قلعتك مش موجودة');

  for (const t of march.troops) {
    const stack = origin.army.find((a) => a.key === t.key);
    if (stack) stack.count += t.count;
    else origin.army.push({ key: t.key, count: t.count });
  }

  march.status = 'resolved';
  march.report = {
    outcome: 'recalled',
    loot: { gold: 0, wood: 0, stone: 0 },
    troops_sent: march.troops,
    troops_lost: [],
    troops_survived: march.troops,
  };

  await Promise.all([origin.save(), march.save()]);

  return { castle: origin, march };
}

// ====== بيحوّل عدد ثواني لنص عربي مختصر للإشعارات (يوم/ساعة/دقيقة) - نفس
// فلسفة formatDuration بتاعة الفرونت إند (utils/duration.js) بس نسخة نصية
// بسيطة للباك إند (الإشعارات بترسل كنص جاهز، مش رقم يتفسر في الواجهة). ======
function formatSecondsArabic(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days} يوم${hours > 0 ? ` و${hours} ساعة` : ''}`;
  if (hours > 0) return `${hours} ساعة${minutes > 0 ? ` و${minutes} دقيقة` : ''}`;
  if (minutes > 0) return `${minutes} دقيقة`;
  return `${seconds} ثانية`;
}

// ====== Phase 1 (Reinforcement & Battle System) - Requirement 6/8/9: قوة
// الدفاع الكلية للحظة معيّنة (تحصينات + جيش القلعة الواقف + تعزيزات الحلفاء
// الواقفة وقتها) - نفس المعادلة اللي كانت جوه resolveAttackArrival القديمة
// بالظبط، بس متاحة هنا عشان تتنادى مرتين: مرة وقت بدء المعركة (تقدير
// تقريبي لمدتها) ومرة وقت حسمها النهائي (النتيجة الفعلية، بعد ما أي تعزيز
// وصل في نص المعركة يتحسب). بترجع القوة + قايمة التعزيزات الواقفة وقتها
// (محتاجينها بعدين لتطبيق الخسائر عليها تحديدًا).
//
// ====== *** فيكس: القدير كان بيتجاهل مباني الدفاع الحقيقية (سور/برج/
// بوابة/فخ) خالص - fortificationPower كانت مجرد "مستوى مبنى القيادة × 9"،
// حتى لو اللاعب بنى سور وبرج فعليًا مالهمش أي أثر هنا. دلوقتي بنضيف
// structuresDefensePower (defense.service.js - مجموع combat_stats.defense
// الحقيقي بتاع كل قطعة دفاعية واقفة) لنفس المجموع، نفس فلسفة إضافة
// reinforcementPower بالظبط. مفيش أي تعديل على النتيجة النهائية للمعركة
// (دي محسوبة بمعادلة defensePowerCalculator الكاملة في battleResolution) -
// هنا بس تقدير المدة/الرقم المعروض بيبقى متسق مع وجود مباني الدفاع. ******
async function computeDefensePower(target) {
  let stationedReinforcements = [];
  try {
    stationedReinforcements = await allianceReinforcementService.getStationedForCastle(target._id);
  } catch (err) {
    console.error('[March] failed to load stationed reinforcements:', err.message);
  }

  const townHall = target.buildings.find((b) => b.key === 'town_hall');
  const townHallLevel = townHall?.level || 1;
  const fortificationPower = townHallLevel * BASE_DEFENSE_PER_TOWNHALL_LEVEL;
  const defenderArmyPower = armyStatTotal(target.army, 'defense');
  const reinforcementPower = allianceReinforcementService.stationedDefensePower(stationedReinforcements, 'defense');
  // ====== lazy require عشان نتجنب دورة استيراد: defense.service.js بيعمل
  // require لـ castle.service.js، واللي march.service.js نفسه بيعمله require
  // ليه فوق - نفس فلسفة lazy require في castleBattleBroadcaster.js بالظبط
  // (تجنب "نسخة ناقصة" من أي موديول لو اتحمّل في نص دورة استيراد). ======
  const defenseService = require('../defense/defense.service');
  const defenseStructuresPower = await defenseService.getStructuresDefensePowerByCastleId(target._id);

  return {
    defenderPower: fortificationPower + defenderArmyPower + reinforcementPower + defenseStructuresPower,
    stationedReinforcements,
  };
}

// ====== نفس فلسفة "الهدف مختفي" - سواء وقت وصول المسير الأول أو وقت خلاص
// مدة معركة كانت شغالة فعلًا (نادر جدًا: قلعة الهدف اتمسحت وهي المعركة
// شغالة) - المهاجم بيخسر جيشه بالكامل من غير أي معركة حقيقية. ======
async function resolveMissingTarget(march) {
  march.status = 'resolved';
  march.report = {
    outcome: 'loss',
    loot: { gold: 0, wood: 0, stone: 0 },
    troops_sent: march.troops,
    troops_lost: march.troops,
    troops_survived: [],
    defender_troops_lost: [],
  };
  await march.save();
  await notify(march.user_id, 'march_target_gone', 'الهدف مختفي', 'الهدف اللي كان جيشك متجه ليه مبقاش موجود.');
}

// ====== حل وصول مسير هجوم لهدفه (Requirement 6/7/8/9): بدل ما المعركة
// تتحسم فورًا زي الأول، دلوقتي هي مجرد "بداية" المعركة - بنحسب مدتها هنا
// بناءً على حجم الطرفين (Requirement 8/9: كل ما الجيوش أكبر، كل ما
// استغرقت وقت أطول، ممكن لساعات أو أيام لمعارك ضخمة)، ونحط المسير في حالة
// 'battling' لحد ما battle_ends_at يوصل - هناك بس finalizeAttackBattle
// (تحت) بيطلع النتيجة النهائية الفعلية (خسائر/غنيمة). ======
async function beginBattle(march) {
  const target = await Castle.findById(march.target_castle_id);
  if (!target) {
    await resolveMissingTarget(march);
    return;
  }

  // ====== *** فيكس حرج: Phase 2 كانت بتنادي finalizeBattleResolution هنا -
  // لحظة وصول الهجوم (بداية المعركة) - وده كان بيخلّص مستند Battle فورًا
  // (status: 'finished' + battle_result كامل) بمجرد ما المعركة تبدأ، مش لما
  // تخلص. ده بالظبط اللي كان بيخلي تقرير/مكافأة المعركة (نفس مستند Battle
  // اللي ReportsMailPanel بيقرا منه) جاهز فور البداية بدل ما ينتظر
  // battle_ends_at - عكس المطلوب تمامًا ("never calculate immediately").
  // النداء اتنقل لـ finalizeAttackBattle (نهاية المعركة الفعلية) تحت - هنا
  // بقى بس بداية اللايف (حالة 'battling' + أول قراءة باور 100%)، من غير أي
  // حسم فعلي للنتيجة. ******

  // ====== قوة الطرفين لحظة الوصول - هنا بس لتقدير "حجم المعركة" ومدتها،
  // مش نتيجتها النهائية (اللي بتتحسب تاني وقت finalizeAttackBattle عشان أي
  // تعزيز يوصل في النص يتحسب فعليًا - Requirement 10). ======
  const { defenderPower } = await computeDefensePower(target);
  const attackerPower = armyStatTotal(march.troops, 'attack');
  const distance = distanceInSlots(march.origin_map_slot, march.target_map_slot);
  const durationSeconds = battleDurationSeconds(attackerPower, defenderPower, distance);

  const now = new Date();
  march.status = 'battling';
  march.battle_started_at = now;
  march.battle_ends_at = new Date(now.getTime() + durationSeconds * 1000);
  await march.save();

  const durationLabel = formatSecondsArabic(durationSeconds);
  await notify(
    march.user_id,
    'march_battle_started',
    'جيشك وصل ودخلت المعركة',
    `جيشك وصل لهدفه والمعركة بدأت فعليًا - المفروض تستغرق حوالين ${durationLabel} لحد ما تتحسم نهائيًا.`,
    { march_id: march._id, battle_ends_at: march.battle_ends_at }
  );

  if (!target.is_npc && target.user_id) {
    // ====== *** تعديل: إشعار "قلعتك تحت الهجوم" بقى بيتبعت وقت انطلاق
    // الجيش (notifyIncomingAttack في startMarch) مش هنا - هنا بقى بس بداية
    // اللايف الفعلي (حالة 'battling' + أول قراءة باور 100%)، عشان صاحب
    // القلعة يكون خد التنبيه بدري وقت ما الجيش لسه في الطريق، ثم يتابع
    // اللايف بمجرد ما الجيش يوصل فعليًا. ======
    await notify(
      target.user_id,
      'march_battle_started_defender',
      'المعركة بدأت فعليًا في قلعتك',
      `الجيش المعادي وصل قلعتك دلوقتي والمعركة بدأت فعليًا - المفروض تستمر حوالين ${durationLabel}. أي تعزيزات حلفاء توصلك قبل ما تخلص هتشارك في الدفاع.`,
      { march_id: march._id, battle_ends_at: march.battle_ends_at }
    );

    const powerPayload = {
      march_id: march._id,
      castle_id: target._id,
      power_pct: 100,
      defender_power: defenderPower,
      attacker_power: attackerPower,
    };

    // ====== الويب سوكيت: أول قراءة لباور القلعة (100% - المعركة لسه بادئة
    // دلوقتي)، بمجرد ما الجيش يوصل فعليًا. بتتبعت لصاحب القلعة، لتحالفه،
    // ولغرفة المعركة العامة (march:<id>) عشان أي حد فاتح صفحة المعركة دي
    // (مش بالضرورة صاحبها) يقدر يتابع اللايف من نفس اللحظة - راجع
    // joinBattleRoom في realtime/socket.js. ======
    emitToUser(target.user_id, 'castle:power_update', powerPayload);
    emitToBattle(march._id, 'castle:power_update', powerPayload);
    emitToBattle(march._id, 'battle:live_started', {
      march_id: march._id,
      battle_ends_at: march.battle_ends_at,
      duration_label: durationLabel,
    });

    // ====== تنبيه فوري لباقي أعضاء تحالف المدافع إن المعركة "بدأت فعليًا"
    // دلوقتي (كانوا اتبلّغوا وقت الانطلاق أصلًا) - عشان يعرفوا إنها بقت
    // قابلة للمتابعة لايف من دلوقتي. ======
    await notifyAllianceOfAttack(target.user_id, march._id, 'battling', march.battle_ends_at, durationLabel);
  }
}

// ====== باور القلعة الحي أثناء معركة "شغالة" (march.status === 'battling')
// - نفس معادلة resolveBattle بالظبط (المستخدمة في الحسم النهائي في
// finalizeAttackBattle)، بس هنا بنطبّقها على قوة الدفاع *الحالية* (بتشمل أي
// تعزيز حليف وصل واستقر لسه - راجع computeDefensePower فوق) ونسقطها على
// "نسبة تقدّم" الوقت لحد battle_ends_at:
//   - كل ما الوقت يعدي، الباور بيقل تدريجيًا نحو (1 - defenderLossFraction)
//     في لحظة الحسم النهائي - defenderLossFraction نفسها بتزيد كل ما قوة
//     المهاجم النسبية أكبر (نفس فلسفة "بيقل حسب قوة المهاجم" اللي اتطلبت).
//   - أي تعزيز جديد يوصل ويستقر بيزوّد defenderPower فورًا → powerRatio
//     يميل أكتر لصالح الدافع → defenderLossFraction تقل → الباور يرتفع في
//     نفس اللحظة (مش لازم يستنى نهاية المعركة).
// النتيجة دي بس "مؤشر حي" للعرض - الحسم الفعلي (خسائر/غنيمة) لسه بيحصل
// مرة واحدة بس في finalizeAttackBattle زي ما هو بالظبط، من غير أي تعديل. ======
async function computeLiveCastlePowerPct(target, march) {
  const { defenderPower } = await computeDefensePower(target);
  const attackerPower = armyStatTotal(march.troops, 'attack');
  const battle = resolveBattle(attackerPower, defenderPower);

  const startedAt = march.battle_started_at ? new Date(march.battle_started_at).getTime() : Date.now();
  const endsAt = march.battle_ends_at ? new Date(march.battle_ends_at).getTime() : startedAt;
  const totalMs = Math.max(1, endsAt - startedAt);
  const elapsedMs = Math.min(totalMs, Math.max(0, Date.now() - startedAt));
  const progress = elapsedMs / totalMs;

  const rawPct = Math.round((1 - battle.defenderLossFraction * progress) * 100);

  return {
    power_pct: Math.min(100, Math.max(0, rawPct)),
    defender_power: defenderPower,
    attacker_power: attackerPower,
  };
}

// ====== يبلغ كل أعضاء تحالف المدافع (غير المدافع نفسه) إن قلعته مستهدفة -
// نفس نمط notify() تمامًا (رسالة نظام في صندوق الوارد)، فشل هنا (تحميل
// التحالف أو بعت لعضو واحد) ما يوقفش بداية المعركة نفسها. بتتنادى في لحظتين
// مختلفتين (stage): 'departed' وقت ما الجيش المعادي يتحرك (لسه في الطريق -
// eta بس، مفيش battle_ends_at لسه)، و'battling' وقت ما يوصل فعليًا ويدخل
// المعركة (battle_ends_at بقى معروف). ======
async function notifyAllianceOfAttack(defenderUserId, marchId, stage, etaOrEndsAt, durationLabel) {
  try {
    const alliance = await allianceService.getMyAlliance(defenderUserId);
    if (!alliance) return;

    const nameMap = await castleService.buildOwnerNameMap([defenderUserId]);
    const defenderName = nameMap.get(defenderUserId.toString()) || 'حليفك';

    const allyIds = alliance.members
      .map((m) => m.user_id.toString())
      .filter((id) => id !== defenderUserId.toString());

    const isDeparted = stage === 'departed';
    const title = isDeparted ? 'حليفك مستهدف بهجوم' : 'حليفك تحت الهجوم فعليًا';
    const body = isDeparted
      ? `جيش معادي اتحرك ناحية ${defenderName} - المفروض يوصل خلال حوالين ${durationLabel}. تقدر تبعتله تعزيزات قبل ما يوصل.`
      : `${defenderName} تحت هجوم فعليًا دلوقتي - المعركة المفروض تستمر حوالين ${durationLabel}. تقدر تتابعها لايف أو تبعتله تعزيزات.`;

    await Promise.all(
      allyIds.map((allyId) =>
        notify(allyId, 'ally_under_attack', title, body, {
          march_id: marchId,
          defender_user_id: defenderUserId,
          ...(isDeparted ? { arrives_at: etaOrEndsAt } : { battle_ends_at: etaOrEndsAt }),
        })
      )
    );

    // ====== الويب سوكيت: نفس التنبيه فوق بس فوري (push) - بيوصل لكل أعضاء
    // التحالف المتصلين دلوقتي (بمن فيهم المدافع نفسه، اللي اتبعتله أصلًا
    // battle:under_attack المخصص له - الفرونت إند بيتجاهل الحدث ده لو
    // defender_user_id == هو نفسه) في نفس لحظة الانطلاق/بدء المعركة. ======
    emitToAlliance(alliance._id, 'battle:ally_under_attack', {
      march_id: marchId,
      defender_user_id: defenderUserId,
      defender_name: defenderName,
      stage,
      ...(isDeparted ? { arrives_at: etaOrEndsAt } : { battle_ends_at: etaOrEndsAt }),
      duration_label: durationLabel,
    });
  } catch (err) {
    console.error('[March] failed to notify alliance of attack:', err.message);
  }
}

// ====== حسم نهائي لمعركة "شغالة" (march.status === 'battling') وصلت مدتها
// (battle_ends_at) - نفس معركة resolveAttackArrival القديمة بالظبط (مجموع
// هجوم المهاجم مقابل دفاع الهدف + جيشه + تعزيزات حلفائه، نهب نسبي لو كسب،
// خسائر تقريبية للطرفين) - الفرق الوحيد إنها بتتحصل هنا بعد فترة انتظار
// حقيقية (Requirement 6) بدل لحظة الوصول، وإن تعزيزات الحلفاء بتتحسب هنا
// (وقت الحسم) مش وقت البداية - فأي تعزيز وصل واستقر في قلعة الهدف قبل ما
// المعركة تخلص بيشارك في نتيجتها فعليًا (Requirement 10). ======
async function finalizeAttackBattle(march) {
  const target = await Castle.findById(march.target_castle_id);
  const now = new Date();

  if (!target) {
    await resolveMissingTarget(march);
    return;
  }

  // ====== *** فيكس حرج (تكملة تعليق beginBattle فوق): هنا بقى المكان
  // الصح لحسم مستند Battle الرسمي (Phase 2 Battle Integration & Persistence)
  // - لحظة battle_ends_at الفعلية، مش لحظة الوصول/البداية. من دلوقتي، تقرير/
  // مكافأة المعركة (BattleReportDetail + Watch Ad → Double Reward) مش
  // هيبقوا متاحين أو محسوبين غير بعد ما المعركة تخلص فعليًا. مغلّفة بـ
  // try/catch جوه finalizeBattleResolution نفسها زي ما كانت بالظبط -
  // فشلها لوحده ميوقفش حسم المسير نفسه. ======
  await finalizeBattleResolution(march._id);

  castleService.syncResources(target);

  // ====== Requirement 10: تعزيزات الحلفاء الواقفة في قلعة الهدف *دلوقتي*
  // (لحظة حسم المعركة، مش لحظة بدايتها) - أي تعزيز وصل واستقر بعد ما
  // المعركة بدأت وقبل ما تخلص بيتحسب هنا تلقائيًا (نفس استعلام
  // getStationedForCastle بالظبط - مفيش أي فلترة زمنية إضافية محتاجة، لأن
  // التعزيز نفسه مبيبقاش 'stationed' غير لو لسه واقف فعلًا). ======
  const { defenderPower, stationedReinforcements } = await computeDefensePower(target);
  const attackerPower = armyStatTotal(march.troops, 'attack');

  // ====== معركة حقيقية بالطرفين: المهاجم بجيشه الماشي، والدافع بجيشه
  // الواقف في قلعته + تحصيناته + تعزيزات حلفائه - الاتنين بياخدوا خسائر
  // حقيقية حسب قوتهم النسبية لبعض (مش الدافع بس اللي بياخد صفر خسائر زي قبل كده). ======
  const battle = resolveBattle(attackerPower, defenderPower);
  const { win } = battle;

  const { lost: troopsLost, survived: troopsSurvived } = applyLossFraction(march.troops, battle.attackerLossFraction);
  const { lost: defenderTroopsLost, survived: defenderTroopsSurvived } = applyLossFraction(
    target.army,
    battle.defenderLossFraction
  );
  target.army = defenderTroopsSurvived;

  // ====== نفس نسبة خسارة الدافع (battle.defenderLossFraction) بتتطبّق على
  // كل تعزيز واقف بشكل مستقل - بترجع مين خسر إيه لكل حليف عشان تقرير
  // المعركة يقدر يحدد ملكية الجنود ("Battle Report must identify troop
  // ownership"). ======
  const reinforcementLosses =
    stationedReinforcements.length > 0
      ? await allianceReinforcementService.applyBattleLossesToStationedTroops(target._id, battle.defenderLossFraction)
      : [];

  const loot = { gold: 0, wood: 0, stone: 0 };
  if (win) {
    const carryCapacity = armyCarryCapacity(march.troops);
    const wanted = {};
    let totalWanted = 0;
    for (const resource of RESOURCE_TYPES) {
      wanted[resource] = Math.floor(target.resources[resource].stored * ATTACK_LOOT_FRACTION);
      totalWanted += wanted[resource];
    }
    const scale = totalWanted > carryCapacity && totalWanted > 0 ? carryCapacity / totalWanted : 1;
    for (const resource of RESOURCE_TYPES) {
      loot[resource] = Math.floor(wanted[resource] * scale);
      target.resources[resource].stored -= loot[resource];
    }
  }

  await target.save();

  // ====== NEW (Attackable World Objects) - لو الهدف ده أصلًا "قلعة ظل"
  // بتمثّل كائن عالم معادي (Barbarian Camp/Guard Tower/...إلخ - راجع
  // world/worldObjectCastleBridge.js)، بنزامن نتيجة المعركة (جيش الحامية
  // الناجي + الموارد المتبقية) رجوع لمستند الـ WorldObject الأصلي، وبنعلّمه
  // "منهوب" لو خلص - نفس فلسفة أي هدف تاني بيتحدّث بعد المعركة، بس هنا
  // بنحدّث كمان المصدر اللي الخريطة فعليًا بترسم منه (WorldObjectMarker).
  // مغلّفة بـ try/catch زي أي تكامل اختياري تاني في الملف ده (registerBattleFoundation/
  // finalizeBattleResolution فوق) - فشلها لوحده ميوقفش حسم المسير نفسه. ======
  if (target.is_world_object) {
    try {
      await syncShadowCastleToWorldObject(target);
    } catch (err) {
      console.error('[March] failed to sync shadow castle back to world object:', err.message);
    }
  }

  march.status = 'resolved';
  march.report = {
    outcome: win ? 'win' : 'loss',
    loot,
    troops_sent: march.troops,
    troops_lost: troopsLost,
    troops_survived: troopsSurvived,
    // ====== ملكية الجنود في الدفاع: defender_troops_lost يفضل يعني جيش
    // صاحب القلعة نفسه بس (زي قبل كده، Battle Engine مش اتلمس) -
    // defender_reinforcements_lost حقل جديد بيوضّح لكل حليف بعت تعزيز كام
    // جندي خسر من تعزيزه هو بالذات ("Battle Report must identify troop
    // ownership"). ======
    defender_troops_lost: defenderTroopsLost,
    defender_reinforcements_lost: reinforcementLosses.map((r) => ({
      owner_user_id: r.owner_user_id,
      troops_lost: r.troops_lost,
    })),
  };
  await march.save();

  const lootText = win
    ? `وكسبت ${loot.gold + loot.wood + loot.stone} وحدة موارد كغنيمة`
    : 'وماكسبتش أي غنيمة';

  // ====== *** فيكس: كان بيكتب "قلعة هدفك" دايمًا لأي هدف مش NPC، بدل اسم
  // اللاعب الحقيقي - نفس النمط المستخدم في getPublicBattleView/listLiveBattles
  // بالظبط (buildOwnerNameMap([target.user_id])، القلاع الحقيقية مالهاش اسم
  // مخزن على القلعة نفسها، بتاخده من جدول User وقت العرض). ******
  let targetDisplayName = 'قلعة هدفك';
  if (target.is_npc) {
    targetDisplayName = target.npc_name;
  } else if (target.user_id) {
    const nameMap = await castleService.buildOwnerNameMap([target.user_id]);
    targetDisplayName = nameMap.get(target.user_id.toString()) || targetDisplayName;
  }

  await notify(
    march.user_id,
    'march_battle_report',
    win ? 'كسبت المعركة!' : 'خسرت المعركة',
    `جيشك وصل لـ${targetDisplayName} ${lootText}.`,
    { march_id: march._id, outcome: win ? 'win' : 'loss', loot }
  );

  if (!target.is_npc && target.user_id) {
    const defenderLostCount = defenderTroopsLost.reduce((sum, t) => sum + t.count, 0);
    const defenseBody =
      defenderLostCount > 0
        ? `جيش معادي هاجم قلعتك${win ? ' وسرق جزء من مواردك' : ''} - خسرت ${defenderLostCount.toLocaleString('ar-EG')} وحدة من جيشك في الدفاع.`
        : `جيش معادي هاجم قلعتك${win ? ' وسرق جزء من مواردك' : ' بس اتصدّ من غير ما تخسر أي جندي'}.`;
    await notify(target.user_id, 'march_defended', win ? 'قلعتك اتهاجمت' : 'قلعتك اتهاجمت وصدّيتي الهجوم', defenseBody, {
      march_id: march._id,
      outcome: win ? 'lost_resources' : 'defended',
    });
  }

  // ====== الويب سوكيت: المعركة خلصت فعليًا - نفس فلسفة battle:under_attack
  // بالظبط بس عكسها (بداية → نهاية). من غير الحدث ده، الفرونت إند كان
  // بيعتمد بس على دورة الـ polling كل 12 ثانية (getLiveBattles) عشان يلاحظ
  // إن المعركة مبقتش 'battling' ويشيلها من الشاشة - يعني شريط الباور كان
  // ممكن يفضل ظاهر (متجمد على آخر رقم وصله) لحد 12 ثانية بعد الحسم الفعلي.
  // هنا بنبعت تنبيه فوري لصاحب القلعة المدافعة، ولتحالفه، ولصاحب الجيش
  // المهاجم - الثلاثة بيعتمدوا عليه عشان يشيلوا شريط الباور فورًا لحظة
  // الحسم، من غير ما يستنوا الـ polling. ======
  const battleEndedBase = { march_id: march._id, castle_id: target._id };
  emitToUser(march.user_id, 'battle:ended', { ...battleEndedBase, outcome: win ? 'win' : 'loss' });
  if (!target.is_npc && target.user_id) {
    emitToUser(target.user_id, 'battle:ended', {
      ...battleEndedBase,
      outcome: win ? 'lost_resources' : 'defended',
    });
    try {
      const defenderAlliance = await allianceService.getMyAlliance(target.user_id);
      if (defenderAlliance) {
        emitToAlliance(defenderAlliance._id, 'battle:ended', {
          ...battleEndedBase,
          defender_user_id: target.user_id,
          outcome: win ? 'lost_resources' : 'defended',
        });
      }
    } catch (err) {
      console.error('[March] failed to notify alliance of battle end:', err.message);
    }
  }

  // ====== *** إضافة: بث لأي متفرّج منضم لغرفة المعركة العامة (راجع
  // battle:watch في realtime/socket.js) إن المعركة خلصت - نفس النتيجة اللي
  // بتوصل للمدافع بالظبط (outcome من منظور المدافع). ======
  emitToBattle(march._id, 'battle:ended', {
    ...battleEndedBase,
    outcome: win ? 'lost_resources' : 'defended',
  });

  if (troopsSurvived.length > 0) {
    const distance = distanceInSlots(march.target_map_slot, march.origin_map_slot);
    const seconds = marchSeconds(troopsSurvived, distance);
    await March.create({
      user_id: march.user_id,
      origin_castle_id: march.target_castle_id,
      target_castle_id: march.origin_castle_id,
      origin_map_slot: march.target_map_slot,
      target_map_slot: march.origin_map_slot,
      target_name: null,
      target_is_npc: false,
      direction: 'return',
      status: 'traveling',
      troops: troopsSurvived,
      departed_at: now,
      arrives_at: new Date(now.getTime() + seconds * 1000),
      loot,
    });
  }
}

// ====== حل مسير عودة وصل لقلعة صاحبه: بيرجّع الناجيين لجيش القلعة والغنيمة
// لمخزون الموارد (لحد سقف التخزين المتاح وقتها)
// ====== *** فيكس Bug 3 (Recall/Return -> الجنود بيتضافوا لقلعة الهدف
// (الميدان/قلعة الحليف) بدل ما يرجعوا لقلعة صاحبهم) *** السبب الحقيقي: أي
// مسير عودة (direction: 'return') بيتعمل بعكس origin_castle_id/target_castle_id
// قصدًا وقت إنشائه (راجع الكود فوق اللي بيعمل March.create direction: 'return'
// وكمان startReturnMarchFromRaw في allianceReinforcement.service.js) - يعني
// origin_castle_id بيبقى نقطة *انطلاق* مسير العودة (الميدان / قلعة الحليف
// اللي كانت التعزيزات واقفة فيها)، وtarget_castle_id بيبقى نقطة *وصوله*
// (قلعة صاحب الجيش الفعلية). الكود القديم هنا كان بيقرا march.origin_castle_id
// (الميدان) بدل march.target_castle_id (قلعة صاحب الجيش) - فالجنود كانت
// بتتضاف غلط لقلعة الهدف/الحليف بدل ما ترجع لصاحبها. الحل: نستخدم
// target_castle_id هنا زي أي مكان تاني في الملف بيحسم "وصول" مسير
// (قارن resolveAttackArrival وresolveReinforcementArrival اللي بيستخدموا
// march.target_castle_id عشان يعرفوا القلعة اللي المسير واصل لها). ======
async function resolveReturnArrival(march) {
  const destination = await Castle.findById(march.target_castle_id);
  if (!destination) {
    march.status = 'resolved';
    await march.save();
    return;
  }

  castleService.syncResources(destination);

  for (const t of march.troops) {
    const stack = destination.army.find((a) => a.key === t.key);
    if (stack) stack.count += t.count;
    else destination.army.push({ key: t.key, count: t.count });
  }

  let lootDelivered = 0;
  for (const resource of RESOURCE_TYPES) {
    const cap = castleService.computeCapacity(destination, resource);
    const add = march.loot?.[resource] || 0;
    destination.resources[resource].stored = Math.min(cap, destination.resources[resource].stored + add);
    lootDelivered += add;
  }

  march.status = 'resolved';
  await Promise.all([destination.save(), march.save()]);

  await notify(
    march.user_id,
    'march_returned',
    'جيشك رجع من الغارة',
    lootDelivered > 0 ? `جيشك رجع سليم ومعاه ${lootDelivered} وحدة موارد.` : 'جيشك رجع لقلعتك.',
    { march_id: march._id }
  );
}

async function notify(userId, type, title, body, metadata = {}) {
  try {
    await inboxService.createSystemMessage({ userId, type, title, body, metadata });
  } catch (err) {
    console.error('[March] failed to send inbox message:', err.message);
  }
}

// ====== *** فيكس جذري: "مفيش أي إنذار بيوصل + رسائل صندوق الوارد مش
// مظبوطة" *** السبب الحقيقي: الدالة دي (زي ما كانت مكتوبة قبل كده) ما كانتش
// بتتنفذ إلا Scoped بمعرف لاعب واحد (userId)، ومنادى عليها بس من جوه نقاط
// نهاية بيستخدمها *صاحب المسير نفسه* وهو بيتصفح تطبيقه (startMarch،
// listMarches، getVisibleMarches، listIncomingAttacks، listLiveBattles). يعني
// beginBattle (المصدر الوحيد لحدث battle:under_attack + إشعار "قلعتك تحت
// الهجوم") وfinalizeAttackBattle (المصدر الوحيد لـbattle:ended + رسالة
// "كسبت/خسرت المعركة") ما كانوش بيتنفذوا خالص غير لو المهاجم بالذات فاتح
// حاجة في التطبيق في نفس التوقيت - لو قفل التطبيق بعد ما بعت جيشه (أو مبقاش
// متابع)، القلعة المستهدفة (المدافع) ما كانتش تستلم أي تنبيه ولا أي رسالة
// نظام لحد ما حد (مش بالضرورة المهاجم) يشغّل نفس الدالة بالصدفة - ده يفسّر
// كل من غياب الإنذار الفوري وتأخّر/غياب رسائل البريد.
//
// الحل: resolveDueMarchesQuery تحت بتاخد فلتر Mongo عام بدل userId مباشرة -
// resolveDueMarches(userId) لسه موجودة زي ما هي (فلتر بمستخدم واحد، بتتنادى
// من نقاط النهاية القديمة زي ما هي)، لكن resolveAllDueMarchesGlobal()
// الجديدة تحت بتشيل فلتر المستخدم خالص وبتحسم مسايرات *كل اللاعبين* مع بعض -
// دي اللي marchScheduler.js (جدولة دورية عامة، نفس فلسفة
// challenge.scheduler.js/castleBattleBroadcaster.js) بتنادي عليها كل كذا
// ثانية من غير أي اعتماد على مين فاتح التطبيق دلوقتي. كمان ضفنا try/catch
// حوالين كل مسير على حدة - فشل مسير واحد (هدف اتمسح، قاعدة بيانات مشغولة...)
// ما يوقفش باقي الدفعة، وده مهم جدًا دلوقتي إن الدفعة بقت لكل اللاعبين مش
// لاعب واحد بس. ======
async function resolveDueMarchesQuery(baseFilter) {
  const now = new Date();
  const dueArrivalIds = await March.find({ ...baseFilter, status: 'traveling', arrives_at: { $lte: now } })
    .sort({ arrives_at: 1 })
    .select('_id');

  for (const { _id } of dueArrivalIds) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const march = await March.findOneAndUpdate({ _id, status: 'traveling' }, { status: 'processing' }, { new: true });
      if (!march) continue; // eslint-disable-line no-continue -- نداء تاني حجزه فعلًا

      // ====== *** فيكس (Reinforcements must march, not teleport -
      // Requirement 1): مسير هجوم معلّم بـ reinforces_march_id هو تعزيز
      // ماشي لمسير هجوم شغال أصلًا - وصوله لازم يدمجه جوه المسير الأصلي
      // (mergeReinforcementIntoBattle) مش يبدأ معركة جديدة (beginBattle)
      // زي أي هجوم عادي. لازم الفحص ده قبل فرع direction === 'attack' العادي
      // عشان يتقطع بدري. ======
      // eslint-disable-next-line no-await-in-loop
      if (march.direction === 'attack' && march.reinforces_march_id) await mergeReinforcementIntoBattle(march);
      // eslint-disable-next-line no-await-in-loop
      else if (march.direction === 'attack') await beginBattle(march);
      // eslint-disable-next-line no-await-in-loop
      else if (march.direction === 'reinforcement') await allianceReinforcementService.resolveReinforcementArrival(march);
      // eslint-disable-next-line no-await-in-loop
      else await resolveReturnArrival(march);
    } catch (err) {
      console.error('[March] resolveDueMarches failed for arrival march', _id.toString(), err.message);
    }
  }

  const dueBattleIds = await March.find({
    ...baseFilter,
    status: 'battling',
    battle_ends_at: { $lte: now },
  })
    .sort({ battle_ends_at: 1 })
    .select('_id');

  for (const { _id } of dueBattleIds) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const march = await March.findOneAndUpdate({ _id, status: 'battling' }, { status: 'processing' }, { new: true });
      if (!march) continue; // eslint-disable-line no-continue -- نداء تاني حجزه فعلًا

      // eslint-disable-next-line no-await-in-loop
      await finalizeAttackBattle(march);
    } catch (err) {
      console.error('[March] resolveDueMarches failed for battle march', _id.toString(), err.message);
    }
  }
}

// ====== بيدوّر على كل مسايرات اللاعب اللي وصلت وقتها ولسه معلّقة، ويحسمها
// واحد واحد (بالترتيب) - بينادى عليها قبل أي عملية قراءة/كتابة متعلقة
// بالجيش أو المسايرات، نفس فلسفة completeFinishedTraining في castle.service.
// ====== *** فيكس Bug 4 (تعزيزات/جيوش بترجع بعدد أكبر من المفروض) *** السبب
// الحقيقي: الدالة دي بتتنادى من كذا نقطة مستقلة (getMyCastle، listMarches،
// getVisibleMarches) وWorldMapPage.jsx بينادي عليها كلها تقريبًا في نفس
// اللحظة (useEffect الأول + polling كل 5-20 ثانية) - يعني ممكن نداءين أو
// تلاتة يعملوا resolveDueMarches لنفس اللاعب في نفس التوقيت بالظبط. كانت
// الدالة بتعمل March.find({status:'traveling', ...}) وبعدين تعالج كل مسير
// (تضيف الجنود/تنشئ سجل تعزيز) وما تحدّثش status المسير لـ'resolved' إلا في
// آخر الدالة المعالجة (beginBattle/resolveReinforcementArrival/
// resolveReturnArrival) - يعني لو نداءين اتنفذوا في نفس اللحظة، الاتنين
// كانوا بيلاقوا نفس المسير لسه 'traveling' (لأن ولا واحد فيهم خلص لسه)
// ويعالجوه مرتين (أو تلاتة) - فالجنود كانت بتتضاف مرتين/تلاتة لنفس المسير
// الواحد. الحل: نحجز كل مسير بعملية atomic واحدة (findOneAndUpdate بشرط
// status ما زالش 'traveling'/'battling') قبل ما نعالجه - لو نداء تاني وصل
// بعدنا بلحظة، هيلاقي المسير اتحجز فعلًا (status='processing') ومش هيعالجه
// تاني. ======
async function resolveDueMarches(userId) {
  return resolveDueMarchesQuery({ user_id: userId });
}

// ====== زي resolveDueMarches بالظبط بس من غير فلتر user_id خالص - بتحسم
// مسايرات *كل اللاعبين* مع بعض في نداء واحد. مخصصة لـmarchScheduler.js
// (جدولة دورية عامة تشتغل في الخلفية طول الوقت) - مش أي نقطة نهاية REST
// بتستخدمها، عشان كده لازم تفضل بعيدة عن أي فلتر خاص بلاعب واحد. ======
async function resolveAllDueMarchesGlobal() {
  return resolveDueMarchesQuery({});
}


// ====== كل مسايرات اللاعب الحالية (ماشية + آخر مسايرات اتحسمت) جاهزة للعرض ======
async function listMarches(userId) {
  await resolveDueMarches(userId);
  return March.find({ user_id: userId }).sort({ created_at: -1 }).limit(30);
}

// ====== كل المسايرات (لأي لاعب) اللي المفروض تبان على خريطة العالم لهذا
// اللاعب - مش بس مسايراته هو. أي مسير (هجوم/عودة/تعزيز/تجميع) لسه ماشي
// وأحد طرفيه (مصدره أو هدفه) واقع جوه نطاق رؤيته (نفس نصف القطر ونفس فلسفة
// getNearbySlots المستخدمة أصلًا للقلاع القريبة - "ضباب الحرب" واحد للقلاع
// وللمسايرات مع بعض) بيبان له، سواء كان المسير بتاعه هو أو بتاع لاعب تاني
// (صديق أو عدو). كده كل اللاعبين اللي شايفين نفس المنطقة على الخريطة بيشوفوا
// نفس المسايرات الماشية فيها - مش بس صاحبها. ======
async function getVisibleMarches(userId, radiusInSlots = VISION_RADIUS_SLOTS) {
  const myCastle = await castleService.getOrCreateCastle(userId);
  await resolveDueMarches(userId);

  const slot = myCastle.map_slot;
  const radius = radiusInSlots * worldMapService.SLOT_SPACING;
  const now = new Date();

  // ====== بنستبعد أي مسير "فات وقته" (arrives_at <= الآن) من الاستعلام نفسه
  // - مش بس مسايرات اللاعب الحالي بتتحسم لحظة قراءته (resolveDueMarches بتاع
  // صاحب المسير نفسه هو اللي بيعمل ده)، فلو مسير لاعب تاني وصل وقته ولسه
  // صاحبه ما فتحش الصفحة عشان يتحسم، مش عايزينه يفضل ظاهر "ماشي" على خريطتنا
  // كـ"شبح" أكتر من اللازم. ======
  const box = (prefix) => ({
    [`${prefix}.x`]: { $gte: slot.x - radius, $lte: slot.x + radius },
    [`${prefix}.y`]: { $gte: slot.y - radius, $lte: slot.y + radius },
  });

  const marches = await March.find({
    status: 'traveling',
    arrives_at: { $gt: now },
    $or: [box('origin_map_slot'), box('target_map_slot')],
  })
    .sort({ created_at: -1 })
    .limit(300);

  const ownerUserIds = [...new Set(marches.map((m) => m.user_id.toString()))];
  const allianceMap = await castleService.buildAllianceMap(ownerUserIds);
  const ownerNameMap = await castleService.buildOwnerNameMap(ownerUserIds);
  const viewerAllianceId = allianceMap.get(userId.toString())?.id || null;

  return marches.map((m) => ({
    march: m,
    is_mine: m.user_id.toString() === userId.toString(),
    owner_name: ownerNameMap.get(m.user_id.toString()) || null,
    owner_alliance_tag: allianceMap.get(m.user_id.toString())?.tag || null,
    is_same_alliance: Boolean(
      viewerAllianceId && allianceMap.get(m.user_id.toString())?.id?.toString() === viewerAllianceId.toString()
    ),
  }));
}

// ====== نسبة فوز تقريبية "لايف" لطرف معيّن - نفس فكرة resolveBattle (كل ما
// قوتك أكبر نسبيًا من خصمك كل ما نسبتك أعلى) بس هنا رقم مستمر (0-100%) بدل
// win/lose بولياني، عشان الواجهة تقدر تعرضه كشريط تقدّم حي بيتحدّث كل ما
// حد من الطرفين يتغيّر (تعزيز جديد وصل، خسائر...). مش بديل لـ resolveBattle
// نفسها - دي بس تقدير للعرض، النتيجة الفعلية النهائية لسه بتتحسب في
// finalizeAttackBattle زي ما هي بالظبط. ======
function computeWinProbabilityPct(myPower, opponentPower) {
  const total = Math.max(1, myPower) + Math.max(1, opponentPower);
  return clampPct(Math.round((Math.max(1, myPower) / total) * 100));
}

function clampPct(value) {
  return Math.min(99, Math.max(1, value));
}

// ====== كل هجمات الأعداء الجارية على قلعة اللاعب الحالي دلوقتي (لسه ماشية
// أو دخلت مرحلة "battling" فعليًا) - ده أساس "متابعة المعركة لايف" من ناحية
// المدافع: مش بس إشعار لحظي في صندوق الوارد (notify فوق)، لكن حالة حيّة
// قابلة للاستعلام في أي وقت طول عمر الهجوم، حتى لو اللاعب قفل الصفحة ورجع
// تاني بعدين - العداد والنسبة بيتحسبوا وقت كل استعلام من تاريخ حقيقي
// (arrives_at/battle_ends_at) مش من مؤقّت فرونت إند بيتصفّر لو الصفحة اتقفلت. ======
async function listIncomingAttacks(userId) {
  const myCastle = await castleService.getOrCreateCastle(userId);
  await resolveDueMarches(userId);

  // ====== *** فيكس (Reinforcements must march, not teleport - Requirement 1/2)
  // *** نفس استثناء listLiveBattles بالظبط: مسير تعزيز (reinforces_march_id
  // مش null) رايح لهجوم شغال أصلًا على قلعتي - لو سيبناه هنا هيظهر كـ"هجوم"
  // منفصل تاني على نفس القلعة (تأثيرات "تحت الهجوم"/عدّاد في IsometricWorld.jsx
  // بتاخد أول نتيجة من liveBattles، فمهم إننا منديش أكتر من صف واحد لكل
  // معركة حقيقية شغالة). ======
  const attacks = await March.find({
    target_castle_id: myCastle._id,
    direction: 'attack',
    status: { $in: ['traveling', 'battling'] },
    reinforces_march_id: null,
  }).sort({ created_at: -1 });

  if (attacks.length === 0) return [];

  const attackerUserIds = [...new Set(attacks.filter((m) => m.user_id).map((m) => m.user_id.toString()))];
  const ownerNameMap = await castleService.buildOwnerNameMap(attackerUserIds);

  const { defenderPower } = await computeDefensePower(myCastle);

  return attacks.map((march) => {
    const attackerPower = armyStatTotal(march.troops, 'attack');
    return {
      march_id: march._id,
      status: march.status, // 'traveling' = لسه في الطريق، 'battling' = المعركة شغالة فعليًا
      departed_at: march.departed_at,
      arrives_at: march.arrives_at,
      battle_ends_at: march.battle_ends_at,
      attacker_name: ownerNameMap.get(march.user_id?.toString()) || 'لاعب مجهول',
      // نسبة نجاة تقديرية للمدافع (يعني للاعب اللي بيقرا الرد ده) - مبنية
      // على قوة دفاعه الحالية (بتحصيناته وتعزيزاته دلوقتي) مقابل قوة هجوم
      // الجيش القادم، وممكن تتغيّر لو تعزيز جديد وصل قبل ما المعركة تخلص.
      my_win_probability_pct: computeWinProbabilityPct(defenderPower, attackerPower),
    };
  });
}

// ====== كل معارك اللاعب الحالي "الشغالة لايف" دلوقتي - سواء هو المهاجم
// (جيشه ماشي/بيحارب في قلعة حد تاني) أو المدافع (قلعته تحت هجوم). ده
// المصدر الوحيد اللي عداد المعركة في الفرونت إند بيعتمد عليه - بيرجع وقت
// حقيقي (مش عداد بيتصفّر لو قفلت الصفحة) ونسبة فوز حيّة لكل معركة. ======
async function listLiveBattles(userId) {
  await resolveDueMarches(userId);

  // ====== *** فيكس (Reinforcements must march, not teleport - Requirement 1/3)
  // *** مسير تعزيز (reinforces_march_id مش null) هو رحلة جيش بس، مش معركة
  // مستقلة - لو سيبناه هنا هيظهر كصف "🚶 الجيش في الطريق" منفصل جنب صف
  // "⚔️ معركة جارية" بتاع المعركة الأصلية اللي هو أصلًا رايح يعزّزها، ويدي
  // انطباع غلط إن فيه معركتين شغالتين على نفس الهدف. بنستثنيه هنا (reinforces_march_id: null)
  // - لسه بيظهر كخط ماشي على الخريطة نفسها (getVisibleMarches ماعندهاش نفس
  // الاستثناء، وده مقصود: المطلوب إنه "يبان ماشي على الخريطة" بس مش كـ"معركة"
  // منفصلة في القوائم/التقارير). ======
  const outgoing = await March.find({
    user_id: userId,
    direction: 'attack',
    status: { $in: ['traveling', 'battling'] },
    reinforces_march_id: null,
  }).sort({ created_at: -1 });

  const outgoingFormatted = await Promise.all(
    outgoing.map(async (march) => {
      const target = await Castle.findById(march.target_castle_id).select('user_id is_npc npc_name buildings army');
      const attackerPower = armyStatTotal(march.troops, 'attack');
      let defenderPower = 0;
      let opponentName = march.target_name || 'هدف مجهول';
      if (target) {
        opponentName = target.is_npc ? target.npc_name : opponentName;
        if (!target.is_npc) {
          const nameMap = await castleService.buildOwnerNameMap([target.user_id]);
          opponentName = nameMap.get(target.user_id?.toString()) || opponentName;
        }
        ({ defenderPower } = await computeDefensePower(target));
      }
      return {
        march_id: march._id,
        role: 'attacker',
        status: march.status,
        departed_at: march.departed_at,
        arrives_at: march.arrives_at,
        battle_ends_at: march.battle_ends_at,
        opponent_name: opponentName,
        // ====== *** إضافة (Castle Under Attack - task 1): رقم القلعة الهدف -
        // عشان الفرونت إند يقدر يظهّر تأثيرات "تحت الهجوم" (سيوف/دخان/نبضة
        // حمراء) على القلعة الصح على الخريطة لو المهاجم بيزور/شايف قلعة
        // هدفه (nearbyCastles) - قبل كده مكانش متاح غير للمدافع (قلعته هو
        // نفسه دايمًا). ******
        target_castle_id: march.target_castle_id,
        my_win_probability_pct: computeWinProbabilityPct(attackerPower, defenderPower),
      };
    })
  );

  const incoming = await listIncomingAttacks(userId);
  const incomingFormatted = incoming.map((atk) => ({
    march_id: atk.march_id,
    role: 'defender',
    status: atk.status,
    departed_at: atk.departed_at,
    arrives_at: atk.arrives_at,
    battle_ends_at: atk.battle_ends_at,
    opponent_name: atk.attacker_name,
    my_win_probability_pct: atk.my_win_probability_pct,
  }));

  return [...outgoingFormatted, ...incomingFormatted];
}

// ====== *** إضافة: مشاهدة معركة معيّنة لايف بمعرفة march_id بس - من غير أي
// شرط ملكية (مش لازم تكون صاحب القلعة المهاجَمة ولا حليفه ولا المهاجم نفسه).
// المستخدَمة من endpoint عام جديد (GET /castle/battles/:marchId/live) عشان
// أي زائر يقدر يفتح صفحة "متابعة المعركة" لأي قلعة تحت هجوم دلوقتي. بترجع
// null لو المسير مش موجود أو مش هجوم شغال حاليًا (traveling/battling). ******
async function getPublicBattleView(marchId) {
  const march = await March.findById(marchId);
  if (!march || march.direction !== 'attack') return null;
  if (!['traveling', 'battling'].includes(march.status)) return null;

  const target = await Castle.findById(march.target_castle_id).select('user_id is_npc npc_name army buildings');
  const attackerNameMap = await castleService.buildOwnerNameMap([march.user_id]);

  let opponentName = march.target_name || 'هدف مجهول';
  let defenderPower = 0;
  let powerPct = 100;
  if (target) {
    opponentName = target.is_npc ? target.npc_name : opponentName;
    if (!target.is_npc && target.user_id) {
      const nameMap = await castleService.buildOwnerNameMap([target.user_id]);
      opponentName = nameMap.get(target.user_id.toString()) || opponentName;
    }
    ({ defenderPower } = await computeDefensePower(target));
    if (march.status === 'battling') {
      ({ power_pct: powerPct } = await computeLiveCastlePowerPct(target, march));
    }
  }

  const attackerPower = armyStatTotal(march.troops, 'attack');

  return {
    march_id: march._id,
    status: march.status, // 'traveling' = الجيش لسه في الطريق، 'battling' = المعركة شغالة لايف
    attacker_name: attackerNameMap.get(march.user_id?.toString()) || 'لاعب مجهول',
    defender_name: opponentName,
    arrives_at: march.arrives_at,
    battle_ends_at: march.battle_ends_at,
    power_pct: march.status === 'battling' ? powerPct : 100,
    attacker_power: attackerPower,
    defender_power: defenderPower,
  };
}

module.exports = {
  startMarch,
  recallMarch,
  resolveDueMarches,
  resolveAllDueMarchesGlobal,
  listMarches,
  getVisibleMarches,
  listIncomingAttacks,
  listLiveBattles,
  getPublicBattleView,
  // ====== مُصدّرة عشان allianceReinforcement.service.js تقدر تحسب مدة مسير
  // التعزيز بنفس منطق مسير الهجوم بالظبط (نفس المسافة/نفس marchSeconds) من
  // غير ما تكرر الحساب - "Reuse existing march logic whenever possible". ======
  distanceInSlots,
  // ====== مُصدّرة عشان castleBattleBroadcaster.js (البث الدوري لباور
  // القلعة) وallianceReinforcement.service.js (تحديث فوري وقت وصول تعزيز)
  // يقدروا يحسبوا نفس القيمة بالظبط من غير ما يكرروا المعادلة. ======
  computeDefensePower,
  computeLiveCastlePowerPct,
};