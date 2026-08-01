// ====== Statistics System (امتداد لـ Combat Engine) ======
// الملف ده مسؤول **بس** عن تجميع/عرض إحصائيات القتال الحية (total_damage,
// units_killed, units_lost, buildings_destroyed, damage_by_type,
// damage_by_unit) - نفس فلسفة moraleSystem.js/modifierSystem.js بالظبط:
// مخزن عام (store) مستقل تمامًا عن Combat/Simulation/Replay/Frontend، بياخد
// أرقام/معرّفات جاهزة من برّه (combatEngine.js) ويجمّعها فقط - مفيش هنا أي
// حساب ضرر، فحص مدى، أو قرار قتالي من أي نوع.
//
// ====== حدود المسؤولية (نفس فلسفة moraleSystem.js/modifierSystem.js) ======
// - الملف ده **بيجمّع ويعرض أرقام بس** - كل استدعاء (recordDamage/
//   recordUnitKilled/recordBuildingDestroyed) بيوصله رقم/معرّف جاهز محسوب
//   برّه (combatEngine.js هو اللي بيقرر إمتى/إزاي)، مفيش هنا أي منطق قتالي.
// - مفيش هنا أي معرفة بـ Combat/Simulation/Replay/Frontend ولا حتى بـ
//   Event Bus - الملف ده deterministic بالكامل (نفس المدخلات = نفس
//   الإحصائيات دايمًا)، قابل للاستخدام/الاختبار من غير أي محرك تاني حواليه.
// - بيتبني حول owner نصي حر (زي MoraleStore/ModifierStore بياخدوا targetId
//   حر) - مفيش أي افتراض إن الـ owner لازم يكون "attacker"/"defender" بالظبط،
//   عشان يفضل صالح لأي عدد أطراف (alliance rally, world boss...) مستقبلًا.

'use strict';

const { DAMAGE_TYPE } = require('./damage.config');

function createEmptyDamageByType() {
  const byType = {};
  Object.values(DAMAGE_TYPE).forEach((type) => {
    byType[type] = 0;
  });
  return byType;
}

/** Map<string, number> -> plain object {key: number} - بترتيب إدخال ثابت
 * (Map بتحافظ على ترتيب الإدخال) عشان الناتج يبقى deterministic. */
function mapToObject(map) {
  const obj = {};
  for (const [key, value] of map.entries()) {
    obj[key] = value;
  }
  return obj;
}

// =============================================================================
// CombatStatisticsTracker - المخزن العام الوحيد لكل إحصائيات القتال الحية.
// =============================================================================
class CombatStatisticsTracker {
  constructor() {
    this._totalDamage = 0;
    // Requirement: damage_by_type - كل نوع ضرر (DAMAGE_TYPE.*) بيبدأ صفر عشان
    // الشكل (shape) يبقى ثابت من أول لحظة، بغض النظر هل النوع ده استُخدم
    // بالفعل في المعركة ولا لأ (سهل على أي مستهلك - Battle Report مثلًا -
    // يلف على مفاتيح ثابتة من غير ما يتحقق من وجودها الأول).
    this._damageByType = createEmptyDamageByType();
    // Requirement: damage_by_unit - مفتاحها id الوحدة اللي *نزّلت* الضرر (مش
    // اللي استقبلته) - بتتبني ديناميكيًا (مفيش قايمة وحدات معروفة مسبقًا هنا).
    this._damageByUnit = new Map();

    // Requirement: units_killed/units_lost - مجمّعين حسب owner (نصي حر) عشان
    // يفضلوا مفيدين لأي عدد أطراف، مش بس هجوم/دفاع تنائي. "killed" = القتلات
    // اللي owner ده سجّلها (نسبة للمهاجم)، "lost" = الوحدات اللي owner ده
    // فقدها (نسبة للضحية) - مش نفس الرقم بالضرورة لو أكتر من طرفين في المعركة.
    this._unitsKilledByOwner = new Map();
    this._unitsLostByOwner = new Map();
    this._totalUnitsKilled = 0;

    // Requirement: buildings_destroyed - نفس فلسفة units_lost (مجمّع حسب
    // owner المبنى اللي اتدمر).
    this._buildingsDestroyedByOwner = new Map();
    this._totalBuildingsDestroyed = 0;
  }

