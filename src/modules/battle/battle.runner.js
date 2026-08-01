// ====== Battle Runner (Frontend Integration step) ======
// الملف ده مش محرك جديد ولا فيه أي منطق قتال/قواعد/محاكاة من عندنا - هو بس
// "التوصيلة" (plumbing) الناقصة اللي بتوصّل الأنظمة الموجودة فعلاً
// (SimulationEngine / RuleEngine / CombatEngine) ببعض وتخلّيها تشتغل فعليًا
// فوق مستند Battle حقيقي، وتنشر حالتها في battle.current_state عشان
// الفرونت إند يقدر يعمل عليها polling (GET /api/battles/:battleId).
//
// كل حاجة بتحصل هنا هي استدعاء مباشر لـ APIs موجودة بالفعل في:
//   - engines/simulationEngine.js  (tick loop + state machine + unit store)
//   - engines/ruleEngine.js        (تقييم شروط خطة اللاعب - دلوقتي بيتغذّى
//                                    فعليًا بقواعد حقيقية محوّلة تلقائيًا من
//                                    BattlePlan كل طرف عن طريق
//                                    army/battlePlanRuleCompiler.js، راجع
//                                    registerPlanRulesForSide تحت)
//   - engines/combatEngine.js      (حسم الاشتباكات - target selection, range,
//                                    damage, casualties, morale, statistics)
//
// الحاجة الوحيدة اللي الملف ده بيعملها وممكن تتفسّر كـ"قرار" هي إصدار أمر
// قتال افتراضي واحد بس (attack_unit / attack_building بالـ NEAREST strategy
// الافتراضية بتاعة CombatEngine نفسه) لكل وحدة حية وقت بدء المعركة - وده
// بالظبط المعادل لـ "الجيشين اتقابلوا وبدأوا يضربوا بعض" لحد ما Battle
// Planner/Rule Engine الحقيقيين يتبنوا ويحددوا أوامر مفصّلة من خطة اللاعب
// نفسه. مفيش هنا أي معادلة ضرر، ولا اختيار هدف، ولا فحص مدى - كل ده
// CombatEngine نفسه بيعمله زي ما هو مبني بالظبط.

'use strict';

const Battle = require('./battle.model');
const { BATTLE_STATUS } = require('./battle.config');
const {
  createSimulationEngine,
  buildUnitGroupsFromSnapshot,
  SIMULATION_EVENT,
  SIMULATION_STATE,
} = require('./engines/simulationEngine');
const {
  createCombatEngine,
  COMBAT_ACTION_TYPE,
  COMBAT_EVENT,
  TARGET_SELECTION_STRATEGY,
  selectTarget,
  isInRange,
  isValidTroopType,
} = require('./engines/combatEngine');
const { createRuleEngine, RULE_EVENT } = require('./engines/ruleEngine');
const { createMovementSystem } = require('./engines/movementSystem');
// ====== Rule Plan Executor - الجسر الناقص اللي اكتشفناه: RuleEngine كانت
// بتنشر RULE_TRIGGERED من غير ما حد يسمعها فعليًا (خطة اللاعب كانت بتتقيّم
// في الفاضي). راجع تعليق الملف نفسه لتفاصيل كاملة. ======
const { createRulePlanExecutor } = require('./engines/rulePlanExecutor');
// ====== Building Interaction (خطوة 6) - بيسمع BUILDING_DESTROYED من نفس الـ
// Combat Engine اللي هيتبنى تحت (نفس فلسفة تسجيل Rule Engine على نفس
// eventBus) ويترجمه لحالة "بوابة اتفتحت/برج اتعطّل" - راجع
// engines/buildingInteraction.js للتفاصيل. ======
const { createBuildingInteraction } = require('./engines/buildingInteraction');
// ====== Battle Planner 2.0 integration - نفس الفلسفة المذكورة في التعليق
// فوق: البلانر بيتسجّل قواعده في نفس الـ Rule Engine الموجود بالفعل من غير
// ما يحتاج أي تعديل في ruleEngine.js نفسه. راجع army/battlePlanRuleCompiler.js
// للتفاصيل - هنا بس بنستدعي الـ API العام بتاعه. ======
const battlePlannerService = require('../army/battlePlanner.service');
const { registerBattlePlanRules } = require('../army/battlePlanRuleCompiler');
// ====== Battle Plan Combat Bonus - الإضافة اللي بتخلي الخطة تأثر فعليًا
// على *قوة* الجيش (raw attack/defense جوه CombatEngine)، مش بس على سلوك
// الوحدات زي battlePlanRuleCompiler.js فوق. راجع battlePlanBonusCompiler.js
// للتفاصيل والحدود، وbattlePlanBonus.config.js لكل النسب القابلة للتعديل. ======
const { buildUnitModifiers: buildBattlePlanUnitModifiers } = require('../army/battlePlanBonusCompiler');

// ====== سجل المعارك الشغالة حاليًا في الذاكرة - Map<battle_id, RunnerHandle>.
// مفيش persistence لمحرك شغال بين إعادة تشغيل السيرفر (نفس حدود أي in-memory
// timer)؛ current_state المحفوظة في MongoDB هي مصدر الحقيقة لأي حد بيعمل
// GET، فحتى لو السيرفر اترستارت، آخر حالة محفوظة تفضل متاحة للقراءة (بس
// المعركة نفسها هتفضل واقفة عند آخر تيك - قابلة للتوسعة لاحقًا لو حبينا
// نعيد تشغيلها من current_state المحفوظة). ======
const runningBattles = new Map();

