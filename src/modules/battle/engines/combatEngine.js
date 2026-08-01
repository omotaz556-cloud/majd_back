// ====== Combat Engine (خطوة 5 من معمارية نظام المعارك) ======
// الملف ده مسؤول **بس** عن حسم الاشتباك القتالي نفسه: تنفيذ فعل هجوم/دفاع
// واحد، اختيار الهدف المناسب، فحص المدى، حساب الضرر، وتحديث الـ hp - ونشر
// النتيجة كأحداث. بيستقبل أوامره من Simulation Engine (عن طريق ACTION_DUE
// وUNIT_UPDATED وTICK_COMPLETED على نفس الـ Event Bus) ومن Rule Engine (اللي
// بينشر فعل خطة اللاعب زي ما هو - راجع ruleEngine.js).
//
// كمان بيتتبّع خسائر كل وحدة (units killed/wounded/remaining troops - راجع
// casualties في CombatUnitStore.register/applyDamage) وبيحسب مورال كل وحدة
// (moraleSystem.js - خسائر تقيلة/موت قائد/هجوم ناجح/قرب حلفاء) وينشر
// CASUALTY_UPDATED/MORALE_CHANGED مع كل تغيير فعلي - راجع الحدود تحت لأهمية
// الفرق بين "بيحسب ويعرض" و"بيقرر".
//
// وأخيرًا (statisticsSystem.js) بيجمّع إحصائيات المعركة الحية بشكل مستمر
// (total_damage/units_killed/units_lost/buildings_destroyed/damage_by_type/
// damage_by_unit - متاحة عن طريق getStatistics()) وينشر مجموعة أحداث القتال
// النهائية (BUILDING_DESTROYED عند تدمير مبنى فعليًا، COMMANDER_DEFEATED عند
// موت وحدة `commander: true`) - فوق أحداث الضرر/القتل/الخسائر/المورال
// الموجودة بالفعل.
//
// ====== حدود المسؤولية (مهم جدًا) ======
// - مفيش هنا أي اختراع استراتيجية: الملف ده مايقرّرش "مين يهاجم مين" من
//   تحليل ذكي للموقف - هو بس بيحوّل فعل قتالي (Attack Unit/Attack Building/
//   Defend Position/Hold Position) اتنشر بالفعل لنتيجة رقمية (ضرر، موت،
//   ضرر مبنى)، باستخدام استراتيجية اختيار هدف *مُهيّأة مسبقًا* (configurable)
//   مش استراتيجية بيخترعها هو وقت التشغيل.
// - مفيش هنا أي منطق حركة/توقيت محاكاة - تحريك الوحدات فعليًا وتوقيت التيكات
//   يفضلوا شغل Simulation Engine بالكامل (راجع simulationEngine.js).
// - مفيش هنا أي استيراد أو معرفة بالـ AI، الـ Replay System، الـ Frontend،
//   ولا Battle Report - الملف ده بيعرف بس عن نفسه + مفردات الـ Event Bus
//   المشتركة (SIMULATION_EVENT/BattleTimeline/SimulationEventBus) اللي
//   simulationEngine.js بيصدّرها، بنفس فلسفة ruleEngine.js بالظبط.
// - مفيش هنا أي اتصال بـ Mongoose/battle.model - الوحدات والمباني اللي
//   المحرك ده بيقاتل بيها/عليها لازم تتسجّل فيه صراحةً (registerCombatant/
//   registerStructure) من طرف مستخدم الملف ده - ده بيسيبه قابل للاختبار
//   بالكامل من غير قاعدة بيانات، ونفس الفلسفة اللي خلّت Simulation/Rule
//   Engine ماتعرفش حاجة عن battle.service.js.
// - مورال المعركة **بيتحسب ويتعرض بس هنا** (getMorale/getAllMorale) - مفيش
//   ولا سطر واحد كود بيقرر حاجة تكتيكية بناءً على القيمة دي (زي "هرب لو
//   المورال قل عن كذا"). القرار ده شغل Rule Engine (أو AI مستقبلي) اللي
//   هيقرا القيمة من هنا ويقرر بمنطقه الخاص - راجع moraleSystem.js لتفاصيل
//   إضافية عن نفس الحد.

'use strict';

const {
  SIMULATION_EVENT,
  BattleTimeline,
  SimulationEventBus,
  DEFAULT_TICK_RATE_MS,
} = require('./simulationEngine');

// ---------------------------------------------------------------------------
// نظام الضرر (Damage System) - damage.config.js بيحمل القيم/الجداول القابلة
// للتعديل (troop counters, damage type mitigation profiles...) و
// damageEngine.js بيحمل خط الحساب الحتمي (pipeline) نفسه اللي بيقرا منها.
// الملف ده (combatEngine.js) بيستخدمهم بس - مايعيدش تعريف أي قيمة توازن هنا،
// نفس فلسفة الفصل بين ruleEngine.js والقيم اللي بيقيّم عليها.
// ---------------------------------------------------------------------------
const {
  DAMAGE_TYPE,
  TROOP_TYPE,
  isValidDamageType,
  isValidTroopType,
  getDefaultDamageTypeForTroopType,
  DEFAULT_ATTACK_SPEED,
} = require('./damage.config');
const {
  computeDamage: computeDamagePipeline,
  computeCooldownTicks,
  isAttackReady,
} = require('./damageEngine');

// ---------------------------------------------------------------------------
// نظام المُعدِّلات (Modifier System) - modifierSystem.js بيحمل دورة حياة كل
// المودفيرز المؤقتة/الدائمة (تسجيل/تكديس/تجميع/انتهاء صلاحية) بشكل عام تمامًا
// (generic) - الملف ده (combatEngine.js) بيستخدمه بس زي ما بيستخدم
// damageEngine.js بالظبط: بينادي addModifier/removeModifier/getActiveModifiers/
// updateModifiers ويطبّق الأثر الصافي وقت حساب الضرر، من غير ما يعرف حاجة
// عن *مين* بعت المودفير (قائد؟ تكنولوجيا؟ تحالف؟ معدات؟ مهارة مؤقتة؟) - كل
// اللي بيوصله هو `source` نصي حر + `type`/`value`/`duration_ticks`.
// ---------------------------------------------------------------------------
const {
  MODIFIER_TYPE,
  STACKING_MODE,
  MODIFIER_EVENT,
  ModifierStore,
  applyModifiersToAttacker,
  applyModifiersToTarget,
} = require('./modifierSystem');

// ---------------------------------------------------------------------------
// نظام المورال (Morale System) - moraleSystem.js بيحمل التخزين/الحساب العام
// (حد أدنى/أقصى قابلين للتهيئة + الأسباب الأربعة المطلوبة) بشكل مستقل تمامًا
// عن Combat Engine (نفس فلسفة ModifierStore بالظبط). الملف ده (combatEngine.js)
// بيستخدمه بس: بيسجّل مورال ابتدائي لكل وحدة وقت registerCombatant، وبينادي
// applyHeavyLosses/applyCommanderDeath/applySuccessfulAttack/applyNearbyAllies
// في اللحظات القتالية المناسبة، وبينشر MORALE_CHANGED على الـ combatLog/
// Event Bus بنفس شكل باقي أحداث القتال - **بدون أي قرار تكتيكي مبني على
// القيمة دي** (راجع حدود المسؤولية في أعلى moraleSystem.js).
// ---------------------------------------------------------------------------
const {
  MORALE_CHANGE_REASON,
  DEFAULT_MORALE_MIN,
  DEFAULT_MORALE_MAX,
  DEFAULT_MORALE_INITIAL,
  DEFAULT_MORALE_RULES,
  MoraleStore,
} = require('./moraleSystem');

// ---------------------------------------------------------------------------
// نظام الإحصائيات (Statistics System) - statisticsSystem.js بيحمل تجميع/عرض
// كل إحصائيات القتال الحية (total_damage, units_killed, units_lost,
// buildings_destroyed, damage_by_type, damage_by_unit) بشكل عام تمامًا، نفس
// فلسفة MoraleStore/ModifierStore بالظبط. الملف ده (combatEngine.js) بيستخدمه
// بس: بينادي recordDamage/recordUnitKilled/recordBuildingDestroyed في اللحظات
// القتالية المناسبة (نفس اللحظات اللي بتنشر فيها DAMAGE_DEALT/UNIT_KILLED/
// BUILDING_DESTROYED) وبيعرض اللقطة الكاملة عن طريق getStatistics().
// ---------------------------------------------------------------------------
const { CombatStatisticsTracker } = require('./statisticsSystem');

// نطاق "قرب الحلفاء" الافتراضي (Requirement: nearby allies) - نفس وحدة قياس
// المسافة المستخدمة في range/isInRange فوق (مسافة إقليدية بسيطة، مفيش
// باثفايندنج). قابل للتجاوز بالكامل وقت إنشاء CombatEngine (راجع الـ
// constructor تحت).
const DEFAULT_NEARBY_ALLIES_RADIUS = 3;

const COMBAT_ENGINE_VERSION = '0.5.0-statistics-final-events';

// ---------------------------------------------------------------------------
// Requirement 3: أنواع أفعال القتال (Combat Actions) - مفردات خاصة بالـ
// Combat Engine نفسه، مختلفة عن ACTION_TYPE بتاع Simulation Engine (حركة
// بس: move/rotate/wait/...) وعن PLAN_ACTION_TYPE بتاع Rule Engine (مفردات
// خطة اللاعب الخام زي attack_gate/defend_gate). التحريك (Movement) نفسه
// يفضل شغل Simulation Engine بالكامل - مفيش أي نوع "move" هنا.
// ---------------------------------------------------------------------------
const COMBAT_ACTION_TYPE = {
  ATTACK_UNIT: 'attack_unit',
  ATTACK_BUILDING: 'attack_building',
  DEFEND_POSITION: 'defend_position',
  HOLD_POSITION: 'hold_position',
};

// ---------------------------------------------------------------------------
// Requirement 4: استراتيجيات اختيار الهدف (Target Selection) - كل استراتيجية
// هنا بس بتختار عنصر من قايمة أهداف *موجودة بالفعل* (وحدات/مباني بتالكة
// للعدو) - مفيش أي "قرار ذكي" هنا، مجرد قاعدة ترتيب/فلترة ثابتة.
// ---------------------------------------------------------------------------
const TARGET_SELECTION_STRATEGY = {
  NEAREST: 'nearest',
  LOWEST_HP: 'lowest_hp',
  HIGHEST_THREAT: 'highest_threat',
  BUILDING_PRIORITY: 'building_priority',
  COMMANDER_PRIORITY: 'commander_priority',
  MANUAL_TARGET: 'manual_target',
};