  /** Requirement: total_damage + damage_by_type + damage_by_unit - بتتنادى
   * مع *كل* ضربة نزّلت ضرر فعلي (وحدة أو مبنى، نفس المعاملة) - مش بس الضربات
   * اللي قتلت/دمّرت حاجة، عشان الإحصائية تبقى "حية" فعلاً (Requirement 1:
   * Continuously update) مش لقطة نهائية بس.
   * @param {{unitId?:string, damageType?:string, amount:number}} params
   */
  recordDamage({ unitId, damageType, amount } = {}) {
    if (!Number.isFinite(amount) || amount <= 0) return;
    this._totalDamage += amount;
    if (typeof damageType === 'string' && Object.prototype.hasOwnProperty.call(this._damageByType, damageType)) {
      this._damageByType[damageType] += amount;
    }
    if (unitId) {
      this._damageByUnit.set(unitId, (this._damageByUnit.get(unitId) || 0) + amount);
    }
  }

  /** Requirement: units_killed/units_lost - بتتنادى مرة واحدة بالظبط لكل
   * وحدة ماتت (نفس لحظة COMBAT_EVENT.UNIT_KILLED في combatEngine.js).
   * @param {{killerOwner?:string, victimOwner?:string}} params
   */
  recordUnitKilled({ killerOwner, victimOwner } = {}) {
    this._totalUnitsKilled += 1;
    if (killerOwner) {
      this._unitsKilledByOwner.set(killerOwner, (this._unitsKilledByOwner.get(killerOwner) || 0) + 1);
    }
    if (victimOwner) {
      this._unitsLostByOwner.set(victimOwner, (this._unitsLostByOwner.get(victimOwner) || 0) + 1);
    }
  }

  /** Requirement: buildings_destroyed - بتتنادى مرة واحدة بالظبط لكل مبنى
   * اتدمر (نفس لحظة COMBAT_EVENT.BUILDING_DESTROYED في combatEngine.js).
   * @param {{owner?:string}} params
   */
  recordBuildingDestroyed({ owner } = {}) {
    this._totalBuildingsDestroyed += 1;
    if (owner) {
      this._buildingsDestroyedByOwner.set(owner, (this._buildingsDestroyedByOwner.get(owner) || 0) + 1);
    }
  }

  /** لقطة كاملة (snapshot) من كل الإحصائيات الحالية - نسخة جديدة كل مرة
   * (immutable من وجهة نظر المستهلك) عشان أي تعديل على الناتج ميأثرش على
   * الحالة الداخلية للـ tracker. نفس الشكل ده صالح مباشرة لـ Battle Report
   * مستقبلًا من غير أي تحويل إضافي. */
  getStatistics() {
    return {
      total_damage: this._totalDamage,
      units_killed: {
        total: this._totalUnitsKilled,
        by_owner: mapToObject(this._unitsKilledByOwner),
      },
      units_lost: {
        total: this._totalUnitsKilled,
        by_owner: mapToObject(this._unitsLostByOwner),
      },
      buildings_destroyed: {
        total: this._totalBuildingsDestroyed,
        by_owner: mapToObject(this._buildingsDestroyedByOwner),
      },
      damage_by_type: { ...this._damageByType },
      damage_by_unit: mapToObject(this._damageByUnit),
    };
  }

  /** بيصفّر كل حاجة - مفيدة لو نفس الـ tracker اتعاد استخدامه (اختبار) أو
   * وقت destroy() بتاع CombatEngine. */
  clear() {
    this._totalDamage = 0;
    this._damageByType = createEmptyDamageByType();
    this._damageByUnit.clear();
    this._unitsKilledByOwner.clear();
    this._unitsLostByOwner.clear();
    this._totalUnitsKilled = 0;
    this._buildingsDestroyedByOwner.clear();
    this._totalBuildingsDestroyed = 0;
  }
}

function createStatisticsTracker() {
  return new CombatStatisticsTracker();
}

module.exports = {
  CombatStatisticsTracker,
  createStatisticsTracker,
};
