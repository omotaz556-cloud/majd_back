// ====== Rule Engine (خطوة 4 من معمارية نظام المعارك) ======
// الملف ده **مش AI**. مسؤوليته الوحيدة إنه يقيّم (evaluate) الشروط اللي
// اللاعب نفسه حطّها في خطة الهجوم (Battle Plan) أو خطة الدفاع (Defense Plan)،
// وبمجرد ما شرط يتحقق، ينشر (publish) الفعل اللي اللاعب حدده مسبقًا لنفس
// الشرط ده بالظبط. الـ Rule Engine مايخترعش استراتيجية، ومايبدّلش قرار
// اللاعب، ومايقرّرش هو نفسه أي فعل يتنفذ - هو بس "لو الشرط X اتحقق، انشر
// الفعل Y اللي اللاعب سبق واختاره".
//
// ====== حدود المسؤولية (مهم جدًا) ======
// - مفيش هنا أي حساب ضرر أو حسم اشتباك (ده شغل Combat Engine).
// - مفيش هنا أي منطق حركة/باثفايندنج (Pathfinding) حقيقي - أقصى حاجة بيعملها
//   الملف ده جغرافيًا هي فحص ثابت "هل نقطة جوه منطقة معينة" (Enemy Entered
//   Area) بناءً على مواقع موجودة بالفعل - مفيش حساب مسار أو حركة.
// - مفيش هنا أي قرار ذكاء اصطناعي (AI) - كل قاعدة (Rule) واللي فيها بتيجي
//   حرفيًا من خطة اللاعب، مش من تحليل ذكي للموقف.
// - الملف ده بيقرأ حقائق (facts) جاهزة عن حالة المعركة (وحدات، مبانِ/أسوار/
//   أبراج/بوابات، معنويات...) - مايحسبش هو الحقائق دي، بس يقيّمها. الحقائق
//   اللي مش موجودة في UnitStateStore بتاع Simulation Engine (زي حالة سور/
//   برج/بوابة) بتتوصّله عن طريق `context.facts` - حاوية حرة هتتملى من
//   Combat Engine / Building Interaction لما يتبنوا، ولحد ما ده يحصل أي شرط
//   بيعتمد عليها بيرجع `false` بأمان (مش يفترض حاجة).
//
// لسه مش متبني: Combat Engine (اللي هيحوّل RULE_TRIGGERED.action.type فعليًا
// لحركة/هجوم حقيقي)، وBuilding Interaction (اللي هيملى context.facts.gates/
// walls/towers فعليًا). الـ Rule Engine هنا جاهز يستقبلهم من غير ما يحتاج
// أي تعديل في الملف ده نفسه.

'use strict';

const {
  SIMULATION_EVENT,
  BattleTimeline,
  SimulationEventBus,
} = require('./simulationEngine');

const RULE_ENGINE_VERSION = '0.1.0-foundation';

// ---------------------------------------------------------------------------
// Requirement 3: عوامل ربط الشروط (Rule Conditions) - AND / OR + تعشيش
// ---------------------------------------------------------------------------
const LOGICAL_OPERATOR = {
  AND: 'AND',
  OR: 'OR',
};

// ---------------------------------------------------------------------------
// Requirement 2: أنواع الشروط المدعومة (Rule Evaluation)
// كل نوع هنا بيتقيّم ضد `context` (اللي فيه tick الحالي + units من Simulation
// Engine + facts خارجية من أنظمة تانية) - مفيش أي حساب قتالي في أي واحد منهم.
// ---------------------------------------------------------------------------
const CONDITION_TYPE = {
  GATE_DESTROYED: 'gate_destroyed',
  WALL_DESTROYED: 'wall_destroyed',
  TOWER_DESTROYED: 'tower_destroyed',
  COMMANDER_DEAD: 'commander_dead',
  FORMATION_DESTROYED: 'formation_destroyed',
  CASUALTIES_ABOVE_PERCENT: 'casualties_above_percent',
  MORALE_BELOW: 'morale_below',
  TARGET_CAPTURED: 'target_captured',
  TIMER_REACHED: 'timer_reached',
  ENEMY_ENTERED_AREA: 'enemy_entered_area',
  REINFORCEMENTS_ARRIVED: 'reinforcements_arrived',
};