// أولوية أنواع المباني وقت BUILDING_PRIORITY - بوابة الأول (أهم نقطة اقتحام)،
// بعدها برج (تهديد نشط)، بعدها سور، وأخيرًا مبنى عادي. رقم أعلى = أولوية أعلى.
const STRUCTURE_TYPE_PRIORITY = {
  gate: 4,
  tower: 3,
  wall: 2,
  building: 1,
};

// ---------------------------------------------------------------------------
// Requirement 6: أحداث الـ Combat Engine - بتتنشر على نفس الـ Simulation
// Event Bus اللي انحقن للمحرك (نفس فلسفة RULE_EVENT في ruleEngine.js) عشان
// أي نظام تاني (Building Interaction, Replay System, Battle Report) يقدر
// يعمل subscribe من غير ما يعرف حاجة عن الـ Combat Engine نفسه.
// ---------------------------------------------------------------------------
const COMBAT_EVENT = {
  DAMAGE_DEALT: 'combat:damage_dealt',
  UNIT_KILLED: 'combat:unit_killed',
  BUILDING_DAMAGED: 'combat:building_damaged',
  // Requirement (أحداث القتال النهائية): بينشر مرة واحدة بالظبط لحظة ما مبنى/
  // تحصين يوصل لـ hp صفر (destroyed=true) - مختلف عن BUILDING_DAMAGED اللي
  // بينشر مع *كل* ضربة (تدمير أو لأ). Building Interaction/Replay System/
  // Battle Report يقدروا يستهلكوا الحدث ده مباشرة من غير ما يحتاجوا يفلتروا
  // BUILDING_DAMAGED بأنفسهم بحثًا عن `destroyed: true`.
  BUILDING_DESTROYED: 'combat:building_destroyed',
  // Requirement: تتبّع الخسائر - بينشر مع كل تغيير فعلي في killed/wounded/
  // remaining لوحدة معيّنة (مش مع كل ضربة - راجع _applyDamageToUnit تحت).
  CASUALTY_UPDATED: 'combat:casualty_updated',
  // Requirement: نظام المورال - بينشر مع أي تغيير فعلي (بعد الـ clamp) في
  // مورال أي وحدة، بغض النظر عن السبب (MORALE_CHANGE_REASON.*).
  MORALE_CHANGED: 'combat:morale_changed',
  // Requirement (أحداث القتال النهائية): بينشر مرة واحدة بالظبط لحظة ما وحدة
  // مسجّلة بـ `commander: true` تموت - حدث إضافي فوق UNIT_KILLED العادي (مش
  // بديل عنه)، عشان أي مستهلك (Rule Engine مستقبلًا، Battle Report) يقدر
  // يتفاعل مع "موت قائد" تحديدًا من غير ما يفحص `commander` بنفسه على كل
  // UNIT_KILLED. القائد نفسه بيتشال من تتبّع المورال في نفس اللحظة (راجع
  // _applyDamageToUnit تحت) - نفس ترتيب النشر: UNIT_KILLED الأول ثم
  // COMMANDER_DEFEATED.
  COMMANDER_DEFEATED: 'combat:commander_defeated',
  // ====== Auto-Turret / Traps: بينشر مرة واحدة بالظبط لحظة ما فخ (structure
  // بـ single_use=true) يتفعّل ويضرب وحدة مهاجمة - مختلف عن DAMAGE_DEALT
  // العادي (اللي بينشر برضه لنفس الضربة) بس ده تحديدًا بيوضّح "الفخ اتستهلك
  // دلوقتي ومش هيتفعّل تاني" - مفيد لـ Building Interaction/الفرونت إند عشان
  // يعرض تأثير بصري مختلف عن ضربة برج عادية متكررة.
  TRAP_TRIGGERED: 'combat:trap_triggered',
};

// ---------------------------------------------------------------------------
// Auto-Turret: نوع الضرر الافتراضي لأي منشأة دفاعية بتطلق نار تلقائيًا (برج/
// فخ) لو مالهاش damage_type محدد صراحةً وقت التسجيل - نفس فلسفة
// TROOP_TYPE_DEFAULT_DAMAGE_TYPE بتاعة الوحدات في damage.config.js بالظبط،
// بس للمنشآت. الأبراج بترمي سهام (ranged)، الفخاخ ضربة ميكانيكية مفاجئة
// بتتجاهل الدرع/الدفاع تمامًا (true_damage - نادر عمدًا زي ما damage.config.js
// موضّح، بس منطقي جدًا لفخ بيطعن/يطبق فجأة على وحدة داخلة فيه).
// ---------------------------------------------------------------------------
const DEFAULT_STRUCTURE_DAMAGE_TYPE = {
  tower: DAMAGE_TYPE.RANGED,
  trap: DAMAGE_TYPE.TRUE_DAMAGE,
};

function getDefaultDamageTypeForStructureType(structureType) {
  return DEFAULT_STRUCTURE_DAMAGE_TYPE[structureType] || DAMAGE_TYPE.SIEGE;
}

// =============================================================================
// دوال مساعدة صغيرة (Helpers) - نفس أسلوب ruleEngine.js بالظبط (مفيش حساب
// قتالي فيها، مجرد هندسة/قراءة بيانات)
// =============================================================================
function distance(a, b) {
  const dx = (a?.x ?? 0) - (b?.x ?? 0);
  const dy = (a?.y ?? 0) - (b?.y ?? 0);
  return Math.sqrt(dx * dx + dy * dy);
}

// معرّفات الوحدات بتتبني بالشكل `owner:troopKey:index` (راجع
// buildUnitGroupsFromSnapshot في simulationEngine.js) - بنستخدمها كـ fallback
// بس لو الطرف المستخدم مابعتش owner صريح وقت التسجيل.
function inferOwnerFromId(id) {
  const str = String(id ?? '');
  const sepIndex = str.indexOf(':');
  return sepIndex === -1 ? null : str.slice(0, sepIndex);
}

function getHp(candidate) {
  return candidate.kind === 'structure' ? candidate.hp : candidate.stats?.hp ?? 0;
}

// ---------------------------------------------------------------------------
// Requirement 5: فحص المدى - وحدة/مبنى مايقدرش يهاجم هدف برّه مداه. فحص
// هندسي بسيط بس (مسافة إقليدية بين موقعين) - مفيش باثفايندنج ولا حركة هنا.
// ---------------------------------------------------------------------------
function isInRange(attackerPosition, targetPosition, range) {
  if (!Number.isFinite(range)) return false;
  return distance(attackerPosition, targetPosition) <= range;
}

// =============================================================================
// Requirement 4: اختيار الهدف - كل استراتيجية بترجّع عنصر واحد من `candidates`
// (أو null لو مفيش هدف صالح) - بدون أي تعديل لحالة أي حاجة.
// =============================================================================
function selectTarget({ strategy, manualTargetId, position, candidates }) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  switch (strategy) {
    case TARGET_SELECTION_STRATEGY.MANUAL_TARGET: {
      // Requirement 4: manual_target - هدف محدد صراحةً من اللاعب/الخطة. لو
      // مش موجود أو مات، مفيش fallback تلقائي لاستراتيجية تانية - الهجوم
      // ببساطة مايحصلش التيك ده (اللاعب هو اللي يقرر يغيّر الهدف بنفسه).
      return candidates.find((c) => c.id === manualTargetId) || null;
    }

    case TARGET_SELECTION_STRATEGY.LOWEST_HP: {
      return candidates.reduce((best, c) => (getHp(c) < getHp(best) ? c : best));
    }

    case TARGET_SELECTION_STRATEGY.HIGHEST_THREAT: {
      return candidates.reduce((best, c) => ((c.threat ?? 0) > (best.threat ?? 0) ? c : best));
    }

    case TARGET_SELECTION_STRATEGY.BUILDING_PRIORITY: {
      return candidates.reduce((best, c) => {
        const cPriority = STRUCTURE_TYPE_PRIORITY[c.type] ?? 0;
        const bestPriority = STRUCTURE_TYPE_PRIORITY[best.type] ?? 0;
        if (cPriority !== bestPriority) return cPriority > bestPriority ? c : best;
        return distance(position, c.position) < distance(position, best.position) ? c : best;
      });
    }

    case TARGET_SELECTION_STRATEGY.COMMANDER_PRIORITY: {
      const commanders = candidates.filter((c) => c.commander === true);
      const pool = commanders.length > 0 ? commanders : candidates;
      return pool.reduce((best, c) =>
        distance(position, c.position) < distance(position, best.position) ? c : best
      );
    }

    case TARGET_SELECTION_STRATEGY.NEAREST:
    default: {
      return candidates.reduce((best, c) =>
        distance(position, c.position) < distance(position, best.position) ? c : best
      );
    }
  }
}

// ---------------------------------------------------------------------------
// معادلة الضرر (Damage Formula) - Requirements 1-4: القديمة كانت placeholder
// بسيط (attack - defense * 0.5) بدون armor/attack_speed/troop_type ولا أي
// مفهوم "نوع ضرر". دلوقتي هي بس wrapper رفيع فوق damageEngine.computeDamage
// (خط الأنابيب الحتمي الكامل: troop counters + armor/defense mitigation حسب
// نوع الضرر + مضاعف المباني) - القيمة الراجعة نفس الشكل القديم بالظبط (رقم
// واحد) عشان أي كود قديم بينادي عليها لسه يشتغل من غير تعديل. _resolveOrder
// تحت بينادي على damageEngine.computeDamage مباشرة (مش الدالة دي) عشان
// يستخدم الـ breakdown الكامل في حدث COMBAT_EVENT.DAMAGE_DEALT.
// ---------------------------------------------------------------------------
function computeDamage(attacker, target, damageType) {
  const resolvedDamageType =
    damageType || getDefaultDamageTypeForTroopType(attacker?.troop_type);
  return computeDamagePipeline({ attacker, target, damageType: resolvedDamageType }).damage;
}