// كل قد ايه (بالتيكات) نكتب current_state في قاعدة البيانات - مش كل تيك
// (250ms) عشان منعملش write كل ربع ثانية لكل معركة شغالة، بس برضه قريب
// كفاية من "لحظي" بالنسبة للفرونت إند اللي بيعمل poll كل ~1-2 ثانية.
const PERSIST_EVERY_N_TICKS = 2;

// ---------------------------------------------------------------------------
// تحويل لقطة معركة (battle.snapshot) لأوامر تسجيل جاهزة لـ CombatEngine -
// نفس فلسفة buildUnitGroupsFromSnapshot بتاعة simulationEngine.js بالظبط،
// بس هنا بنبني كمان الـ stats/troop_type اللي CombatEngine محتاجها (مش مجرد
// موقع/حالة زي UnitStateStore). كل رقم هنا منسوخ من snapshot نفسه (اللي
// اتجمّد وقت إنشاء المعركة) - مفيش أي حساب/توازن جديد بيحصل هنا.
// ---------------------------------------------------------------------------
function buildCombatUnitsFromSnapshot(battle) {
  const units = [];

  function pushSide(owner, troopStacks, startX) {
    (troopStacks || []).forEach((troop, index) => {
      // كومة (stack) وحدها ممكن تمثّل أكتر من جندي (troop.count) - CombatEngine
      // بيتعامل مع "كومة" كوحدة قتالية واحدة (troop_count) ليها تتبّع خسائر
      // داخلي (راجع casualties في combatEngine.js) بدل ما نسجّل كل جندي لوحده.
      const id = `${owner}:${troop.key}:${index}`;
      units.push({
        id,
        owner,
        // مواقع مبدئية بسيطة بس - المهاجم والدافع بيتقابلوا على "خط اشتباك"
        // واحد (x=0) بفاصل صغير بينهم حسب ترتيب الكومة (index)، عشان يكونوا
        // فعليًا جوه مدى بعض (range الافتراضي = 3 تحت) - مفيش نظام
        // تشكيلات/مواقع حقيقي على خريطة المدينة لسه (ده شغل Battle Planner
        // القادم)، فده placeholder جغرافي بس يخلي فحص المدى/الاختيار
        // الموجودين فعلًا في CombatEngine يشتغلوا بمعنى، مش قرار تكتيكي.
        position: { x: startX, y: index * 2 },
        stats: {
          attack: troop.stats?.attack ?? 0,
          defense: troop.stats?.defense ?? 0,
          hp: (troop.stats?.hp ?? 0) * Math.max(1, Number(troop.count) || 1),
        },
        troop_count: Math.max(1, Number(troop.count) || 1),
        troop_key: troop.key,
        troop_type: isValidTroopType(troop.key) ? troop.key : null,
        range: 5,
        alive: true,
      });
    });
  }

  pushSide('attacker', battle?.snapshot?.attacker?.troops, 0);
  pushSide('defender', battle?.snapshot?.defender?.troops, 4);

  return units;
}

// ---------------------------------------------------------------------------
// تحويل مباني/أسوار/أبراج/بوابات الدافع (لقطة المعركة) لهياكل قابلة للتسجيل
// في CombatEngine.registerStructure - **بس** اللي معاها hp رقمي فعلي (مش
// null). زي ما موضّح في battle.snapshot.service.js، مفيش نظام تحصينات/صحة
// مبانِ حقيقي لسه في اللعبة، فالقيم دي هتفضل فاضية عمليًا لحد ما ده يتبنى -
// الملف ده مش بيخترع hp افتراضي لمبنى مالوش واحد، عشان ميعرضش على الفرونت
// إند مبنى "قابل للتدمير" وهو أصلًا مش قابل للتدمير في اللعبة الحقيقية.
// ---------------------------------------------------------------------------
function buildStructuresFromSnapshot(battle) {
  const structures = [];
  const defender = battle?.snapshot?.defender || {};

  // ====== Auto-Turret / Traps: `singleUse` هنا هي علم تمرير بس (مش حساب) -
  // بتتحدد حسب مصدر القايمة (trap_positions) مش حسب أي رقم جوه item نفسه،
  // لأن snapshotDefenseStructures (battle.snapshot.service.js) نفسها هي
  // مصدر الحقيقة الوحيد لـ "ده فخ يتستهلك مرة واحدة". أي item من towers/
  // walls/gates/buildings ما معاهوش damage/range حقيقي (undefined) بيتحول
  // تلقائيًا لـ null جوه StructureStore.register نفسها (راجع تعليقها) - يفضل
  // هدف بس زي ما كان بالظبط، من غير أي تغيير في سلوكهم القديم. ======
  function pushList(list, type, { singleUse = false } = {}) {
    (list || []).forEach((item, index) => {
      if (!Number.isFinite(item.hp)) return; // مفيش hp حقيقي = مش هدف قتالي دلوقتي
      // ====== لو القطعة دي جاية من نظام دفاع حقيقي (CastleDefense.structures)،
      // اللقطة بقت بتحمل `structure_id` (نفس الـ Mongo `_id` الأصلي - راجع
      // snapshotDefenseStructures) - بنستخدمه *هو* كـ id هنا بدل الـ id
      // المصنّع بالـ index، عشان يفضل نفس المعرّف اللي BattlePlan.target_priorities/
      // protection_rules بيشاوروا عليه (target_ref_id) طول السلسلة (خطة ->
      // compiler -> Rule Engine facts -> Combat Engine structure) - من غير
      // كده مفيش طريقة تقنية تربط "هاجم البوابة رقم كذا" في خطة اللاعب بأي
      // قطعة حقيقية هنا. المباني العادية (buildings) لسه مالهاش نظام دفاع
      // حقيقي (راجع تعليق battle.snapshot.service.js) فبتفضل بالـ id القديم. ======
      const id = item.structure_id
        ? `defender:${type}:${item.structure_id}`
        : `defender:${type}:${item.key || type}:${index}`;
      structures.push({
        id,
        type,
        owner: 'defender',
        position: { x: item.position?.x ?? 4, y: item.position?.y ?? index * 2 },
        hp: item.hp,
        armor: Number.isFinite(item.armor) ? item.armor : 0,
        defense: 0,
        // ====== الأبراج (وحاليًا الفخاخ) بس هي اللي بتحمل damage/range
        // حقيقيين جوه snapshot (من combat_stats المحسوبة وقت البناء/الترقية -
        // راجع snapshotDefenseStructures) - بننقلهم زي ما هم بالظبط من غير
        // أي رقم مخترع هنا، نفس فلسفة hp فوق بالظبط. ======
        damage: item.damage,
        range: item.range,
        single_use: singleUse,
      });
    });
  }

  pushList(defender.walls, 'wall');
  pushList(defender.towers, 'tower');
  pushList(defender.gates, 'gate');
  pushList(defender.buildings, 'building');
  // ====== الفخاخ (defender.trap_positions - راجع buildDefenderSnapshot في
  // battle.snapshot.service.js) كانت لسه مش متسجّلة هنا خالص لحد دلوقتي، فمع
  // إن CombatEngine بقى يعرف يشغّل auto-fire للفخاخ (راجع
  // _resolveStructureAutoFire) كانت النتيجة إن مفيش فخ فعليًا بيتسجّل في أي
  // معركة حقيقية. singleUse: true هنا هي اللي بتخلي StructureStore يعامل
  // القطعة دي كـ "تتستهلك مرة واحدة وبس" (راجع single_use/consumed في
  // combatEngine.js). ======
  pushList(defender.trap_positions, 'trap', { singleUse: true });

  return structures;
}

