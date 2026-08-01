const Battle = require('./battle.model');
const Castle = require('../castle/castle.model');
const castleService = require('../castle/castle.service');
const { GRID_SIZE } = require('../castle/castle.config');
const { nextSequence } = require('../common/counter.service');
const {
  BATTLE_STATUS,
  BATTLE_MODE,
  BATTLE_ID_PREFIX,
  BATTLE_ID_COUNTER_NAME,
  BATTLE_ID_OFFSET,
  isValidTransition,
  generateRandomSeed,
} = require('./battle.config');
const { buildAttackerSnapshot, buildDefenderSnapshot, snapshotTroopStacks } = require('./battle.snapshot.service');
const battlePlannerService = require('../army/battlePlanner.service');
// ====== Phase 2: Battle Integration & Persistence - المحرك المتزامن الجديد
// (modules/battleResolution، لسه Phase 1 مستقل ومش متكامل مع حاجة) - بيتستخدم
// هنا بس عشان يحسم نتيجة المعركة النهائية لحظة ما مسير الهجوم يوصل (راجع
// resolveBattleForMarch تحت وmarch.service.resolveAttackArrival). مفيش أي
// تعديل على الموديول نفسه - استهلاك بس، زي أي consumer تاني. ======
const battleResolutionEngine = require('../battleResolution');
// ====== لو محرك التيك (Simulation/Rule/Combat) شغال في الذاكرة لمعركة معينة
// (نادر - يعني اللاعب فتح صفحة المعركة وضغط "ابدأ" قبل ما المسير يوصل
// فعليًا)، لازم نوقفه قبل ما نكتب نتيجة المحرك المتزامن فوق نفس المستند -
// عشان الاتنين ميتصادموش على نفس الـ Battle document. ======
const { stopBattleRunner, isBattleRunning } = require('./battle.runner');
// ====== نظام الدفاع الحقيقي (walls/towers/gates/traps) - defenseService هنا
// بيتستخدم للقراءة بس (getDefenseByCastleId، نفس اللي viewDefense في
// defense.controller.js بيستخدمها) عشان نجيب القطع الدفاعية الحقيقية بتاعة
// قلعة المدافع وقت بدء الهجوم، ونحطها جوه اللقطة (snapshot) بدل ما تفضل
// فاضية. لو القلعة دي لسه معملتش أي مستند دفاع خالص، بترجع null والـ
// snapshot.service بيتعامل معاها كمصفوفة فاضية (نفس السلوك القديم بالظبط). ======
const defenseService = require('../defense/defense.service');
// ====== الهيرو اللي اللاعب اختاره قبل بداية اللعب (راجع hero.config.js) -
// بيتحوّل هنا لشكل "commanders[]" العام اللي buildAttackerSnapshot/
// buildDefenderSnapshot أصلًا بيستقبلاه (commanderSnapshotSchema) - مصدر
// البونص الحقيقي الوحيد اللي بيوصل لمحرك حسم المعارك (battleResolutionEngine
// يقرا bonuses.attack_percent/defense_percent من نفس الحقل ده لاحقًا). ======
const { heroToBattleInput } = require('../castle/hero.config');
// ====== Phase 6: Battle Consequences - بيطبّق نتيجة battleResolutionEngine
// (اللي resolveBattleForMarch تحت بتحسبها وتحفظها في battle.battle_result)
// فعليًا على العالم الحي (موارد/جنود/أسوار/إحصائيات) - راجع
// modules/battleConsequences/battleConsequences.service.js لتفاصيل كاملة.
// استهلاك بس هنا (زي أي consumer تاني لنتيجة المعركة) - مفيش أي منطق حساب
// جديد في battle.service.js نفسها. ======
const battleConsequencesService = require('../battleConsequences/battleConsequences.service');