// =============================================================================
// CombatUnitStore - نسخة قتالية محلية للوحدات المشاركة في الاشتباك (attack/
// defense/hp/range/threat/commander) - مختلفة عمدًا عن UnitStateStore بتاع
// Simulation Engine (اللي بيتابع بس position/destination/action/formation من
// غير أي رقم قتالي). بنتزامن مع مواقع/حياة Simulation Engine عن طريق
// UNIT_UPDATED بس - أي رقم قتالي (hp الحقيقي بعد الضرر، attack، defense)
// بيتسجّل ويتحدّث هنا فقط.
// =============================================================================
class CombatUnitStore {
  constructor() {
    this._units = new Map();
  }

  /**
   * @param {{id:string, owner?:string, position?:{x:number,y:number},
   *   stats:{attack:number, defense:number, hp:number, armor?:number,
   *   attack_speed?:number}, troop_type?:string, damage_type?:string,
   *   range?:number, threat?:number, commander?:boolean, alive?:boolean,
   *   troop_count?:number, modifiers?:Array}} unit
   */
  register(unit) {
    if (!unit || !unit.id) {
      throw new Error('كل وحدة قتالية لازم يكون ليها id فريد');
    }
    const owner = unit.owner ?? inferOwnerFromId(unit.id);
    // Requirement (تتبّع الخسائر): عدد الجنود اللي الوحدة/الكومة دي بتمثّلهم
    // فعليًا (troop group) - افتراضي 1 لو مش مبعوت صراحةً، عشان أي كود قديم
    // مانداش troop_count يشتغل بالظبط زي الأول (جندي واحد = وحدة واحدة،
    // stats.hp بتاعها = hp الجندي ده بالظبط، مفيش "خسائر جزئية" ممكنة).
    const troopCount =
      Number.isFinite(unit.troop_count) && unit.troop_count > 0 ? Math.floor(unit.troop_count) : 1;
    const state = {
      id: unit.id,
      owner,
      kind: 'unit',
      position: unit.position ?? { x: 0, y: 0 },
      stats: {
        attack: unit.stats?.attack ?? 0,
        defense: unit.stats?.defense ?? 0,
        hp: unit.stats?.hp ?? 0,
        max_hp: unit.stats?.hp ?? 0,
        // Requirement 1: الدرع - قيمة منفصلة عن defense (defense بيوصف مهارة
        // قتالية/تكتيك، armor بيوصف حماية جسدية فعلية) - كل نوع ضرر بيتأثر
        // بيهم بنسبة مختلفة (راجع DAMAGE_TYPE_MITIGATION_PROFILE).
        armor: Number.isFinite(unit.stats?.armor) ? unit.stats.armor : 0,
        // Requirement 1: سرعة الهجوم - هجمة/ثانية. بتتحول لعدد تيكات تبريد
        // (راجع computeCooldownTicks) بدل ما تضاعف الضرر مباشرة - وده اللي
        // بيخلي وحدة سريعة فعلاً "تضرب أكتر" مش بس "تضرب أقوى في كل تيك".
        attack_speed: Number.isFinite(unit.stats?.attack_speed)
          ? unit.stats.attack_speed
          : DEFAULT_ATTACK_SPEED,
      },
      // Requirement 1: تصنيف الوحدة (TROOP_TYPE.*) - أساس جدول الـ counters
      // (Requirement 2). null صراحةً لو الطرف المستخدم ما بعتوش (بيرجع لتعادل
      // تكتيكي كامل - راجع getTroopCounterMultiplier في damage.config.js).
      troop_type: isValidTroopType(unit.troop_type) ? unit.troop_type : null,
      // Requirement 3: نوع الضرر الافتراضي لهجمات الوحدة دي - لو مش محدد
      // صراحةً وقت التسجيل، بيتحدد تلقائيًا من troop_type (سيف = melee، سهم =
      // ranged...)، وبرضو ممكن يتجاوَز لكل أمر على حدة عن طريق order.damage_type
      // (مهارة/تكنولوجيا مستقبلية تخلي نفس الوحدة تضرب fire مؤقتًا مثلاً).
      damage_type: isValidDamageType(unit.damage_type)
        ? unit.damage_type
        : getDefaultDamageTypeForTroopType(unit.troop_type),
      // Requirement: نقطة توسّع المهارات/التكنولوجيا (راجع MODIFIER_STAGE في
      // damageEngine.js) - مصفوفة modifiers اختيارية بتتطبق وقت الحساب من
      // غير ما damageEngine.js أو combatEngine.js يحتاجوا يعرفوا مصدرها.
      modifiers: Array.isArray(unit.modifiers) ? unit.modifiers : [],
      // Requirement 5: مدى الهجوم - لازم يتحدد وقت التسجيل (وحدة قتال قريب
      // زي المقاتل بالسيف بيكون مداها صغير، رامي السهام مداه أكبر...) -
      // الملف ده مايفترضش قيمة "منطقية" لنوع معيّن، بس يديله افتراضي آمن (1).
      range: Number.isFinite(unit.range) ? unit.range : 1,
      threat: unit.threat ?? 0,
      commander: unit.commander === true,
      status: unit.status ?? 'idle',
      alive: unit.alive ?? true,
      // Requirement: تتبّع آخر تيك ضربت فيه الوحدة دي فعليًا - null يعني لسه
      // ما ضربتش خالص (جاهزة تضرب فورًا أول ما يتوفر هدف صالح في المدى).
      last_attack_tick: null,
      // Requirement (تتبّع الخسائر): إحصائية الخسائر بتاعة الكومة دي -
      // troops_total ثابتة من وقت التسجيل، troops_remaining بتقل مع كل قتل،
      // troops_killed/troops_wounded تراكميين. hp_per_troop بتحسب مرة واحدة
      // هنا (max_hp الكلي ÷ عدد الجنود) وبتستخدم كـ "وحدة قياس" ثابتة لتوزيع
      // أي ضرر لاحق على عدد جنود مقتولين/مصابين - راجع applyDamage تحت لتفاصيل
      // نموذج الحساب المبسّط (كل جنود الكومة الواحدة متساويين في الـ hp).
      casualties: {
        troops_total: troopCount,
        troops_remaining: troopCount,
        troops_killed: 0,
        troops_wounded: 0,
        hp_per_troop: troopCount > 0 ? (unit.stats?.hp ?? 0) / troopCount : unit.stats?.hp ?? 0,
      },
    };
    this._units.set(state.id, state);
    return state;
  }

  /** بيطبّق ضرر فعلي على وحدة - بيرجّع الحالة بعد التحديث + علم هل ماتت التيك
   * ده + دلتا الخسائر (جنود اتقتلوا/اتصابوا في الضربة دي بالظبط - راجع
   * casualties في register() فوق لشرح النموذج). */
  applyDamage(id, amount) {
    const unit = this._units.get(id);
    if (!unit || unit.alive === false) return null;
    const wasAlive = unit.alive;
    const dmg = Math.max(0, amount);
    unit.stats.hp = Math.max(0, unit.stats.hp - dmg);
    if (unit.stats.hp <= 0) unit.alive = false;

    // Requirement (تتبّع الخسائر): نحسب عدد الجنود اللي ماتوا فعليًا في
    // الضربة دي من الـ hp الكلي المتبقي، مقسومًا على hp_per_troop الثابت من
    // وقت التسجيل - نموذج مبسّط بيفترض كل جنود الكومة الواحدة متساويين في
    // الـ hp (مفيش تتبّع فردي لكل جندي - غير مطلوب هنا، الملف ده بيحسب
    // إحصائية الكومة ككل بس).
    const casualties = unit.casualties;
    let killedThisHit = 0;
    let woundedThisHit = 0;
    if (casualties && casualties.hp_per_troop > 0) {
      const troopsBefore = casualties.troops_remaining;
      const troopsAfter =
        unit.stats.hp > 0 ? Math.min(troopsBefore, Math.ceil(unit.stats.hp / casualties.hp_per_troop)) : 0;
      killedThisHit = Math.max(0, troopsBefore - troopsAfter);
      // "مصاب" (wounded) = فيه على الأقل جندي واحد من الباقيين مش بكامل
      // صحته (الـ hp المتبقي مش مضاعف تام لعدد الجنود الباقيين) - حدث واحد
      // بيتسجّل لكل ضربة بتصيب من غير ما تقتل، مش عدد الجنود المصابين فرديًا
      // (تبسيط مقصود - راجع الملاحظة فوق).
      const partialDamageOnSurvivor = troopsAfter > 0 && unit.stats.hp < troopsAfter * casualties.hp_per_troop;
      woundedThisHit = dmg > 0 && partialDamageOnSurvivor ? 1 : 0;

      casualties.troops_killed += killedThisHit;
      casualties.troops_wounded += woundedThisHit;
      casualties.troops_remaining = troopsAfter;
    }

    return {
      unit,
      killed: wasAlive && !unit.alive,
      casualty_delta:
        casualties && (killedThisHit > 0 || woundedThisHit > 0)
          ? { killed_this_hit: killedThisHit, wounded_this_hit: woundedThisHit }
          : null,
    };
  }

  /** بيتزامن مع UNIT_UPDATED الجاي من Simulation Engine - موقع/حياة بس،
   * مفيش أي رقم قتالي بيتحدث من هنا (Simulation Engine مايعرفش عنهم أصلًا) */
  syncFromSimulation(patch) {
    if (!patch || !patch.id) return;
    const unit = this._units.get(patch.id);
    if (!unit) return; // وحدة مش متسجّلة في الـ Combat Engine - مش شغلنا
    if (patch.position) unit.position = patch.position;
    if (patch.status !== undefined) unit.status = patch.status;
    if (patch.alive !== undefined) unit.alive = patch.alive;
  }

  get(id) {
    return this._units.get(id) || null;
  }

  /** إحصائية الخسائر الحالية بتاعة وحدة/كومة معيّنة - null لو مش متسجّلة. */
  getCasualties(id) {
    const unit = this._units.get(id);
    return unit ? unit.casualties : null;
  }

  getAll() {
    return Array.from(this._units.values());
  }

  /** كل الوحدات الحية اللي مش بتاعة نفس المالك - Requirement 4 (مصدر الأهداف) */
  getAllEnemyOf(owner) {
    return this.getAll().filter((u) => u.alive !== false && u.owner !== owner);
  }

