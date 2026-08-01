// ====== Simulation Engine (خطوة 3 من معمارية نظام المعارك) ======
// دي الخطوة اللي بتحول المعركة من "مستند حالة" ثابت (Battle Foundation) لحاجة
// شغالة فعليًا بمرور الوقت: عدّاد تيكات (ticks)، حالة تشغيل، طابور أفعال
// مجدولة، وخط زمني (timeline) للأحداث. أي محرك مستقبلي (Rule Engine, Combat
// Engine, Building Interaction, Replay System, Battle Report) المفروض
// "يشترك" (subscribe) في الأحداث اللي المحرك ده بينشرها بدل ما يتعدّل الملف
// ده نفسه في كل مرة.
//
// ====== حدود المسؤولية (مهم جدًا) ======
// الملف ده بيعمل بس: تقدّم الوقت (tick)، إدارة حالة المحاكاة (state machine)،
// جدولة الأفعال (scheduling)، ونشر الأحداث (event bus + timeline + replay).
// مفيش هنا خالص:
//   - أي معادلة ضرر (damage formulas) أو حسم اشتباك (combat resolution) -
//     ده شغل Combat Engine (engines/combatEngine.js) لما يتبنى.
//   - أي قرار ذكاء اصطناعي (AI decisions) - هيتضاف في محرك منفصل لاحقًا.
//   - أي منطق قواعد (مين يقدر يهاجم مين، شروط الفوز...) - ده شغل Rule Engine
//     (engines/ruleEngine.js).
// الملف ده بينفّذ فعل واحد بس وقت التيك: يسحب الأفعال المجدولة المستحقة
// وينشرها كأحداث (SIMULATION_EVENT.ACTION_DUE) - مفيش أي حساب نتيجة (ضرر/
// hp) بيحصل هنا خالص، ده شغل الأنظمة اللي بتعمل subscribe (Combat Engine).
// تحريك الوحدات الفعلي (تحديث position/destination) كمان مش هنا - ده شغل
// engines/movementSystem.js، اللي بيعمل subscribe على SIMULATION_EVENT.TICK_STARTED
// وبينادي updateUnitGroup() تحت (الـ API العام بتاع الملف ده) زي أي نظام
// تاني مستقل (moraleSystem.js/statisticsSystem.js/buildingInteraction.js) -
// مفيش أي منطق حركة هنا جوه SimulationEngine نفسها.

'use strict';

const SIMULATION_ENGINE_VERSION = '0.1.0-foundation';

// ---------------------------------------------------------------------------
// إعدادات افتراضية (Requirement 1: Tick-based Simulation Engine)
// ---------------------------------------------------------------------------
const DEFAULT_TICK_RATE_MS = 250; // معدل التيك الافتراضي - 250 مللي ثانية
const DEFAULT_SPEED = 1; // مضاعف السرعة الافتراضي (Configurable simulation speed)

// ---------------------------------------------------------------------------
// حالات المحاكاة (Requirement 4: Simulation State)
// ---------------------------------------------------------------------------
const SIMULATION_STATE = {
  WAITING: 'waiting',
  INITIALIZING: 'initializing',
  RUNNING: 'running',
  PAUSED: 'paused',
  FINISHED: 'finished',
  CANCELLED: 'cancelled',
};

// ====== خريطة الانتقالات المسموحة بين حالات المحاكاة - نفس فلسفة
// ALLOWED_TRANSITIONS في battle.config.js بالظبط، بس هنا للـ Simulation
// Engine الداخلي (مستقل تمامًا عن battle.status اللي في battle.model). ======
const ALLOWED_STATE_TRANSITIONS = {
  [SIMULATION_STATE.WAITING]: [SIMULATION_STATE.INITIALIZING],
  [SIMULATION_STATE.INITIALIZING]: [SIMULATION_STATE.RUNNING, SIMULATION_STATE.CANCELLED],
  [SIMULATION_STATE.RUNNING]: [
    SIMULATION_STATE.PAUSED,
    SIMULATION_STATE.FINISHED,
    SIMULATION_STATE.CANCELLED,
  ],
  [SIMULATION_STATE.PAUSED]: [
    SIMULATION_STATE.RUNNING,
    SIMULATION_STATE.FINISHED,
    SIMULATION_STATE.CANCELLED,
  ],
  [SIMULATION_STATE.FINISHED]: [],
  [SIMULATION_STATE.CANCELLED]: [],
};