// ====== ترتيب خطوط التشكيل (Battle Formation lines من Battle Planner 2.0)
// لعمود مبدئي رقمي - مستخدم بس عشان نترجم battle_formation (الشكل الغني:
// line/slot_index) لشكل snapshotFormation الأبسط (row/column) اللي محرك
// المحاكاة (Simulation Engine) بيفهمه فعليًا دلوقتي - مفيش أي تعديل على
// snapshotFormation أو المحرك نفسه هنا، بس تحويل بيانات. ======
const FORMATION_LINE_TO_ROW = { front_line: 0, middle_line: 1, back_line: 2 };

// ====== لو المهاجم اختار خطة معركة حقيقية (Battle Planner 2.0) وقت
// الهجوم، بنجيبها ونترجمها لنفس الشكل البسيط اللي buildAttackerSnapshot
// بيتوقعه (formation: {type, slots:[{troop_key,row,column}]}, battlePlan:
// {objective, orders, notes}) - ده أفضل نقل ممكن للبيانات الحقيقية للخطة من
// غير ما نمس Simulation/Rule/Combat Engines (لسه مش بتستهلك التشكيل ده
// فعليًا في حساب مواقع الوحدات - راجع تعليق buildUnitGroupsFromSnapshot في
// simulationEngine.js - ده شغل مستقبلي لهم مش للفرونت إند). أي فشل هنا
// (خطة محذوفة/مش بتاعة المستخدم) بيرجّع null بهدوء بدل ما يوقف الهجوم. ======
async function resolveBattlePlanForAttack(userId, battlePlanId) {
  if (!battlePlanId || !userId) return { formation: null, battlePlan: null };
  try {
    const plan = await battlePlannerService.getPlanById(userId, battlePlanId);
    const slots = (plan.battle_formation || [])
      .filter((s) => s && s.troop_key)
      .map((s) => ({
        troop_key: s.troop_key,
        row: FORMATION_LINE_TO_ROW[s.line] ?? 1,
        column: s.slot_index ?? 0,
      }));
    return {
      formation: { type: 'battle_plan', slots },
      battlePlan: { objective: 'loot', orders: [], notes: plan.name || null },
    };
  } catch (err) {
    console.error('[Battle] failed to resolve battle plan for attack:', err.message);
    return { formation: null, battlePlan: null };
  }
}

// ====== توليد battleId فريد وقابل للعرض (زي "BTL-100001") - عن طريق نفس
// عداد التسلسل الـ atomic المستخدم لـ kingdom_id في castle.service. ======
async function generateBattleId() {
  const seq = await nextSequence(BATTLE_ID_COUNTER_NAME, BATTLE_ID_OFFSET);
  return `${BATTLE_ID_PREFIX}-${seq}`;
}