/**
 * بيبني الـ 3 محركات (Simulation/Rule/Combat) لمعركة معينة، يسجّل الوحدات/
 * المباني من اللقطة، يوصّلهم ببعض عن طريق نفس الـ event bus، ويرجّع "handle"
 * بسيط بيسمح نوقفه/نقرا حالته الحالية. مفيش أي حالة بتتبني هنا برّه الـ APIs
 * اللي المحركات التلاتة أصلًا بتعرضها.
 */
/**
 * لو صاحب الطرف ده (attacker/defender) لاعب حقيقي (مش NPC) وعنده خطة معركة
 * افتراضية محفوظة، بيحوّلها لقواعد ويسجّلها في نفس الـ Rule Engine بتاع
 * المعركة دي. مفيش أي فشل هنا بيوقف بدء المعركة نفسها - لو تحميل الخطة فشل
 * لأي سبب، بنسجّل خطأ ونكمل من غير قواعد لنفس الطرف ده (تمامًا زي لو ماكانش
 * عنده خطة أصلًا من الأول - نفس فلسفة "خطأ في قاعدة واحدة مايوقفش الباقي"
 * الموجودة جوه RuleEngine.evaluateTick نفسها).
 */
// ====== بترجع الخطة المحمّلة (أو null) عشان buildEnginesForBattle يقدر
// يعيد استخدام نفس الخطة لبناء مودفيرز القوة الحقيقية (راجع
// applyPlanBonusModifiersForSide تحت) من غير نداء قاعدة بيانات تاني. ======
async function registerPlanRulesForSide(ruleEngine, participant, owner) {
  const userId = participant?.user_id;
  if (!userId) return null; // NPC أو طرف من غير مستخدم حقيقي - مفيش خطة تتحمّل

  let plan = null;
  try {
    plan = await battlePlannerService.getDefaultPlan(userId);
  } catch (err) {
    console.error(`[BattleRunner] تعذر تحميل خطة المعركة الافتراضية لـ ${owner}:`, err.message);
    return null;
  }
  if (!plan) return null; // اللاعب لسه ما بناش أي خطة معركة - سلوك زي قبل التكامل تمامًا

  registerBattlePlanRules(ruleEngine, plan, { owner });
  return plan;
}

