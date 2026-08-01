// ====== Phase 6: Battle Consequences ======
// المسؤولية الوحيدة للملف ده: ياخد Battle مستند خلص فعليًا (status ===
// 'finished' و battle_result معمول - راجع battleService.resolveBattleForMarch
// في modules/battle/battle.service.js)، ويطبّق نتيجته على العالم الحي فعليًا:
//
//   - الفائز: بياخد الغنيمة (loot) + إحصائيات المعركة
//   - الخاسر/الدافع: بيخسر موارد + جنود + ضرر على المباني/السور
//   - الأسوار/الأبراج: الـ hp بتنزل فعليًا على CastleDefense.structures
//     (نفس القطع الحقيقية اللي battle.snapshot اتاخد منها)
//   - الجنود: الناجيين بيرجعوا لجيش القلعة (castle.army)، المفقودين بيتشالوا
//   - إحصائيات: بتتسجّل على نفس Battle.statistics (حقل موجود بالفعل، كان
//     دايمًا صفر) + إحصائيات تراكمية (lifetime) لكل يوزر في BattleStats
//
// عمدًا **مش** بيلمس:
//   - modules/battleResolution/* (منطق الحساب نفسه - استهلاك بس، زي أي
//     consumer تاني لـ battle.battle_result)
//   - modules/battle/engines/battleReport.js أو أي حاجة تانية في محرك
//     المعركة الحي (Simulation/Rule/Combat) - دول نظام منفصل تمامًا (تيك
//     بتيك)، الموديول ده بيشتغل على نتيجة battleResolutionEngine المتزامنة بس
//   - أي كومبوننت فرونت إند (BattleReportPage.jsx وغيره) - التقرير بيقرأ
//     battle_result وbattle.statistics زي ما هما، الملف ده بس بيملأهم
//   - march.service.js's resolveAttackArrival (المسار الاقتصادي القديم -
//     خسائر/غنيمة march.report) - نظام موازي منفصل تمامًا ومقصود إننا نسيبه
//     زي ما هو (راجع تعليق battleService.resolveBattleForMarch)
//
// idempotent بالكامل: applyBattleConsequences بتتأكد إن نفس battle_id ما
// اتطبقتش نتيجته قبل كده (battle.consequences_applied_at) قبل ما تعمل أي
// تعديل - عشان استدعاء متكرر (زي أي retry أو سباق) ميضاعفش الغنيمة/الخسائر.

'use strict';

const Castle = require('../castle/castle.model');
const CastleDefense = require('../defense/defense.model');
const BattleStats = require('./battleStats.model');
const { RESOURCE_TYPES } = require('../castle/castle.config');
const { computeCapacity, buildOwnerNameMap } = require('../castle/castle.service');
// ====== Battle Reports removal - المطلوب: "Mail system should become the
// single source for completed battle reports". بدل تبويب/صفحة "تقارير
// المعارك" المنفصلة (اتشالت بالكامل)، بمجرد ما المعركة تتحسم فعليًا هنا
// (نفس اللحظة اللي battle_result يتحسب فيها ونتائجها تتطبق على العالم
// الحي)، بنبعت رسالة بريد وحدة (system message) لكل من المهاجم والمدافع
// الحقيقيين (لو مش NPC) فيها ملخص المعركة الكامل. ======
const inboxService = require('../inbox/inbox.service');
// ====== AttackableTarget abstraction (راجع world/worldObjectCastleBridge.js)
// - لو القلعة اللي المعركة دي بتاعتها أصلًا "قلعة ظل" لكائن عالم معادي
// (Barbarian Camp/Guard Tower/...إلخ)، بعد ما نتيجة المحرك المتزامن الجديد
// (battleResolutionEngine) تتطبق عليها هنا، بنزامن نفس النتيجة رجوع لمستند
// الـ WorldObject الأصلي - نفس الفكرة المستخدمة في march.service.resolveAttackArrival
// (المسار الاقتصادي الأقدم)، بس هنا لمسار "Battle Consequences" الرسمي. ======
const { syncShadowCastleToWorldObject } = require('../world/worldObjectCastleBridge');
const {
  WALL_HEAVILY_DAMAGED_THRESHOLD_PERCENT,
  MAX_CITY_DEFENSE_BONUS_PERCENT,
  HEAVILY_DAMAGED_STRUCTURE_PENALTY_PERCENT,
} = require('./battleConsequences.config');