// ====== إنشاء معركة جديدة (Battle Instance) - ده جوهر "Battle Foundation":
// بياخد لقطة كاملة (snapshot) من الطرفين لحظة الاستدعاء، بحيث أي تعديل
// لاحق (بناء، ترقية، تدريب، تعديل توازن...) ميأثرش على المعركة دي وهي
// مسجّلة/شغالة. المعركة بتتولد بحالة "preparing" دايمًا - باقي الأنظمة
// (Planner/Simulation/Combat) هي اللي هتنقلها لحالات تانية لاحقًا. ======
async function createBattle({
  attackerCastle,
  defenderCastle,
  troops,
  commanders,
  formation,
  battlePlan,
  marchId = null,
  attackerName = null,
  defenderName = null,
  battleMode = BATTLE_MODE.PVP,
  // ====== Phase 12: Alliance Reinforcements - تعزيزات حلفاء الدافع الواقفة
  // في قلعته وقت بدء الهجوم (شكل AllianceReinforcement documents:
  // {origin_user_id, troops}) - بتتحط جوه لقطة الدافع (buildDefenderSnapshot)
  // زي أي جيش واقف تاني، مع تمييز ملكيتها. مصفوفة فاضية افتراضيًا (نفس سلوك
  // المعركة قبل الإضافة دي بالظبط لو مفيش تعزيزات). ======
  reinforcements = [],
}) {
  if (!attackerCastle || !defenderCastle) {
    throw new Error('لازم قلعة المهاجم وقلعة الدافع عشان تتسجّل المعركة');
  }
  if (attackerCastle._id.toString() === defenderCastle._id.toString()) {
    throw new Error('متقدرش تعمل معركة على نفس القلعة');
  }

  const battleId = await generateBattleId();

  // ====== الهيرو الحقيقي بتاع كل طرف (لو اختار واحد - hero_key على مستند
  // القلعة) - بيحل محل أي commanders اتبعتت صراحة (لسه محدش بيبعت حاجة
  // فعلية غير الهيرو ده، وcreateBattleForUser اللي بتاخد commanders برضه
  // من الطلب مباشرة تفضل شغالة زي ما هي لو حد استخدمها يومًا). ======
  const attackerCommanders =
    commanders && commanders.length > 0 ? commanders : heroToBattleInput(attackerCastle.hero_key);
  const defenderCommanders = heroToBattleInput(defenderCastle.hero_key);

  const attackerSnapshot = buildAttackerSnapshot({ troops, commanders: attackerCommanders, formation, battlePlan });

  // ====== قراءة مستند دفاع المدافع (لو موجود) - فشل القراءة هنا (استثناء
  // غير متوقع) مايوقفش بدء الهجوم، بيسجّل خطأ ويكمل بمصفوفة فاضية بس، نفس
  // فلسفة "خطأ في جزء واحد مايوقفش الباقي" المستخدمة أصلًا مع تحميل خطة
  // المعركة (resolveBattlePlanForAttack فوق). ======
  let defenseStructures = [];
  try {
    const defense = await defenseService.getDefenseByCastleId(defenderCastle._id);
    defenseStructures = defense ? defense.structures : [];
  } catch (err) {
    console.error('[Battle] تعذر تحميل القطع الدفاعية بتاعة المدافع:', err.message);
  }

  const defenderSnapshot = buildDefenderSnapshot(defenderCastle, {
    gridSize: GRID_SIZE,
    defenseStructures,
    reinforcements,
    commanders: defenderCommanders,
  });

  // ====== لو محدش بعت اسم مهاجم صراحة (الحالة العادية لأي هجوم عادي من
  // الخريطة - registerBattleFoundation في march.service مابيبعتش attackerName
  // خالص)، بنجيبه إحنا من صاحب قلعة المهاجم نفسه (أو npc_name لو قلعة NPC)
  // بدل ما نسيب الحقل null ويظهر "مهاجم مجهول" في تقرير المعركة لصاحب
  // القلعة المدافعة (getBattleReport في الأسفل). ======
  let resolvedAttackerName = attackerName;
  if (!resolvedAttackerName) {
    if (attackerCastle.is_npc) {
      resolvedAttackerName = attackerCastle.npc_name || null;
    } else if (attackerCastle.user_id) {
      const nameMap = await castleService.buildOwnerNameMap([attackerCastle.user_id]);
      resolvedAttackerName = nameMap.get(attackerCastle.user_id.toString()) || null;
    }
  }

  // ====== نفس منطق resolvedAttackerName بالظبط لكن للمدافع - registerBattleFoundation
  // في march.service مابتبعتش defenderName خالص (الحالة العادية لأي هجوم عادي من
  // الخريطة)، فمن غير الـ resolve ده الاسم كان بيفضل null لأي قلعة دافع ملك لاعب
  // حقيقي، وده كان بيخلي الفرونت إند يعرض "قلعة العدو" (fallback) بدل اسم اللاعب
  // الفعلي في تقرير المعركة لصاحب القلعة المهاجمة. ======
  let resolvedDefenderName = defenderName;
  if (!resolvedDefenderName) {
    if (defenderCastle.is_npc) {
      resolvedDefenderName = defenderCastle.npc_name || null;
    } else if (defenderCastle.user_id) {
      const nameMap = await castleService.buildOwnerNameMap([defenderCastle.user_id]);
      resolvedDefenderName = nameMap.get(defenderCastle.user_id.toString()) || null;
    }
  }

  const battle = await Battle.create({
    battle_id: battleId,
    march_id: marchId,
    attacker: {
      user_id: attackerCastle.user_id || null,
      castle_id: attackerCastle._id,
      is_npc: Boolean(attackerCastle.is_npc),
      name: resolvedAttackerName,
    },
    defender: {
      user_id: defenderCastle.user_id || null,
      castle_id: defenderCastle._id,
      is_npc: Boolean(defenderCastle.is_npc),
      name: resolvedDefenderName,
    },
    snapshot: {
      attacker: attackerSnapshot,
      defender: defenderSnapshot,
    },
    status: BATTLE_STATUS.PREPARING,

    // ====== ميتاداتا المعركة - راجع battle.config.js ======
    // random_seed لازم يتولّد هنا وقت الإنشاء بالظبط (مش default عام في
    // الموديل) عشان كل معركة تاخد بذرة مختلفة فعليًا؛ battle_version و
    // battle_events بياخدوا الـ default بتاعهم من الموديل نفسه (Battle.model.js).
    random_seed: generateRandomSeed(),
    battle_mode: Object.values(BATTLE_MODE).includes(battleMode) ? battleMode : BATTLE_MODE.PVP,
  });

  return battle;
}