// ====== بتسجّل بونصات القوة الحقيقية (ATTACK_BONUS/DEFENSE_BONUS) لكل
// وحدة حية بتاعة الطرف ده في نفس CombatEngine - دي الإضافة اللي بتخلي خطة
// المعركة تأثر فعليًا في *نتيجة* المعركة (رقم الضرر)، مش بس في سلوك
// الوحدات (ده شغل rulePlanExecutor.js الموجود بالفعل وفاضل زي ما هو).
// مفيش أي فشل هنا بيوقف بدء المعركة (نفس فلسفة registerPlanRulesForSide
// فوق بالظبط) - لو التحويل فشل لأي سبب، بنسجّل خطأ ونكمل من غير بونص لنفس
// الطرف ده. ======
function applyPlanBonusModifiersForSide(combat, plan, combatUnits, owner) {
  if (!plan) return;
  const source = `battle_plan:${plan.plan_id}`;
  for (const unit of combatUnits) {
    if (unit.owner !== owner) continue;
    try {
      const modifiers = buildBattlePlanUnitModifiers(plan, unit, source);
      for (const modifier of modifiers) {
        combat.addModifier(unit.id, modifier);
      }
    } catch (err) {
      console.error(`[BattleRunner] تعذر تطبيق بونص خطة المعركة على الوحدة ${unit.id}:`, err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// الجسر الناقص التاني اللي اكتشفناه: RuleEngine.evaluateTick() بتقيّم شروط
// زي gate_destroyed/wall_destroyed/tower_destroyed عن طريق
// context.facts.gates/walls/towers (راجع CONDITION_EVALUATORS في
// ruleEngine.js) - لكن getContext هنا كانت بترجّع { units } بس، من غير
// facts خالص. النتيجة: الشروط دي كانت ترجع false طول عمرها (getFacts بترجع
// {} لو context.facts مش موجود) - يعني قواعد "دافع عن البوابة" أو "انسحب
// لو البوابة اتكسرت" في خطة اللاعب كانت مسجّلة صح في Rule Engine بس ملهاش
// أي أثر فعلي أبدًا، حتى لو البوابة اتكسرت فعليًا في المعركة.
//
// الدالة دي بتبني facts.gates/walls/towers من combat.getAllStructures() -
// نفس مصدر الحقيقة الوحيد (StructureStore.destroyed) اللي BuildingInteraction
// نفسها بتسمعه - من غير أي حساب جديد، مجرد تجميع بيانات موجودة بالفعل بشكل
// الـ facts اللي CONDITION_EVALUATORS متوقّعاه.
//
// كل قطعة بتتسجّل تحت مفتاحين: الـ id الكامل بتاعها في Combat Engine
// (defender:gate:<structure_id>) وكمان الـ structure_id الخام (لو موجود) -
// عشان تتوافق مع الشكلين اللي battlePlanRuleCompiler.js ممكن يبنيهم
// (findMatchingTargetRef بيرجّع target_ref_id الخام من BattlePlan)، من غير
// ما نضطر نغيّر شكل أي حاجة تانية في الـ compiler نفسه.
// ---------------------------------------------------------------------------
function buildFactsFromCombat(combat) {
  const gates = {};
  const walls = {};
  const towers = {};

  function targetMapFor(type) {
    if (type === 'gate') return gates;
    if (type === 'wall') return walls;
    if (type === 'tower') return towers;
    return null;
  }

  for (const structure of combat.getAllStructures()) {
    const targetMap = targetMapFor(structure.type);
    if (!targetMap) continue;

    const entry = { destroyed: Boolean(structure.destroyed), hp: structure.hp, max_hp: structure.max_hp };
    targetMap[structure.id] = entry;

    // defender:gate:<structure_id> -> بنسحب آخر جزء (الـ structure_id الخام)
    // عشان نسجّله تحت المفتاح ده كمان - نفس فلسفة ownerOfUnit في
    // ruleEngine.js (استخراج جزء من id مركّب بـ ":").
    const rawId = String(structure.id).split(':').slice(2).join(':');
    if (rawId) targetMap[rawId] = entry;
  }

  return { gates, walls, towers };
}

async function buildEnginesForBattle(battle) {
  const simulation = createSimulationEngine({
    battleId: battle.battle_id,
    tickRateMs: 250,
  });

  // ====== Rule Engine context - بيتغذّى بـ:
  //  - units: نفس الوحدات القتالية (Combat Engine) زي ما كان.
  //  - morale: كانت مش موجودة خالص - CONDITION_EVALUATORS.morale_below
  //    بيدوّر على u.morale جوه كل وحدة (راجع getUnits(context) في
  //    ruleEngine.js)، لكن CombatUnitStore.register() ما بيسجّلش morale
  //    جوه حالة الوحدة نفسها (المورال متخزّن في MoraleStore منفصل تمامًا -
  //    راجع combatEngine.js: getAllMorale()). النتيجة: u.morale كانت دايمًا
  //    undefined، فقاعدة "انسحب لو المعنويات وقعت تحت X" (سواء القديمة أو
  //    strategy_config.retreat_rules.morale_threshold) كانت دايمًا false -
  //    بنلحق كل وحدة بمورالها الحقيقي هنا بدل ما نعدّل شكل
  //    CombatUnitStore.register() نفسه (تصميم مستقل ومقصود، راجع تعليقه).
  //  - facts: راجع buildFactsFromCombat فوق - كانت مش موجودة خالص.
  // ======
  const rules = createRuleEngine({
    eventBus: simulation.eventBus,
    getContext: () => {
      const moraleById = new Map(combat.getAllMorale().map((m) => [m.id, m.morale]));
      const units = combat.getAllCombatants().map((u) => ({ ...u, morale: moraleById.get(u.id) ?? u.morale }));
      return { units, facts: buildFactsFromCombat(combat) };
    },
  });

  // ====== Battle Planner 2.0: لو صاحب أي طرف (مش NPC) عنده خطة معركة
  // افتراضية محفوظة (BattlePlan - راجع army/battlePlanner.service.js)، بنحوّل
  // خيارات الخطة دي كلها لقواعد حقيقية جوه نفس Rule Engine الـ instance ده
  // بالظبط (registerBattlePlanRules - راجع army/battlePlanRuleCompiler.js).
  // لو مفيش user_id (NPC) أو مفيش خطة افتراضية أصلًا، مفيش قواعد بتتسجّل -
  // نفس سلوك المعركة قبل التكامل ده تمامًا (Backward compatible). ======
  const attackerPlan = await registerPlanRulesForSide(rules, battle.attacker, 'attacker');
  const defenderPlan = await registerPlanRulesForSide(rules, battle.defender, 'defender');

  const combat = createCombatEngine({
    eventBus: simulation.eventBus,
    tickRateMs: simulation.tickRateMs,
  });

  // ====== Building Interaction: بتتسجّل على نفس eventBus بتاع المعركة دي -
  // بمجرد ما CombatEngine (فوق) ينشر BUILDING_DESTROYED (بوابة أو برج
  // اتدمر)، الـ tracker ده بيسجّل الحالة تلقائيًا (gate_open/tower_disabled -
  // راجع summarizeEngines تحت لعرضها في current_state). ======
  const buildingInteraction = createBuildingInteraction({
    eventBus: simulation.eventBus,
    combatEvent: COMBAT_EVENT,
  });

  // ====== Rule Plan Executor - بيتسجّل على نفس eventBus بتاع المعركة دي،
  // وبمجرد ما RuleEngine (فوق) ينشر RULE_TRIGGERED (قاعدة من خطة اللاعب
  // اتحقق شرطها)، بيترجمها فورًا لأوامر قتال فعلية عن طريق combat.issueOrder
  // (نفس الأمر اللي BattleCommandPanel بيبعته وقت تحكم يدوي - الفرق بس مصدر
  // النداء). من غير المحرك ده، خطط اللاعبين كانت بتتقيّم من غير أي أثر فعلي
  // على المعركة. ======
  const rulePlanExecutor = createRulePlanExecutor({
    eventBus: simulation.eventBus,
    ruleEvent: RULE_EVENT,
    combat,
    combatActionType: COMBAT_ACTION_TYPE,
    targetSelectionStrategy: TARGET_SELECTION_STRATEGY,
  });

  // ====== Movement System - أول تحريك حقيقي للوحدات (راجع تعليق
  // engines/movementSystem.js لتفاصيل كاملة) - بيسمع نفس الـ event bus وبينادي
  // simulation.updateUnitGroup()/combat.getAllCombatants() العامة بس، مفيش
  // أي تعديل مطلوب في simulationEngine.js/combatEngine.js نفسهم. ======
  const movement = createMovementSystem({
    eventBus: simulation.eventBus,
    simulationEvent: SIMULATION_EVENT,
    simulation,
    combat,
    combatActionType: COMBAT_ACTION_TYPE,
    targetSelectionStrategy: TARGET_SELECTION_STRATEGY,
    selectTarget,
    isInRange,
  });

  // ---- تسجيل الوحدات في الاتنين: UnitStateStore بتاعة Simulation (موقع/
  // حالة عامة) و CombatUnitStore بتاعة Combat (stats/hp/قتال فعلي) - نفس
  // الفكرة اللي buildUnitGroupsFromSnapshot معلّق عليها في simulationEngine.js
  // نفسه: "نقطة انطلاق جاهزة من غير ما نحتاج نعدّل المحرك". ----
  const simUnits = buildUnitGroupsFromSnapshot(battle);
  simulation.initialize({ units: simUnits });

  const combatUnits = buildCombatUnitsFromSnapshot(battle);
  for (const unit of combatUnits) {
    combat.registerCombatant(unit);
  }
  for (const structure of buildStructuresFromSnapshot(battle)) {
    combat.registerStructure(structure);
  }

  // ====== Battle Plan Combat Bonus - نفس فلسفة تسجيل قواعد الخطة فوق:
  // بونصات القوة الحقيقية (ATTACK_BONUS/DEFENSE_BONUS) بتتسجّل بعد ما كل
  // وحدة اتسجّلت في CombatEngine (محتاجين stats.attack/defense الفعلية
  // بتاعتها لحساب القيمة raw) وقبل أي أمر قتالي - عشان أول حسبة ضرر فعلية
  // تلاقي البونص مسجّل بالفعل. ======
  applyPlanBonusModifiersForSide(combat, attackerPlan, combatUnits, 'attacker');
  applyPlanBonusModifiersForSide(combat, defenderPlan, combatUnits, 'defender');

  // ---- أمر قتالي افتراضي واحد بس لكل وحدة حية: "هاجم أقرب عدو" - نفس
  // COMBAT_ACTION_TYPE.ATTACK_UNIT الموجود أصلًا في combatEngine.js، بالـ
  // NEAREST target selection الافتراضية بتاعته هو نفسه (مش حساب بتاعنا).
  // ده معادل "الجيشين اتقابلوا وبدأوا القتال" لحد ما Battle Planner الحقيقي
  // يديله معنى مفصّل (هاجم بوابة الأول، دافع عن نقطة معينة...). ----
  for (const unit of combatUnits) {
    combat.issueOrder({ source: unit.id, type: COMBAT_ACTION_TYPE.ATTACK_UNIT });
  }

  return { simulation, rules, combat, buildingInteraction, movement, rulePlanExecutor };
}

/**
 * بيلخّص حالة المحركات التلاتة لشكل واحد بسيط، جاهز يتخزّن في
 * battle.current_state ويتقرا من الفرونت إند - تجميع بيانات بس (نفس فلسفة
 * getSnapshot() بتاعة SimulationEngine نفسها)، مفيش أي حساب جديد هنا.
 */
function summarizeEngines({ simulation, combat, buildingInteraction }) {
  const simSnapshot = simulation.getSnapshot();
  const combatants = combat.getAllCombatants();
  const structures = combat.getAllStructures();
  const morale = combat.getAllMorale();
  const moraleById = new Map(morale.map((m) => [m.id, m]));

  const units = combatants.map((c) => {
    const simUnit = simulation.getUnit(c.id);
    const moraleEntry = moraleById.get(c.id);
    const order = combat.getOrder(c.id);
    // الـ id بشكل "owner:troop_key:index" (راجع buildCombatUnitsFromSnapshot) -
    // بنسحب troop_key منه هنا بس عشان CombatUnitStore.register() (combatEngine.js)
    // مش بيحتفظ بأي حقل حر زي ده أصلًا (بيحتفظ بس بـ troop_type من enum
    // ثابت TROOP_TYPE.*)، والفرونت إند محتاج اسم/نوع الوحدة الحقيقي عشان
    // يختار السبرايت/الاسم المناسب من TROOP_TYPES بتاعة castle.config.
    const idParts = String(c.id).split(':');
    const troopKey = idParts.length >= 2 ? idParts[1] : null;
    return {
      id: c.id,
      owner: c.owner,
      troop_key: troopKey,
      troop_type: c.troop_type ?? null,
      position: simUnit?.position ?? c.position,
      // اتجاه بسيط (radians) محسوب من موقع الوحدة تجاه هدفها الحالي - مفيدة
      // للفرونت إند يلف السبرايت بالاتجاه الصحيح، بدون أي منطق قتالي جديد
      // (بس فرق إحداثيات هندسي بحت من بيانات موجودة بالفعل).
      direction: order?.manual_target_id
        ? directionTo(c.position, combat.getCombatant(order.manual_target_id)?.position)
        : null,
      hp: c.stats?.hp ?? 0,
      max_hp: c.stats?.max_hp ?? 0,
      alive: c.alive,
      morale: moraleEntry ? moraleEntry.morale : null,
      current_action: c.alive ? (order ? order.type : 'idle') : 'dead',
      target: order?.manual_target_id ?? null,
      casualties: c.casualties,
      commander: Boolean(c.commander),
    };
  });

  const structuresOut = structures.map((s) => ({
    id: s.id,
    type: s.type,
    owner: s.owner,
    position: s.position,
    hp: s.hp,
    max_hp: s.max_hp,
    destroyed: s.destroyed,
    // ====== Auto-Turret / Traps: مضافة هنا عشان الفرونت إند (لسه ماتلمسش -
    // خطوة تانية منفصلة) يقدر يفرّق بصريًا بين هدف بس (damage: null) ومنشأة
    // بتطلق نار فعليًا، ويعرف الفخ اتفعّل (consumed) ولا لسه من غير ما يحتاج
    // يستنى BUILDING_DESTROYED (الفخ ممكن يفضل واقف hp>0 بعد ما يتستهلك). ======
    damage: s.damage,
    range: s.range,
    single_use: s.single_use,
    consumed: s.consumed,
  }));

  return {
    engine_version: simSnapshot.engine_version,
    simulation_state: simSnapshot.state,
    current_tick: simSnapshot.current_tick,
    simulation_time: simSnapshot.simulation_time,
    tick_rate_ms: simSnapshot.tick_rate_ms,
    units,
    structures: structuresOut,
    statistics: combat.getStatistics(),
    // ====== Building Interaction: مصفوفة IDs بس (مش أوبچكتات كاملة) - نفس
    // فلسفة recent_events تحت، الفرونت إند (لسه ماتلمسش) هيقدر يقارنها بـ
    // structures.id عشان يعرض تأثير بصري (بوابة مفتوحة/برج معطّل) - لو
    // buildingInteraction مش مبعوت (استدعاء مباشر قديم للدالة دي بدون الحقل
    // ده) بترجع مصفوفتين فاضيتين، مش undefined. ======
    gates_open: buildingInteraction ? buildingInteraction.getOpenedGates() : [],
    towers_disabled: buildingInteraction ? buildingInteraction.getDisabledTowers() : [],
    // آخر شوية أحداث قتال بس (مش الأرشيف الكامل) - كافية للفرونت إند يعرض
    // فيدباك بصري لآخر ضربات/موت/تدمير حصل، من غير ما current_state تكبر
    // بلا حدود على طول المعركة. الأرشيف الكامل موجود أصلًا في
    // combat.getCombatLog() / simulation.getTimeline() لو احتجناه لاحقًا
    // (Replay System) لكن مش هدف الخطوة دي.
    recent_events: combat.getCombatLog().slice(-40),
  };
}

// ---------------------------------------------------------------------------
// Phase 4: Replay System Persistence - بيلخّص بيانات الـ replay الجاهزة
// أصلًا جوه المحركين لشكل واحد جاهز يتخزّن في battle.replay (راجع
// replaySchema في battle.model.js). مفيش أي تسجيل أحداث جديد بيحصل هنا -
// combat.getReplayData()/simulation.getReplayData() بيرجّعوا نفس
// الأوبچكتات اللي BattleTimeline (simulationEngine.js) سجّلتها بالفعل
// أثناء المعركة، الدالة دي بس بتجمّعهم مع الميتاداتا (إصدارات المحركات،
// معدل التيك، عدد التيكات) اللي replaySchema محتاجاها.
//
// عمدًا مفيش أي نسخة من simulation.getReplayData().events هنا (بخلاف
// combat.getReplayData().events): محتواها (TICK_STARTED/TICK_COMPLETED)
// حاليًا بس بيانات دورية ثابتة (tick, simulation_time = tick * tick_rate_ms)
// من غير أي أفعال حقيقية مجدولة (مفيش حد بينادي simulation.scheduleAction()
// في أي مكان في الملف ده) - تخزينها كانت هتبقى تكرار بحت لرقمين إحنا أصلًا
// مخزّنينهم (tick_rate_ms/total_ticks). كل حدث قتالي حقيقي (ضرر/موت/تدمير
// مبنى/مورال) أصلًا معاه tick بتاعه في payload بتاعه (combatLog.addEvent)،
// فده كافي لإعادة حساب توقيته من غير الحاجة لأي حدث تيك منفصل.
// ---------------------------------------------------------------------------
function buildReplayPayload({ simulation, combat }) {
  const simReplay = simulation.getReplayData();
  const combatReplay = combat.getReplayData();

  return {
    simulation_engine_version: simReplay.engine_version,
    combat_engine_version: combatReplay.engine_version,
    tick_rate_ms: simulation.tickRateMs,
    total_ticks: simulation.current_tick,
    events: combatReplay.events,
    recorded_at: new Date(),
  };
}


function directionTo(from, to) {
  if (!from || !to) return null;
  return Math.atan2((to.y ?? 0) - (from.y ?? 0), (to.x ?? 0) - (from.x ?? 0));
}

/**
 * بيحدد هل المعركة وصلت لنتيجة نهائية - قاعدة دورة حياة بسيطة بس ("طرف مالوش
 * وحدات حية تاني = خسر")، مش قاعدة قتالية. مفيش أي حساب ضرر/قوة هنا، بس
 * قراءة `alive` الجاهزة من CombatEngine.
 */
function checkOutcome(combat) {
  const combatants = combat.getAllCombatants();
  const attackerAlive = combatants.some((c) => c.owner === 'attacker' && c.alive !== false);
  const defenderAlive = combatants.some((c) => c.owner === 'defender' && c.alive !== false);

  if (!combatants.length) return null;
  if (!attackerAlive && !defenderAlive) return 'draw';
  if (!attackerAlive) return 'defender';
  if (!defenderAlive) return 'attacker';
  return null;
}

// ====== نداءات "بدء تشغيل" شغالة حاليًا (لسه ما خلصتش) - Map<battle_id,
// Promise>. غرضها الوحيد قفل سباق (race) بين نداءين متزامنين لـ
// startBattleRunner بنفس الـ battleId قبل ما أي منهم يوصل لحظة تسجيل
// الـ handle في runningBattles (اللي بتحصل بعد أول await). من غير القفل ده،
// نداءين جايين في نفس اللحظة بالظبط ممكن الاتنين يعدّوا فحص
// runningBattles.has() (لسه فاضية) قبل ما أي واحد فيهم يسجّل فيها، فيبنوا
// محركين منفصلين لنفس المعركة. ======
const startingBattles = new Map();

/**
 * بيبدأ (أو يرجّع الـ handle الموجود لو المعركة شغالة فعلًا) تشغيل معركة -
 * الدالة دي هي الاستبدال الوحيد لـ "مفيش حد بينادي simulation.startSimulation()
 * فعليًا" المذكورة في الملاحظة الأولى. مفيش أي منطق قتال هنا برضه - كل اللي
 * بيحصل هو: تجميع المحركات، تشغيلهم، وحفظ حالتهم بشكل دوري.
 */
async function startBattleRunner(battleId) {
  if (runningBattles.has(battleId)) {
    return runningBattles.get(battleId);
  }
  if (startingBattles.has(battleId)) {
    return startingBattles.get(battleId);
  }

  const startPromise = startBattleRunnerInternal(battleId).finally(() => {
    startingBattles.delete(battleId);
  });
  startingBattles.set(battleId, startPromise);
  return startPromise;
}

async function startBattleRunnerInternal(battleId) {
  const battle = await Battle.findOne({ battle_id: battleId });
  if (!battle) throw new Error('المعركة دي مش موجودة');

  if (battle.status !== BATTLE_STATUS.READY && battle.status !== BATTLE_STATUS.RUNNING) {
    throw new Error(`متقدرش تبدأ محاكاة معركة في حالة "${battle.status}"`);
  }

  const engines = await buildEnginesForBattle(battle);
  let ticksSincePersist = 0;
  let stopped = false;


  async function persist({ force = false } = {}) {
    ticksSincePersist += 1;
    if (!force && ticksSincePersist < PERSIST_EVERY_N_TICKS) return;
    ticksSincePersist = 0;

    const summary = summarizeEngines(engines);
    await Battle.updateOne(
      { battle_id: battleId },
      {
        $set: {
          current_state: summary,
          current_tick: summary.current_tick,
        },
      }
    );
  }

  async function finish(winner) {
    if (stopped) return;
    stopped = true;
    engines.simulation.finishSimulation(winner ? `${winner}_wins` : 'draw');
    await persist({ force: true });
    // ====== Phase 4: Replay System Persistence - بمجرد ما المعركة تتحسم
    // فعليًا، بنسجّل الـ replay الكامل (راجع buildReplayPayload فوق) مرة
    // واحدة بس، في نفس التحديث اللي أصلًا بيسجّل نتيجة المعركة - مفيش
    // نداء database إضافي محتاجينه. ======
    await Battle.updateOne(
      { battle_id: battleId },
      {
        $set: {
          status: BATTLE_STATUS.FINISHED,
          winner,
          finish_time: new Date(),
          replay: buildReplayPayload(engines),
        },
      }
    );
    runningBattles.delete(battleId);
  }

  // ---- كل تيك بيخلص (TICK_COMPLETED من Simulation - نفس الحدث اللي
  // CombatEngine بيسمعه هو نفسه عشان يحسم الأوامر الواقفة)، بنتأكد هل
  // المعركة خلصت، وإلا بنحفظ آخر حالة (كل PERSIST_EVERY_N_TICKS تيك). ----
  engines.simulation.on(SIMULATION_EVENT.TICK_COMPLETED, () => {
    if (stopped) return;
    const outcome = checkOutcome(engines.combat);
    if (outcome) {
      finish(outcome).catch((err) => console.error('[BattleRunner] خطأ أثناء إنهاء المعركة:', err));
      return;
    }
    persist().catch((err) => console.error('[BattleRunner] خطأ أثناء حفظ حالة المعركة:', err));
  });

  if (battle.status === BATTLE_STATUS.READY) {
    battle.status = BATTLE_STATUS.RUNNING;
    battle.start_time = battle.start_time || new Date();
    await battle.save();
  }

  const handle = {
    battleId,
    engines,
    stop() {
      if (stopped) return;
      stopped = true;
      try {
        engines.simulation.stopSimulation();
      } catch (err) {
        // لو المحاكاة خلصت/اتلغت بالفعل، stopSimulation ممكن يرفض الانتقال -
        // مش مشكلة، الهدف هنا بس نضمن التيمر بتاعها وقف.
      }
      runningBattles.delete(battleId);
    },
    isRunning() {
      return !stopped;
    },
  };
  // ====== بنسجّل الـ handle في runningBattles *قبل* أي await تاني (زي
  // startSimulation نفسها بترجع فورًا - بتشغّل setInterval بس - وpersist
  // التحت دي) - عشان أي نداء متزامن تاني لـ startBattleRunner بنفس الـ
  // battleId (مثلاً الفرونت إند بعت start مرتين بسرعة) يلاقي المعركة دي
  // مسجّلة بالفعل في runningBattles.has() ويرجع نفس الـ handle، مش يبني
  // محرك تاني موازي لنفس المعركة. ======
  runningBattles.set(battleId, handle);

  engines.simulation.startSimulation();
  await persist({ force: true });

  return handle;
}

function stopBattleRunner(battleId) {
  const handle = runningBattles.get(battleId);
  if (handle) handle.stop();
}

function isBattleRunning(battleId) {
  return runningBattles.has(battleId);
}

// ---------------------------------------------------------------------------
// Phase 2: قناة الأوامر الحية (Live Command Channel) - نقطة الدخول الوحيدة
// اللي بتخلي طرف متصل (attacker/defender) يبعت أمر قتالي فعلي لمجموعة
// وحدات بتاعته وقت ما المعركة شغالة فعليًا في الذاكرة (runningBattles).
//
// مفيش أي "قرار ذكي" أو حساب توازن جديد هنا خالص - كل اللي بيحصل هو نفس
// الاستدعاء اللي startBattleRunnerInternal (فوق) بيعمله بالظبط لحظة بدء
// المعركة (combat.issueOrder) - الفرق الوحيد إنه بيحصل *لحظيًا* من طلب HTTP
// بدل ما يحصل مرة واحدة وقت البدء. MovementSystem (اللي بيقرا
// combat.getOrder() كل تيك - راجع تعليقه) هيلتقط الأمر الجديد ده تلقائيًا
// من غير أي كود إضافي هنا، وCombatEngine._resolveOrder هيحسم القتال عليه
// بنفس منطقه الموجود بالفعل.
//
// التحقق من الصلاحيات (هل اللاعب ده فعلاً مالك الوحدة دي؟ هل الهدف من
// الفريق التاني؟) شغل battle.controller.js (الطبقة اللي فاهمة req.user/
// battle.attacker/defender) - الفانكشن دي بتفترض إن اللي بينادي عليها
// تأكد بالفعل من ده، وبتعمل بس فحوصات "الحالة منطقية داخل المحرك نفسه"
// (الوحدة موجودة/حية، الهدف موجود/مش من نفس الفريق).
// ---------------------------------------------------------------------------
function issueLiveCommand(battleId, order) {
  const handle = runningBattles.get(battleId);
  if (!handle || !handle.isRunning()) {
    throw new Error('المعركة دي مش شغالة دلوقتي (مفيش محرك حي ليها) - متقدرش تبعت أوامر لمعركة واقفة أو خلصت');
  }

  const { combat } = handle.engines;

  const unit = combat.getCombatant(order.source);
  if (!unit) {
    throw new Error(`الوحدة "${order.source}" مش موجودة في المعركة دي`);
  }
  if (unit.alive === false) {
    throw new Error('الوحدة دي ماتت بالفعل - متقدرش تديها أوامر');
  }

  if (order.manual_target_id) {
    const targetUnit = combat.getCombatant(order.manual_target_id);
    const targetStructure = combat.getStructure(order.manual_target_id);
    const target = targetUnit || targetStructure;

    if (!target) {
      throw new Error(`الهدف "${order.manual_target_id}" مش موجود في المعركة دي`);
    }
    if (target.owner === unit.owner) {
      throw new Error('متقدرش توجّه أمر هجوم/دفاع على هدف من نفس فريقك');
    }
    if (targetUnit && targetUnit.alive === false) {
      throw new Error('الهدف ده مات بالفعل - اختار هدف تاني');
    }
    if (targetStructure && targetStructure.destroyed) {
      throw new Error('المنشأة دي اتدمرت بالفعل - اختار هدف تاني');
    }
  }

  // نفس issueOrder العام بتاع CombatEngine بالظبط - مفيش نسخة تانية من
  // منطق التطبيع (normalization) هنا.
  return combat.issueOrder(order);
}

module.exports = {
  startBattleRunner,
  stopBattleRunner,
  isBattleRunning,
  issueLiveCommand,
  // مُصدَّرة للاختبار المباشر لو احتجنا نفحص التلخيص من غير ما نمر بكل دورة
  // حياة المعركة (نفس فلسفة تصدير helpers في simulationEngine.js/combatEngine.js)
  summarizeEngines,
  buildEnginesForBattle,
  // ====== مُصدَّرة عشان أي Replay Player مستقبلي (استهلاك بس - لسه مش
  // متنفذ، شوف Phase 4 requirements) يقدر يعيد بناء حالة "التيك صفر"
  // (الوحدات/المباني الابتدائية) من battle.snapshot المحفوظة بنفس الدوال
  // الحتمية دي بالظبط - بدل ما نخزّن نسخة تانية من نفس البيانات جوه
  // battle.replay (راجع تعليق replaySchema في battle.model.js). مفيش أي
  // تغيير في منطقهم هنا - بس بقوا مُصدَّرة. ======
  buildCombatUnitsFromSnapshot,
  buildStructuresFromSnapshot,
};