  clear() {
    this._units.clear();
  }
}

// =============================================================================
// StructureStore - نسخة قتالية محلية للمباني/الأسوار/الأبراج/البوابات.
// نفس فلسفة CombatUnitStore بالظبط، بس للأهداف الثابتة (مالهاش موقع بيتغيّر
// ولا يتزامن مع UNIT_UPDATED خالص - مفيش "وحدة مبنى" في Simulation Engine).
// =============================================================================
class StructureStore {
  constructor() {
    this._structures = new Map();
  }

  /**
   * @param {{id:string, type:'gate'|'tower'|'wall'|'building', owner?:string,
   *   position?:{x:number,y:number}, hp:number, range?:number, armor?:number,
   *   defense?:number, modifiers?:Array}} structure
   */
  register(structure) {
    if (!structure || !structure.id) {
      throw new Error('كل مبنى/تحصين لازم يكون ليه id فريد');
    }
    if (!Number.isFinite(structure.hp)) {
      // مفيش نظام "صحة مبنى" حقيقي في battle.model لسه (hp بيبدأ null هناك)
      // - الـ Combat Engine نفسه مستقل عن الموديل، فبيتطلّب hp رقمي صريح
      // وقت التسجيل هنا عشان يقدر يحسب عليه فعليًا؛ توصيل القيمة الحقيقية
      // (لما نظام صحة المباني يتبنى) شغل الطرف اللي بيستدعي registerStructure.
      throw new Error(`المبنى "${structure.id}": لازم تحدد hp رقمي وقت التسجيل`);
    }
    const state = {
      id: structure.id,
      owner: structure.owner ?? null,
      kind: 'structure',
      type: structure.type ?? 'building',
      position: structure.position ?? { x: 0, y: 0 },
      hp: structure.hp,
      max_hp: structure.hp,
      // Requirement 4: نفس حقول armor/defense بتاعة الوحدات - عشان المباني
      // تستخدم *نفس* دالة damageEngine.computeDamage بدون أي حالة خاصة
      // (special-casing) - سور مرقّى فعليًا بيدرّع (armor) أعلى، مش مجرد hp
      // أكبر. افتراضي صفر (لا حماية) لو المبنى ما حددش.
      armor: Number.isFinite(structure.armor) ? structure.armor : 0,
      defense: Number.isFinite(structure.defense) ? structure.defense : 0,
      // Requirement: نقطة توسّع مهارات/تكنولوجيا دفاعية (تحصين مؤقت، درع
      // سحري على السور...) - نفس فلسفة modifiers بتاعة الوحدات بالظبط.
      modifiers: Array.isArray(structure.modifiers) ? structure.modifiers : [],
      destroyed: false,

      // ====== Auto-Turret / Traps: أي منشأة (برج/فخ) عندها damage/range
      // رقميين فعليين بقت "قادرة تهاجم"، مش بس هدف - راجع
      // CombatEngine._resolveStructureAutoFire تحت. سور/بوابة/مبنى عادي
      // (damage=null) يفضلوا أهداف بس، بالظبط زي الأول. القيم دي جايّة من
      // نظام الدفاع الحقيقي (defense.config combat_stats) عن طريق
      // battle.snapshot.service.js/battle.runner.js - مفيش رقم مخترع هنا. ======
      damage: Number.isFinite(structure.damage) && structure.damage > 0 ? structure.damage : null,
      range: Number.isFinite(structure.range) && structure.range > 0 ? structure.range : null,
      attack_speed: Number.isFinite(structure.attack_speed) ? structure.attack_speed : DEFAULT_ATTACK_SPEED,
      damage_type: isValidDamageType(structure.damage_type) ? structure.damage_type : null,
      // الفخاخ (single_use) بتتفعّل مرة واحدة بس وتتستهلك - "consumed" بيمنعها
      // تطلق تاني حتى لو لسه واقفة (hp لسه أكبر من صفر - "destroyed" مختلف
      // تمامًا عن "consumed": الأول معناه اتضربت لحد ما اتكسرت، التاني معناه
      // اتفعّلت مرة واحدة زي ما المفروض).
      single_use: structure.single_use === true,
      consumed: false,
      last_attack_tick: null,
    };
    this._structures.set(state.id, state);
    return state;
  }

  applyDamage(id, amount) {
    const structure = this._structures.get(id);
    if (!structure || structure.destroyed) return null;
    const wasDestroyed = structure.destroyed;
    structure.hp = Math.max(0, structure.hp - Math.max(0, amount));
    if (structure.hp <= 0) structure.destroyed = true;
    return { structure, destroyed: !wasDestroyed && structure.destroyed };
  }

  get(id) {
    return this._structures.get(id) || null;
  }

  getAll() {
    return Array.from(this._structures.values());
  }

  /** كل المباني اللي لسه واقفة وبتاعة عدو - Requirement 4 (مصدر أهداف Attack Building) */
  getAllEnemyOf(owner) {
    return this.getAll().filter((s) => !s.destroyed && s.owner !== owner);
  }

  clear() {
    this._structures.clear();
  }
}

// =============================================================================
// CombatEngine - القلب: يستقبل أوامر قتال (Combat Actions)، يخزّنها كـ "أمر
// واقف" (standing order) لكل وحدة مصدر، وبيحاول يحسمها كل تيك (evaluated
// on TICK_COMPLETED) - نفس فلسفة evaluateTick بتاعة RuleEngine، بس بدل ما
// نقيّم شروط لاعب، بنحاول ننفّذ فعل قتالي فعلي مع فحص مدى + اختيار هدف.
// =============================================================================
class CombatEngine {
  /**
   * @param {object} [options]
   * @param {object} [options.eventBus] - نفس الـ Simulation Event Bus (أي
   *   أوبچكت فيه on/off/emit) - لو مش مبعوت بيتعمل واحد محلي (اختبار معزول
   *   بس، مفيش subscribe تلقائي على محرك حقيقي في الحالة دي).
   * @param {number} [options.tickRateMs] - **بس** عشان تحويل attack_speed
   *   (هجمة/ثانية) لعدد تيكات تبريد (راجع damageEngine.computeCooldownTicks) -
   *   المفروض تتبعت هي نفسها SimulationEngine.tickRateMs بتاعة نفس المعركة
   *   (نفس فلسفة random_seed في battle.config.js: قيمة واحدة متزامنة بين
   *   المحركات عشان أي إعادة حساب/replay يطلع بنفس النتيجة بالظبط). لو مش
   *   مبعوتة بترجع لـ DEFAULT_TICK_RATE_MS بتاعة Simulation Engine نفسها.
   * @param {number} [options.moraleMin] - Requirement 3: الحد الأدنى للمورال
   *   (افتراضي DEFAULT_MORALE_MIN من moraleSystem.js)
   * @param {number} [options.moraleMax] - Requirement 3: الحد الأقصى للمورال
   *   (افتراضي DEFAULT_MORALE_MAX)
   * @param {number} [options.moraleInitial] - المورال الابتدائي الافتراضي لأي
   *   وحدة جديدة لو مابعتش `morale` صريحة وقت registerCombatant
   * @param {object} [options.moraleRules] - تجاوز جزئي/كامل لـ
   *   DEFAULT_MORALE_RULES (قيم كل سبب - راجع moraleSystem.js)
   * @param {number} [options.nearbyAlliesRadius] - نطاق حساب "الحلفاء
   *   القريبين" (Requirement: nearby allies) - افتراضي
   *   DEFAULT_NEARBY_ALLIES_RADIUS
   */
  constructor({
    eventBus = null,
    tickRateMs = DEFAULT_TICK_RATE_MS,
    moraleMin = DEFAULT_MORALE_MIN,
    moraleMax = DEFAULT_MORALE_MAX,
    moraleInitial = DEFAULT_MORALE_INITIAL,
    moraleRules = {},
    nearbyAlliesRadius = DEFAULT_NEARBY_ALLIES_RADIUS,
  } = {}) {
    this.eventBus = eventBus || new SimulationEventBus();
    this.tickRateMs = Number.isFinite(tickRateMs) && tickRateMs > 0 ? tickRateMs : DEFAULT_TICK_RATE_MS;

    this._units = new CombatUnitStore();
    this._structures = new StructureStore();

    // Requirement 1: نظام المُعدِّلات العام - مخزن واحد مشترك لأي هدف (وحدة
    // أو مبنى، نفس المنطق بالظبط) بيستقبل modifiers مُجمّعة من أنظمة خارجية.
    // بيشارك نفس eventBus بتاع المحرك عشان أي نظام تاني (Simulation Engine
    // لعقوبة الحركة، UI لعرض الـ buffs...) يقدر يعمل subscribe على
    // MODIFIER_EVENT.* من غير ما يعرف حاجة عن Combat Engine نفسه.
    this._modifiers = new ModifierStore({ eventBus: this.eventBus });

    // Requirement (نظام المورال): مخزن مورال عام مستقل تمامًا (moraleSystem.js) -
    // **بدون** eventBus هنا عمدًا (بخلاف ModifierStore فوق) - CombatEngine هو
    // اللي بيحوّل كل تغيير مورال لحدث COMBAT_EVENT.MORALE_CHANGED كامل على
    // نفس الـ combatLog/eventBus بتاعه (نفس شكل DAMAGE_DEALT/UNIT_KILLED)
    // بدل ما ينشر حدث خام من نظام تاني بشكل مختلف - راجع _applyMoraleChange تحت.
    this._morale = new MoraleStore({
      min: moraleMin,
      max: moraleMax,
      initial: moraleInitial,
      rules: moraleRules,
    });
    this._nearbyAlliesRadius =
      Number.isFinite(nearbyAlliesRadius) && nearbyAlliesRadius >= 0
        ? nearbyAlliesRadius
        : DEFAULT_NEARBY_ALLIES_RADIUS;

    // Requirement 1 (إحصائيات المعركة): مخزن إحصائيات حي واحد لكل معركة -
    // بيتحدّث (recordDamage/recordUnitKilled/recordBuildingDestroyed) في نفس
    // اللحظات اللي بينشر فيها الحدث القتالي المقابل، مش في نهاية المعركة -
    // getStatistics() بيرجّع اللقطة الحالية في أي وقت أثناء أو بعد المعركة.
    this._stats = new CombatStatisticsTracker();

    // أمر واقف واحد بس لكل وحدة مصدر (source) - أمر جديد لنفس المصدر بيستبدل
    // القديم (نفس منطق "أحدث أمر يلغي اللي قبله" المنطقي لأي وحدة عسكرية).
    this._orders = new Map(); // source id -> order

    // Requirement 6/7: سجل كل حدث قتالي اتنشر - نفس شكل BattleTimeline
    // المستخدم في simulationEngine.js/ruleEngine.js (tick/timestamp/type/
    // source/target/payload) عشان Replay System/Battle Report يقدروا يدمجوه
    // مع باقي الخط الزمني من غير أي شكل مختلف.
    this.combatLog = new BattleTimeline();

    // ---- Requirement 2: الاشتراك في الـ Event Bus - الثلاثة بالظبط
    // المطلوبين، ومفيش أي حدث تاني بيتسمع منه ----
    this._unsubscribeActionDue = this.eventBus.on(SIMULATION_EVENT.ACTION_DUE, (event) =>
      this._handleActionDue(event)
    );
    this._unsubscribeUnitUpdated = this.eventBus.on(SIMULATION_EVENT.UNIT_UPDATED, (event) =>
      this._handleUnitUpdated(event)
    );
    this._unsubscribeTickCompleted = this.eventBus.on(SIMULATION_EVENT.TICK_COMPLETED, (event) =>
      this._handleTickCompleted(event)
    );
  }