// ====== نسخة مساعدة تُستخدم مباشرة من نظام المسايرات (march.service) وقت
// ما مسير هجوم جديد بيتسجّل - "Create a Battle Instance whenever an attack
// starts". بتاخد كائنات القلعة (attacker/defender) جاهزة عشان مفيش داعي
// تتقرأ مرة تانية من قاعدة البيانات هنا. أي خطأ هنا لازم يتمسك بره الدالة
// دي (زي أي إشعار جانبي تاني في march.service) عشان فشل تسجيل "لقطة
// المعركة" ميوقفش الهجوم نفسه - ده أساس بس، مش جزء إلزامي من مسار اللعب لسه. ======
async function createBattleFromAttack({
  attackerCastle,
  defenderCastle,
  troops,
  marchId,
  battleMode,
  battlePlanId,
  reinforcements = [],
}) {
  const { formation, battlePlan } = await resolveBattlePlanForAttack(attackerCastle.user_id, battlePlanId);
  return createBattle({
    attackerCastle,
    defenderCastle,
    troops,
    // ====== [] هنا مقصودة: createBattle فوق بتفهمها "مفيش commanders
    // اتبعتت صراحة" وبترجع لهيرو صاحب قلعة المهاجم الحقيقي (attackerCastle.hero_key)
    // تلقائيًا - نفس مسار الهجوم العادي من الخريطة الرئيسية. ======
    commanders: [],
    formation,
    battlePlan,
    marchId,
    battleMode: battleMode ?? BATTLE_MODE.PVP,
    reinforcements,
  });
}

