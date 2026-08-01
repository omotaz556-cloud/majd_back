// ====== Morale System (امتداد لـ Combat Engine) ======
// الملف ده مسؤول **بس** عن تخزين/حساب قيمة "المورال" (Morale) لأي هدف (وحدة
// قتالية غالبًا - مفيش مفهوم مورال لمبنى) - رقم واحد محصور بين حد أدنى وأقصى
// قابلين للتهيئة (configurable)، بيتغيّر بسبب أحداث قتالية معروفة (خسائر
// تقيلة، موت قائد، هجوم ناجح، قرب حلفاء) وبيُنشر حدث لما يتغيّر.
//
// ====== حدود المسؤولية (مهم جدًا - نفس فلسفة modifierSystem.js/damageEngine.js) ======
// - الملف ده **بيحسب ويعرض قيم مورال بس** - مفيش هنا أي قرار تكتيكي/سلوك ذكاء
//   اصطناعي مبني على المورال (زي "لو المورال قل عن كذا، اهرب/استسلم"). القرار
//   ده شغل نظام تاني بالكامل (Rule Engine مستقبلًا، أو AI) اللي هيقرا القيمة
//   من هنا (getMorale/getAllMorale في combatEngine.js) ويقرر هو بمنطقه الخاص.
// - مفيش هنا أي معرفة بـ Combat/Simulation/Replay/Frontend - نفس فلسفة
//   ModifierStore بالظبط: بياخد id نصي حر بس (targetId)، وeventBus اختياري
//   (أي أوبچكت فيه emit) - الملف ده قابل للاستخدام/الاختبار من غير أي محرك
//   تاني حواليه خالص.
// - مفيش هنا أي حساب ضرر ولا فحص مدى ولا اختيار هدف - القيم اللي بتتغذّي هنا
//   (نسبة جنود ماتوا، عدد حلفاء قريبين...) لازم تتحسب برّه (combatEngine.js)
//   وتتبعت جاهزة كأرقام/أعلام بسيطة.

'use strict';

// ---------------------------------------------------------------------------
// Requirement 2: أسباب تغيّر المورال المدعومة - القايمة دي *مش* قافلة (زي
// MODIFIER_TYPE في modifierSystem.js) - أي نظام خارجي يقدر يستخدم
// applyDelta() مباشرة بسبب حر تاني (مثلاً "weather_penalty" مستقبلًا) من غير
// ما يحتاج يعدّل الملف ده؛ القيم هنا بس الأربعة المطلوبة صراحةً.
// ---------------------------------------------------------------------------
const MORALE_CHANGE_REASON = {
  HEAVY_LOSSES: 'heavy_losses',
  COMMANDER_DEATH: 'commander_death',
  SUCCESSFUL_ATTACK: 'successful_attack',
  NEARBY_ALLIES: 'nearby_allies',
};

// Requirement 3: الحدود الافتراضية - قابلة للتجاوز بالكامل وقت إنشاء
// MoraleStore (راجع الـ constructor تحت)، وكمان وقت إنشاء CombatEngine نفسه
// (بيمررها هو لـ MoraleStore - راجع combatEngine.js).
const DEFAULT_MORALE_MIN = 0;
const DEFAULT_MORALE_MAX = 100;
const DEFAULT_MORALE_INITIAL = 100;