function isValidStateTransition(fromState, toState) {
  return (
    Array.isArray(ALLOWED_STATE_TRANSITIONS[fromState]) &&
    ALLOWED_STATE_TRANSITIONS[fromState].includes(toState)
  );
}

// ---------------------------------------------------------------------------
// أنواع الأفعال المسموح جدولتها (Requirement 5: Action Queue)
// جدولة بس - مفيش أي منطق تنفيذ (execution logic) لأي نوع من دول هنا.
// ---------------------------------------------------------------------------
const ACTION_TYPE = {
  MOVE: 'move',
  ROTATE: 'rotate',
  WAIT: 'wait',
  CAPTURE_POSITION: 'capture_position',
  ENTER_GATE: 'enter_gate',
  EXIT_GATE: 'exit_gate',
};

// ---------------------------------------------------------------------------
// أنواع أحداث الـ Event Bus (Requirement 6: Event Bus)
// أي محرك مستقبلي يقدر يعمل subscribe لأي حدث من غير ما يحتاج يعدّل الملف ده
// ---------------------------------------------------------------------------
const SIMULATION_EVENT = {
  STATE_CHANGED: 'simulation:state_changed',
  SIMULATION_INITIALIZED: 'simulation:initialized',
  SIMULATION_STARTED: 'simulation:started',
  SIMULATION_PAUSED: 'simulation:paused',
  SIMULATION_RESUMED: 'simulation:resumed',
  SIMULATION_STOPPED: 'simulation:stopped',
  SIMULATION_RESTARTED: 'simulation:restarted',
  SIMULATION_FINISHED: 'simulation:finished',
  TICK_STARTED: 'tick:started',
  TICK_COMPLETED: 'tick:completed',
  ACTION_SCHEDULED: 'action:scheduled',
  ACTION_DUE: 'action:due',
  UNIT_REGISTERED: 'unit:registered',
  UNIT_UPDATED: 'unit:updated',
};

// =============================================================================
// SimulationEventBus - Requirement 6
// نظام نشر/اشتراك داخلي بسيط. أي محرك مستقبلي (Combat/Rule/Replay/Reports)
// بيعمل subscribe عن طريق engine.on(eventType, handler) من غير أي "تشبيك"
// (tight coupling) مع الملف ده - الـ Simulation Engine مايعرفش ولا يهمّه مين
// بيسمع، وده اللي بيسمح بإضافة أنظمة جديدة من غير ما نلمس الملف ده تاني.
// =============================================================================
class SimulationEventBus {
  constructor() {
    this._listeners = new Map(); // eventType -> Set<handler>
  }

  on(eventType, handler) {
    if (typeof handler !== 'function') return () => {};
    if (!this._listeners.has(eventType)) this._listeners.set(eventType, new Set());
    this._listeners.get(eventType).add(handler);
    return () => this.off(eventType, handler); // unsubscribe جاهز
  }

  off(eventType, handler) {
    if (this._listeners.has(eventType)) this._listeners.get(eventType).delete(handler);
  }

  emit(eventType, payload) {
    const handlers = this._listeners.get(eventType);
    if (!handlers) return;
    // بننسخ الـ Set قبل التكرار عشان لو مستمع عمل off/on لنفسه جوه الـ handler
    // نفسه ميأثرش على التكرار الحالي
    for (const handler of Array.from(handlers)) {
      try {
        handler(payload);
      } catch (err) {
        // خطأ في مستمع واحد (مثلاً Combat Engine مستقبلًا) ميوقفش المحاكاة كلها
        console.error(`[SimulationEngine] خطأ في مستمع الحدث "${eventType}":`, err);
      }
    }
  }

  clear() {
    this._listeners.clear();
  }
}

// =============================================================================
// BattleTimeline - Requirement 2
// خط زمني مرتّب لكل أحداث المعركة. كل حدث فيه: tick, timestamp, type, source,
// target, payload - بالظبط زي المطلوب. مخزّنة بترتيب زمني (chronological).
// =============================================================================
class BattleTimeline {
  constructor() {
    this._events = [];
    this._nextEventId = 1;
  }