// ====== Hospital (اختياري) - مفيش موديول hospital حقيقي في المشروع ده لسه
// خالص (اتفحص بحث كامل في الكودبيز قبل الكتابة). المطلوب ("Injured troops
// are sent to the Hospital if available") بيتنفّذ هنا بمحاولة require آمنة:
// لو الموديول اتضاف يومًا ما بنفس الاسم/الشكل المتوقع، هيتستخدم تلقائيًا من
// غير أي تعديل تاني على الملف ده. لو مش موجود (الحالة الحالية)، الجنود اللي
// مش "remaining" (ناجيين) بيتعتبروا "troops_lost" كاملة - نفس سلوك
// battleResolutionEngine.calculateCasualties أصلًا (مفيش مفهوم "مصاب جزئيًا"
// منفصل عن "remaining"/"lost" في نتيجة المحرك ده، على عكس محرك التيك الحي
// اللي فيه wounded منفصل - راجع engines/combatEngine.js لمقارنة). ======
function tryLoadHospitalService() {
  try {
    // eslint-disable-next-line global-require, import/no-unresolved
    return require('../hospital/hospital.service');
  } catch (err) {
    return null;
  }
}

function clampNonNegative(value) {
  return Math.max(0, Number(value) || 0);
}

// ====== تطبيق موارد الغنيمة/الخسارة على القلعتين الحيّتين - بيستخدم القيم
// الحية الحالية (مش snapshot المعركة المجمّد) عشان أي تغيير حصل للموارد وهو
// المعركة بتتحسب (إنتاج طبيعي، إنفاق تاني...) يتاخد في الاعتبار، بدل ما نفرض
// رقم مجمّد فوق حالة ممكن تكون اتغيّرت. الغنيمة بتتحط سقف بسعة تخزين المهاجم
// (نفس فلسفة march.service.resolveReturnArrival)، وخسارة الدافع بتتقف عند
// صفر (مينفعش موارد سالبة). ======
function applyResourceConsequences({ attackerCastle, defenderCastle, loot }) {
  const looted = (loot && loot.looted) || {};

  for (const resource of RESOURCE_TYPES) {
    const amount = clampNonNegative(looted[resource]);
    if (amount <= 0) continue;

    // ====== الدافع بيخسر المورد ده فعليًا من مخزونه الحي الحالي ======
    if (defenderCastle) {
      const current = defenderCastle.resources[resource].stored;
      defenderCastle.resources[resource].stored = Math.max(0, current - amount);
    }

    // ====== المهاجم بياخد نفس الكمية - بحد أقصى سعة التخزين المتاحة عنده
    // دلوقتي (لو الغنيمة أكبر من المساحة الفاضية، الباقي بيضيع - نفس فلسفة
    // resolveReturnArrival بالظبط). ======
    if (attackerCastle) {
      const cap = computeCapacity(attackerCastle, resource);
      const current = attackerCastle.resources[resource].stored;
      attackerCastle.resources[resource].stored = Math.min(cap, current + amount);
    }
  }
}

// ====== تطبيق نتيجة الجنود (survivors/casualties) على جيش قلعة حية واحدة -
// بتاخد remaining_troops[side] بتاعة battle_result (شكل [{key, type, count}])
// وتحط castle.army بنفس القيم - يعني الجنود الناجيين هم كل جيش القلعة دلوقتي
// لهذا الطرف (نفس فلسفة march.service: target.army = defenderTroopsSurvived).
//
// ملحوظة مهمة عن المهاجم: جيشه أصلًا "ماشي" (مش موجود في attackerCastle.army
// وقت الهجوم - march.service.startMarch بيكون خصمه بالفعل وقت إرسال المسير).
// الناجيين من جيش المهاجم مفروض "يرجعوا" لقلعته - ده أصلًا بيحصل في
// march.service.resolveAttackArrival عن طريق مسير عودة (return march) منفصل،
// مش بتعديل مباشر على army هنا، عشان نفس فلسفة "الجيش الماشي بياخد وقت
// يرجع" متتكسرش. الفانكشن دي عشان كده بتتستخدم بس لجيش الدافع (اللي أصلًا
// واقف في قلعته من غير ما يتحرك) - applyBattleConsequences بينادي عليها
// لطرف الدافع بس، مش المهاجم. ======
function applyStandingArmyConsequences(castle, remainingStacks) {
  if (!castle || !Array.isArray(remainingStacks)) return;

  castle.army = remainingStacks
    .filter((s) => s && s.key && Number(s.count) > 0)
    .map((s) => ({ key: s.key, count: Math.round(Number(s.count)) }));
}

