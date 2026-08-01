// ====== Building Interaction (خطوة 6 من معمارية نظام المعارك) ======
// دلوقتي كل حساب الضرر الفعلي على المباني/الأسوار/الأبراج/البوابات (hp،
// تدمير، damage_type مضاعف المباني...) بقى شغل CombatEngine/StructureStore
// بالكامل (راجع combatEngine.js: StructureStore.applyDamage +
// _applyDamageToStructure + COMBAT_EVENT.BUILDING_DAMAGED/BUILDING_DESTROYED) -
// الـ stub القديم هنا (applyDamageToBuilding اللي كان بيرمي error) كان
// placeholder لحساب مكرر بقى غير محتاج خالص بعد ما StructureStore اتبنى.
//
// المسؤولية الحقيقية المتبقية لـ "Building Interaction" (زي ما موصوف في
// التعليق الأصلي: فتح بوابة، تعطيل برج دفاعي) هي **ترجمة** حدث "مبنى اتدمر"
// (COMBAT_EVENT.BUILDING_DESTROYED) لتأثير ميكانيكي واضح حسب نوع المنشأة -
// مش إعادة حساب الضرر تاني. الملف ده بيعمل subscribe على نفس الـ Event Bus
// اللي CombatEngine بيستخدمه (نفس فلسفة moraleSystem.js/statisticsSystem.js:
// نظام عام مستقل بيسمع أحداث القتال ويبني حالته الخاصة منها) وبينشر أحداثه
// الخاصة (BUILDING_INTERACTION_EVENT.*) عشان أي مستهلك تاني (Rule Engine
// مستقبلًا - "هاجم دلوقتي إن البوابة اتفتحت"، Replay System، الفرونت إند)
// يقدر يعمل subscribe من غير ما يعرف حاجة عن CombatEngine نفسه.
//
// ====== حدود المسؤولية (مهم) ======
// - مفيش هنا أي قرار تكتيكي ("هاجم دلوقتي إن البوابة اتفتحت") - ده شغل Rule
//   Engine/AI مستقبلًا؛ الملف ده بيسجّل ويعرض "حالة" بس (gate open/tower
//   disabled)، بالظبط زي حدود المورال/الإحصائيات الموضّحة في combatEngine.js.
// - مفيش هنا أي حساب ضرر جديد ولا نسخة تانية من hp - المصدر الوحيد للحقيقة
//   لحظة "دمار فعلي" هو COMBAT_EVENT.BUILDING_DESTROYED نفسه.
// - "برج اتعطّل" هنا معناها إعلامي/عرضي بس - CombatEngine._resolveStructureAutoFire
//   أصلًا بيتجاهل أي structure.destroyed=true (فبيوقف يطلق نار لوحده من
//   غير ما يحتاج حد يقوله)؛ الملف ده بس بيوثّق اللحظة دي بشكل صريح تحت اسم
//   "تعطيل" عشان مستهلكين تانيين (Replay/UI) يعرضوا تأثير بصري واضح.
// - مفيش هنا أي اتصال بـ Mongoose/battle.model - نفس فلسفة combatEngine.js
//   بالظبط (قابل للاختبار بالكامل من غير قاعدة بيانات).

'use strict';

const BUILDING_INTERACTION_EVENT = {
  GATE_OPENED: 'building_interaction:gate_opened',
  TOWER_DISABLED: 'building_interaction:tower_disabled',
};

class BuildingInteractionTracker {
  constructor({ eventBus = null, combatEvent = null } = {}) {
    this.eventBus = eventBus;

    this._openedGates = new Set();
    this._disabledTowers = new Set();

    this._unsubscribeBuildingDestroyed = null;
    if (this.eventBus && combatEvent && combatEvent.BUILDING_DESTROYED) {
      this._unsubscribeBuildingDestroyed = this.eventBus.on(
        combatEvent.BUILDING_DESTROYED,
        (event) => this.handleBuildingDestroyed(event)
      );
    }
  }

  handleBuildingDestroyed(event) {
    const payload = event?.payload || {};
    const structureId = payload.structure_id;
    const structureType = payload.structure_type;
    if (!structureId) return;

    if (structureType === 'gate') {
      if (this._openedGates.has(structureId)) return;
      this._openedGates.add(structureId);
      this._emit(BUILDING_INTERACTION_EVENT.GATE_OPENED, {
        structure_id: structureId,
        owner: payload.owner,
        destroyed_by: payload.destroyed_by,
      });
      return;
    }

    if (structureType === 'tower') {
      if (this._disabledTowers.has(structureId)) return;
      this._disabledTowers.add(structureId);
      this._emit(BUILDING_INTERACTION_EVENT.TOWER_DISABLED, {
        structure_id: structureId,
        owner: payload.owner,
        destroyed_by: payload.destroyed_by,
      });
      return;
    }
  }

  _emit(type, payload) {
    if (this.eventBus && typeof this.eventBus.emit === 'function') this.eventBus.emit(type, payload);
  }

  isGateOpen(structureId) {
    return this._openedGates.has(structureId);
  }

  isTowerDisabled(structureId) {
    return this._disabledTowers.has(structureId);
  }

  getOpenedGates() {
    return Array.from(this._openedGates);
  }

  getDisabledTowers() {
    return Array.from(this._disabledTowers);
  }

  destroy() {
    if (typeof this._unsubscribeBuildingDestroyed === 'function') this._unsubscribeBuildingDestroyed();
    this._unsubscribeBuildingDestroyed = null;
    this._openedGates.clear();
    this._disabledTowers.clear();
  }
}

function createBuildingInteraction(options) {
  return new BuildingInteractionTracker(options);
}

module.exports = {
  BUILDING_INTERACTION_EVENT,
  BuildingInteractionTracker,
  createBuildingInteraction,
};
