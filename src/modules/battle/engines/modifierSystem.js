// ====== Modifier System (امتداد لـ Combat Engine) ======
// الملف ده مسؤول **بس** عن دورة حياة "المُعدِّلات المؤقتة/الدائمة" (Modifiers)
// اللي بتأثر على وحدة أو مبنى في المعركة: هجوم إضافي، دفاع إضافي، تقليل ضرر،
// عقوبة حركة، أو مورال. مفيش هنا أي معرفة بمين بعت المودفير ده - القائد،
// التكنولوجيا، تحالف، معدات، أو مهارة مؤقتة كلهم بيتعاملوا هنا بنفس الشكل
// بالظبط (source عبارة عن نص/id حر بس، مش نوع كيان خاص). ده اللي بيخلي
// Combat Engine نفسه ماعندوش أي "if commander then..." - هو بس بيستقبل
// modifiers مُجمّعة جاهزة من أي نظام خارجي وبيطبقها بشكل عام.
//
// ====== حدود المسؤولية ======
// - مفيش هنا أي حساب ضرر (ده شغل damageEngine.js) - الملف ده بس بيدير
//   تسجيل/تكديس/تجميع/انتهاء صلاحية المودفيرز، وبيرجّع قيم مُجمّعة جاهزة
//   لأي نظام تاني (combatEngine.js لحساب الضرر، simulationEngine.js
//   لعقوبة الحركة، أي نظام مورال مستقبلي...) يستخدمها زي ما هو مناسب له.
// - مفيش هنا أي معرفة بالـ Event Bus بتاع المحاكاة تحديدًا - بياخد أي
//   eventBus عنده on/off/emit (اختياري تمامًا) بنفس فلسفة CombatEngine نفسه،
//   عشان يفضل قابل للاستخدام/الاختبار من غير أي محرك تاني حواليه خالص.

'use strict';

// ---------------------------------------------------------------------------
// Requirement 2: أنواع المُعدِّلات المدعومة افتراضيًا. القايمة دي *مش* قافلة -
// أي نظام خارجي يقدر يبعت `type` نص حر تاني (مهارة/تكنولوجيا جديدة مستقبلية)
// من غير ما يحتاج يعدّل الملف ده؛ القيم هنا بس أسامي قياسية جاهزة + قاعدة
// تكديس افتراضية معقولة لكل واحدة فيهم (راجع DEFAULT_STACKING_RULES تحت).
// ---------------------------------------------------------------------------
const MODIFIER_TYPE = {
  ATTACK_BONUS: 'attack_bonus',
  DEFENSE_BONUS: 'defense_bonus',
  DAMAGE_REDUCTION: 'damage_reduction',
  MOVEMENT_PENALTY: 'movement_penalty',
  MORALE_BONUS: 'morale_bonus',
};

// ---------------------------------------------------------------------------
// Requirement 4: قواعد التكديس (Stacking Rules) - قابلة للتهيئة لكل نوع
// (configurable)، مش مُبَرمَجة (hardcoded) جوه منطق الحساب:
//   - STACK             : كل المودفيرز الفعالة تتجمع (مجموع القيم) - مناسب
//                         لبَفّات هجوم/مورال متعددة من مصادر مختلفة.
//   - HIGHEST_ONLY       : بس الأقوى قيمة هي اللي فعالة - الباقي يفضل مسجّل
//                         (عشان لو اتشال يبان اللي بعده) بس مش محسوب في
//                         التجميع. مناسب لتقليل ضرر/عقوبة حركة (منطقيًا
//                         تأثيرين من نفس النوع مايتضاعفوش فوق بعض).
//   - LATEST_ONLY        : آخر modifier مُضاف من نفس النوع (أي مصدر) بيستبدل
//                         أي واحد قبله في اللحظة اللي بيتضاف فيها.
//   - UNIQUE_PER_SOURCE  : نفس المصدر مايقدرش يكون ليه أكتر من تأثير واحد
//                         فعال من نفس النوع في نفس اللحظة (مصدر جديد بيستبدل
//                         القديم بتاعه بس)، لكن مصادر مختلفة بتتجمع مع بعض.
// ---------------------------------------------------------------------------
const STACKING_MODE = {
  STACK: 'stack',
  HIGHEST_ONLY: 'highest_only',
  LATEST_ONLY: 'latest_only',
  UNIQUE_PER_SOURCE: 'unique_per_source',
};