// ---------------------------------------------------------------------------
// Requirement 4: الأفعال اللي ممكن تتنشر (Rule Execution) - دي مفردات خطة
// اللاعب نفسها (Battle Plan / Defense Plan)، مختلفة عن ACTION_TYPE بتاع
// Simulation Engine (اللي هو مفردات حركة تيك بتيك زي move/rotate/wait).
// الـ Rule Engine بينشر الفعل ده زي ما هو بالظبط - مش بيقرر معناه ولا يحوّله
// لحركة فعلية (ده شغل Combat Engine/Building Interaction لما يستلموه).
// ---------------------------------------------------------------------------
const PLAN_ACTION_TYPE = {
  MOVE_FORMATION: 'move_formation',
  HOLD_POSITION: 'hold_position',
  ATTACK_GATE: 'attack_gate',
  ATTACK_WALL: 'attack_wall',
  DEFEND_GATE: 'defend_gate',
  REINFORCE_WALL: 'reinforce_wall',
  ACTIVATE_RESERVE_ARMY: 'activate_reserve_army',
  RETREAT: 'retreat',
  OPEN_GATE: 'open_gate',
  CLOSE_GATE: 'close_gate',
  PROTECT_TOWN_HALL: 'protect_town_hall',
};

// ---------------------------------------------------------------------------
// أحداث الـ Rule Engine - بتتنشر على نفس الـ Simulation Event Bus اللي
// انحقنت للمحرك (نفس فلسفة "مفيش تشبيك" بتاعة Simulation Engine بالظبط):
// أي نظام (Combat Engine, Replay System, Battle Report) يقدر يعمل subscribe
// من غير ما يعرف حاجة عن الـ Rule Engine نفسه.
// ---------------------------------------------------------------------------
const RULE_EVENT = {
  RULE_REGISTERED: 'rule:registered',
  RULE_UNREGISTERED: 'rule:unregistered',
  RULE_ENABLED: 'rule:enabled',
  RULE_DISABLED: 'rule:disabled',
  RULE_TRIGGERED: 'rule:triggered',
};

// =============================================================================
// التحقق من شكل شجرة الشروط (Condition Tree Validation) - وقت التسجيل بس،
// عشان أي قاعدة غلط شكلها تترفض فورًا بدل ما تفشل بصمت وقت التقييم.
// =============================================================================
function isLogicalOperator(op) {
  return op === LOGICAL_OPERATOR.AND || op === LOGICAL_OPERATOR.OR;
}

function validateConditionNode(node, path = 'condition') {
  if (!node || typeof node !== 'object') {
    throw new Error(`${path}: لازم يكون object`);
  }

  // ---- عقدة منطقية (AND/OR) بتحتوي شروط فرعية (تعشيش - Requirement 3) ----
  if (node.operator !== undefined) {
    if (!isLogicalOperator(node.operator)) {
      throw new Error(`${path}.operator: قيمة غير مدعومة "${node.operator}" - المسموح بس AND/OR`);
    }
    if (!Array.isArray(node.conditions) || node.conditions.length === 0) {
      throw new Error(`${path}.conditions: لازم يكون array فيه شرط واحد على الأقل`);
    }
    node.conditions.forEach((child, i) => validateConditionNode(child, `${path}.conditions[${i}]`));
    return;
  }

  // ---- عقدة ورقة (Leaf) - نوع شرط فعلي من CONDITION_TYPE ----
  if (typeof node.check !== 'string' || !Object.values(CONDITION_TYPE).includes(node.check)) {
    throw new Error(`${path}.check: نوع شرط غير معروف "${node.check}"`);
  }
  if (node.params !== undefined && (typeof node.params !== 'object' || node.params === null)) {
    throw new Error(`${path}.params: لازم يكون object لو موجود`);
  }
}

// =============================================================================
// دوال مساعدة صغيرة لقراءة الـ context - بدون أي حساب قتالي، مجرد استعلام
// على بيانات موجودة بالفعل (units من Simulation Engine + facts خارجية).
// =============================================================================
function getUnits(context) {
  return Array.isArray(context.units) ? context.units : [];
}