  // ---------------------------------------------------------------------
  // تسجيل المشاركين - الطرف المستخدم (battle.service مستقبلًا) هو اللي بيغذي
  // المحرك بالوحدات/المباني اللي هيقاتل بيها/عليها (من battle.snapshot).
  // ---------------------------------------------------------------------
  registerCombatant(unit) {
    const state = this._units.register(unit);
    // Requirement (نظام المورال): كل وحدة قتالية بتتسجّل بمورال ابتدائي -
    // `unit.morale` صريحة لو مبعوتة (مثلاً وحدة نخبة بمورال أعلى من البداية)،
    // وإلا القيمة الافتراضية بتاعة الـ CombatEngine (moraleInitial). المباني
    // (registerStructure تحت) عمدًا **مالهاش** مورال - المفهوم ده خاص
    // بالجنود بس.
    this._morale.register(state.id, unit?.morale);
    return state;
  }

  registerStructure(structure) {
    return this._structures.register(structure);
  }

  getCombatant(id) {
    return this._units.get(id);
  }

  getStructure(id) {
    return this._structures.get(id);
  }

  getAllCombatants() {
    return this._units.getAll();
  }

  getAllStructures() {
    return this._structures.getAll();
  }

  // ---------------------------------------------------------------------
  // Requirement (تتبّع الخسائر): قراءة إحصائية الخسائر الحالية (units killed/
  // wounded/remaining troops) - مفيدة لـ Battle Report/Rule Engine من غير ما
  // يحتاجوا يعيدوا حساب أي حاجة بنفسهم.
  // ---------------------------------------------------------------------
  getCasualties(id) {
    return this._units.getCasualties(id);
  }

  // ---------------------------------------------------------------------
  // Requirement (نظام المورال): CombatEngine بيحسب ويعرض قيمة المورال بس -
  // مفيش أي API هنا بيتخذ قرار بناءً عليها؛ Rule Engine (أو أي نظام تاني)
  // هو اللي هيقرا القيمة دي ويقرر هو بمنطقه الخاص.
  // ---------------------------------------------------------------------
  getMorale(id) {
    return this._morale.get(id);
  }

  getAllMorale() {
    return this._morale.getAll();
  }

  /** الحدود/القواعد الفعلية المستخدمة لحساب المورال في المعركة دي - مفيد لأي
   * نظام تاني (Rule Engine) عايز يفسّر رقم المورال (مثلاً "أقل من 20% من
   * الحد الأقصى = منهارة معنويًا") من غير ما يفترض قيم ثابتة بنفسه. */
  getMoraleConfig() {
    return { min: this._morale.min, max: this._morale.max, rules: { ...this._morale.rules } };
  }

  // ---------------------------------------------------------------------
  // Requirement 1 (إحصائيات المعركة): قراءة اللقطة الحية الحالية لكل
  // إحصائيات القتال - مفيدة لـ Battle Report/Rule Engine/UI من غير ما
  // يحتاجوا يجمّعوا الأحداث بأنفسهم أو ينتظروا نهاية المعركة (بتتحدّث كل
  // ضربة/قتل/تدمير مبنى فعلي - راجع statisticsSystem.js لتفاصيل الشكل).
  // ---------------------------------------------------------------------
  getStatistics() {
    return this._stats.getStatistics();
  }

  // ---------------------------------------------------------------------
  // Requirement 6: APIs عامة لنظام المُعدِّلات - Combat Engine نفسه مش عارف
  // مين بعت المودفير ده (قائد/تكنولوجيا/تحالف/معدات/مهارة) - كل اللي بيعمله
  // هو تمرير الاستدعاء لـ ModifierStore وتطبيق الأثر الصافي وقت الحساب.
  // ---------------------------------------------------------------------
  /**
   * @param {string} targetId - id الوحدة أو المبنى المستهدف
   * @param {{id?:string, source:string, type:string, value:number,
   *   duration_ticks?:number|null, stackable?:boolean}} modifier
   */
  addModifier(targetId, modifier) {
    return this._modifiers.addModifier(targetId, modifier);
  }

  removeModifier(targetId, modifierId) {
    return this._modifiers.removeModifier(targetId, modifierId);
  }

  removeModifiersBySource(source, targetId = null) {
    return this._modifiers.removeModifiersBySource(source, targetId);
  }

  getActiveModifiers(targetId, type) {
    return this._modifiers.getActiveModifiers(targetId, type);
  }

  getAggregatedModifierValue(targetId, type) {
    return this._modifiers.getAggregatedValue(targetId, type);
  }

  /** بتتنادى تلقائيًا كل تيك (راجع _handleTickCompleted تحت) - متاحة كمان
   * كـ API عام لو طرف مستخدم عايز يتحكم في توقيتها بنفسه (اختبار مباشر). */
  updateModifiers(ticksElapsed = 1) {
    return this._modifiers.updateModifiers(ticksElapsed);
  }

  configureModifierStacking(type, mode) {
    return this._modifiers.configureStacking(type, mode);
  }

  // ---------------------------------------------------------------------
  // Requirement 3: أوامر القتال - issueOrder هو نفس اللي _handleActionDue
  // بينادي عليه لما يستقبل ACTION_DUE مناسب، بس متاح كـ API عام كمان (مفيد
  // للاختبار المباشر أو لو نظام تاني حابب يبعت أمر قتال مباشرة).
  // ---------------------------------------------------------------------
  /**
   * @param {{source:string, type:string, target?:string|null,
   *   target_selection?:string, manual_target_id?:string|null,
   *   range?:number, damage_type?:string}} order
   */
  issueOrder(order) {
    if (!order || !order.source) {
      throw new Error('أمر القتال لازم يكون ليه source (id الوحدة المنفّذة)');
    }
    if (!Object.values(COMBAT_ACTION_TYPE).includes(order.type)) {
      throw new Error(`نوع فعل قتالي غير معروف: "${order.type}"`);
    }
    const normalized = {
      source: order.source,
      type: order.type,
      target_selection: order.target_selection || null,
      manual_target_id: order.manual_target_id ?? order.target ?? null,
      range_override: Number.isFinite(order.range) ? order.range : null,
      // Requirement 3: تجاوز اختياري لنوع الضرر الافتراضي بتاع المهاجم - نقطة
      // التوسّع اللي بتسيب مهارة/تكنولوجيا مستقبلية (زي "سهم ناري") تخلي أمر
      // واحد بس يضرب بنوع ضرر مختلف من غير ما تغيّر تصنيف الوحدة نفسها.
      damage_type: isValidDamageType(order.damage_type) ? order.damage_type : null,
    };
    this._orders.set(order.source, normalized);
    return normalized;
  }

  clearOrder(sourceId) {
    this._orders.delete(sourceId);
  }

  getOrder(sourceId) {
    return this._orders.get(sourceId) || null;
  }

  getAllOrders() {
    return Array.from(this._orders.values());
  }

  // ---------------------------------------------------------------------
  // Requirement 2: مستمعات الـ Event Bus
  // ---------------------------------------------------------------------

  /** ACTION_DUE بييجي من Simulation Engine (تنفيذ فعل مجدول) أو ممكن يتنشر
   * مباشرة من Rule Engine/Battle Planner - أي نوع فعل مش من COMBAT_ACTION_TYPE
   * (زي move/rotate/wait بتاعة الحركة) بيتجاهله فورًا، مش شغل المحرك ده. */
  _handleActionDue(event) {
    if (!event || !Object.values(COMBAT_ACTION_TYPE).includes(event.type)) return;
    if (!event.source) return;

    const payload = event.payload || {};
    this.issueOrder({
      source: event.source,
      type: event.type,
      target: event.target,
      target_selection: payload.target_selection,
      manual_target_id: payload.manual_target_id,
      range: payload.range,
      damage_type: payload.damage_type,
    });
  }

  /** UNIT_UPDATED بييجي من UnitStateStore بتاع Simulation Engine - بنستخدمه
   * بس عشان نفضل متزامنين مع موقع/حياة الوحدة، مش عشان نحسب أي حاجة قتالية. */
  _handleUnitUpdated(event) {
    this._units.syncFromSimulation(event);
    // وحدة ماتت (من مصدر تاني غير الـ Combat Engine نفسه) - أمرها الواقف
    // بقى من غير معنى، فبنشيله عشان مايتحاولش يتنفذ تاني كل تيك.
    if (event && event.alive === false) {
      this.clearOrder(event.id);
      this._modifiers.clearTarget(event.id);
      this._morale.remove(event.id);
    }
  }