// ====== مطابقة قطعة ضرر من نتيجة battleResolutionEngine (structureDamage
// items: {key, starting_hp, damage, remaining_hp, destroyed} - key هنا هو
// "النوع" type مش الـ _id، راجع battle.snapshot.service.snapshotDefenseStructures
// اللي بتحط key: s.type) لقطعة حقيقية جوه CastleDefense.structures. المطابقة
// بتحصل بالترتيب (index-aligned) داخل نفس الفئة (wall/tower) - لأن
// structureDamageCalculator.damageStructureList بيحافظ على نفس ترتيب
// المصفوفة المدخلة، ونفس المصفوفة دي (snapshot.defender.walls/towers) اتبنت
// أصلًا بنفس ترتيب defense.structures وقت بدء المعركة (snapshotDefenseStructures
// بتلف على الـ structures[] بالترتيب وتوزّعهم على walls/towers/gates/traps من
// غير أي إعادة ترتيب). القطع اللي اتدمرت أو اتصلحت بين وقت بدء المعركة ولحظة
// الحسم مش موجودة في اللقطة أصلًا (snapshotDefenseStructures بتستبعد
// hp<=0/destroyed وقت اللقطة) فمفيش تعارض محتمل. ======
function buildOrderedStructureList(defenseStructures, category) {
  return (defenseStructures || []).filter((s) => {
    if (category === 'wall') return s.category === 'wall' || s.category === 'barricade';
    return s.category === category;
  });
}

// ====== تطبيق ضرر السور/الأبراج فعليًا على CastleDefense الحقيقي بتاع
// الدافع - نفس منطق defenseService.reportDamage بالظبط (hp بينزل، حالة
// الإصلاح (repair.state) بتتحدث لـ 'damaged'/'destroyed'، البوابة المدمرة
// بتتعلّم gate_state.destroyed) بس بيتطبق هنا مباشرة على مستند الدفاع (مش عن
// طريق endpoint إداري بيتطلب userId مالك) لأنه جزء من نتيجة معركة رسمية مش
// أكشن يدوي من اللاعب. ======
function applyStructureDamage(defense, damageList, category) {
  if (!defense || !Array.isArray(damageList) || damageList.length === 0) return { applied: 0 };

  const orderedStructures = buildOrderedStructureList(defense.structures, category);
  let applied = 0;

  damageList.forEach((entry, index) => {
    const structure = orderedStructures[index];
    if (!structure || !entry) return;
    if (!Number.isFinite(Number(entry.damage)) || Number(entry.damage) <= 0) return;

    structure.hp = Math.max(0, structure.hp - Number(entry.damage));
    applied += 1;

    if (structure.hp === 0) {
      structure.repair.state = 'destroyed';
      if (structure.type === 'gate') structure.gate_state.destroyed = true;
    } else if (structure.hp < structure.max_hp) {
      structure.repair.state = 'damaged';
    }
  });

  return { applied };
}

// ====== "بونص دفاع المدينة" - مفيش نظام حقيقي بيحسب ده في اللعبة لسه (مش
// حتى في defense.config.js)، فده منطق جديد بحت مقصور على الملف ده: بيحسب
// نسبة الـ hp المتبقي لكل قطعة سور/برج مقابل max_hp بتاعها، وبينزّل بونص
// افتراضي (MAX_CITY_DEFENSE_BONUS_PERCENT) بمقدار ثابت (HEAVILY_DAMAGED_
// STRUCTURE_PENALTY_PERCENT) لكل قطعة "متضررة بشدة" (تحت العتبة). القيمة دي
// بتتخزن جوه battle.statistics بس (مش على CastleDefense نفسها - مفيش تعديل
// على defense.model.js) عشان تبقى متاحة كجزء من "نتيجة المعركة" بس من غير ما
// نخترع حقل جديد دائم على القلعة نفسها لسه. ======
function computeCityDefenseBonus(defense) {
  const relevantStructures = (defense?.structures || []).filter(
    (s) => s.category === 'wall' || s.category === 'barricade' || s.category === 'tower'
  );

  if (relevantStructures.length === 0) {
    return { defense_bonus_percent: 0, heavily_damaged_count: 0, total_structures: 0 };
  }

  let heavilyDamagedCount = 0;
  for (const s of relevantStructures) {
    const maxHp = Number(s.max_hp) || 0;
    if (maxHp <= 0) continue;
    const ratio = Number(s.hp) / maxHp;
    if (ratio < WALL_HEAVILY_DAMAGED_THRESHOLD_PERCENT) heavilyDamagedCount += 1;
  }

  const penalty = heavilyDamagedCount * HEAVILY_DAMAGED_STRUCTURE_PENALTY_PERCENT;
  const defenseBonusPercent = Math.max(0, MAX_CITY_DEFENSE_BONUS_PERCENT - penalty);

  return {
    defense_bonus_percent: defenseBonusPercent,
    heavily_damaged_count: heavilyDamagedCount,
    total_structures: relevantStructures.length,
  };
}