const DEFAULT_STACKING_RULES = {
  [MODIFIER_TYPE.ATTACK_BONUS]: STACKING_MODE.STACK,
  [MODIFIER_TYPE.DEFENSE_BONUS]: STACKING_MODE.STACK,
  [MODIFIER_TYPE.DAMAGE_REDUCTION]: STACKING_MODE.HIGHEST_ONLY,
  [MODIFIER_TYPE.MOVEMENT_PENALTY]: STACKING_MODE.HIGHEST_ONLY,
  [MODIFIER_TYPE.MORALE_BONUS]: STACKING_MODE.STACK,
};

// Requirement 6: أحداث اختيارية بتتنشر لو الطرف المستخدم بعت eventBus - أي
// نظام تاني (Simulation Engine لعقوبة الحركة، UI لعرض الـ buffs...) يقدر
// يعمل subscribe من غير ما يعرف حاجة عن تفاصيل التخزين هنا.
const MODIFIER_EVENT = {
  ADDED: 'modifier:added',
  REMOVED: 'modifier:removed',
  EXPIRED: 'modifier:expired',
};

let _autoModifierSeq = 0;
function generateModifierId() {
  _autoModifierSeq += 1;
  return `mod_${Date.now().toString(36)}_${_autoModifierSeq}`;
}

function isValidModifierInput(input) {
  return !!input && typeof input.type === 'string' && input.type.length > 0 && Number.isFinite(input.value);
}

// =============================================================================
// Requirement 1+3+5: ModifierStore - المخزن العام لكل المودفيرز الفعالة، بتاع
// أي عدد أهداف (وحدات أو مباني - نفس المنطق، الملف ده مايفرّقش بينهم خالص،
// بيتعامل مع targetId كنص فريد بس). كل هدف ليه مجموعة مودفيرز مستقلة.
// =============================================================================
class ModifierStore {
  /**
   * @param {object} [options]
   * @param {object} [options.eventBus] - أي كائن فيه emit(type, payload) -
   *   اختياري تمامًا، مفيش أي subscribe بيحصل هنا (الملف ده بس بينشر لو
   *   موجود، عكس CombatEngine اللي بيعمل subscribe فعليًا).
   * @param {object} [options.stackingRules] - تجاوز اختياري لقواعد التكديس
   *   الافتراضية لكل نوع - راجع DEFAULT_STACKING_RULES فوق.
   */
  constructor({ eventBus = null, stackingRules = {} } = {}) {
    this.eventBus = eventBus;
    this.stackingRules = { ...DEFAULT_STACKING_RULES, ...stackingRules };
    // targetId -> Map<modifierId, modifierRecord>
    this._byTarget = new Map();
  }

  _emit(type, payload) {
    if (this.eventBus && typeof this.eventBus.emit === 'function') {
      this.eventBus.emit(type, payload);
    }
  }

  _getBucket(targetId, createIfMissing) {
    let bucket = this._byTarget.get(targetId);
    if (!bucket && createIfMissing) {
      bucket = new Map();
      this._byTarget.set(targetId, bucket);
    }
    return bucket || null;
  }

  /** بيغيّر قاعدة التكديس بتاعة نوع معيّن وقت التشغيل (مثلاً نظام تحالفات
   * عايز damage_reduction بتاعه يتجمّع بدل ما ياخد الأقوى بس فقط لهذه المعركة). */
  configureStacking(type, mode) {
    if (!Object.values(STACKING_MODE).includes(mode)) {
      throw new Error(`[ModifierSystem] وضع تكديس غير معروف: "${mode}"`);
    }
    this.stackingRules[type] = mode;
  }