  /** التيك خلص - دلوقتي وقت محاولة حسم كل الأوامر الواقفة (Requirement 3/5) */
  _handleTickCompleted(event) {
    const tick = Number.isFinite(event?.tick) ? event.tick : 0;

    // Requirement 5: المودفيرز المؤقتة بتنقص تيك واحد بالظبط لكل TICK_COMPLETED
    // - بره أي وحدة أو أمر معيّن، عشان انتهاء الصلاحية يحصل حتى لو الهدف
    // مالوش أمر واقف دلوقتي (وحدة واقفة تدافع بس عندها buff مؤقت مثلاً).
    this._modifiers.updateModifiers(1);

    // Requirement (نظام المورال - قرب الحلفاء): بيتحسب كل تيك لكل الوحدات
    // الحية (مش بس اللي عندها أمر واقف) - نفس فلسفة تحديث المودفيرز فوق:
    // وحدة واقفة تدافع من غير أمر جديد لسه المفروض تحس بوجود حلفاء حواليها.
    this._updateNearbyAlliesMorale(tick);

    for (const order of Array.from(this._orders.values())) {
      try {
        this._resolveOrder(order, tick);
      } catch (err) {
        // خطأ في حسم أمر وحدة واحدة مايوقفش حسم باقي الوحدات
        console.error(`[CombatEngine] خطأ أثناء حسم أمر الوحدة "${order.source}":`, err);
      }
    }

    // ====== Auto-Turret / Traps: بعد ما كل الأوامر الواقفة بتاعة الوحدات
    // اتحسمت للتيك ده، بننادي auto-fire للمنشآت الدفاعية (أبراج/فخاخ) - نفس
    // ترتيب "الوحدات الأول" المستخدم أصلًا فوق (المودفيرز بعدين الأوامر) -
    // ده اللي بيضمن إن وحدة ماتت من ضربة وحدة تانية التيك ده مابقتش هدف
    // صالح لبرج/فخ في نفس التيك (getAllEnemyOf بيفلتر alive فقط - نفس فلسفة
    // "مفيش ضرب مزدوج" الموجودة أصلًا في فحص alive جوه applyDamage). ======
    this._resolveAutoDefenses(tick);
  }

  // ---------------------------------------------------------------------
  // Auto-Turret / Traps: نفس فلسفة _resolveOrder بالظبط بس المصدر مبنى
  // (برج/فخ) مش وحدة، والأمر نفسه ضمني ("هاجم أقرب عدو تلقائيًا") مش أمر
  // player-issued (مفيش issueOrder/ACTION_DUE هنا خالص) - مفيش أي "قرار ذكي"
  // إضافي: بس فحص مدى + سرعة هجوم (attack_speed/cooldown) + اختيار أقرب هدف،
  // نفس القواعد المستخدمة للوحدات بالظبط في _resolveOrder. لكل منشأة تسجّلت
  // بـ damage/range رقميين فعليًا (راجع StructureStore.register فوق) - سور/
  // بوابة/مبنى عادي (damage=null) مايتفحصوش هنا خالص، يفضلوا أهداف بس زي ما
  // كانوا بالظبط.
  // ---------------------------------------------------------------------
  _resolveAutoDefenses(tick) {
    for (const structure of this._structures.getAll()) {
      try {
        this._resolveStructureAutoFire(structure, tick);
      } catch (err) {
        console.error(`[CombatEngine] خطأ أثناء auto-fire المنشأة "${structure.id}":`, err);
      }
    }
  }

  _resolveStructureAutoFire(structure, tick) {
    if (structure.destroyed) return; // مبنى مدمّر - مايطلقش نار تاني
    if (!Number.isFinite(structure.damage) || !Number.isFinite(structure.range)) return; // هدف بس (سور/بوابة/مبنى عادي)
    // الفخاخ (single_use): اتفعّلت قبل كده = اتستهلكت - مايتفحصش حتى لو
    // hp لسه أكبر من صفر (راجع الفرق بين consumed و destroyed في
    // StructureStore.register).
    if (structure.single_use && structure.consumed) return;

    const candidates = this._units.getAllEnemyOf(structure.owner);
    if (!candidates.length) return; // مفيش هدف صالح دلوقتي - هيعاد المحاولة التيك الجاي

    // Requirement 4: استراتيجية اختيار هدف افتراضية واحدة بس للمنشآت (أقرب
    // عدو) - نفس NEAREST الافتراضية بتاعة _resolveOrder، مفيش تخصيص لكل نوع
    // برج لسه (توسّع مستقبلي محتمل لو احتجنا "أولوية للقادة" لبرج بالستا مثلًا).
    const target = selectTarget({
      strategy: TARGET_SELECTION_STRATEGY.NEAREST,
      position: structure.position,
      candidates,
    });
    if (!target) return;

    // Requirement 5: فحص المدى - فشل صامت زي _resolveOrder بالظبط.
    if (!isInRange(structure.position, target.position, structure.range)) return;

    // سرعة الهجوم/التبريد - نفس فحص isAttackReady المستخدم للوحدات بالظبط.
    if (
      !isAttackReady({
        lastAttackTick: structure.last_attack_tick,
        currentTick: tick,
        attackSpeed: structure.attack_speed,
        tickRateMs: this.tickRateMs,
      })
    ) {
      return;
    }

    const damageType = structure.damage_type || getDefaultDamageTypeForStructureType(structure.type);

    // ====== computeDamagePipeline (زي applyModifiersToAttacker) بيتوقع
    // "attacker" بشكل stats.attack/stats.attack_speed (نفس شكل CombatUnitStore
    // بالظبط) - المنشأة نفسها بتخزن damage/attack_speed على المستوى الأعلى
    // (مش جوه stats، راجع StructureStore.register) عشان مالهاش أي رقم قتالي
    // "وحدة" تاني (troop_type، defense هجومي...) - فبنبني هنا "واجهة مهاجم"
    // خفيفة بس لحظة الحساب، من غير ما نغيّر شكل التخزين الأصلي في
    // StructureStore خالص. ======
    const attackerView = {
      id: structure.id,
      kind: 'structure',
      owner: structure.owner,
      stats: { attack: structure.damage, attack_speed: structure.attack_speed },
      modifiers: structure.modifiers,
    };

    const effectiveAttacker = applyModifiersToAttacker(this._modifiers, attackerView);
    const effectiveTarget = applyModifiersToTarget(this._modifiers, target);

    const { damage, breakdown } = computeDamagePipeline({
      attacker: effectiveAttacker,
      target: effectiveTarget,
      damageType,
    });

    structure.last_attack_tick = tick;

    // نفس _applyDamageToUnit المستخدمة لهجمات الوحدات بالظبط (DAMAGE_DEALT +
    // CASUALTY_UPDATED + UNIT_KILLED/COMMANDER_DEFEATED + إحصائيات - مفيش
    // نسخة مبسّطة تانية هنا) - order هنا كائن بسيط بس عشان الحدث يحمل
    // action_type منطقي (attack_unit)، مفيش أمر واقف حقيقي اتسجّل للمنشأة.
    const order = { type: COMBAT_ACTION_TYPE.ATTACK_UNIT };
    const result = this._applyDamageToUnit(order, attackerView, target, damage, breakdown, tick);

    // Requirement (Auto-Turret/Traps): TRAP_TRIGGERED بينشر بس لو الفخ فعلاً
    // ضرب حد (result موجود) - لو الهدف مات بالفعل من ضربة تانية في نفس
    // التيك قبل ما دور الفخ يجيله، مفيش ضرب حصل فعليًا، فمفيش استهلاك (فرصة
    // الفخ لسه موجودة التيك الجاي لهدف تاني).
    if (result && structure.single_use) {
      structure.consumed = true;
      const trapEvent = this.combatLog.addEvent({
        tick,
        type: COMBAT_EVENT.TRAP_TRIGGERED,
        source: structure.id,
        target: target.id,
        payload: {
          structure_id: structure.id,
          structure_type: structure.type,
          target_id: target.id,
          damage,
          damage_type: breakdown.damage_type,
          breakdown,
        },
      });
      this.eventBus.emit(COMBAT_EVENT.TRAP_TRIGGERED, trapEvent);
    }
  }

  /** Requirement (نظام المورال - قرب الحلفاء): لكل وحدة حية، بنعدّ الحلفاء
   * (نفس owner) الأحياء جوه this._nearbyAlliesRadius وبنمرر العدد لـ
   * MoraleStore.applyNearbyAllies - حساب هندسي بسيط بس (مسافة إقليدية)، مفيش
   * أي قرار تكتيكي هنا (مين يتحرك لمين، إلخ). */
  _updateNearbyAlliesMorale(tick) {
    const aliveUnits = this._units.getAll().filter((u) => u.alive !== false);
    for (const unit of aliveUnits) {
      let alliesNearby = 0;
      for (const other of aliveUnits) {
        if (other.id === unit.id || other.owner !== unit.owner) continue;
        if (distance(unit.position, other.position) <= this._nearbyAlliesRadius) alliesNearby += 1;
      }
      this._applyMoraleChange(this._morale.applyNearbyAllies(unit.id, alliesNearby), tick);
    }
  }

  // ---------------------------------------------------------------------
  // Requirement (نظام المورال): نشر MORALE_CHANGED - نقطة واحدة بينشر منها
  // أي تغيير مورال (بغض النظر عن السبب) على الـ combatLog/eventBus، بنفس
  // شكل باقي أحداث القتال (DAMAGE_DEALT/UNIT_KILLED/CASUALTY_UPDATED) -
  // `moraleResult` هو السجل الراجع من أي applyXxx في MoraleStore (أو null لو
  // مفيش تغيير فعلي حصل، زي هدف مش مسجّل أو delta=0 بعد الـ clamp).
  // ---------------------------------------------------------------------
  _applyMoraleChange(moraleResult, tick) {
    if (!moraleResult) return;
    const unit = this._units.get(moraleResult.target);
    const payload = {
      unit_id: moraleResult.target,
      owner: unit ? unit.owner : null,
      before: moraleResult.before,
      after: moraleResult.after,
      delta: moraleResult.delta,
      reason: moraleResult.reason,
      meta: moraleResult.meta,
      min: this._morale.min,
      max: this._morale.max,
    };
    const moraleEvent = this.combatLog.addEvent({
      tick,
      type: COMBAT_EVENT.MORALE_CHANGED,
      source: moraleResult.target,
      target: moraleResult.target,
      payload,
    });
    this.eventBus.emit(COMBAT_EVENT.MORALE_CHANGED, moraleEvent);
  }