// ---------------------------------------------------------------------------
// القيم/المعادلات القابلة للتهيئة لكل سبب - نفس فلسفة damage.config.js
// (جداول/قيم توازن منفصلة عن خط الحساب نفسه) - أي طرف مستخدم يقدر يجاوزها
// جزئيًا وقت الإنشاء (`new MoraleStore({ rules: { commander_death_penalty: 50 } })`)
// من غير ما يحتاج يلمس منطق الحساب في applyHeavyLosses/applyCommanderDeath/...
// ---------------------------------------------------------------------------
const DEFAULT_MORALE_RULES = {
  // Requirement: خسائر تقيلة - عقوبة *متناسبة* مع نسبة الجنود اللي ماتوا في
  // نفس الضربة من إجمالي الوحدة الأصلي (0..1). خسارة الوحدة بالكامل في ضربة
  // واحدة (fraction=1) بتاخد أقصى عقوبة معرّفة هنا؛ خسارة جزئية بتاخد نسبة
  // من نفس الرقم (مش قيمة ثابتة بغض النظر عن الحجم).
  heavy_losses_max_penalty: 40,
  // Requirement: موت القائد - عقوبة ثابتة (مش متناسبة مع حاجة) بتتطبق على كل
  // وحدة حليفة (نفس المالك) لسه حية وقت موت القائد - القائد نفسه بيتشال من
  // تتبّع المورال أصلًا لحظة موته (مفيش معنى لمورال وحدة ماتت).
  commander_death_penalty: 30,
  // Requirement: هجوم ناجح - مكافأة ثابتة صغيرة لأي وحدة نزّلت ضرر فعلي على
  // هدف (بغض النظر هل الضربة قتلت حد ولا لسه) - بتتطبق على المهاجم نفسه.
  successful_attack_bonus: 3,
  // Requirement: حلفاء قريبين - مكافأة لكل حليف حي جوه نطاق معيّن (المسافة
  // نفسها بتتحسب برّه - راجع combatEngine.js)، بحد أقصى لعدد الحلفاء
  // المحسوبين عشان جيش ضخم مايدّيش مكافأة بلا حدود كل تيك.
  nearby_allies_bonus_per_ally: 0.5,
  nearby_allies_max_counted: 5,
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// =============================================================================
// MoraleStore - المخزن العام لقيمة مورال أي عدد أهداف - نفس منطق ModifierStore
// (targetId نصي حر، مفيش أي فرضية عن نوع الهدف).
// =============================================================================
class MoraleStore {
  /**
   * @param {object} [options]
   * @param {number} [options.min] - الحد الأدنى المسموح للمورال (Requirement 3)
   * @param {number} [options.max] - الحد الأقصى المسموح للمورال (Requirement 3)
   * @param {number} [options.initial] - القيمة الافتراضية لأي هدف جديد لو
   *   مابعتش قيمة ابتدائية صريحة وقت register()
   * @param {object} [options.rules] - تجاوز جزئي/كامل لـ DEFAULT_MORALE_RULES
   * @param {object} [options.eventBus] - أي كائن فيه emit(type, payload) -
   *   اختياري تمامًا، زي ModifierStore بالظبط (اختبار معزول من غير أي محرك).
   */
  constructor({
    min = DEFAULT_MORALE_MIN,
    max = DEFAULT_MORALE_MAX,
    initial = DEFAULT_MORALE_INITIAL,
    rules = {},
    eventBus = null,
  } = {}) {
    if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
      throw new Error('[MoraleSystem] min/max لازم يكونوا أرقام صحيحة و min أصغر من max');
    }
    this.min = min;
    this.max = max;
    this.initial = clamp(Number.isFinite(initial) ? initial : DEFAULT_MORALE_INITIAL, min, max);
    this.rules = { ...DEFAULT_MORALE_RULES, ...rules };
    this.eventBus = eventBus;
    this._byTarget = new Map(); // targetId -> current morale value
  }

  _emit(type, payload) {
    if (this.eventBus && typeof this.eventBus.emit === 'function') {
      this.eventBus.emit(type, payload);
    }
  }

  /** بيسجّل هدف جديد بقيمة ابتدائية (أو `initial` الافتراضي لو مابعتش) -
   * لازم يتنادى قبل أي applyXxx على نفس الـ id (زي registerCombatant). */
  register(id, initialMorale) {
    const value = clamp(
      Number.isFinite(initialMorale) ? initialMorale : this.initial,
      this.min,
      this.max
    );
    this._byTarget.set(id, value);
    return value;
  }

  has(id) {
    return this._byTarget.has(id);
  }

  /** القيمة الحالية - null لو الهدف مش مسجّل (مش صفر - عشان مايتلخبطش مع
   * مورال فعلي بقيمته صفر). */
  get(id) {
    return this._byTarget.has(id) ? this._byTarget.get(id) : null;
  }

  getAll() {
    return Array.from(this._byTarget.entries()).map(([id, morale]) => ({ id, morale }));
  }

  /** بيشيل هدف من التتبّع بالكامل (وحدة ماتت - نفس فلسفة clearTarget بتاعة
   * ModifierStore) - مفيش داعي يفضل ليها مورال بعد ما تموت. */
  remove(id) {
    this._byTarget.delete(id);
  }

  clear() {
    this._byTarget.clear();
  }

  // ---------------------------------------------------------------------
  // Requirement 4: القلب - أي تغيير مورال (من أي سبب) لازم يعدّي من هنا عشان
  // الـ clamp (الحد الأدنى/الأقصى) يبقى موحّد في مكان واحد، ومفيش تعديل مباشر
  // لأي رقم من برّه المخزن ده. بترجّع سجل التغيير الكامل (قبل/بعد/الفرق
  // الفعلي بعد الـ clamp/السبب) عشان الطرف المستخدم (combatEngine.js) يقدر
  // ينشر حدث MORALE_CHANGED بنفس البيانات، أو null لو الهدف مش مسجّل أصلًا.
  // ---------------------------------------------------------------------
  applyDelta(id, delta, reason, meta = {}) {
    if (!this._byTarget.has(id)) return null;
    if (!Number.isFinite(delta) || delta === 0) return null;
    const before = this._byTarget.get(id);
    const after = clamp(before + delta, this.min, this.max);
    // لو الهدف أصلاً على الحد الأدنى/الأقصى وطلع نفس الرقم بعد الـ clamp،
    // مفيش تغيير فعلي حصل - مفيش داعي نسجّل/ننشر حدث "تغيّر" فاضي (Requirement
    // 4: بننشر لما المورال *يتغيّر* فعلاً، مش لما نحاول نغيّره من غير أثر).
    if (after === before) return null;
    this._byTarget.set(id, after);
    const record = { target: id, before, after, delta: after - before, reason, meta };
    this._emit('morale:changed', record);
    return record;
  }

  // ---------------------------------------------------------------------
  // Requirement 1: الأسباب الأربعة المطلوبة صراحةً - كل واحدة دالة راحة رفيعة
  // فوق applyDelta() بس، بتحسب الـ delta المناسب من DEFAULT_MORALE_RULES/
  // this.rules وبترجّع نفس شكل السجل اللي applyDelta بيرجعه.
  // ---------------------------------------------------------------------

  /** خسائر تقيلة - `troopsLostFraction` نسبة من 0 لـ 1 (جنود ماتوا في الضربة
   * دي / إجمالي الوحدة الأصلي) - العقوبة بتتناسب معاها مباشرة. */
  applyHeavyLosses(id, troopsLostFraction) {
    const fraction = clamp(Number.isFinite(troopsLostFraction) ? troopsLostFraction : 0, 0, 1);
    if (fraction <= 0) return null;
    const delta = -this.rules.heavy_losses_max_penalty * fraction;
    return this.applyDelta(id, delta, MORALE_CHANGE_REASON.HEAVY_LOSSES, {
      troops_lost_fraction: fraction,
    });
  }

  /** موت قائد - عقوبة ثابتة (`commander_death_penalty`) على كل حليف لسه حي. */
  applyCommanderDeath(id) {
    return this.applyDelta(id, -this.rules.commander_death_penalty, MORALE_CHANGE_REASON.COMMANDER_DEATH, {});
  }

  /** هجوم ناجح - مكافأة ثابتة (`successful_attack_bonus`) على المهاجم. */
  applySuccessfulAttack(id) {
    return this.applyDelta(id, this.rules.successful_attack_bonus, MORALE_CHANGE_REASON.SUCCESSFUL_ATTACK, {});
  }

  /** حلفاء قريبين - `alliesCount` عدد الحلفاء الأحياء جوه نطاق معيّن (محسوب
   * برّه هنا) - بيتحسب بس لحد `nearby_allies_max_counted`. */
  applyNearbyAllies(id, alliesCount) {
    const counted = Math.min(
      Math.max(0, Math.floor(Number.isFinite(alliesCount) ? alliesCount : 0)),
      this.rules.nearby_allies_max_counted
    );
    if (counted <= 0) return null;
    const delta = this.rules.nearby_allies_bonus_per_ally * counted;
    return this.applyDelta(id, delta, MORALE_CHANGE_REASON.NEARBY_ALLIES, { nearby_allies: counted });
  }
}

function createMoraleStore(options) {
  return new MoraleStore(options);
}

module.exports = {
  MORALE_CHANGE_REASON,
  DEFAULT_MORALE_MIN,
  DEFAULT_MORALE_MAX,
  DEFAULT_MORALE_INITIAL,
  DEFAULT_MORALE_RULES,

  MoraleStore,
  createMoraleStore,
};
