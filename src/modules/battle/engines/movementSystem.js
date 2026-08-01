// ====== Movement System (خطوة إضافية - أول تحريك حقيقي للوحدات) ======
// simulationEngine.js نفسه موثّق بوضوح إنه بس بيدير الوقت/الطابور ("مفيش أي
// تحريك وحدة فعلي هنا" - راجع تعليقه فوق) وإن الحركة "شغل Simulation Engine"
// حسب توثيق battle/README.md، لكن محدش كان بيعمل الخطوة دي فعليًا لحد كده -
// نتيجة ده إن كل وحدة كانت بتتسجّل في مكانها الابتدائي وتفضل واقفة فيه طول
// المعركة (مفيش تقدّم نحو العدو، كل حاجة بتتحل وكأنها أصلًا في مدى بعض من
// أول تيك). الملف ده هو أول تنفيذ فعلي لده - نفس فلسفة buildingInteraction.js/
// moraleSystem.js/statisticsSystem.js بالظبط: نظام مستقل بيسمع نفس الـ Event
// Bus (هنا TICK_STARTED) ومبيعدلش في CombatEngine ولا SimulationEngine نفسهم
// خالص، بس بيستخدم الـ APIs العامة الموجودة بالفعل:
//   - CombatEngine.getAllCombatants/getAllStructures/getOrder (قراءة بس)
//   - CombatEngine.selectTarget/isInRange (نفس منطق اختيار الهدف/فحص المدى
//     اللي CombatEngine._resolveOrder بيستخدمه بالظبط - مفيش نسخة تانية من
//     المنطق ده هنا، نفس الدالة المُصدَّرة)
//   - SimulationEngine.updateUnitGroup (الكتابة الوحيدة هنا - وده بالظبط
//     المسار اللي CombatEngine._units.syncFromSimulation() أصلًا بيستنى منه
//     تحديثات الموقع، راجع اشتراكه على UNIT_UPDATED في combatEngine.js - يعني
//     بمجرد ما الملف ده يحدّث موقع في SimulationEngine، CombatEngine نفسه
//     بيتزامن معاه تلقائيًا من غير أي كود إضافي هنا)
//
// ====== حدود المسؤولية (مهم) ======
// - مفيش هنا أي حسم قتال (ضرر/hp/casualties) - ده لسه بالكامل شغل CombatEngine
//   زي ما هو، الملف ده بس بيقرّب الوحدة من هدفها لحد ما تدخل مداها.
// - مفيش هنا أي قرار تكتيكي جديد (مين الهدف) - بيستخدم نفس order/strategy
//   الموجودة بالفعل على الوحدة (target_selection/manual_target_id) من غير
//   ما يفرض حاجة تانية.
// - سرعة الحركة (MOVEMENT_SPEED_PER_SECOND) قيمة توازن Placeholder بحتة -
//   وحدة قياسها "خانة معركة/ثانية محاكاة" (مقياس مختلف تمامًا عن speed بتاع
//   TROOP_TYPES في castle.config.js اللي ده "خانة عالمية/ساعة" لمسير خارجي -
//   مقياسين مختلفين لغرضين مختلفين تمامًا، نفس فلسفة أي رقم Placeholder تاني
//   في المشروع زي structureCombatStatsPlaceholder في defense.config.js).

'use strict';

// سرعة الحركة الافتراضية لكل نوع وحدة (خانة معركة/ثانية) - الفرسان أسرع،
// المنجنيقات/آلات الحصار أبطأ، نفس الترتيب المنطقي المتوقع من أي لعبة
// استراتيجية عادي.
const MOVEMENT_SPEED_PER_SECOND = {
  infantry: 1.2,
  archer: 1.0,
  cavalry: 2.2,
  siege: 0.6,
};
const DEFAULT_MOVEMENT_SPEED_PER_SECOND = 1.0;

// أقرب مسافة نعتبر عندها الوحدة "وصلت" لنقطة معينة (عشان مانتجش في نقصان/
// زيادة لا نهائية من فروقات الفاصلة العشرية - نفس فكرة أي epsilon مقارنة
// أعداد عشرية عادية).
const ARRIVAL_EPSILON = 0.05;