  /**
   * يضيف حدث جديد للخط الزمني مع الحفاظ على الترتيب الزمني (تيك تلو تيك).
   * @returns {object} الحدث بعد ما اتضاف (فيه id واحد لكل حدث)
   */
  addEvent({ tick, type, source = null, target = null, payload = {} }) {
    const event = {
      id: this._nextEventId++,
      tick,
      timestamp: Date.now(),
      type,
      source,
      target,
      payload,
    };

    // إدراج مرتّب بالتيك - عمليًا التيكات بتزيد بالترتيب دايمًا (advanceTick
    // بيزوّد current_tick بمقدار 1 في كل مرة)، فده هيكون push في آخر الأرّاي
    // في الحالة العادية. بنسيب البحث ده كحماية لأي إدراج مستقبلي بتيك أقدم
    // (مثلاً دمج replay خارجي) عشان الترتيب الزمني يفضل مضمون دايمًا.
    let insertAt = this._events.length;
    for (let i = this._events.length - 1; i >= 0; i--) {
      if (this._events[i].tick <= tick) break;
      insertAt = i;
    }
    this._events.splice(insertAt, 0, event);

    return event;
  }

  getEvents() {
    return this._events.slice();
  }

  getEventsForTick(tick) {
    return this._events.filter((e) => e.tick === tick);
  }

  clear() {
    this._events = [];
    this._nextEventId = 1;
  }
}

// =============================================================================
// ActionQueue - Requirement 5
// طابور أفعال مجدولة لتيكات مستقبلية. جدولة بس - الـ dequeueDue بتسحب
// الأفعال المستحقة لتيك معيّن وترجّعها، بدون أي تنفيذ فعلي لمعناها.
// =============================================================================
class ActionQueue {
  constructor() {
    this._byTick = new Map(); // targetTick -> array<action>
    this._nextActionId = 1;
  }

  schedule(targetTick, { type, source = null, target = null, payload = {} }) {
    if (!Object.values(ACTION_TYPE).includes(type)) {
      throw new Error(`نوع فعل غير معروف: "${type}"`);
    }

    const scheduled = {
      id: this._nextActionId++,
      tick: targetTick,
      type,
      source,
      target,
      payload,
    };

    if (!this._byTick.has(targetTick)) this._byTick.set(targetTick, []);
    this._byTick.get(targetTick).push(scheduled);

    return scheduled;
  }

  /** يسحب (ويشيل) كل الأفعال المستحقة عند تيك معيّن - يتنادى مرة واحدة لكل تيك */
  dequeueDue(tick) {
    const due = this._byTick.get(tick) || [];
    this._byTick.delete(tick);
    return due;
  }

  /** كل الأفعال المجدولة اللي لسه مستنية (للفحص/الديبج - بدون سحب) */
  peekAll() {
    const all = [];
    for (const list of this._byTick.values()) all.push(...list);
    return all.sort((a, b) => a.tick - b.tick);
  }

  clear() {
    this._byTick.clear();
    this._nextActionId = 1;
  }
}

// =============================================================================
// UnitStateStore - Requirement 3
// حالة حية لكل مجموعة وحدات مشاركة في المعركة. مفيش أي حساب قتالي هنا -
// مجرد تخزين/تحديث حالة (position, destination, action, formation, morale
// placeholder, status, alive) زي ما هو مطلوب بالظبط.
// =============================================================================
class UnitStateStore {
  constructor() {
    this._units = new Map();
  }

  register(unit) {
    if (!unit || !unit.id) {
      throw new Error('كل وحدة (Unit Group) لازم يكون ليها id فريد');
    }
    const state = {
      id: unit.id,
      position: unit.position ?? { x: 0, y: 0 },
      destination: unit.destination ?? null,
      current_action: unit.current_action ?? 'idle',
      formation: unit.formation ?? null,
      // placeholder بس دلوقتي - مفيش نظام معنويات (morale) حقيقي لسه، القيمة
      // هنا مجرد مكان محجوز لحد ما Rule/Combat Engine يدّوها معنى فعلي
      morale: unit.morale ?? 100,
      status: unit.status ?? 'idle',
      alive: unit.alive ?? true,
    };
    this._units.set(state.id, state);
    return state;
  }

  update(id, patch = {}) {
    const existing = this._units.get(id);
    if (!existing) {
      throw new Error(`مفيش وحدة (Unit Group) بالـ id ده: "${id}"`);
    }
    const updated = { ...existing, ...patch, id: existing.id };
    this._units.set(id, updated);
    return updated;
  }