// ====== تحديث إحصائيات المعركة نفسها (Battle.statistics - حقل موجود بالفعل
// في battle.model.js، كان دايمًا كله أصفار من وقت createDefaultStatistics في
// battle.config.js). بيتملى هنا من نفس battle.battle_result اللي
// resolveBattleForMarch حسبه بالفعل - مفيش أي حساب جديد، مجرد نقل/تجميع شكل
// لشكل. الشكل المتوقع من الفرونت إند مختلف عن current_state.statistics
// (اللي محرك التيك الحي بيملاها - راجع "Statistics — single source" في
// battle/README.md) - هنا بنملى statisticsSchema بتاعة battle.model.js نفسها،
// مش current_state، فمفيش أي تعارض مع الملاحظة دي. ======
function buildBattleStatisticsUpdate(battle, cityDefenseBonus) {
  const result = battle.battle_result || {};
  const casualties = result.casualties || {};
  const attackerCasualties = casualties.attacker || {};
  const defenderCasualties = casualties.defender || {};

  const wallDamage = result.wall_damage || [];
  const buildingDamage = result.building_damage || [];
  const towerDamage = result.tower_damage || [];

  return {
    attacker_troops_lost: clampNonNegative(attackerCasualties.lost),
    attacker_troops_survived: clampNonNegative(attackerCasualties.remaining),
    defender_troops_lost: clampNonNegative(defenderCasualties.lost),
    defender_troops_survived: clampNonNegative(defenderCasualties.remaining),
    buildings_damaged: buildingDamage.filter((b) => b.damage > 0 && !b.destroyed).length,
    buildings_destroyed: buildingDamage.filter((b) => b.destroyed).length,
    walls_breached: wallDamage.filter((w) => w.destroyed).length,
    towers_destroyed: towerDamage.filter((t) => t.destroyed).length,
    gates_destroyed: 0, // مفيش gate_damage منفصل في نتيجة battleResolutionEngine دلوقتي (gates مش مستهدفة في structureDamageCalculator)
    resources_looted: {
      gold: clampNonNegative(result.loot?.looted?.gold),
      wood: clampNonNegative(result.loot?.looted?.wood),
      stone: clampNonNegative(result.loot?.looted?.stone),
    },
    total_ticks: battle.statistics?.total_ticks || 0,
    // ====== إضافة جديدة (additive) - مش موجودة في statisticsSchema الأصلية،
    // بتتسجّل هنا كـ metadata إضافية جوه نفس الحقل (Mixed-safe عن طريق
    // battle.markModified لو احتجناها - لكن لأن city_defense_bonus مش جزء من
    // statisticsSchema الرسمي (تعريف صارم بـ mongoose.Schema)، بنسيبها بره
    // الحقل ده ونحطها في مكان تاني (battle_result.city_defense_status) بدل ما
    // نضطر نعدّل statisticsSchema في battle.model.js. ======
  };
}