  getStackingMode(type) {
    return this.stackingRules[type] || STACKING_MODE.STACK;
  }

  // ---------------------------------------------------------------------
  // Requirement 6: addModifier() - الإضافة بتطبّق قاعدة التكديس المهيّأة
  // للنوع ده *وقت الإضافة* (مش وقت القراءة) - عشان getActiveModifiers ترجع
  // بس الحالة الفعلية المتفق عليها من غير ما يحتاج أي قارئ يعرف قواعد
  // التكديس أصلًا.
  // ---------------------------------------------------------------------
  /**
   * @param {string} targetId - id الوحدة/المبنى المستهدف بالتأثير
   * @param {{id?:string, source:string, type:string, value:number,
   *   duration_ticks?:number|null, stackable?:boolean}} input
   * @returns {object} السجل الكامل المُسجَّل (بما فيه remaining_ticks)
   */
  addModifier(targetId, input) {
    if (!targetId) throw new Error('[ModifierSystem] addModifier: لازم targetId');
    if (!isValidModifierInput(input)) {
      throw new Error('[ModifierSystem] addModifier: المودفير لازم يكون فيه type نصي وvalue رقمي');
    }
    if (!input.source) {
      throw new Error('[ModifierSystem] addModifier: المودفير لازم يكون له source (مصدر خارجي - قائد/تكنولوجيا/تحالف/معدات/مهارة)');
    }

    // Requirement 3: duration_ticks/remaining_ticks - null صراحةً يعني مودفير
    // دائم (بيفضل شغال لحد ما حد ينادي removeModifier عليه بالـ id بتاعه)،
    // مش "منتهي فورًا".
    const durationTicks =
      Number.isFinite(input.duration_ticks) && input.duration_ticks > 0
        ? Math.floor(input.duration_ticks)
        : null;

    const record = {
      id: input.id || generateModifierId(),
      source: input.source,
      type: input.type,
      value: input.value,
      duration_ticks: durationTicks,
      remaining_ticks: durationTicks,
      // Requirement 3: stackable - افتراضي true لو مش محدد صراحةً بـ false
      stackable: input.stackable !== false,
    };

    const bucket = this._getBucket(targetId, true);
    const mode = this.getStackingMode(record.type);

    if (mode === STACKING_MODE.LATEST_ONLY) {
      for (const [existingId, existing] of bucket) {
        if (existing.type === record.type) bucket.delete(existingId);
      }
    } else if (mode === STACKING_MODE.UNIQUE_PER_SOURCE) {
      for (const [existingId, existing] of bucket) {
        if (existing.type === record.type && existing.source === record.source) bucket.delete(existingId);
      }
    } else if (record.stackable === false) {
      // Requirement 3: مودفير محدد صراحةً كـ non-stackable - أي نسخة قديمة
      // بنفس (source + type) بتتستبدل، بغض النظر عن قاعدة التكديس العامة
      // للنوع (تجاوز صريح على مستوى المودفير نفسه).
      for (const [existingId, existing] of bucket) {
        if (existing.type === record.type && existing.source === record.source) bucket.delete(existingId);
      }
    }
    // STACKING_MODE.STACK و HIGHEST_ONLY: مفيش أي استبدال وقت الإضافة - كل
    // النسخ بتفضل متسجّلة، والفرق بينهم بس في getAggregatedValue تحت.

    bucket.set(record.id, record);
    this._emit(MODIFIER_EVENT.ADDED, { target: targetId, modifier: record });
    return record;
  }

  /** Requirement 6: removeModifier() - إزالة يدوية بالـ id (مثلاً مهارة
   * اتلغت قبل ما تخلص مدتها، أو قائد خرج من المعركة). */
  removeModifier(targetId, modifierId) {
    const bucket = this._getBucket(targetId, false);
    if (!bucket || !bucket.has(modifierId)) return false;
    const modifier = bucket.get(modifierId);
    bucket.delete(modifierId);
    if (bucket.size === 0) this._byTarget.delete(targetId);
    this._emit(MODIFIER_EVENT.REMOVED, { target: targetId, modifier });
    return true;
  }