function getFacts(context) {
  return context.facts && typeof context.facts === 'object' ? context.facts : {};
}

// معرّفات الوحدات بتتبني بالشكل `owner:troopKey:index` (راجع
// buildUnitGroupsFromSnapshot في simulationEngine.js) - الجزء قبل أول ":"
// هو صاحب الوحدة (attacker/defender).
function ownerOfUnit(unit) {
  const id = String(unit?.id ?? '');
  const sepIndex = id.indexOf(':');
  return sepIndex === -1 ? null : id.slice(0, sepIndex);
}

function distance(a, b) {
  const dx = (a?.x ?? 0) - (b?.x ?? 0);
  const dy = (a?.y ?? 0) - (b?.y ?? 0);
  return Math.sqrt(dx * dx + dy * dy);
}

function isInsideArea(position, area = {}) {
  if (!position) return false;
  if (Number.isFinite(area.radius)) {
    return distance(position, { x: area.x ?? 0, y: area.y ?? 0 }) <= area.radius;
  }
  const width = area.width ?? 0;
  const height = area.height ?? 0;
  return (
    position.x >= (area.x ?? 0) &&
    position.x <= (area.x ?? 0) + width &&
    position.y >= (area.y ?? 0) &&
    position.y <= (area.y ?? 0) + height
  );
}

// =============================================================================
// Requirement 2: تقييم كل نوع شرط - كل دالة هنا بترجع boolean بس، من غير أي
// تنفيذ أو تعديل لأي حالة. أي حقل مش موجود في context.facts بيتعامل معاه
// كـ "لسه ما تحققش" (false) بدل ما نفترض حاجة عن نظام لسه مش موجود.
// =============================================================================
const CONDITION_EVALUATORS = {
  [CONDITION_TYPE.GATE_DESTROYED](params, context) {
    const facts = getFacts(context);
    return Boolean(facts.gates?.[params.gate_id]?.destroyed);
  },

  [CONDITION_TYPE.WALL_DESTROYED](params, context) {
    const facts = getFacts(context);
    return Boolean(facts.walls?.[params.wall_id]?.destroyed);
  },

  [CONDITION_TYPE.TOWER_DESTROYED](params, context) {
    const facts = getFacts(context);
    return Boolean(facts.towers?.[params.tower_id]?.destroyed);
  },

  [CONDITION_TYPE.COMMANDER_DEAD](params, context) {
    const facts = getFacts(context);
    if (facts.commanders && params.commander_id in facts.commanders) {
      return facts.commanders[params.commander_id]?.alive === false;
    }
    // مفيش نظام قادة حقيقي لسه - كـ fallback، لو القائد متسجّل كوحدة عادية
    // (unit group) في الـ Simulation Engine، بنستخدم علم alive بتاعها.
    const unit = getUnits(context).find((u) => u.id === params.commander_id);
    return unit ? unit.alive === false : false;
  },

  [CONDITION_TYPE.FORMATION_DESTROYED](params, context) {
    const units = getUnits(context).filter((u) => u.formation === params.formation_id);
    if (units.length === 0) return false;
    return units.every((u) => u.alive === false);
  },

  [CONDITION_TYPE.CASUALTIES_ABOVE_PERCENT](params, context) {
    const units = getUnits(context).filter((u) => ownerOfUnit(u) === params.owner);
    if (units.length === 0) return false;
    const dead = units.filter((u) => u.alive === false).length;
    return (dead / units.length) * 100 >= (params.percent ?? 0);
  },

  [CONDITION_TYPE.MORALE_BELOW](params, context) {
    if (params.unit_id) {
      const unit = getUnits(context).find((u) => u.id === params.unit_id);
      return unit ? (unit.morale ?? 100) < params.value : false;
    }
    const units = getUnits(context).filter((u) => ownerOfUnit(u) === params.owner);
    if (units.length === 0) return false;
    const avgMorale = units.reduce((sum, u) => sum + (u.morale ?? 100), 0) / units.length;
    return avgMorale < (params.value ?? 0);
  },

  [CONDITION_TYPE.TARGET_CAPTURED](params, context) {
    const facts = getFacts(context);
    return Array.isArray(facts.captured_targets) && facts.captured_targets.includes(params.target_id);
  },

  [CONDITION_TYPE.TIMER_REACHED](params, context) {
    if (Number.isFinite(params.simulation_time)) {
      return (context.simulation_time ?? 0) >= params.simulation_time;
    }
    return (context.tick ?? 0) >= (params.tick ?? 0);
  },

  [CONDITION_TYPE.ENEMY_ENTERED_AREA](params, context) {
    const units = getUnits(context).filter(
      (u) => ownerOfUnit(u) !== params.owner && u.alive !== false
    );
    return units.some((u) => isInsideArea(u.position, params.area));
  },

  [CONDITION_TYPE.REINFORCEMENTS_ARRIVED](params, context) {
    const facts = getFacts(context);
    const arrived = Array.isArray(facts.reinforcements_arrived) ? facts.reinforcements_arrived : [];
    if (params.reinforcement_id) return arrived.includes(params.reinforcement_id);
    if (params.owner) return arrived.some((id) => String(id).startsWith(`${params.owner}:`));
    return arrived.length > 0;
  },
};