// ====== الدالة العامة الرئيسية - بتتنادى من battle.service.resolveBattleForMarch
// فورًا بعد ما battle.battle_result يتحسب ويتحفظ. بتاخد مستند Battle كامل
// (لسه من غير .save() - نفس المستند اللي resolveBattleForMarch شغالة عليه)
// وبتطبق كل حاجة على العالم الحي، وبترجع ملخص بسيط لأي حد حابب يعرف اتعمل
// إيه (مفيدة للـ logging بس، مش لازم تتستخدم). ======
async function applyBattleConsequences(battle) {
  if (!battle || !battle.battle_result) {
    throw new Error('لازم تكون المعركة اتحسمت (battle_result موجود) قبل ما نطبّق نتيجتها');
  }

  // ====== Idempotency guard - لو النتيجة دي اتطبقت قبل كده على العالم الحي
  // لنفس المعركة بالظبط، مانعملش حاجة تاني. بنستخدم علم منفصل
  // (consequences_applied_at) بدل الاعتماد على battle.status === 'finished'
  // بس، لأن finished ممكن تتحقق قبل ما applyBattleConsequences تتنادى (أو لو
  // فشلت أول مرة وبيتعاد المحاولة - عايزين نضمن التطبيق نفسه حصل مرة واحدة). ======
  if (battle.consequences_applied_at) {
    return { applied: false, reason: 'already_applied' };
  }

  const result = battle.battle_result;

  const [attackerCastle, defenderCastle] = await Promise.all([
    Castle.findById(battle.attacker.castle_id),
    Castle.findById(battle.defender.castle_id),
  ]);

  // ====== لو قلعة أي طرف اتمسحت (نادر جدًا، مثلاً حساب اتمسح) بين بدء
  // المعركة ولحظة الحسم، مفيش حاجة نطبقها على القلعة دي بالذات - بس بننادي
  // على أي طرف لسه موجود، ونسجّل الإحصائيات في كل الأحوال (Battle.statistics
  // ومستند BattleStats بيعتمدوا على battle_result المخزّن، مش على وجود
  // القلعة الحية). ======

  // ====== 1) الموارد - غنيمة الفائز (المهاجم بس، نفس قاعدة lootCalculator:
  // مفيش نهب إلا لو المهاجم كسب) + خسارة الدافع ======
  applyResourceConsequences({
    attackerCastle,
    defenderCastle,
    loot: result.loot,
  });

  // ====== 2) الجنود - جيش الدافع الواقف بيتحدّث للناجيين بس (remaining_troops.defender).
  // جيش المهاجم عمدًا مش بيتلمس هنا (راجع تعليق applyStandingArmyConsequences
  // فوق - مسير العودة بتاع march.service هو المسؤول عن رجوعه فعليًا لقلعته). ======
  applyStandingArmyConsequences(defenderCastle, result.remaining_troops?.defender);

  // ====== 3) الأسوار/الأبراج - ضرر حقيقي على CastleDefense.structures بتاعة
  // الدافع (لو عنده مستند دفاع أصلًا - نفس فلسفة "لو مفيش يبقى مفيش حاجة
  // تتضرر" المستخدمة في كل مكان تاني في المشروع ده). ======
  let cityDefenseBonus = null;
  const defense = await CastleDefense.findOne({ castle_id: battle.defender.castle_id });
  if (defense) {
    applyStructureDamage(defense, result.wall_damage, 'wall');
    applyStructureDamage(defense, result.tower_damage, 'tower');
    cityDefenseBonus = computeCityDefenseBonus(defense);
    await defense.save();
  }

  // ====== 4) المباني - مفيش نظام Building HP حقيقي في اللعبة لسه (hp دايمًا
  // null في snapshotBuildings)، فـ result.building_damage هيكون دايمًا
  // مصفوفة فاضية (structureDamageCalculator.damageStructureList بتستبعد أي
  // structure من غير hp رقمي - راجع تعليق damageStructureList هناك). مفيش أي
  // منطق نضيفه هنا اختراعًا لـ hp مش موجود أصلًا - نفس قاعدة "no invented hp"
  // اللي كل الموديول ده ماشي عليها. لما نظام الـ Building HP يتبنى فعليًا
  // (خارج نطاق الـ Phase دي)، نفس applyStructureDamage فوق هتشتغل عليه من
  // غير أي تعديل إضافي - هي أصلًا معمولة عامة (بتاخد أي defense/category). ======

  // ====== 5) الجنود المصابين -> المستشفى (لو موجود) ======
  // battleResolutionEngine.calculateCasualties بيرجّع بس "lost"/"remaining"
  // لكل كومة وحدات - مفيش تصنيف "مصاب" (wounded) منفصل زي محرك التيك الحي
  // (engines/combatEngine.js) في النتيجة دي. فعليًا الموديول ده معندهوش عدد
  // "مصابين" يبعته لمستشفى - لو نظام Hospital اتضاف يومًا ما وعايز يستقبل
  // بيانات إصابة تفصيلية، ده هيحتاج تعديل في casualtyCalculator.js نفسه الأول
  // (خارج نطاق الملف ده تمامًا - وده تعديل على battleResolution، ممنوع في
  // النطاق ده). اللي بنعمله هنا بس: لو الموديول موجود، بنبلّغه بعدد الخسائر
  // الكلي (troops_lost) كفرصة يسجّل/يستهلك الحدث - قرار هل يعتبرهم "مصابين
  // قابلين للعلاج" أو لأ بالكامل مسؤوليته هو، مش الملف ده. لو مش موجود
  // (الحالة الحالية في الكودبيز)، بنتجاهل الخطوة دي بهدوء - نفس فلسفة try/catch
  // المستخدمة في كل مكان تاني في المشروع (march.service.registerBattleFoundation
  // مثلاً) لأي تكامل اختياري. ======
  const hospitalService = tryLoadHospitalService();
  if (hospitalService && typeof hospitalService.admitCasualties === 'function') {
    try {
      await hospitalService.admitCasualties({
        castleId: battle.defender.castle_id,
        troopsLost: result.casualties?.defender?.lost || 0,
        stacks: result.remaining_troops?.defender || [],
      });
    } catch (err) {
      console.error('[BattleConsequences] hospital admission failed (non-blocking):', err.message);
    }
  }

  // ====== 6) حفظ القلاع المعدَّلة ======
  await Promise.all([attackerCastle ? attackerCastle.save() : null, defenderCastle ? defenderCastle.save() : null]);

  // ====== NEW (Attackable World Objects) - لو المدافع أصلًا "قلعة ظل"
  // (راجع الاستيراد فوق) - بنزامن حالتها بعد المعركة رجوع لمستند الـ
  // WorldObject الأصلي فورًا بعد حفظها. مغلّفة بـ try/catch زي أي تكامل
  // اختياري تاني في الملف ده (hospital admission فوق مثلًا) - فشلها لوحده
  // ميوقفش تسجيل نتيجة المعركة نفسها. ======
  if (defenderCastle?.is_world_object) {
    try {
      await syncShadowCastleToWorldObject(defenderCastle);
    } catch (err) {
      console.error('[BattleConsequences] failed to sync shadow castle back to world object:', err.message);
    }
  }

  // ====== 7) إحصائيات المعركة نفسها (Battle.statistics) ======
  battle.statistics = buildBattleStatisticsUpdate(battle, cityDefenseBonus);

  // ====== إضافة حالة الدفاع الحالية (city defense bonus) لنفس battle_result
  // - مش حقل جديد في statisticsSchema الصارمة، بس battle_result نفسها Mixed
  // (راجع تعليقها في battle.model.js: "Mixed عمدًا... عشان شكل نتيجة المحرك
  // ده يفضل مسؤولية موديول battleResolution وحده") فإضافة مفتاح إضافي عليها
  // هنا (بعد ما اتحسبت) آمنة تمامًا ومتسقة مع نفس فلسفة الحقل، من غير أي
  // تعديل على battle.model.js أو على شكل نتيجة battleResolutionEngine نفسها. ======
  if (cityDefenseBonus) {
    battle.battle_result = { ...battle.battle_result, defender_city_defense: cityDefenseBonus };
    battle.markModified('battle_result');
  }

  battle.consequences_applied_at = new Date();
  await battle.save();

  // ====== 8) إحصائيات تراكمية (lifetime) - لكل يوزر حقيقي طرف في المعركة
  // (مش NPC - مفيش user_id يتسجّل ليه). ======
  await Promise.all([
    updateLifetimeStats({ battle, role: 'attacker' }),
    updateLifetimeStats({ battle, role: 'defender' }),
  ]);

  // ====== 9) Battle Reports removal - رسالة بريد المعركة الكاملة (Victory/
  // Defeat + المهاجم والمدافع + وقت المعركة + الخسائر + الغنيمة + المكافآت +
  // ملخص كامل). دي أول مرة أي تقرير معركة "بيتسلّم" فعليًا للاعب من دلوقتي -
  // مفيش تبويب/صفحة تقارير منفصلة أصلًا. بتتبعت هنا بالظبط (بعد ما النتيجة
  // اتطبقت فعليًا على العالم الحي، مش قبل كده) عشان تضمن إن المعركة خلصت
  // فعليًا (status: 'finished') قبل ما أي تفاصيل تتكشف - أثناء 'battling' ما
  // فيش أي رسالة بريد بتتبعت خالص (راجع march.service.beginBattle/
  // notifyAllianceOfAttack: بيبلّغوا إن المعركة "بدأت"، من غير أي كشف
  // لنتيجتها). ======
  try {
    await sendBattleMail(battle);
  } catch (err) {
    console.error('[BattleConsequences] failed to send battle mail:', err.message);
  }

  return { applied: true, city_defense_bonus: cityDefenseBonus };
}

