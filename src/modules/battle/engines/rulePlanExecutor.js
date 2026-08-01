// ====== Rule Plan Executor (الجسر الناقص بين Rule Engine وCombat Engine) ======
// اكتشفنا إن RuleEngine.evaluateTick() بينشر RULE_EVENT.RULE_TRIGGERED كل تيك
// (راجع تعليقها في ruleEngine.js) لكن محدش كان بيسمعها فعليًا - يعني خطة
// اللاعب (BattlePlan -> قواعد عن طريق army/battlePlanRuleCompiler.js) كانت
// بتتقيّم في الفاضي: تتحقق شروطها لكن مفيش أي وحدة بتتحرك بناءً عليها.
//
// الملف ده هو نفس فلسفة buildingInteraction.js بالظبط: نظام عام بيعمل
// subscribe على نفس الـ Event Bus (مفيش أي تعديل في ruleEngine.js أو
// combatEngine.js نفسهم)، وبيترجم PLAN_ACTION_TYPE (مفردات "نية" اللاعب
// الاستراتيجية - هجوم على بوابة، دفاع عن نقطة، انسحاب...) لأوامر قتال فعلية
// (COMBAT_ACTION_TYPE) لكل وحدة حية بتاعة نفس الطرف، عن طريق نفس
// combat.issueOrder() العام الموجود بالفعل.
//
// ====== حدود المسؤولية (مهم) ======
// - مفيش هنا أي حساب ضرر/اختيار هدف جديد - كل ده لسه شغل CombatEngine نفسه
//   (selectTarget/isInRange/computeDamagePipeline) زي ما هو بالظبط؛ الملف ده
//   بس بيقرر *نوع* الأمر (attack_building/defend_position/hold_position) و
//   *استراتيجية* اختيار الهدف الافتراضية المناسبة له، مش الهدف نفسه.
// - مفيش هنا أي حركة/باثفايندنج - "انسحاب" (RETREAT) لسه مالوش تجسيد حركة
//   حقيقي (ده شغل MovementSystem لو حبينا نبنيه لاحقًا)، فمؤقتًا بيتحول لـ
//   hold_position (الوحدة بتوقف عن الهجوم بدل ما "تنسحب" فعليًا جغرافيًا) -
//   تفصيلة مسجّلة وواضحة، مش مخفية جوه الكود.
// - أفعال مش قتالية خالص على مستوى الوحدة (open_gate/close_gate/
//   activate_reserve_army - أنظمة بوابات/جيش احتياطي لسه مش مبنية) بيتم
//   تجاهلها بأمان (تحذير واحد بس، مش رمي error يوقف المعركة).
// - مفيش هنا أي اتصال بـ Mongoose/battle.model - نفس فلسفة كل محركات
//   battle/engines الباقية (قابل للاختبار من غير قاعدة بيانات).

'use strict';

// جدول تعيين PLAN_ACTION_TYPE -> {نوع أمر قتالي, استراتيجية افتراضية} - نفس
// فلسفة الجداول في battlePlanRuleCompiler.js (تعيين بيانات بدل if/else مكرر)،
// عشان أي PLAN_ACTION_TYPE جديد يتضاف يوم ما يحتاج سطر واحد بس هنا.
function buildActionMap({ combatActionType, targetSelectionStrategy }) {
  return {
    attack_gate: { type: combatActionType.ATTACK_BUILDING, strategy: targetSelectionStrategy.BUILDING_PRIORITY },
    attack_wall: { type: combatActionType.ATTACK_BUILDING, strategy: targetSelectionStrategy.BUILDING_PRIORITY },
    defend_gate: { type: combatActionType.DEFEND_POSITION, strategy: targetSelectionStrategy.NEAREST },
    reinforce_wall: { type: combatActionType.DEFEND_POSITION, strategy: targetSelectionStrategy.NEAREST },
    protect_town_hall: { type: combatActionType.DEFEND_POSITION, strategy: targetSelectionStrategy.NEAREST },
    hold_position: { type: combatActionType.HOLD_POSITION, strategy: null },
    // ====== RETREAT: لسه مالوش حركة جغرافية حقيقية (تفصيلة مؤجلة بالاتفاق) -
    // hold_position هو أقرب سلوك آمن متاح دلوقتي (الوحدة توقف الهجوم على
    // الأقل بدل ما تفضل تقاتل وهي "المفروض منسحبة"). ======
    retreat: { type: combatActionType.HOLD_POSITION, strategy: null },
    move_formation: { type: combatActionType.ATTACK_UNIT, strategy: targetSelectionStrategy.NEAREST },
    // attack_gate/attack_wall/defend_gate/... فوق مغطيين؛ open_gate/close_gate/
    // activate_reserve_army عمدًا مش موجودين هنا (مفيش تجسيد قتالي ليهم لسه).
  };
}