/** يقيّم عقدة شرط (منطقية أو ورقة) - بيتنادى تكراريًا لدعم التعشيش (Requirement 3) */
function evaluateConditionNode(node, context) {
  if (node.operator === LOGICAL_OPERATOR.AND) {
    return node.conditions.every((child) => evaluateConditionNode(child, context));
  }
  if (node.operator === LOGICAL_OPERATOR.OR) {
    return node.conditions.some((child) => evaluateConditionNode(child, context));
  }
  const evaluator = CONDITION_EVALUATORS[node.check];
  if (!evaluator) return false; // نوع شرط غير معروف وقت التقييم - أمان إضافي (المفروض اتصيد وقت registerRule)
  return Boolean(evaluator(node.params || {}, context));
}

// =============================================================================
// RuleEngine - القلب: يسجّل قواعد اللاعب، يقيّمها كل تيك، وينشر أفعالها
// =============================================================================
class RuleEngine {
  /**
   * @param {object} [options]
   * @param {object} [options.eventBus] - نفس الـ Simulation Event Bus (أي
   *   أوبچكت فيه on/off/emit) - لو مش مبعوت بيتعمل واحد محلي (مفيد للاختبار
   *   المعزول بس)، ومفيش أي subscribe تلقائي على تيكات محرك حقيقي في الحالة دي.
   * @param {() => object} [options.getContext] - دالة بترجّع بيانات إضافية
   *   (units, facts...) تتضاف لأي context بييجي مع كل تيك تلقائي. اختيارية -
   *   لو المستخدم بيستدعي evaluateTick(context) يدويًا مش لازم يحددها.
   */
  constructor({ eventBus = null, getContext = null } = {}) {
    this.eventBus = eventBus || new SimulationEventBus();
    this._autoSubscribed = Boolean(eventBus);
    this._getContext = typeof getContext === 'function' ? getContext : null;

    this._rules = new Map(); // id -> rule (بعد التطبيع/normalize)
    this._lastTriggeredTick = new Map(); // id -> آخر تيك اتنفذ فيه (Cooldown)

    // ====== Requirement 7: سجل كل الأفعال اللي المحرك ده نشرها - بنفس شكل
    // BattleTimeline اللي Simulation Engine بيستخدمه (tick/timestamp/type/
    // source/target/payload)، عشان Replay System/Battle Report/Battle
    // Timeline يقدروا يدمجوه مع الخط الزمني الرئيسي من غير أي شكل مختلف. ======
    this.ruleLog = new BattleTimeline();

    // ---- Requirement 1: اشتراك تلقائي في الـ Simulation Event Bus عشان
    // المحرك "يشتغل كل تيك محاكاة" من غير ما حد ينادي عليه يدويًا كل مرة ----
    this._unsubscribeTick = this.eventBus.on(SIMULATION_EVENT.TICK_COMPLETED, (payload) => {
      this.evaluateTick(this._buildContext(payload));
    });
  }