  /** بيشيل كل المودفيرز الجايين من مصدر معيّن على هدف معيّن (أو كل الأهداف لو
   * targetId مابعتش) - مفيد لما مصدر كامل يتلغي مرة واحدة (قائد اتقتل، تحالف
   * اتفكك) من غير ما الطرف المستخدم يحتاج يعرف كل id فردي. */
  removeModifiersBySource(source, targetId = null) {
    const removed = [];
    const targets = targetId ? [targetId] : Array.from(this._byTarget.keys());
    for (const tId of targets) {
      const bucket = this._getBucket(tId, false);
      if (!bucket) continue;
      for (const [modifierId, modifier] of bucket) {
        if (modifier.source === source) {
          bucket.delete(modifierId);
          removed.push({ target: tId, modifier });
        }
      }
      if (bucket.size === 0) this._byTarget.delete(tId);
    }
    for (const item of removed) this._emit(MODIFIER_EVENT.REMOVED, item);
    return removed;
  }

  // ---------------------------------------------------------------------
  // Requirement 6: getActiveModifiers() - القراءة الخام (raw records) - كل
  // مودفير لسه مسجّل ومامتهوش، حتى لو HIGHEST_ONLY مش خاده هو الفعلي في
  // التجميع (شفافية كاملة لأي نظام عايز يعرض كل الـ buffs الموجودة، مش بس
  // الأثر الصافي).
  // ---------------------------------------------------------------------
  getActiveModifiers(targetId, type) {
    const bucket = this._getBucket(targetId, false);
    if (!bucket) return [];
    const all = Array.from(bucket.values());
    return type ? all.filter((m) => m.type === type) : all;
  }

  getAllTargetsWithModifiers() {
    return Array.from(this._byTarget.keys());
  }

  /** Requirement 4: القيمة الصافية الفعلية لنوع معيّن على هدف، بعد تطبيق
   * قاعدة التكديس المهيّأة لهذا النوع - دي القيمة اللي أي نظام حساب (ضرر،
   * حركة...) المفروض يستخدمها، مش يحاول يعيد منطق التكديس بنفسه. */
  getAggregatedValue(targetId, type) {
    const active = this.getActiveModifiers(targetId, type);
    if (active.length === 0) return 0;
    const mode = this.getStackingMode(type);
    if (mode === STACKING_MODE.HIGHEST_ONLY) {
      return active.reduce((max, m) => (m.value > max ? m.value : max), active[0].value);
    }
    // STACK / LATEST_ONLY / UNIQUE_PER_SOURCE: في كل الحالات دي مجموع الفعال
    // بالظبط هو المجموع (LATEST_ONLY وUNIQUE_PER_SOURCE أصلًا بيضمنوا مفيش
    // تكرار غير مقصود وقت الإضافة، فالمجموع هنا صافي فعلًا).
    return active.reduce((sum, m) => sum + m.value, 0);
  }

  // ---------------------------------------------------------------------
  // Requirement 5: updateModifiers() - بتتنادى مرة واحدة بالظبط لكل تيك
  // محاكاة (بينادي عليها CombatEngine على TICK_COMPLETED) - بتنقّص
  // remaining_ticks لكل المودفيرز المؤقتة (duration_ticks غير null)، وأي
  // واحد يوصل remaining_ticks لصفر أو أقل بيتشال تلقائيًا (expire) وينشر
  // MODIFIER_EVENT.EXPIRED. مودفيرز دائمة (duration_ticks=null) مابتتأثرش.
  // ---------------------------------------------------------------------
  updateModifiers(ticksElapsed = 1) {
    const expired = [];
    for (const [targetId, bucket] of this._byTarget) {
      for (const [modifierId, modifier] of bucket) {
        if (modifier.duration_ticks === null) continue; // دائم - مايخلصش لوحده
        modifier.remaining_ticks -= ticksElapsed;
        if (modifier.remaining_ticks <= 0) {
          bucket.delete(modifierId);
          expired.push({ target: targetId, modifier });
        }
      }
      if (bucket.size === 0) this._byTarget.delete(targetId);
    }
    for (const item of expired) this._emit(MODIFIER_EVENT.EXPIRED, item);
    return expired;
  }