// ====== يبني ويبعت رسالة بريد المعركة الكاملة لكل طرف حقيقي (مش NPC) -
// نسخة واحدة "من منظوره" لكل طرف (عنوان/نتيجة مختلفة حسب هل هو كسب/خسر)،
// بس نفس بيانات الملخص الكامل (metadata) في الاتنين عشان الفرونت إند يقدر
// يعرض تفاصيل المعركة كاملة من نفس الرسالة من غير أي endpoint إضافي - نفس
// شكل battle.battle_result اللي كان أصلًا مصدر تقرير المعركة القديم
// (BattleReportDetail المحذوفة)، هنا بس بيتوصّل عن طريق البريد بدل صفحة
// منفصلة. idempotent بشكل غير مباشر: applyBattleConsequences نفسها بترجع
// بدري لو consequences_applied_at موجود بالفعل (فوق)، فالدالة دي مش ممكن
// تتنادى مرتين لنفس المعركة أصلًا. ======
async function sendBattleMail(battle) {
  const result = battle.battle_result || {};
  const winner = result.winner;

  const participants = [
    { role: 'attacker', self: battle.attacker, opponent: battle.defender },
    { role: 'defender', self: battle.defender, opponent: battle.attacker },
  ].filter((p) => p.self && !p.self.is_npc && p.self.user_id);

  if (participants.length === 0) return;

  const nameableIds = [battle.attacker, battle.defender]
    .filter((p) => p && !p.is_npc && p.user_id)
    .map((p) => p.user_id);
  const nameMap = nameableIds.length > 0 ? await buildOwnerNameMap(nameableIds) : new Map();

  const displayName = (participant) => {
    if (!participant) return 'مجهول';
    if (participant.is_npc) return participant.name || 'قوة معادية';
    return nameMap.get(participant.user_id?.toString()) || participant.name || 'لاعب';
  };

  const attackerName = displayName(battle.attacker);
  const defenderName = displayName(battle.defender);
  const lootedTotal = RESOURCE_TYPES.reduce((sum, key) => sum + clampNonNegative(result.loot?.looted?.[key]), 0);
  // ====== قوة الطرفين الابتدائية (وقت بدء المعركة) - من نفس battle.snapshot
  // اللي resolveBattleForMarch اتحسبت عليه أصلًا (راجع battle.service.js) -
  // بنضيفها هنا للرسالة عشان "Full battle summary" يبقى فعليًا مكتفي
  // بذاته من غير أي نداء API إضافي لجلب المعركة الحية بعد ما تخلص. ======
  const initialTroops = {
    attacker: battle.snapshot?.attacker?.troops || [],
    defender: battle.snapshot?.defender?.troops || [],
  };

  for (const { role } of participants) {
    const won = winner === role;
    const isDraw = winner === 'draw';
    const opponentRole = role === 'attacker' ? 'defender' : 'attacker';
    const ownCasualtiesLost = clampNonNegative(result.casualties?.[role]?.lost);
    const opponentCasualtiesLost = clampNonNegative(result.casualties?.[opponentRole]?.lost);

    const title = isDraw ? 'تعادل في المعركة' : won ? 'انتصار في المعركة!' : 'هزيمة في المعركة';
    const outcomeText = isDraw ? 'انتهت المعركة بتعادل' : won ? 'كسبت هذه المعركة' : 'خسرت هذه المعركة';
    const lootText =
      role === 'attacker' && won && lootedTotal > 0 ? ` وغنمت ${lootedTotal.toLocaleString('en-US')} وحدة موارد` : '';

    const body = `${outcomeText} بين ${attackerName} و${defenderName}${lootText}. خسرت ${ownCasualtiesLost.toLocaleString(
      'en-US'
    )} وحدة من جيشك، وتسببت في ${opponentCasualtiesLost.toLocaleString('en-US')} خسارة للخصم.`;

    await inboxService.createSystemMessage({
      userId: role === 'attacker' ? battle.attacker.user_id : battle.defender.user_id,
      type: 'battle_report',
      title,
      body,
      metadata: {
        battle_id: battle.battle_id,
        role,
        winner,
        attacker_name: attackerName,
        defender_name: defenderName,
        battle_time: battle.finish_time || result.resolved_at || new Date(),
        duration_seconds: result.battle_duration_seconds ?? null,
        casualties: result.casualties || {},
        initial_troops: initialTroops,
        loot: result.loot || {},
        remaining_troops: result.remaining_troops || {},
        defender_participants: result.defender_participants || [],
        wall_damage: result.wall_damage || [],
        building_damage: result.building_damage || [],
        tower_damage: result.tower_damage || [],
        key_battle_events: result.key_battle_events || [],
      },
    });
  }
}