  _buildContext(tickPayload = {}) {
    const extra = this._getContext ? this._getContext() || {} : {};
    return { ...extra, ...tickPayload, tick: tickPayload.tick ?? extra.tick ?? 0 };
  }

  _emit(type, payload) {
    if (this.eventBus) this.eventBus.emit(type, payload);
  }

  // ---------------------------------------------------------------------
  // Requirement 8: API - registerRule / unregisterRule / enableRule / disableRule
  // ---------------------------------------------------------------------

  /**
   * يسجّل قاعدة جديدة (Battle Plan/Defense Plan) - يتحقق من شكلها بس
   * (الشرط + الفعل)، مايحاولش يفهم "قصدها إيه" أو يحسّنها.
   * @param {{
   *   id: string, owner?: 'attacker'|'defender'|null, name?: string,
   *   priority?: number, cooldown_ticks?: number, enabled?: boolean,
   *   condition: object, action: {type: string, target?: any, payload?: object}
   * }} rule
   */
  registerRule(rule) {
    if (!rule || typeof rule !== 'object') {
      throw new Error('لازم تدّي registerRule أوبچكت قاعدة (rule) صحيح');
    }
    const { id } = rule;
    if (!id || typeof id !== 'string') {
      throw new Error('كل قاعدة لازم يكون ليها id فريد (نص/string)');
    }
    if (this._rules.has(id)) {
      throw new Error(`فيه قاعدة مسجّلة قبل كده بنفس الـ id: "${id}"`);
    }
    if (!rule.condition) {
      throw new Error(`القاعدة "${id}": لازم تحدد condition`);
    }
    validateConditionNode(rule.condition, `${id}.condition`);

    if (!rule.action || typeof rule.action !== 'object') {
      throw new Error(`القاعدة "${id}": لازم تحدد action`);
    }
    if (!Object.values(PLAN_ACTION_TYPE).includes(rule.action.type)) {
      throw new Error(`القاعدة "${id}": نوع فعل غير معروف في خطة اللاعب: "${rule.action.type}"`);
    }
    if (rule.cooldown_ticks !== undefined && (!Number.isFinite(rule.cooldown_ticks) || rule.cooldown_ticks < 0)) {
      throw new Error(`القاعدة "${id}": cooldown_ticks لازم يكون رقم صفر أو أكبر`);
    }

    const normalized = {
      id,
      owner: rule.owner ?? null,
      name: rule.name ?? null,
      priority: Number.isFinite(rule.priority) ? rule.priority : 0, // Requirement 5
      cooldown_ticks: Number.isFinite(rule.cooldown_ticks) ? rule.cooldown_ticks : 0, // Requirement 6
      enabled: rule.enabled !== false,
      condition: rule.condition,
      action: {
        type: rule.action.type,
        target: rule.action.target ?? null,
        payload: rule.action.payload ?? {},
      },
    };

    this._rules.set(id, normalized);
    this._emit(RULE_EVENT.RULE_REGISTERED, { rule_id: id, owner: normalized.owner });
    return normalized;
  }

  unregisterRule(id) {
    if (!this._rules.has(id)) {
      throw new Error(`مفيش قاعدة بالـ id ده: "${id}"`);
    }
    this._rules.delete(id);
    this._lastTriggeredTick.delete(id);
    this._emit(RULE_EVENT.RULE_UNREGISTERED, { rule_id: id });
  }

  enableRule(id) {
    const rule = this._rules.get(id);
    if (!rule) throw new Error(`مفيش قاعدة بالـ id ده: "${id}"`);
    rule.enabled = true;
    this._emit(RULE_EVENT.RULE_ENABLED, { rule_id: id });
  }

  disableRule(id) {
    const rule = this._rules.get(id);
    if (!rule) throw new Error(`مفيش قاعدة بالـ id ده: "${id}"`);
    rule.enabled = false;
    this._emit(RULE_EVENT.RULE_DISABLED, { rule_id: id });
  }

  getRule(id) {
    return this._rules.get(id) || null;
  }

  getAllRules() {
    return Array.from(this._rules.values());
  }