class RulePlanExecutor {
  constructor({ eventBus = null, ruleEvent = null, combat = null, combatActionType, targetSelectionStrategy } = {}) {
    this.eventBus = eventBus;
    this.combat = combat;
    this._targetSelectionStrategy = targetSelectionStrategy;
    this._actionMap = buildActionMap({ combatActionType, targetSelectionStrategy });
    // ====== تشخيص/مراقبة بس (Battle Report/Replay مستقبلًا ممكن يستفيدوا) -
    // مش جزء من منطق التنفيذ نفسه. ======
    this._appliedCount = 0;
    this._unsupportedLogged = new Set();

    this._unsubscribeRuleTriggered = null;
    if (this.eventBus && ruleEvent && ruleEvent.RULE_TRIGGERED) {
      this._unsubscribeRuleTriggered = this.eventBus.on(ruleEvent.RULE_TRIGGERED, (event) =>
        this.handleRuleTriggered(event)
      );
    }
  }

  // ====== ترجمة target_ref_id الخام (نفس الـ _id بتاعة القطعة الدفاعية في
  // CastleDefense.structures) للـ id الفعلي المسجّل في StructureStore/
  // CombatUnitStore (defender:<type>:<structure_id> أو
  // attacker/defender:<troop_key>:<index>). بندوّر بالترتيب: (1) تطابق حرفي
  // مباشر - يغطي حالة إن حد بيبعت الـ id الكامل فعلاً، (2) انتهاء الـ id
  // بـ ":<rawId>" - يغطي حالة البوابة/السور/البرج الحقيقية اللي هي السبب
  // الأصلي للترجمة دي. لو مفيش تطابق (هدف مش موجود/اتغيّر)، بترجع null
  // بأمان - نفس فلسفة selectTarget نفسها (مفيش fallback مخترع). ======
  _resolveManualTargetId(rawTarget) {
    if (!rawTarget || typeof rawTarget !== 'string') return null;
    if (!this.combat) return null;

    const structures = this.combat.getAllStructures();
    const directStructureMatch = structures.find((s) => s.id === rawTarget);
    if (directStructureMatch) return directStructureMatch.id;

    const suffix = `:${rawTarget}`;
    const suffixStructureMatch = structures.find((s) => String(s.id).endsWith(suffix));
    if (suffixStructureMatch) return suffixStructureMatch.id;

    const units = this.combat.getAllCombatants();
    const directUnitMatch = units.find((u) => u.id === rawTarget);
    if (directUnitMatch) return directUnitMatch.id;

    return null;
  }