  get(id) {
    return this._units.get(id) || null;
  }

  getAll() {
    return Array.from(this._units.values());
  }

  clear() {
    this._units.clear();
  }
}

// =============================================================================
// SimulationEngine - القلب اللي بيربط كل حاجة فوق مع بعض
// =============================================================================
class SimulationEngine {
  /**
   * @param {object} options
   * @param {string|null} [options.battleId] - battle_id بتاع المعركة (اختياري، مفيد للـ replay/logging بس)
   * @param {number} [options.tickRateMs] - معدل التيك بالمللي ثانية (افتراضي 250)
   * @param {number} [options.speed] - مضاعف السرعة الابتدائي (افتراضي 1)
   */
  constructor({ battleId = null, tickRateMs = DEFAULT_TICK_RATE_MS, speed = DEFAULT_SPEED } = {}) {
    this.battleId = battleId;
    this.tickRateMs = tickRateMs > 0 ? tickRateMs : DEFAULT_TICK_RATE_MS;
    this.speed = speed > 0 ? speed : DEFAULT_SPEED;

    // ---- Requirement 4: Simulation State ----
    this.state = SIMULATION_STATE.WAITING;

    // ---- Requirement 1: current_tick + simulation_time ----
    this.current_tick = 0;
    this.simulation_time = 0; // = current_tick * tickRateMs (بالمللي ثانية المحاكاة، مش وقت حقيقي)

    // ---- Requirement 2/5/3/6 ----
    this.timeline = new BattleTimeline();
    this.actionQueue = new ActionQueue();
    this.units = new UnitStateStore();
    this.eventBus = new SimulationEventBus();

    // ---- Requirement 7: Replay Recording ----
    // نسخة حتمية (deterministic) من كل حدث محاكاة اتنشر أثناء التيكات - مفيش
    // أي بيانات بصرية (رسوم/أنيميشن) هنا خالص، بس أحداث خام قابلة لإعادة اللعب.
    this.replay = { battle_id: battleId, engine_version: SIMULATION_ENGINE_VERSION, events: [] };

    this._timer = null;
    // بنحتفظ بآخر تشكيلة وحدات ابتدائية اتبعتت لـ initialize()/startSimulation()
    // عشان restartSimulation() يقدر يرجّع نفس البداية بالظبط من غير ما يحتاج
    // الطرف المستخدم يبعتها تاني.
    this._initialUnits = [];
  }

  // ---------------------------------------------------------------------
  // إدارة حالة المحاكاة (Simulation State)
  // ---------------------------------------------------------------------
  _setState(newState) {
    if (!isValidStateTransition(this.state, newState)) {
      throw new Error(`متقدرش تنقل المحاكاة من حالة "${this.state}" لحالة "${newState}"`);
    }
    const previous = this.state;
    this.state = newState;
    this.eventBus.emit(SIMULATION_EVENT.STATE_CHANGED, {
      previous,
      current: newState,
      tick: this.current_tick,
    });
  }

  getState() {
    return this.state;
  }

  // ---------------------------------------------------------------------
  // Event Bus API - أي محرك مستقبلي بيعمل subscribe من هنا بس
  // ---------------------------------------------------------------------
  on(eventType, handler) {
    return this.eventBus.on(eventType, handler);
  }

  off(eventType, handler) {
    this.eventBus.off(eventType, handler);
  }

  // ---------------------------------------------------------------------
  // التهيئة (Initializing) - بتسجّل الوحدات المشاركة وترجّع كل حاجة لبدايتها
  // ---------------------------------------------------------------------
  initialize({ units = [] } = {}) {
    this._setState(SIMULATION_STATE.INITIALIZING);

    this.current_tick = 0;
    this.simulation_time = 0;
    this.timeline.clear();
    this.actionQueue.clear();
    this.units.clear();
    this.replay = { battle_id: this.battleId, engine_version: SIMULATION_ENGINE_VERSION, events: [] };

    this._initialUnits = units;
    for (const unit of units) {
      const registered = this.units.register(unit);
      this.eventBus.emit(SIMULATION_EVENT.UNIT_REGISTERED, registered);
    }

    this.eventBus.emit(SIMULATION_EVENT.SIMULATION_INITIALIZED, {
      tick: this.current_tick,
      units_count: this.units.getAll().length,
    });

    return this.getSnapshot();
  }