// ====== Requirement 1 (One Active Battle) - *** فيكس (Reinforcements must
// march, not teleport): دلوقتي بتتنادى من march.service.js::mergeReinforcementIntoBattle
// بس - يعني وقت ما مسير تعزيز (reinforces_march_id) يوصل فعليًا لهدفه بعد
// رحلة حقيقية على الخريطة، مش لحظة إرسال التعزيز زي ما كان قبل كده. بنلاقي
// المعركة الأصلية المرتبطة بالمسير الأصلي (march_id ثابت زي ما هو -
// march.service هي اللي بتدمج الجيش الجديد جوه نفس مستند March، مش هنا)
// ونحدّث بس snapshot.attacker.troops بتاعها عشان يعكس إجمالي الجيش المدموج
// (القديم + التعزيز اللي وصل فعليًا) - مفيش أي حسم نتيجة أو تغيير حالة أو
// تعديل على snapshot.defender هنا خالص، ده بالظبط نفس مبدأ "لا تحسب نتيجة
// المعركة فور الإرسال" المطبّق على أي هجوم عادي. لو المعركة دي خلصت فعلًا
// (finished) قبل ما التعزيز يوصل هنا (سباق نادر) بنرجّعها زي ما هي من غير
// أي تعديل - مفيش داعي نلمس مستند اتحسم خلاص. ======
async function reinforceBattleForMarch(marchId, mergedTroops) {
  const battle = await Battle.findOne({ march_id: marchId });
  if (!battle) return null;

  if (battle.status === BATTLE_STATUS.FINISHED || battle.status === BATTLE_STATUS.CANCELLED) {
    return battle;
  }

  battle.snapshot.attacker.troops = snapshotTroopStacks(mergedTroops);
  await battle.save();
  return battle;
}

// ====== نسخة مساعدة تُستخدم من الـ API مباشرة (battle.controller) - بتاخد
// userId بتاع المهاجم (اللاعب المسجّل دخوله) ومعرّف قلعة الدافع، وبتجيب
// المستندين الحقيقيين من قاعدة البيانات قبل ما تبني اللقطة. مفيدة لأي حالة
// حابين نسجّل فيها معركة مباشرة من غير ما نمر بنظام المسايرات الحالي. ======
async function createBattleForUser(
  userId,
  { defenderCastleId, troops, commanders, formation, battlePlan, marchId, battleMode }
) {
  const attackerCastle = await castleService.getOrCreateCastle(userId);

  const defenderCastle = await Castle.findById(defenderCastleId);
  if (!defenderCastle) throw new Error('قلعة الدافع دي مش موجودة');

  // نفس فلسفة march.service.resolveAttackArrival: نتأكد إن موارد الدافع
  // متزامنة (syncResources) قبل ما ناخد لقطة منها، عشان الرقم يكون دقيق.
  castleService.syncResources(defenderCastle);
  await defenderCastle.save();

  return createBattle({
    attackerCastle,
    defenderCastle,
    troops,
    commanders,
    formation,
    battlePlan,
    marchId,
    battleMode,
  });
}

// ====== جيب معركة عن طريق battleId العام (مش _id بتاع Mongo) ======
async function getBattleByBattleId(battleId) {
  const battle = await Battle.findOne({ battle_id: battleId });
  if (!battle) throw new Error('المعركة دي مش موجودة');
  return battle;
}

// ====== جيب معركة عن طريق march_id - ده بيخلي الفرونت إند يقدر "يسترجع"
// المعركة المرتبطة بمسير معيّن من الباك إند دايمًا (حتى لو الصفحة اترفريشت
// أو الحالة المحلية (client state) ضاعت)، بدل ما يعتمد على أي mapping
// محفوظ في الفرونت إند بس. march_id أصلاً حقل موجود في battle.model من أول
// يوم (راجع battleSchema.march_id) - الفانكشن دي بس بتستخدمه للقراءة، مفيش
// أي حقل/موديل جديد اتضاف هنا. ======
async function getBattleByMarchId(marchId, requestingUser) {
  const battle = await Battle.findOne({ march_id: marchId });
  if (!battle) return null;

  const userId = requestingUser?._id?.toString();
  const isAttacker = battle.attacker.user_id && battle.attacker.user_id.toString() === userId;
  const isDefender = battle.defender.user_id && battle.defender.user_id.toString() === userId;
  const isAdmin = requestingUser?.role === 'admin';

  if (!isAttacker && !isDefender && !isAdmin) {
    throw new Error('مالكش صلاحية تشوف المعركة دي');
  }

  return battle;
}