class MovementSystem {
  constructor({
    eventBus = null,
    simulationEvent = null,
    simulation = null,
    combat = null,
    combatActionType = null,
    targetSelectionStrategy = null,
    selectTarget = null,
    isInRange = null,
    distance = null,
  } = {}) {
    this.eventBus = eventBus;
    this.simulation = simulation;
    this.combat = combat;
    this.combatActionType = combatActionType || {};
    this.targetSelectionStrategy = targetSelectionStrategy || {};
    this.selectTarget = selectTarget;
    this.isInRange = isInRange;
    this.distance = distance;

    this._unsubscribeTick = null;
    if (this.eventBus && simulationEvent && simulationEvent.TICK_STARTED) {
      this._unsubscribeTick = this.eventBus.on(simulationEvent.TICK_STARTED, () => this._onTick());
    }
  }

  _speedFor(unit) {
    return MOVEMENT_SPEED_PER_SECOND[unit.troop_type] ?? DEFAULT_MOVEMENT_SPEED_PER_SECOND;
  }

  // ====== نفس منطق اختيار مصدر الأهداف/الاستراتيجية بتاع
  // CombatEngine._resolveOrder بالظبط (مش نسخة مستقلة - نفس القيم بالظبط)
  // عشان الوحدة تتحرك فعليًا تجاه نفس الهدف اللي هيتحسم معاه القتال، مش هدف
  // تاني بالصدفة. ======
  _candidatesFor(order, attacker) {
    if (order.type === this.combatActionType.ATTACK_BUILDING) {
      return {
        candidates: this.combat.getAllStructures().filter((s) => s.owner !== attacker.owner && !s.destroyed),
        strategy: order.target_selection || this.targetSelectionStrategy.BUILDING_PRIORITY,
      };
    }
    return {
      candidates: this.combat.getAllCombatants().filter((u) => u.owner !== attacker.owner && u.alive !== false),
      strategy: order.target_selection || this.targetSelectionStrategy.NEAREST,
    };
  }

  _onTick() {
    if (!this.simulation || !this.combat || typeof this.selectTarget !== 'function') return;

    const combatants = this.combat.getAllCombatants();
    for (const unit of combatants) {
      if (unit.alive === false) continue;

      const order = this.combat.getOrder(unit.id);
      if (!order || order.type === this.combatActionType.HOLD_POSITION) continue;

      const { candidates, strategy } = this._candidatesFor(order, unit);
      const target = this.selectTarget({
        strategy,
        manualTargetId: order.manual_target_id,
        position: unit.position,
        candidates,
      });
      if (!target || !target.position) continue;

      const range = Number.isFinite(order.range_override) ? order.range_override : unit.range;
      if (this.isInRange(unit.position, target.position, range)) {
        // ====== وصلت لمدى هدفها بالفعل - تقف وتقاتل (CombatEngine هيحسم
        // الهجوم نفسه في نفس التيك ده من مسار _resolveOrder بتاعه، مش شغلنا
        // هنا). بنفضل نبعت تحديث الموقع/الحالة كل تيك برضه (مش بس أول مرة)
        // عشان نضمن إن الموقع الظاهر للفرونت إند (simulation store) متطابق
        // دايمًا مع موقعها الحقيقي في CombatEngine، حتى لو الاتنين اتسجّلوا
        // بقيم ابتدائية مختلفة شوية قبل أول تيك. ======
        this.simulation.updateUnitGroup(unit.id, {
          position: unit.position,
          current_action: 'engaging',
          destination: null,
        });
        continue;
      }

      // ====== لسه برّه المدى - بنقرّبها خطوة واحدة (بمقدار سرعتها الخاصة)
      // تجاه الهدف على نفس الخط المستقيم بينهم. ======
      const dx = target.position.x - unit.position.x;
      const dy = target.position.y - unit.position.y;
      const totalDistance = Math.hypot(dx, dy);
      if (totalDistance <= ARRIVAL_EPSILON) continue;

      const tickRateMs = this.simulation.tickRateMs || 250;
      const stepSize = this._speedFor(unit) * (tickRateMs / 1000);
      const ratio = Math.min(1, stepSize / totalDistance);
      const newPosition = {
        x: unit.position.x + dx * ratio,
        y: unit.position.y + dy * ratio,
      };

      this.simulation.updateUnitGroup(unit.id, {
        position: newPosition,
        destination: target.position,
        current_action: 'moving',
      });
    }
  }

  destroy() {
    if (typeof this._unsubscribeTick === 'function') this._unsubscribeTick();
    this._unsubscribeTick = null;
  }
}

function createMovementSystem(options) {
  return new MovementSystem(options);
}

module.exports = {
  MovementSystem,
  createMovementSystem,
  MOVEMENT_SPEED_PER_SECOND,
  DEFAULT_MOVEMENT_SPEED_PER_SECOND,
};