  // ---------------------------------------------------------------------
  // Requirement 8: Public API
  // ---------------------------------------------------------------------

  /** يبدأ المحاكاة - لو لسه في WAITING بيعمل initialize() تلقائيًا الأول */
  startSimulation({ units } = {}) {
    if (this.state === SIMULATION_STATE.WAITING) {
      this.initialize({ units: units ?? this._initialUnits });
    }
    this._setState(SIMULATION_STATE.RUNNING);
    this._startTimer();
    this.eventBus.emit(SIMULATION_EVENT.SIMULATION_STARTED, { tick: this.current_tick });
    return this.getSnapshot();
  }

  /** يوقف مؤقتًا - بيوقف عدّاد الوقت الحقيقي بس، current_tick بيفضل زي ما هو */
  pauseSimulation() {
    this._setState(SIMULATION_STATE.PAUSED);
    this._stopTimer();
    this.eventBus.emit(SIMULATION_EVENT.SIMULATION_PAUSED, { tick: this.current_tick });
    return this.getSnapshot();
  }

  /** يكمّل من نفس التيك اللي وقف عنده */
  resumeSimulation() {
    this._setState(SIMULATION_STATE.RUNNING);
    this._startTimer();
    this.eventBus.emit(SIMULATION_EVENT.SIMULATION_RESUMED, { tick: this.current_tick });
    return this.getSnapshot();
  }

  /** إيقاف نهائي (مش نتيجة طبيعية زي finishSimulation) - بينقل الحالة لـ CANCELLED */
  stopSimulation() {
    this._stopTimer();
    this._setState(SIMULATION_STATE.CANCELLED);
    this.eventBus.emit(SIMULATION_EVENT.SIMULATION_STOPPED, { tick: this.current_tick });
    return this.getSnapshot();
  }

  /**
   * يرجّع المحاكاة بالكامل لبدايتها (نفس الوحدات الابتدائية) عشان تبدأ تاني
   * من الصفر. ده استثناء متعمّد لخريطة الانتقالات العادية (مفيش أي حالة
   * تانية تقدر ترجع لـ WAITING غير عن طريق restartSimulation صراحةً).
   */
  restartSimulation() {
    this._stopTimer();
    this.state = SIMULATION_STATE.WAITING;
    this.eventBus.emit(SIMULATION_EVENT.SIMULATION_RESTARTED, { tick: this.current_tick });
    return this.initialize({ units: this._initialUnits });
  }

  /**
   * ينهي المحاكاة بنتيجة نهائية - الملف ده مانادهاش لوحده خالص (مفيش قواعد
   * فوز/خسارة هنا)، بس المفروض Rule Engine مستقبلًا ينادي عليها لما يوصل
   * لقرار نهائي، من غير ما يحتاج يعدّل Simulation Engine نفسه.
   */
  finishSimulation(reason = null) {
    this._stopTimer();
    this._setState(SIMULATION_STATE.FINISHED);
    this.eventBus.emit(SIMULATION_EVENT.SIMULATION_FINISHED, { tick: this.current_tick, reason });
    return this.getSnapshot();
  }

  /** مضاعف سرعة المحاكاة (Configurable simulation speed) - بيأثر على معدل التيمر الحقيقي بس */
  setSpeed(multiplier) {
    if (!(multiplier > 0)) {
      throw new Error('سرعة المحاكاة لازم تكون رقم أكبر من صفر');
    }
    this.speed = multiplier;
    if (this.state === SIMULATION_STATE.RUNNING) {
      this._startTimer(); // بيعيد ضبط التيمر بالسرعة الجديدة
    }
    return this.speed;
  }

  // ---------------------------------------------------------------------
  // التيمر الداخلي - وقت حقيقي بس، مالوش أي علاقة بمنطق المحاكاة نفسه
  // ---------------------------------------------------------------------
  _startTimer() {
    this._stopTimer();
    const intervalMs = this.tickRateMs / this.speed;
    this._timer = setInterval(() => {
      try {
        this.advanceTick();
      } catch (err) {
        console.error('[SimulationEngine] خطأ أثناء تقدّم التيك:', err);
      }
    }, intervalMs);
    if (typeof this._timer.unref === 'function') this._timer.unref(); // ميمنعش الـ process من الخروج لو نسينا نوقفه
  }