// ====== نفس الفانكشن فوق بس بيتأكد كمان إن اللي بيطلب المعركة طرف فعلي
// فيها (مهاجم أو دافع) أو أدمن - عشان محدش يقدر يشوف تفاصيل معركة/لقطة مش
// بتاعته. ======
async function getBattleForParticipant(battleId, requestingUser) {
  const battle = await getBattleByBattleId(battleId);

  const userId = requestingUser?._id?.toString();
  const isAttacker = battle.attacker.user_id && battle.attacker.user_id.toString() === userId;
  const isDefender = battle.defender.user_id && battle.defender.user_id.toString() === userId;
  const isAdmin = requestingUser?.role === 'admin';

  if (!isAttacker && !isDefender && !isAdmin) {
    throw new Error('مالكش صلاحية تشوف المعركة دي');
  }

  return battle;
}

// ====== كل معارك لاعب معيّن - كمهاجم و/أو كمدافع، مع تصفية اختيارية بالحالة ======
async function listBattlesForUser(userId, { role = 'all', status = null, limit = 30 } = {}) {
  const query = {};

  if (role === 'attacker') query['attacker.user_id'] = userId;
  else if (role === 'defender') query['defender.user_id'] = userId;
  else query.$or = [{ 'attacker.user_id': userId }, { 'defender.user_id': userId }];

  if (status) query.status = status;

  return Battle.find(query).sort({ created_at: -1 }).limit(limit);
}

// ====== Battle Reports removal - listBattleHistoryForUser/formatHistoryCard
// (سجل المعارك المنتهية بصفحات/فلترة) اتشالوا بالكامل - مفيش أي راوت أو
// consumer تاني ليهم بعد ما GET /battles/history اتشال من battle.routes.js.
// تقرير أي معركة منتهية بقى بيوصل كرسالة بريد كاملة (راجع
// battleConsequences.service.js::sendBattleMail) بدل سجل/endpoint منفصل. ======

// ====== الانتقال بين حالات المعركة (Battle Lifecycle) - بيتأكد إن الانتقال
// المطلوب مسموح (راجع ALLOWED_TRANSITIONS في battle.config)، وبيحدّث
// start_time/finish_time تلقائيًا في اللحظات المناسبة. مفيش أي منطق قتال
// هنا - مجرد إدارة حالة (state machine) نضيفة تقدر باقي الأنظمة تبني فوقها. ======
async function transitionStatus(battleId, requestingUser, newStatus) {
  const battle = await getBattleForParticipant(battleId, requestingUser);

  if (!isValidTransition(battle.status, newStatus)) {
    throw new Error(`متقدرش تنقل المعركة من "${battle.status}" لـ "${newStatus}"`);
  }

  battle.status = newStatus;

  if (newStatus === BATTLE_STATUS.RUNNING && !battle.start_time) {
    battle.start_time = new Date();
  }
  if (newStatus === BATTLE_STATUS.FINISHED || newStatus === BATTLE_STATUS.CANCELLED) {
    battle.finish_time = new Date();
  }

  await battle.save();
  return battle;
}

// ====== تحديث عام لحالة المحاكاة الحية (current_state) والتيك الحالي -
// ده مجرد "توصيلة" (plumbing) جاهزة عشان Simulation Engine يستخدمها لاحقًا،
// مفيش أي حساب قتال بيحصل هنا. current_state بيتعمله merge سطحي (shallow)
// مش استبدال كامل، عشان أي جزء منها ميتمسحش لو التحديث الجاي مغطيش كل الحقول. ======
async function updateCurrentState(battleId, requestingUser, { currentState, currentTick } = {}) {
  const battle = await getBattleForParticipant(battleId, requestingUser);

  if (battle.status !== BATTLE_STATUS.RUNNING && battle.status !== BATTLE_STATUS.PAUSED) {
    throw new Error('متقدرش تحدّث حالة معركة مش شغالة (لازم تكون running أو paused)');
  }

  if (currentState && typeof currentState === 'object') {
    battle.current_state = { ...(battle.current_state || {}), ...currentState };
  }
  if (Number.isFinite(Number(currentTick))) {
    battle.current_tick = Number(currentTick);
  }

  await battle.save();
  return battle;
}