  // ---------------------------------------------------------------------
  // القلب: حسم أمر قتال واحد لتيك واحد
  // ---------------------------------------------------------------------
  _resolveOrder(order, tick) {
    // Hold Position: أمر سلبي تمامًا بتصميمه - الوحدة واقفة مكانها ومش
    // بتبادر بأي هجوم خالص (الحركة نفسها أصلًا شغل Simulation Engine بره
    // الملف ده). مفيش أي حسم ولا حدث بيتنشر للأمر ده.
    if (order.type === COMBAT_ACTION_TYPE.HOLD_POSITION) return;

    const attacker = this._units.get(order.source);
    if (!attacker || attacker.alive === false) return; // وحدة مش متسجّلة أو ماتت

    // Requirement 4: تحديد مصدر الأهداف حسب نوع الفعل + الاستراتيجية
    // الافتراضية المناسبة له لو محددة مفيش استراتيجية صريحة في الأمر.
    let candidates;
    let strategy = order.target_selection;
    if (order.type === COMBAT_ACTION_TYPE.ATTACK_BUILDING) {
      candidates = this._structures.getAllEnemyOf(attacker.owner);
      strategy = strategy || TARGET_SELECTION_STRATEGY.BUILDING_PRIORITY;
    } else {
      // ATTACK_UNIT و DEFEND_POSITION الاتنين بيهاجموا وحدات عدو - الفرق
      // بينهم "نيّة" الأمر بس (هجوم مبادر ضد دفاع عن نقطة)، مش مصدر الأهداف.
      candidates = this._units.getAllEnemyOf(attacker.owner);
      strategy = strategy || TARGET_SELECTION_STRATEGY.NEAREST;
    }

    const target = selectTarget({
      strategy,
      manualTargetId: order.manual_target_id,
      position: attacker.position,
      candidates,
    });
    if (!target) return; // مفيش هدف صالح دلوقتي - مفيش حدث، هيعاد المحاولة التيك الجاي

    // Requirement 5: فحص المدى - لو الهدف برّه مدى المهاجم، الهجوم فشل
    // (بصمت، بدون حدث) بالظبط زي المطلوب "Units and buildings cannot attack
    // outside their range".
    const range = Number.isFinite(order.range_override) ? order.range_override : attacker.range;
    if (!isInRange(attacker.position, target.position, range)) return;

    // Requirement 1: سرعة الهجوم (attack_speed) - المهاجم مايضربش كل تيك
    // بالضرورة، لازم يكون "جاهز" حسب آخر تيك ضرب فيه + سرعته. نفس فلسفة فحص
    // المدى فوق: فشل صامت (بدون حدث) لو لسه في فترة تبريد - هيتحاول تاني
    // التيك الجاي طول ما الأمر واقف.
    if (
      !isAttackReady({
        lastAttackTick: attacker.last_attack_tick,
        currentTick: tick,
        attackSpeed: attacker.stats?.attack_speed,
        tickRateMs: this.tickRateMs,
      })
    ) {
      return;
    }

    // Requirement 3: نوع الضرر الفعلي لهجمة الأمر ده - أولوية لتجاوز الأمر
    // نفسه (order.damage_type، مهارة/تكنولوجيا لحظية)، وبعدين نوع الضرر
    // الافتراضي المسجّل على المهاجم نفسه (damage_type وقت registerCombatant).
    const damageType = order.damage_type || attacker.damage_type;

    // Requirement 1+2+4: الأثر الصافي لأي modifiers فعالة على المهاجم/الهدف
    // (attack_bonus, defense_bonus, damage_reduction) بيتحقن هنا كنسخة
    // "فعّالة" (effective snapshot) - computeDamagePipeline نفسه مايعرفش إن
    // فيه modifier system أصلًا، بيشوف بس رقم attack/defense نهائي. movement
    // العقوبات + المورال مقصود إنهم مايتحقنوش هنا (مش شغل قتال - راجع
    // modifierSystem.js).
    const effectiveAttacker = applyModifiersToAttacker(this._modifiers, attacker);
    const effectiveTarget = applyModifiersToTarget(this._modifiers, target);

    const { damage, breakdown } = computeDamagePipeline({
      attacker: effectiveAttacker,
      target: effectiveTarget,
      damageType,
    });
    attacker.last_attack_tick = tick;

    if (target.kind === 'structure') {
      this._applyDamageToStructure(order, attacker, target, damage, breakdown, tick);
    } else {
      this._applyDamageToUnit(order, attacker, target, damage, breakdown, tick);
    }
  }

  _applyDamageToUnit(order, attacker, targetUnit, damage, breakdown, tick) {
    const result = this._units.applyDamage(targetUnit.id, damage);
    if (!result) return;

    const damagePayload = {
      action_type: order.type,
      attacker_id: attacker.id,
      target_id: targetUnit.id,
      damage,
      // Requirement 3: نوع الضرر + breakdown الحساب الكامل - مفيدين لـ
      // Battle Report/Replay System (يوضحوا "ليه" الضرر طلع بالرقم ده) من
      // غير ما يحتاجوا يعيدوا الحساب بنفسهم.
      damage_type: breakdown.damage_type,
      attacker_troop_type: attacker.troop_type,
      target_troop_type: targetUnit.troop_type,
      breakdown,
      remaining_hp: result.unit.stats.hp,
      target_alive: result.unit.alive,
    };
    const damageEvent = this.combatLog.addEvent({
      tick,
      type: COMBAT_EVENT.DAMAGE_DEALT,
      source: attacker.id,
      target: targetUnit.id,
      payload: damagePayload,
    });
    this.eventBus.emit(COMBAT_EVENT.DAMAGE_DEALT, damageEvent);

    // Requirement 1 (إحصائيات المعركة): total_damage/damage_by_type/
    // damage_by_unit بتتحدّث مع *كل* ضربة نزّلت ضرر فعلي على وحدة (بغض النظر
    // هل قتلت حد ولا لأ) - نفس لحظة نشر DAMAGE_DEALT بالظبط، عشان الإحصائية
    // تفضل متزامنة مع الحدث المقابل ليها دايمًا.
    this._stats.recordDamage({ unitId: attacker.id, damageType: breakdown.damage_type, amount: damage });

    // ---------------------------------------------------------------
    // Requirement (تتبّع الخسائر): CASUALTY_UPDATED بينشر بس لما فعلاً حصل
    // قتل و/أو إصابة في الضربة دي (مش مع كل ضربة تنزل ضرر - راجع
    // CombatUnitStore.applyDamage فوق لتفاصيل الحساب) - العدد الكامل
    // (troops_total/remaining/killed/wounded) بيتنشر كل مرة عشان أي مستهلك
    // (Battle Report، UI) يقدر يعرض الحالة الحالية من غير ما يحتاج يجمّع
    // كل CASUALTY_UPDATED سابق بنفسه.
    // ---------------------------------------------------------------
    if (result.casualty_delta) {
      const casualties = targetUnit.casualties;
      const casualtyPayload = {
        unit_id: targetUnit.id,
        owner: targetUnit.owner,
        troops_total: casualties.troops_total,
        troops_remaining: casualties.troops_remaining,
        troops_killed: casualties.troops_killed,
        troops_wounded: casualties.troops_wounded,
        killed_this_hit: result.casualty_delta.killed_this_hit,
        wounded_this_hit: result.casualty_delta.wounded_this_hit,
        remaining_hp: result.unit.stats.hp,
      };
      const casualtyEvent = this.combatLog.addEvent({
        tick,
        type: COMBAT_EVENT.CASUALTY_UPDATED,
        source: attacker.id,
        target: targetUnit.id,
        payload: casualtyPayload,
      });
      this.eventBus.emit(COMBAT_EVENT.CASUALTY_UPDATED, casualtyEvent);

      // Requirement (نظام المورال - خسائر تقيلة): عقوبة مورال على الهدف نفسه
      // متناسبة مع نسبة الجنود اللي ماتوا في *الضربة دي* من إجمالي الوحدة
      // الأصلي (مش من الباقي دلوقتي - عشان وحدة كبيرة خسرت شوية من عدد كبير
      // تتعاقب أخف من وحدة صغيرة خسرت نفس العدد من إجمالي أصغر).
      if (result.casualty_delta.killed_this_hit > 0 && casualties.troops_total > 0) {
        const lossFraction = result.casualty_delta.killed_this_hit / casualties.troops_total;
        this._applyMoraleChange(this._morale.applyHeavyLosses(targetUnit.id, lossFraction), tick);
      }
    }

    // Requirement (نظام المورال - هجوم ناجح): أي ضرر فعلي نزل بيدّي المهاجم
    // مكافأة مورال صغيرة، بغض النظر هل الضربة قتلت حد ولا لسه. **بس** لو
    // المهاجم وحدة فعلية (kind: 'unit') - المباني/الأبراج/الفخاخ (auto-fire،
    // راجع _resolveStructureAutoFire تحت) عمدًا **مالهاش** مورال خالص (نفس
    // الحد الموضّح في أعلى الملف)، فمفيش أي id بتاعها متسجّل في MoraleStore
    // أصلًا - نداء applySuccessfulAttack بمعرّف مبنى كان هيسيب سجل مورال
    // "شبح" (NaN) في المخزن، فبنتفاداه هنا صراحةً.
    if (attacker.kind !== 'structure') {
      this._applyMoraleChange(this._morale.applySuccessfulAttack(attacker.id), tick);
    }

    if (result.killed) {
      const killedEvent = this.combatLog.addEvent({
        tick,
        type: COMBAT_EVENT.UNIT_KILLED,
        source: attacker.id,
        target: targetUnit.id,
        payload: { unit_id: targetUnit.id, owner: targetUnit.owner, killed_by: attacker.id },
      });
      this.eventBus.emit(COMBAT_EVENT.UNIT_KILLED, killedEvent);

      // Requirement 1 (إحصائيات المعركة): units_killed/units_lost - بيتحدّث
      // مرة واحدة بالظبط لكل وحدة ماتت، بنفس لحظة نشر UNIT_KILLED (killerOwner
      // = مالك المهاجم، victimOwner = مالك الوحدة اللي ماتت).
      this._stats.recordUnitKilled({ killerOwner: attacker.owner, victimOwner: targetUnit.owner });

      // الوحدة الميتة مفيش معنى تفضل ليها أمر واقف بيتحاول يتنفذ كل تيك
      this.clearOrder(targetUnit.id);
      // ولا تفضل ليها modifiers فعالة (buff مات معاها) - نفس فلسفة clearOrder
      this._modifiers.clearTarget(targetUnit.id);
      // ولا تفضل ليها قيمة مورال (وحدة ماتت - مفيش معنى لمورالها بعد كده)
      this._morale.remove(targetUnit.id);

      // Requirement (نظام المورال - موت القائد): لو الوحدة اللي ماتت دي كانت
      // قائد، كل وحدة حليفة (نفس owner) لسه حية بتاخد عقوبة مورال ثابتة -
      // القائد نفسه اتشال من التتبّع فوق فمش هيتأثر بنفس النداء.
      if (targetUnit.commander === true) {
        const allies = this._units.getAll().filter((u) => u.alive !== false && u.owner === targetUnit.owner);
        for (const ally of allies) {
          this._applyMoraleChange(this._morale.applyCommanderDeath(ally.id), tick);
        }

        // Requirement (أحداث القتال النهائية): COMMANDER_DEFEATED - حدث
        // إضافي فوق UNIT_KILLED العادي، بينشر بس لما الوحدة اللي ماتت مسجّلة
        // `commander: true` - نفس ترتيب النشر الموصوف فوق: UNIT_KILLED الأول
        // ثم COMMANDER_DEFEATED، عشان أي مستهلك بيسمع الاتنين ياخد UNIT_KILLED
        // العام قبل التخصص.
        const commanderDefeatedEvent = this.combatLog.addEvent({
          tick,
          type: COMBAT_EVENT.COMMANDER_DEFEATED,
          source: attacker.id,
          target: targetUnit.id,
          payload: { unit_id: targetUnit.id, owner: targetUnit.owner, killed_by: attacker.id },
        });
        this.eventBus.emit(COMBAT_EVENT.COMMANDER_DEFEATED, commanderDefeatedEvent);
      }
    }

    // Requirement (Auto-Turret/Traps): بنرجّع نتيجة applyDamage نفسها -
    // _resolveStructureAutoFire تحت محتاجها عشان يعرف هل الفخ فعلاً ضرب حد
    // (وبالتالي يستهلكه) ولا الهدف مات بالفعل من ضربة تانية في نفس التيك قبل
    // ما دوره يجيله (result يبقى null في الحالة دي - راجع CombatUnitStore.
    // applyDamage فوق). مفيش أي تأثير على أي استدعاء قديم للدالة دي (كان
    // بيتجاهل القيمة الراجعة أصلًا لأنها مكانتش موجودة).
    return result;
  }