  _stopTimer() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /**
   * يقدّم تيك واحد - يدويًا (من برّه) أو تلقائيًا (من جوه التيمر). ده الجزء
   * اللي بيربط الوقت بالأفعال المجدولة والأحداث: بيزوّد current_tick، يسحب
   * أي أفعال مستحقة لهذا التيك وينشرها كأحداث، وبس - مفيش أي تنفيذ فعلي.
   */
  advanceTick() {
    if (this.state !== SIMULATION_STATE.RUNNING && this.state !== SIMULATION_STATE.PAUSED) {
      throw new Error(`متقدرش تقدّم تيك والمحاكاة في حالة "${this.state}"`);
    }

    this.current_tick += 1;
    this.simulation_time = this.current_tick * this.tickRateMs;
    const timestamp = Date.now();

    const tickStarted = this.timeline.addEvent({
      tick: this.current_tick,
      type: SIMULATION_EVENT.TICK_STARTED,
      payload: { simulation_time: this.simulation_time },
    });
    this.replay.events.push(tickStarted);
    this.eventBus.emit(SIMULATION_EVENT.TICK_STARTED, {
      tick: this.current_tick,
      timestamp,
      simulation_time: this.simulation_time,
    });

    // ====== سحب الأفعال المجدولة المستحقة للتيك ده بس - وبعدين نشرها
    // كأحداث. مفيش أي تنفيذ فعلي لمعنى الفعل (تحريك وحدة فعلي، حساب دخول
    // بوابة...) - ده شغل الأنظمة اللي هتعمل subscribe لـ ACTION_DUE لاحقًا
    // (Combat Engine / Rule Engine / Building Interaction). ======
    const dueActions = this.actionQueue.dequeueDue(this.current_tick);
    for (const action of dueActions) {
      const event = this.timeline.addEvent({
        tick: this.current_tick,
        type: action.type,
        source: action.source,
        target: action.target,
        payload: action.payload,
      });
      this.replay.events.push(event);
      this.eventBus.emit(SIMULATION_EVENT.ACTION_DUE, event);
    }

    const tickCompleted = this.timeline.addEvent({
      tick: this.current_tick,
      type: SIMULATION_EVENT.TICK_COMPLETED,
      payload: { actions_processed: dueActions.length },
    });
    this.replay.events.push(tickCompleted);
    this.eventBus.emit(SIMULATION_EVENT.TICK_COMPLETED, {
      tick: this.current_tick,
      actions_processed: dueActions.length,
    });

    return this.getSnapshot();
  }

  // ---------------------------------------------------------------------
  // Requirement 5: جدولة الأفعال - جدولة بس، بدون أي تنفيذ
  // ---------------------------------------------------------------------
  /**
   * @param {{type: string, source?: any, target?: any, payload?: object}} action
   * @param {number} targetTick - لازم يكون تيك مستقبلي (أكبر من current_tick)
   */
  scheduleAction({ type, source = null, target = null, payload = {} }, targetTick) {
    if (!Number.isFinite(targetTick) || targetTick <= this.current_tick) {
      throw new Error('التيك المستهدف لازم يكون رقم مستقبلي (أكبر من التيك الحالي)');
    }
    const scheduled = this.actionQueue.schedule(targetTick, { type, source, target, payload });
    this.eventBus.emit(SIMULATION_EVENT.ACTION_SCHEDULED, scheduled);
    return scheduled;
  }

  getPendingActions() {
    return this.actionQueue.peekAll();
  }

  // ---------------------------------------------------------------------
  // Requirement 3: حالة الوحدات (Unit State) - بدون أي حساب قتالي
  // ---------------------------------------------------------------------
  registerUnitGroup(unit) {
    const registered = this.units.register(unit);
    this.eventBus.emit(SIMULATION_EVENT.UNIT_REGISTERED, registered);
    return registered;
  }

  updateUnitGroup(id, patch) {
    const updated = this.units.update(id, patch);
    this.eventBus.emit(SIMULATION_EVENT.UNIT_UPDATED, updated);
    return updated;
  }

  getUnit(id) {
    return this.units.get(id);
  }

  getAllUnits() {
    return this.units.getAll();
  }

  // ---------------------------------------------------------------------
  // القراءة العامة (Timeline / Replay / Snapshot)
  // ---------------------------------------------------------------------
  getTimeline() {
    return this.timeline.getEvents();
  }