// ====== تحديث/إنشاء مستند BattleStats بتاع يوزر واحد - upsert atomic بسيط
// (findOneAndUpdate + upsert) عشان أول معركة لليوزر تنشئ المستند تلقائيًا من
// غير حاجة لخطوة "getOrCreate" منفصلة (زي getOrCreateDefense/getOrCreateCastle)،
// وعشان نتجنب أي race condition لو نفس اليوزر خلّص معركتين في نفس اللحظة
// بالظبط (findOneAndUpdate بـ $inc atomic على مستوى قاعدة البيانات نفسها). ======
async function updateLifetimeStats({ battle, role }) {
  const participant = battle[role];
  if (!participant || participant.is_npc || !participant.user_id) return null;

  const result = battle.battle_result;
  const opponentRole = role === 'attacker' ? 'defender' : 'attacker';

  const won = result.winner === role;
  const lost = result.winner === opponentRole;
  const isDraw = result.winner === 'draw';

  const ownCasualties = result.casualties?.[role] || {};
  const opponentCasualties = result.casualties?.[opponentRole] || {};

  const lootedTotals =
    role === 'attacker'
      ? result.loot?.looted || {}
      : {}; // بس المهاجم هو اللي "بينهب" - راجع lootCalculator (winner !== 'attacker' => looted: {})

  const lostTotals =
    role === 'defender'
      ? result.loot?.looted || {}
      : {}; // الدافع هو اللي بيخسر نفس القيم اللي المهاجم نهبها

  const inc = {
    total_battles: 1,
    victories: won ? 1 : 0,
    defeats: lost ? 1 : 0,
    draws: isDraw ? 1 : 0,
    troops_lost: clampNonNegative(ownCasualties.lost),
    troops_killed: clampNonNegative(opponentCasualties.lost),
    'resources_looted.gold': clampNonNegative(lootedTotals.gold),
    'resources_looted.wood': clampNonNegative(lootedTotals.wood),
    'resources_looted.stone': clampNonNegative(lootedTotals.stone),
    'resources_lost.gold': clampNonNegative(lostTotals.gold),
    'resources_lost.wood': clampNonNegative(lostTotals.wood),
    'resources_lost.stone': clampNonNegative(lostTotals.stone),
  };

  return BattleStats.findOneAndUpdate(
    { user_id: participant.user_id },
    { $inc: inc, $set: { last_battle_id: battle.battle_id } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

// ====== قراءة إحصائيات لاعب واحد - lazy: لو لسه معندوش مستند (مخلّصش أي
// معركة لسه)، بترجع صفر في كل حاجة بدل ما تعمل مستند فاضي في قاعدة البيانات
// (نفس فلسفة getDefenseByCastleId - "عرض" بس، مش "إنشاء"). ======
async function getLifetimeStats(userId) {
  const stats = await BattleStats.findOne({ user_id: userId });
  if (!stats) {
    return {
      total_battles: 0,
      victories: 0,
      defeats: 0,
      draws: 0,
      troops_lost: 0,
      troops_killed: 0,
      resources_looted: { gold: 0, wood: 0, stone: 0 },
      resources_lost: { gold: 0, wood: 0, stone: 0 },
    };
  }
  return stats;
}

module.exports = {
  applyBattleConsequences,
  getLifetimeStats,
};