  handleRuleTriggered(event) {
    const payload = event?.payload || {};
    const owner = payload.owner;
    const action = payload.action || {};
    if (!owner || !action.type) return;

    const mapped = this._actionMap[action.type];
    if (!mapped) {
      // نوع فعل مش مدعوم كأمر وحدة لسه (open_gate/close_gate/
      // activate_reserve_army) - نسجّل تحذير مرة واحدة بس لكل نوع (مش كل
      // مرة يتنشر، عشان استاندينج أوردرز أصلاً نادرة الطلقة) - مش هنوقف
      // المعركة ولا هنرمي error.
      if (!this._unsupportedLogged.has(action.type)) {
        this._unsubscribeLogWarn(action.type);
      }
      return;
    }
    if (!this.combat) return;

    // ====== كل وحدة حية بتاعة نفس الطرف بتاخد نفس الأمر - مفيش لسه تقسيم
    // فرعي حسب formation line/تشكيلة (تفصيلة مسجّلة لمرحلة تانية لو حبينا
    // "الصف الأول بس يهاجم البوابة" مثلاً)، فده حاليًا "أمر جماعي" واحد لكل
    // القوات المسجّلة لنفس owner - نفس مستوى الدقة المتاح فعليًا في
    // CombatUnitStore دلوقتي (مفيش تقسيم فرعي داخل owner واحد أصلاً). ======
    // ====== لو الخطة محددة هدف بذاته (target_ref_id لبوابة/سور معينة من
    // target_priorities مثلاً) - نستخدم MANUAL_TARGET بالظبط زي ما اللاعب
    // بيعمل من BattleCommandPanel (مفيش fallback تلقائي لهدف تاني لو ده مات/
    // اتدمر - نفس فلسفة selectTarget الموجودة بالفعل)؛ من غير هدف صريح،
    // نرجع للاستراتيجية الافتراضية المناسبة لنوع الفعل (BUILDING_PRIORITY/
    // NEAREST). ======
    // ====== باج مكتشف: action.target جاي من battlePlanRuleCompiler.js وهو
    // الـ target_ref_id *الخام* (نفس الـ _id بتاعة القطعة في
    // CastleDefense.structures - راجع findMatchingTargetRef/compileLegacyTargetPriorities
    // في battlePlanRuleCompiler.js)، لكن selectTarget (combatEngine.js) بيدوّر
    // بـ MANUAL_TARGET عن طريق تطابق حرفي مع الـ id المسجّل فعليًا في
    // StructureStore (الشكل: defender:<type>:<structure_id> - راجع
    // buildStructuresFromSnapshot في battle.runner.js). من غير ترجمة، أي هدف
    // محدد بالاسم في خطة اللاعب (هاجم بوابة بعينها/دافع عن سور بعينه) كان
    // بيتبعت كـ manual_target_id خام مالوش أي تطابق حقيقي، فـ selectTarget
    // كانت بترجع null دايمًا (الهجوم مايحصلش أبدًا - لا خطأ ولا تنفيذ). ======
    const resolvedTargetId = this._resolveManualTargetId(action.target);
    const hasExplicitTarget = Boolean(resolvedTargetId);
    const strategy = hasExplicitTarget ? this._targetSelectionStrategy.MANUAL_TARGET : mapped.strategy;

    const units = this.combat.getAllCombatants().filter((c) => c.owner === owner && c.alive !== false);
    for (const unit of units) {
      this.combat.issueOrder({
        source: unit.id,
        type: mapped.type,
        target_selection: strategy || undefined,
        manual_target_id: hasExplicitTarget ? resolvedTargetId : null,
      });
      this._appliedCount += 1;
    }
  }

  _unsubscribeLogWarn(actionType) {
    this._unsupportedLogged.add(actionType);
    console.warn(`[RulePlanExecutor] نوع فعل خطة "${actionType}" لسه مالوش تجسيد كأمر قتال وحدة - اتجاهل بأمان`);
  }

  getAppliedCount() {
    return this._appliedCount;
  }

  destroy() {
    if (typeof this._unsubscribeRuleTriggered === 'function') this._unsubscribeRuleTriggered();
    this._unsubscribeRuleTriggered = null;
    this._unsupportedLogged.clear();
  }
}

function createRulePlanExecutor(options) {
  return new RulePlanExecutor(options);
}

module.exports = {
  createRulePlanExecutor,
};