  /** Requirement 7: بيانات الـ Replay - أحداث حتمية بس، مفيش بيانات بصرية خالص */
  getReplayData() {
    return {
      battle_id: this.replay.battle_id,
      engine_version: this.replay.engine_version,
      events: this.replay.events.slice(),
    };
  }

  /** لقطة كاملة من حالة المحرك دلوقتي - مفيدة للحفظ الخارجي (battle.current_state) */
  getSnapshot() {
    return {
      engine_version: SIMULATION_ENGINE_VERSION,
      battle_id: this.battleId,
      state: this.state,
      current_tick: this.current_tick,
      simulation_time: this.simulation_time,
      tick_rate_ms: this.tickRateMs,
      speed: this.speed,
      units: this.getAllUnits(),
      pending_actions: this.getPendingActions(),
      events: this.getTimeline(),
    };
  }
}

// =============================================================================
// دوال مساعدة (Helpers) - مش جزء من المحرك نفسه، بس بتسهّل التوصيل مستقبلًا
// =============================================================================

/** Factory بسيطة - نفس فلسفة باقي الملفات في الموديول (تصدير دوال بدل ما
 * تفرض على المستخدم يعمل `new` مباشرة لو مش حابب). */
function createSimulationEngine(options) {
  return new SimulationEngine(options);
}

/**
 * تحويل لقطة معركة (Battle snapshot) جاهزة لمجموعات وحدات ابتدائية
 * (Unit Groups) عشان تتبعت لـ initialize()/startSimulation() - ده مجرد
 * تحويل شكل بيانات (mapping)، بدون أي حساب قتالي.
 *
 * ====== المواقع الابتدائية هنا لازم تفضل مطابقة تمامًا لنفس الصيغة
 * الحسابية اللي buildCombatUnitsFromSnapshot بتستخدمها في battle.runner.js
 * (المهاجم عند x=0، الدافع عند x=4، كل كومة متباعدة بمقدار index*2 على
 * y) - قبل إضافة movementSystem.js كانت القيمة هنا ثابتة {x:0, y:0} لكل
 * الوحدات (مهاجم ودافع مع بعض)، فكل الجيشين كانوا بيترسموا فوق بعض في نقطة
 * واحدة على خريطة المعركة من غير أي خط اشتباك حقيقي. movementSystem.js
 * بيصحح أي اختلاف لاحقًا كل تيك على أي حال (بيبعت موقع CombatEngine الحقيقي
 * كل تيك بغض النظر)، لكن مطابقة الصيغة هنا من الأول تضمن إن أول لقطة تتعرض
 * للفرونت إند (قبل ما أي تيك يخلص أصلًا) تبقى صحيحة هي كمان. ======
 * @param {import('../battle.model')} battle
 */
function buildUnitGroupsFromSnapshot(battle) {
  const groups = [];

  function pushSide(owner, troopStacks, startX) {
    (troopStacks || []).forEach((troop, index) => {
      groups.push({
        id: `${owner}:${troop.key}:${index}`,
        position: { x: startX, y: index * 2 },
        destination: null,
        current_action: 'idle',
        formation: owner === 'attacker' ? battle?.snapshot?.attacker?.formation ?? null : null,
        status: 'staged',
        alive: true,
      });
    });
  }

  pushSide('attacker', battle?.snapshot?.attacker?.troops, 0);
  pushSide('defender', battle?.snapshot?.defender?.troops, 4);

  return groups;
}

module.exports = {
  SimulationEngine,
  createSimulationEngine,
  buildUnitGroupsFromSnapshot,

  // مُصدَّرة عشان أي محرك مستقبلي (Rule Engine, Combat Engine, ...) يقدر
  // يعيد استخدام نفس البنية (خط زمني/ناشر أحداث) بدل ما يخترع واحدة تانية
  // مكررة - بيفضل كل شيء بنفس الشكل (نفس حقول الحدث، نفس واجهة on/off/emit).
  BattleTimeline,
  SimulationEventBus,

  SIMULATION_STATE,
  ALLOWED_STATE_TRANSITIONS,
  isValidStateTransition,

  ACTION_TYPE,
  SIMULATION_EVENT,

  DEFAULT_TICK_RATE_MS,
  DEFAULT_SPEED,
  SIMULATION_ENGINE_VERSION,
};