  /** بيشيل كل مودفيرز هدف معيّن دفعة واحدة (مثلاً وحدة ماتت/اتشالت من المعركة) -
   * بدون نشر أحداث فردية لكل مودفير (الطرف المستخدم أصلًا عارف إن الهدف راح). */
  clearTarget(targetId) {
    this._byTarget.delete(targetId);
  }

  clear() {
    this._byTarget.clear();
  }
}

// =============================================================================
// Requirement: نقطة تكامل مباشرة مع damage pipeline بتاع Combat Engine -
// بتحوّل الأثر الصافي (aggregated) لأنواع attack_bonus/defense_bonus/
// damage_reduction لنسخة "فعّالة" (effective snapshot) من combatant/target
// جاهزة تتحقن في computeDamage من غير ما damageEngine.js أو combatEngine.js
// يحتاجوا يعرفوا حاجة عن دورة حياة المودفيرز نفسها (source/duration/stacking)
// - كل اللي بيشوفوه هو رقم attack/defense نهائي زي أي رقم عادي.
// movement_penalty وmorale_bonus مقصود إنهم *مايتحقنوش* هنا - تحريك الوحدات
// مش شغل Combat Engine خالص (شغل Simulation Engine)، والمورال مفهوم لعبة
// عام لسه مالوش معادلة قتالية محددة؛ أي نظام محتاجهم يقدر ينادي
// getAggregatedValue(targetId, MODIFIER_TYPE.MOVEMENT_PENALTY/MORALE_BONUS)
// مباشرة بنفسه.
// =============================================================================
function applyModifiersToAttacker(store, attacker) {
  if (!store || !attacker) return attacker;
  const attackBonus = store.getAggregatedValue(attacker.id, MODIFIER_TYPE.ATTACK_BONUS);
  if (!attackBonus) return attacker;
  return {
    ...attacker,
    stats: { ...attacker.stats, attack: (attacker.stats?.attack ?? 0) + attackBonus },
  };
}

function applyModifiersToTarget(store, target) {
  if (!store || !target) return target;
  const defenseBonus = store.getAggregatedValue(target.id, MODIFIER_TYPE.DEFENSE_BONUS);
  const damageReduction = store.getAggregatedValue(target.id, MODIFIER_TYPE.DAMAGE_REDUCTION);
  if (!defenseBonus && !damageReduction) return target;

  const effective = { ...target };
  if (defenseBonus) {
    if (effective.kind === 'structure') {
      effective.defense = (target.defense ?? 0) + defenseBonus;
    } else {
      effective.stats = { ...target.stats, defense: (target.stats?.defense ?? 0) + defenseBonus };
    }
  }
  if (damageReduction) {
    // نسبة تقليل ضرر (0 = بدون تأثير، 1 = حصانة كاملة) - بتتطبّق كـ
    // post_mitigation multiplier، نفس صيغة modifiers الموجودة أصلًا في
    // damageEngine.js (راجع MODIFIER_STAGE.POST_MITIGATION).
    const existingModifiers = Array.isArray(target.modifiers) ? target.modifiers : [];
    effective.modifiers = [
      ...existingModifiers,
      { stage: 'post_mitigation', kind: 'multiplier', value: Math.max(0, 1 - damageReduction) },
    ];
  }
  return effective;
}

module.exports = {
  MODIFIER_TYPE,
  STACKING_MODE,
  MODIFIER_EVENT,
  DEFAULT_STACKING_RULES,

  ModifierStore,

  applyModifiersToAttacker,
  applyModifiersToTarget,
};