// ====== إلغاء معركة لسه ما بدأتش فعليًا (preparing/ready) - مثلاً لو
// المهاجم سحب مسيره قبل ما يوصل. مش بيمسح المعركة، بيوثّقها كـ"cancelled"
// عشان تفضل موجودة في السجل. ======
async function cancelBattle(battleId, requestingUser) {
  return transitionStatus(battleId, requestingUser, BATTLE_STATUS.CANCELLED);
}

// ---------------------------------------------------------------------------
// Phase 2: Battle Integration & Persistence
// ---------------------------------------------------------------------------
// بينفّذ Battle Resolution Engine الجديد (modules/battleResolution -
// resolveBattle) على نفس اللقطة (snapshot) المجمّدة اللي اتسجّلت أصلًا وقت
// بدء الهجوم (battle.snapshot - راجع battle.snapshot.service.js)، ويحفظ
// النتيجة الكاملة على نفس مستند Battle، وينقلها لحالة "finished". بينادى
// عليها من march.service.resolveAttackArrival لحظة ما مسير الهجوم يوصل
// فعليًا - نفس اللحظة اللي "الهجوم بيوصل هدفه" فيها. مفيش أي تعديل على منطق
// المسير الاقتصادي نفسه (خسائر/غنيمة march.report) - دي نتيجة "رسمية" بتتسجّل
// بالتوازي على مستند Battle عشان الـ API الحالي (GET /api/battles/:battleId
// وGET /api/battles/by-march/:marchId) يقدر يرجّعها من غير أي راوت جديد.
//
// idempotent: لو المعركة دي اتحسمت خلاص (finished) بترجع نفس المستند من غير
// ما تعيد حساب النتيجة تاني (المحرك فيه عنصر عشوائي ±3% - إعادة الحساب كانت
// هتنتج نتيجة مختلفة كل مرة). لو مفيش Battle Foundation اتسجّل أصلًا لهذا
// المسير (مثلاً فشل تسجيله وقت البدء - registerBattleFoundation في
// march.service.js بيبلع الخطأ ده)، بترجع null بهدوء - مش خطأ يوقف مسار
// المسير نفسه.
async function resolveBattleForMarch(marchId) {
  const battle = await Battle.findOne({ march_id: marchId });
  if (!battle) return null;

  if (battle.status === BATTLE_STATUS.FINISHED) return battle;

  // لو محرك التيك شغال ليها بالفعل في الذاكرة (سباق نادر بين اللاعب اللي
  // ضغط "ابدأ المعركة" ووصول المسير)، نوقفه الأول عشان مفيش كتابتين متزامنتين
  // على نفس المستند.
  if (isBattleRunning(battle.battle_id)) {
    stopBattleRunner(battle.battle_id);
  }

  const snapshot = battle.snapshot || {};
  const attackerInput = {
    troops: snapshot.attacker?.troops || [],
    battlePlan: snapshot.attacker?.battle_plan || null,
    // ====== بونص الهيرو الحقيقي - snapshot.commanders أصلًا بنفس شكل
    // "heroes[].bonuses" اللي bonusAggregator.js بيفهمه (راجع
    // hero.config.heroToBattleInput وbattle.snapshot.service.buildAttackerSnapshot/
    // buildDefenderSnapshot) - مجرد تمرير، مفيش أي تحويل هنا. ======
    heroes: snapshot.attacker?.commanders || [],
  };
  const defenderInput = {
    troops: snapshot.defender?.troops || [],
    heroes: snapshot.defender?.commanders || [],
    buildings: snapshot.defender?.buildings || [],
    wall: snapshot.defender?.walls || [],
    towers: snapshot.defender?.towers || [],
    resources: snapshot.defender?.resources || {},
  };

  const result = battleResolutionEngine.resolveBattle(attackerInput, defenderInput);

  battle.status = BATTLE_STATUS.FINISHED;
  battle.winner = result.winner;
  battle.finish_time = new Date();
  // battle_events أصلًا حقل موجود من قبل (فاضي لحد دلوقتي) - ده أول حاجة
  // بتملّيه فعليًا، بنفس السرد اللي EventGenerator بتاع المحرك رجّعه.
  battle.battle_events = result.key_battle_events;
  // ====== battle_result بيتخزّن هنا بنفس شكل نتيجة battleResolutionEngine
  // بالظبط (winner/final_scores/key_battle_events/defender_participants) -
  // ده الشكل اللي كل الـ consumers الحقيقيين (ReportsMailPanel.jsx في
  // الفرونت إند، وbattleConsequencesService.updateLifetimeStats في الباك إند)
  // بيقروه فعليًا. attack_score/defense_score القدام اتسابوا زي ما هما عشان
  // listBattleHistoryForUser القديمة تفضل شغالة زي ما هي. مفيش أي تعديل على
  // الحساب نفسه هنا - كله زي ما هو راجع من resolveBattle، هنا بس تسمية/تخزين. ======
  battle.battle_result = {
    winner: result.winner,
    final_scores: result.final_scores,
    attack_score: result.final_scores.attacker,
    defense_score: result.final_scores.defender,
    power_breakdown: result.power_breakdown,
    casualties: result.casualties,
    remaining_troops: result.remaining_troops,
    defender_participants: result.defender_participants,
    loot: result.loot,
    building_damage: result.building_damage,
    wall_damage: result.wall_damage,
    tower_damage: result.tower_damage,
    battle_duration_seconds: result.battle_duration_seconds,
    key_battle_events: result.key_battle_events,
    resolved_at: new Date(),
  };

  await battle.save();

  // ====== Phase 6: Battle Consequences - لحظة ما battle_result يتحفظ
  // فعليًا هي نفس اللحظة اللي نتيجته المفروض تتطبق فيها على العالم الحي
  // (موارد/جنود/أسوار/إحصائيات). مغلّفة بـ try/catch زي كل تكامل اختياري
  // تاني في المشروع ده (registerBattleFoundation/finalizeBattleResolution في
  // march.service.js نفس الفلسفة بالظبط) - فشل تطبيق النتائج لوحده مايوقفش
  // حسم المعركة نفسها (battle.battle_result أصلًا اتحفظ فوق بنجاح). ======
  try {
    await battleConsequencesService.applyBattleConsequences(battle);
  } catch (err) {
    console.error('[Battle] failed to apply battle consequences:', err.message);
  }

  // ====== نظام المهام اليومية - تتبع مهمة "اكسب معركة هجومية" لو المهاجم
  // لاعب حقيقي (مش NPC) وكسب المعركة دي بالذات. مغلّفة بـ try/catch زي أي
  // تكامل اختياري تاني هنا (applyBattleConsequences فوق نفس الفلسفة). ======
  try {
    if (battle.winner === 'attacker' && !battle.attacker?.is_npc && battle.attacker?.user_id) {
      // eslint-disable-next-line global-require
      const questService = require('../quests/quest.service');
      await questService.recordQuestProgress(battle.attacker.user_id, 'attack_win', 1);
    }
  } catch (err) {
    console.error('[Battle] failed to track quest progress:', err.message);
  }

  return battle;
}

module.exports = {
  generateBattleId,
  createBattle,
  createBattleFromAttack,
  reinforceBattleForMarch,
  createBattleForUser,
  getBattleByBattleId,
  getBattleByMarchId,
  getBattleForParticipant,
  listBattlesForUser,
  transitionStatus,
  updateCurrentState,
  cancelBattle,
  resolveBattleForMarch,
};