  isRuleOnCooldown(id, tick) {
    const rule = this._rules.get(id);
    if (!rule) return false;
    return this._isOnCooldown(rule, Number.isFinite(tick) ? tick : 0);
  }

  _isOnCooldown(rule, tick) {
    if (!rule.cooldown_ticks) return false;
    const lastTick = this._lastTriggeredTick.get(rule.id);
    if (lastTick === undefined) return false;
    return tick - lastTick < rule.cooldown_ticks;
  }

  // ---------------------------------------------------------------------
  // Requirement 8: evaluateTick() - القلب اللي بيتنادى كل تيك (تلقائيًا عن
  // طريق TICK_COMPLETED، أو يدويًا لو حابب تتحكم بالـ context بنفسك)
  // ---------------------------------------------------------------------
  /**
   * @param {{tick?: number, simulation_time?: number, units?: object[], facts?: object}} [context]
   * @returns {object[]} كل الأحداث اللي اتنشرت في التيك ده (بترتيب الأولوية)
   */
  evaluateTick(context = {}) {
    const tick = Number.isFinite(context.tick) ? context.tick : 0;
    const triggeredEvents = [];

    // Requirement 5: القواعد الأعلى أولوية (priority) بتتقيّم وتتنفذ الأول
    // لو أكتر من قاعدة بقت صحيحة في نفس التيك.
    const candidateRules = Array.from(this._rules.values())
      .filter((rule) => rule.enabled)
      .sort((a, b) => b.priority - a.priority);

    for (const rule of candidateRules) {
      // Requirement 6: تبريد (Cooldown) - يمنع نفس القاعدة تتنفذ كل تيك
      if (this._isOnCooldown(rule, tick)) continue;

      let satisfied = false;
      try {
        satisfied = evaluateConditionNode(rule.condition, context);
      } catch (err) {
        console.error(`[RuleEngine] خطأ أثناء تقييم شرط القاعدة "${rule.id}":`, err);
        continue; // خطأ في قاعدة واحدة مايوقفش تقييم باقي القواعد
      }

      if (!satisfied) continue;

      this._lastTriggeredTick.set(rule.id, tick);

      // Requirement 4: نشر الفعل اللي اللاعب حدده مسبقًا زي ما هو - من غير
      // أي تعديل أو "تحسين" من الـ Rule Engine نفسه.
      const eventPayload = {
        rule_id: rule.id,
        owner: rule.owner,
        priority: rule.priority,
        action: { ...rule.action },
        triggered_at: Date.now(),
      };

      // Requirement 7: تسجيل حدث لكل قاعدة اتنفذت - جاهز لـ Replay/Report/Timeline
      const loggedEvent = this.ruleLog.addEvent({
        tick,
        type: RULE_EVENT.RULE_TRIGGERED,
        source: rule.owner ?? rule.id,
        target: rule.action.target ?? null,
        payload: eventPayload,
      });

      this._emit(RULE_EVENT.RULE_TRIGGERED, loggedEvent);
      triggeredEvents.push(loggedEvent);
    }

    return triggeredEvents;
  }

  // ---------------------------------------------------------------------
  // القراءة العامة (Rule Log / Replay) - Requirement 7
  // ---------------------------------------------------------------------
  getRuleLog() {
    return this.ruleLog.getEvents();
  }

  getReplayData() {
    return { engine: 'rule_engine', engine_version: RULE_ENGINE_VERSION, events: this.ruleLog.getEvents() };
  }

  /** بيلغي الاشتراك في الـ Simulation Event Bus - مهم لو المحرك ده هيتشال/يتستبدل */
  destroy() {
    if (typeof this._unsubscribeTick === 'function') {
      this._unsubscribeTick();
      this._unsubscribeTick = null;
    }
  }
}

function createRuleEngine(options) {
  return new RuleEngine(options);
}

module.exports = {
  RuleEngine,
  createRuleEngine,

  LOGICAL_OPERATOR,
  CONDITION_TYPE,
  PLAN_ACTION_TYPE,
  RULE_EVENT,

  validateConditionNode,
  evaluateConditionNode,

  RULE_ENGINE_VERSION,
};