  _applyDamageToStructure(order, attacker, targetStructure, damage, breakdown, tick) {
    const result = this._structures.applyDamage(targetStructure.id, damage);
    if (!result) return;

    const damagePayload = {
      action_type: order.type,
      attacker_id: attacker.id,
      target_id: targetStructure.id,
      structure_type: targetStructure.type,
      damage,
      // Requirement 4: نفس شكل الحدث بتاع الوحدات بالظبط (damage_type +
      // breakdown) - المباني بتستخدم نفس الـ pipeline، فالنتيجة ليها نفس
      // الشفافية بالظبط، مش نسخة مبسّطة.
      damage_type: breakdown.damage_type,
      attacker_troop_type: attacker.troop_type,
      breakdown,
      remaining_hp: result.structure.hp,
      destroyed: result.structure.destroyed,
    };
    const damageEvent = this.combatLog.addEvent({
      tick,
      type: COMBAT_EVENT.DAMAGE_DEALT,
      source: attacker.id,
      target: targetStructure.id,
      payload: damagePayload,
    });
    this.eventBus.emit(COMBAT_EVENT.DAMAGE_DEALT, damageEvent);

    // Requirement 1 (إحصائيات المعركة): نفس منطق _applyDamageToUnit بالظبط -
    // المباني بتاخد نفس المعاملة (نفس الـ pipeline، نفس damage_by_type/
    // damage_by_unit) من غير أي حالة خاصة.
    this._stats.recordDamage({ unitId: attacker.id, damageType: breakdown.damage_type, amount: damage });

    // Requirement 6: BUILDING_DAMAGED بيتنشر مع كل ضرر بمبنى (مش بس وقت
    // التدمير) - Building Interaction لما يتبنى هو اللي هيقرر معنى "دمار
    // مبنى" (فتح بوابة، سقوط برج...) بناءً على remaining_hp/destroyed هنا.
    const buildingEvent = this.combatLog.addEvent({
      tick,
      type: COMBAT_EVENT.BUILDING_DAMAGED,
      source: attacker.id,
      target: targetStructure.id,
      payload: damagePayload,
    });
    this.eventBus.emit(COMBAT_EVENT.BUILDING_DAMAGED, buildingEvent);

    if (result.destroyed) {
      // Requirement 1 (إحصائيات المعركة): buildings_destroyed - بيتحدّث مرة
      // واحدة بالظبط لحظة التدمير الفعلي (مش مع كل BUILDING_DAMAGED).
      this._stats.recordBuildingDestroyed({ owner: targetStructure.owner });

      // Requirement (أحداث القتال النهائية): BUILDING_DESTROYED - حدث مستقل
      // فوق BUILDING_DAMAGED (اللي بينشر مع كل ضربة) - Building Interaction/
      // Replay System/Battle Report يقدروا يستهلكوه مباشرة من غير ما يفحصوا
      // `destroyed: true` بأنفسهم على كل BUILDING_DAMAGED.
      const buildingDestroyedEvent = this.combatLog.addEvent({
        tick,
        type: COMBAT_EVENT.BUILDING_DESTROYED,
        source: attacker.id,
        target: targetStructure.id,
        payload: {
          structure_id: targetStructure.id,
          structure_type: targetStructure.type,
          owner: targetStructure.owner,
          destroyed_by: attacker.id,
        },
      });
      this.eventBus.emit(COMBAT_EVENT.BUILDING_DESTROYED, buildingDestroyedEvent);

      this.clearOrder(targetStructure.id);
      this._modifiers.clearTarget(targetStructure.id);
    }
  }

  // ---------------------------------------------------------------------
  // القراءة العامة (Combat Log / Replay) - Requirement 6/7
  // ---------------------------------------------------------------------
  getCombatLog() {
    return this.combatLog.getEvents();
  }

  getReplayData() {
    return { engine: 'combat_engine', engine_version: COMBAT_ENGINE_VERSION, events: this.combatLog.getEvents() };
  }

  /** بيلغي الاشتراك في الـ Simulation Event Bus - مهم لو المحرك ده هيتشال/يتستبدل */
  destroy() {
    if (typeof this._unsubscribeActionDue === 'function') this._unsubscribeActionDue();
    if (typeof this._unsubscribeUnitUpdated === 'function') this._unsubscribeUnitUpdated();
    if (typeof this._unsubscribeTickCompleted === 'function') this._unsubscribeTickCompleted();
    this._unsubscribeActionDue = null;
    this._unsubscribeUnitUpdated = null;
    this._unsubscribeTickCompleted = null;
    this._modifiers.clear();
    this._morale.clear();
    this._stats.clear();
  }
}

function createCombatEngine(options) {
  return new CombatEngine(options);
}

module.exports = {
  CombatEngine,
  createCombatEngine,

  COMBAT_ACTION_TYPE,
  TARGET_SELECTION_STRATEGY,
  COMBAT_EVENT,
  STRUCTURE_TYPE_PRIORITY,

  // مُصدَّرة للاختبار المباشر/إعادة الاستخدام - نفس فلسفة evaluateConditionNode
  // المُصدَّرة في ruleEngine.js
  selectTarget,
  computeDamage,
  isInRange,
  distance,

  CombatUnitStore,
  StructureStore,

  // ---- نظام الضرر (Damage System) - معاد تصديرها هنا عشان أي طرف مستخدم
  // (battle.service.js, battle.snapshot.service.js, مهارات/تكنولوجيا
  // مستقبلية) يقدر يستورد كل حاجة محتاجها عن القتال من combatEngine.js
  // بس، من غير ما يحتاج يعرف إن فيه damage.config.js/damageEngine.js
  // منفصلين أصلًا - نفس فلسفة إعادة تصدير STRUCTURE_TYPE_PRIORITY فوق. ----
  DAMAGE_TYPE,
  TROOP_TYPE,
  isValidDamageType,
  isValidTroopType,
  getDefaultDamageTypeForTroopType,
  computeCooldownTicks,
  isAttackReady,

  COMBAT_ENGINE_VERSION,

  // ---- نظام المُعدِّلات (Modifier System) - معاد تصديرها هنا عشان أي طرف
  // مستخدم (battle.service.js, أنظمة قواد/تكنولوجيا/تحالف/معدات/مهارات
  // مستقبلية) يقدر يستورد كل حاجة محتاجها عن المودفيرز من combatEngine.js
  // بس، نفس فلسفة إعادة تصدير نظام الضرر فوق بالظبط. ----
  MODIFIER_TYPE,
  STACKING_MODE,
  MODIFIER_EVENT,
  ModifierStore,
  applyModifiersToAttacker,
  applyModifiersToTarget,

  // ---- نظام المورال (Morale System) - معاد تصديرها هنا عشان أي طرف مستخدم
  // (Rule Engine مستقبلًا، Battle Report، UI) يقدر يستورد كل حاجة محتاجها عن
  // المورال من combatEngine.js بس، نفس فلسفة إعادة تصدير نظام المُعدِّلات فوق
  // بالظبط - CombatEngine بيحسب ويعرض القيم فقط (getMorale/getAllMorale/
  // getMoraleConfig) ومفيش أي قرار تكتيكي هنا. ----
  MORALE_CHANGE_REASON,
  DEFAULT_MORALE_MIN,
  DEFAULT_MORALE_MAX,
  DEFAULT_MORALE_INITIAL,
  DEFAULT_MORALE_RULES,
  DEFAULT_NEARBY_ALLIES_RADIUS,
  MoraleStore,

  // ---- نظام الإحصائيات (Statistics System) - معاد تصديرها هنا عشان أي طرف
  // مستخدم (Battle Report مستقبلًا، اختبارات مباشرة) يقدر يستورد كل حاجة
  // محتاجها عن إحصائيات القتال من combatEngine.js بس، نفس فلسفة إعادة تصدير
  // نظام المورال/المُعدِّلات/الضرر فوق بالظبط. ----
  CombatStatisticsTracker,
};
