const mongoose = require('mongoose');
const {
  BATTLE_STATUS,
  WINNER_VALUES,
  BATTLE_MODE,
  BATTLE_VERSION,
  createDefaultStatistics,
  createInitialCurrentState,
  createEmptyBattleEvents,
} = require('./battle.config');

// ====== كل الـ sub-schemas هنا بتتحط بـ { _id: false } لأنها أجزاء من لقطة
// (snapshot) واحدة مالهاش داعي تتعامل كمستندات مستقلة بمعرّف خاص بيها -
// الاستثناء الوحيد هو أي array عناصرها ممكن تتعدّل واحد واحد لاحقًا. ======

// ====== لقطة وحدة قتالية واحدة (كومة من نفس النوع) - أهم حاجة هنا إن الـ
// stats بتتنسخ فعليًا وقت إنشاء المعركة (مش مجرد reference لـ TROOP_TYPES
// في castle.config) عشان لو حصل تعديل توازن (balance patch) بعد كده،
// المعركة الشغالة/المسجّلة دي تفضل زي ما كانت وقت ما بدأت بالظبط. ======
const troopSnapshotSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    count: { type: Number, required: true, min: 0 },
    stats: {
      attack: { type: Number, default: 0 },
      defense: { type: Number, default: 0 },
      hp: { type: Number, default: 0 },
    },
    speed: { type: Number, default: 0 },
    carry_capacity: { type: Number, default: 0 },
    // ====== Phase 12: Alliance Reinforcements - null/false افتراضيًا يعني
    // "جيش صاحب الطرف نفسه" (نفس السلوك القديم بالظبط) - غير كده يبقى
    // جنود تعزيز حليف واقفة في قلعة الدافع، owner_user_id بيحدد مين بعتها.
    // "Battle Report must identify troop ownership". ======
    owner_user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    is_reinforcement: { type: Boolean, default: false },
  },
  { _id: false }
);

// ====== لقطة قائد واحد - مفيش نظام قادة (Commanders) حقيقي في اللعبة لسه،
// فالـ schema هنا مقصود إنها عامة/مرنة (placeholder جاهز) عشان تستقبل أي
// شكل بيانات لما نظام القادة يتبنى فعليًا من غير ما نحتاج نعدّل نموذج
// المعركة نفسه. ======
const commanderSnapshotSchema = new mongoose.Schema(
  {
    commander_key: { type: String, default: null },
    name: { type: String, default: null },
    level: { type: Number, default: 1 },
    // أي بونصات/مهارات خاصة بالقائد - شكلها مش محدد نهائيًا لسه (نظام
    // القادة نفسه لسه مش موجود)، فبتتخزن هنا كأوبچكت حر بدل ما نخترع حقول
    // وهمية دلوقتي هنتغيرها بعدين أكيد.
    bonuses: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

// ====== لقطة التشكيل (Formation) بتاع جيش المهاجم - نظام التشكيلات لسه مش
// موجود (هيتبنى في "Battle Planner")، فالـ schema هنا Placeholder بسيط:
// نوع عام للتشكيلة + قايمة خانات (slots) تربط كل كومة وحدات بمكانها في
// التشكيل. ======
const formationSlotSchema = new mongoose.Schema(
  {
    troop_key: { type: String, required: true },
    row: { type: Number, default: 0 },
    column: { type: Number, default: 0 },
  },
  { _id: false }
);

const formationSnapshotSchema = new mongoose.Schema(
  {
    type: { type: String, default: 'standard' },
    slots: { type: [formationSlotSchema], default: [] },
  },
  { _id: false }
);

// ====== لقطة خطة المعركة (Battle Plan) بتاعة المهاجم - هتتبنى فعليًا في
// "Battle Planner" (الخطوة الجاية بعد الأساس ده). دلوقتي بنسجّل بس الهدف
// العام والأوامر الخام اللي المهاجم بعتها وقت بدء الهجوم. ======
const battlePlanSnapshotSchema = new mongoose.Schema(
  {
    objective: {
      type: String,
      enum: ['loot', 'raze', 'conquer', 'custom'],
      default: 'loot',
    },
    // أوامر/خطوات خام لسه شكلها مش نهائي - الـ Battle Planner هو اللي هيحدد
    // شكلها بالظبط ويحوّلها لحاجة الـ Simulation Engine يقدر ينفذها.
    orders: { type: [mongoose.Schema.Types.Mixed], default: [] },
    notes: { type: String, default: null },
  },
  { _id: false }
);

// ====== لقطة مبنى واحد جوه مدينة الدافع وقت بدء الهجوم - نفس شكل building
// في castle.model تقريبًا بس منسوخة هنا (snapshot) مش reference. ======
const buildingSnapshotSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    level: { type: Number, default: 1 },
    position: {
      x: { type: Number, required: true },
      y: { type: Number, required: true },
    },
    // مفيش نظام "صحة مبنى" (Building HP) حقيقي في اللعبة لسه - هيتحدد فعليًا
    // في "Building Interaction". null دلوقتي يعني "مش قابل للتدمير بعد".
    hp: { type: Number, default: null },
  },
  { _id: false }
);

// ====== لقطات الأسوار/الأبراج/البوابات - مفيش نظام تحصينات حقيقي في اللعبة
// لسه (castle.model مفيهوش walls/towers/gates خالص)، فالـ arrays دي هتفضل
// فاضية دلوقتي - موجودة كـ placeholder جاهز عشان نظام التحصينات لما يتبنى
// يلاقي مكانه جاهز جوه لقطة المعركة من غير ما نحتاج نعدّل الموديل تاني. ======
const wallSnapshotSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'wall' },
    level: { type: Number, default: 1 },
    hp: { type: Number, default: null },
    // درع القطعة (defense.config combat_stats.defense) - عائق سلبي بيمتص
    // ضربات بس، مالوش نيران دفاعية (نفس فلسفة armor بتاعة الوحدات في
    // combatEngine.js: تقليل ضرر، مش قدرة هجوم).
    armor: { type: Number, default: 0 },
    position: { x: Number, y: Number },
  },
  { _id: false }
);

const towerSnapshotSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'tower' },
    level: { type: Number, default: 1 },
    hp: { type: Number, default: null },
    damage: { type: Number, default: null },
    // مدى إطلاق نار البرج (defense.config combat_stats.range) - لازم يكون
    // موجود عشان محرك القتال يقدر يشغّل البرج كمدافع نشط فعليًا (راجع
    // "Auto-Turret" في combatEngine.js).
    range: { type: Number, default: 0 },
    armor: { type: Number, default: 0 },
    position: { x: Number, y: Number },
  },
  { _id: false }
);

const gateSnapshotSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'gate' },
    level: { type: Number, default: 1 },
    hp: { type: Number, default: null },
    armor: { type: Number, default: 0 },
    position: { x: Number, y: Number },
    // اتجاه البوابة على شبكة المدينة (شمال/جنوب/شرق/غرب) - لسه مش مستخدم،
    // بس هيفيد الـ Battle Renderer لما يرسم نقطة اقتحام الجيش المهاجم.
    facing: { type: String, default: null },
    // حالة البوابة الحقيقية وقت بدء الهجوم (defense.model gate_state) -
    // بوابة "مقفولة" (open: false) بتتعامل كسور عادي لحد ما تتكسر/تتفتح.
    open: { type: Boolean, default: true },
    destroyed: { type: Boolean, default: false },
  },
  { _id: false }
);

// ====== لقطة خطة دفاع الدافع (Defense Plan) - نظير battlePlanSnapshotSchema
// بتاع المهاجم بس من ناحية الدافع: مفيش نظام تخطيط دفاعي حقيقي في اللعبة
// لسه (زي إعادة توزيع الجيش على الأسوار، تفعيل فخاخ، سحب قوات لنقطة معينة)،
// فالـ schema هنا Placeholder عام هيدّي له معنى حقيقي "Battle Planner" لما
// يتبنى من ناحية الدافع كمان (مش بس المهاجم). ======
const defensePlanSnapshotSchema = new mongoose.Schema(
  {
    strategy: { type: String, default: null }, // مثلاً 'hold_walls' / 'turtle' / 'sally_out' - لسه مفيش قيم رسمية
    orders: { type: [mongoose.Schema.Types.Mixed], default: [] }, // نفس فلسفة battle_plan.orders - خام لحد ما Battle Planner يحدد شكلها
    notes: { type: String, default: null },
  },
  { _id: false }
);

// ====== لقطة كومة/موقع حامية (Garrison) - جيش (أو جزء منه) متمركز عند نقطة
// دفاعية بعينها (مبنى/برج/بوابة) بدل ما يكون جيش دفاعي عام واحد بس. النظام
// الحالي (castle.army) مفيهوش تقسيم زي ده لسه، فده placeholder جاهز لأي
// "توزيع قوات" مستقبلي على خريطة المدينة وقت الدفاع. ======
const garrisonSnapshotSchema = new mongoose.Schema(
  {
    garrison_key: { type: String, default: null }, // معرّف حر لسه (مثلاً يربط بمبنى/برج معيّن لاحقًا)
    position: { x: { type: Number, default: 0 }, y: { type: Number, default: 0 } },
    troops: { type: [troopSnapshotSchema], default: [] },
  },
  { _id: false }
);

// ====== لقطة "تخطيط الأسوار" (Wall Layout) - شكل شبكة الأسوار كخطوط/قطع
// متصلة على خريطة المدينة، بخلاف مصفوفة "walls" فوق اللي كل عنصر فيها هو
// قطعة سور مستقلة بحالتها القتالية (hp/level). wall_layout هنا غرضه يوصف
// "الشكل الهندسي" العام (segments) اللي الـ Battle Renderer في الفرونت إند
// هيحتاجه يرسم بيه خط الأسوار كامل، مش تفاصيل كل قطعة القتالية. لسه مفيش
// نظام تحصينات حقيقي (زي wallSnapshotSchema فوق)، فهو حاوية فاضية دلوقتي. ======
const wallSegmentSchema = new mongoose.Schema(
  {
    from: { x: { type: Number, default: 0 }, y: { type: Number, default: 0 } },
    to: { x: { type: Number, default: 0 }, y: { type: Number, default: 0 } },
  },
  { _id: false }
);

const wallLayoutSnapshotSchema = new mongoose.Schema(
  {
    grid_size: { type: Number, default: null },
    segments: { type: [wallSegmentSchema], default: [] },
  },
  { _id: false }
);

// ====== لقطات "مواقع" الأبراج/البوابات/الفخاخ (Positions) - مختلفة عن
// towerSnapshotSchema/gateSnapshotSchema فوق: دي بتخزن بس الإحداثيات (شبكة
// التخطيط العام للمدينة الدفاعية)، مش الحالة القتالية الكاملة (hp/damage) -
// مفيدة لأي محرر تخطيط دفاعي (Battle Planner) يحتاج يعرف "مكان" كل عنصر من
// غير ما يحمّل لقطته القتالية كاملة. ======
const positionSchema = new mongoose.Schema(
  { x: { type: Number, default: 0 }, y: { type: Number, default: 0 } },
  { _id: false }
);

// ====== لقطة موقع فخ (Trap) - نظام الفخاخ مش موجود في اللعبة خالص لسه (ولا
// حتى كـ placeholder زي الأسوار/الأبراج/البوابات)، فده أول مكان بيتسجل فيه
// شكل بياناته المتوقع. ======
const trapPositionSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'trap' },
    level: { type: Number, default: 1 },
    hp: { type: Number, default: null },
    // ضرر/مدى تفعيل الفخ (defense.config combat_stats.damage/range) - الفخ
    // بيتفعّل مرة واحدة بس (single-use) لما وحدة مهاجمة تدخل مداه، راجع
    // "Auto-Turret" + single_use في combatEngine.js/battle.runner.js.
    damage: { type: Number, default: null },
    range: { type: Number, default: 1 },
    position: { x: { type: Number, default: 0 }, y: { type: Number, default: 0 } },
  },
  { _id: false }
);

// ====== لقطة الموارد المخزّنة عند الدافع وقت بدء الهجوم بالظبط - عشان لو
// الدافع صرف أو استخدم موارده وهو الهجوم في الطريق، المعركة تفضل شغالة على
// الأرقام اللي كانت موجودة وقت ما الهجوم بدأ. ======
const resourceSnapshotSchema = new mongoose.Schema(
  {
    gold: { type: Number, default: 0 },
    wood: { type: Number, default: 0 },
    stone: { type: Number, default: 0 },
  },
  { _id: false }
);

// ====== لقطة تخطيط المدينة (City Layout) - شبكة الخانات المفتوحة للبناء
// وقت بدء الهجوم، عشان الـ Battle Renderer يرسم نفس المدينة اللي كانت
// موجودة فعليًا لحظة الهجوم (مش نسخة محدّثة لو الدافع بنى/نقل حاجة بعدين). ======
const cityLayoutSnapshotSchema = new mongoose.Schema(
  {
    grid_size: { type: Number, default: null },
    unlocked_tiles: {
      type: [{ x: Number, y: Number, _id: false }],
      default: [],
    },
  },
  { _id: false }
);

// ====== لقطة كاملة لطرف المهاجم وقت بدء الهجوم ======
const attackerSnapshotSchema = new mongoose.Schema(
  {
    troops: { type: [troopSnapshotSchema], default: [] },
    commanders: { type: [commanderSnapshotSchema], default: [] },
    formation: { type: formationSnapshotSchema, default: () => ({}) },
    battle_plan: { type: battlePlanSnapshotSchema, default: () => ({}) },
  },
  { _id: false }
);

// ====== لقطة كاملة لطرف الدافع وقت بدء الهجوم - المدينة كلها كما هي ======
const defenderSnapshotSchema = new mongoose.Schema(
  {
    // جيش الدفاع الواقف جوه القلعة وقت الهجوم (لو عنده) - ده الجيش "المنشور"
    // فعليًا (منتشر على الأسوار/جاهز يشتبك)، بخلاف reserved_army تحت.
    troops: { type: [troopSnapshotSchema], default: [] },
    commanders: { type: [commanderSnapshotSchema], default: [] },
    buildings: { type: [buildingSnapshotSchema], default: [] },
    walls: { type: [wallSnapshotSchema], default: [] },
    towers: { type: [towerSnapshotSchema], default: [] },
    gates: { type: [gateSnapshotSchema], default: [] },
    resources: { type: resourceSnapshotSchema, default: () => ({}) },
    city_layout: { type: cityLayoutSnapshotSchema, default: () => ({}) },

    // ====== إضافات الأساس الجديدة (Battle Foundation v2) - كلها حاويات
    // فاضية دلوقتي لحد ما "Battle Planner" ونظام التحصينات الحقيقي يتبنوا،
    // موجودة هنا بس عشان الشكل النهائي للقطة يكون واضح من أول يوم. ======

    // خطة دفاع الدافع (نظير battle_plan بتاع المهاجم فوق)
    defense_plan: { type: defensePlanSnapshotSchema, default: () => ({}) },

    // جيش احتياطي مش منشور على خط الدفاع وقت بدء الهجوم (لسه محتفظ بيه
    // الدافع - مثلاً جوه القلعة نفسها بدل الأسوار)
    reserved_army: { type: [troopSnapshotSchema], default: [] },

    // حاميات موزّعة على نقاط دفاعية بعينها (مبنى/برج/بوابة) بدل جيش دفاعي عام واحد
    garrisons: { type: [garrisonSnapshotSchema], default: [] },

    // الشكل الهندسي العام لخط الأسوار (segments) - يفيد الرسم لاحقًا، بخلاف
    // "walls" فوق اللي بتوصف كل قطعة سور بحالتها القتالية
    wall_layout: { type: wallLayoutSnapshotSchema, default: () => ({}) },

    // مواقع خام (إحداثيات بس) للأبراج/البوابات - بخلاف towers/gates فوق
    // اللي بتحمل الحالة القتالية الكاملة (hp/damage)
    tower_positions: { type: [positionSchema], default: [] },
    gate_positions: { type: [positionSchema], default: [] },

    // مواقع الفخاخ - نظام مش موجود خالص لسه، أول تسجيل لشكل بياناته
    trap_positions: { type: [trapPositionSchema], default: [] },
  },
  { _id: false }
);

// ====== مرجع خفيف لطرف من طرفي المعركة (مهاجم/دافع) - بيتخزن هنا اسم
// اللاعب/الـ NPC وقت بدء الهجوم برضه (زي target_name في march.model) عشان
// الواجهة تعرض المعركة من غير ما تحتاج populate إضافي، حتى لو الطرف ده NPC
// مالوش user_id أصلًا. ======
const battleParticipantSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    castle_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Castle', required: true },
    is_npc: { type: Boolean, default: false },
    name: { type: String, default: null },
  },
  { _id: false }
);

const statisticsSchema = new mongoose.Schema(
  {
    attacker_troops_lost: { type: Number, default: 0 },
    attacker_troops_survived: { type: Number, default: 0 },
    defender_troops_lost: { type: Number, default: 0 },
    defender_troops_survived: { type: Number, default: 0 },
    buildings_damaged: { type: Number, default: 0 },
    buildings_destroyed: { type: Number, default: 0 },
    walls_breached: { type: Number, default: 0 },
    towers_destroyed: { type: Number, default: 0 },
    gates_destroyed: { type: Number, default: 0 },
    resources_looted: {
      gold: { type: Number, default: 0 },
      wood: { type: Number, default: 0 },
      stone: { type: Number, default: 0 },
    },
    total_ticks: { type: Number, default: 0 },
  },
  { _id: false }
);

// ====== المعركة نفسها (Battle Instance) ======
// دي الجزء الأساسي من "Battle Foundation" - بتتسجّل مرة واحدة لحظة ما
// الهجوم يبدأ، وبتاخد لقطة كاملة (snapshot) من الطرفين عشان أي تعديل يحصل
// بعد كده (اللاعب بنى مبنى جديد، درّب جيش تاني، تعديل توازن...) ميأثرش على
// المعركة دي وهي شغالة. باقي الأنظمة (Planner/Simulation/Combat/...) هتتبنى
// فوق المستند ده في خطوات لاحقة من غير ما تحتاج تعدّل شكله الأساسي.
// ====== لقطة "إعادة اللعب" (Replay) - Phase 4: Replay System Persistence.
// مختلف تمامًا عن current_state (بيتكتب فوق نفسه كل تيك - آخر حالة بس،
// مفيش تاريخ فيه) وعن battle_events فوق (سجل عالي المستوى/مختصر لسه فاضي -
// محجوز لـ Battle Report مستقبلًا، مش لإعادة لعب دقيقة). replay هنا بيتسجّل
// مرة واحدة بس، لحظة ما المعركة فعليًا تخلص (finish() في battle.runner.js)،
// وغرضه الوحيد إنه يكفي لإعادة إنتاج المعركة بصريًا بالظبط زي ما حصلت -
// بدون أي حساب قتال جديد وقت العرض.
//
// عمدًا من غير أي نسخة من التشكيلة الابتدائية (وحدات/مباني/إحصائيات) - دي
// موجودة بالفعل وثابتة في battle.snapshot (اللي المعركة أصلًا بتاخده وقت
// الإنشاء ومبيتغيّرش أبدًا بعد كده)؛ أي مشغّل إعادة لعب مستقبلي هيعيد بناء
// حالة التيك صفر بنفس الدوال اللي battle.runner.js استخدمها هو نفسه وقت
// البدء (buildCombatUnitsFromSnapshot / buildStructuresFromSnapshot -
// حتمية 100%، مفيش عشوائية) بدل ما نخزّن نسخة تانية زيادة هنا. اللي فعلًا
// محتاج يتسجّل هو بس التسلسل الزمني للأحداث اللي حصلت فوق البداية دي.
const replaySchema = new mongoose.Schema(
  {
    // إصدارات المحركات وقت التسجيل - عشان أي قارئ مستقبلي للـ replay يعرف
    // شكل الأحداث اللي المفروض يفهمها (نفس فلسفة battle_version فوق).
    simulation_engine_version: { type: String, default: null },
    combat_engine_version: { type: String, default: null },

    // معدل التيك (مللي ثانية) وعدد التيكات الكلي - يكفي لحساب توقيت أي حدث
    // من الـ tick بتاعه (timestamp = tick * tick_rate_ms) من غير ما نضطر
    // نخزّن أحداث "بداية/نهاية تيك" منفصلة (كانت هتبقى تكرار بحت لرقمين
    // ثابتين أصلًا هنا).
    tick_rate_ms: { type: Number, default: null },
    total_ticks: { type: Number, default: 0 },

    // التسلسل الزمني الحتمي الكامل - نفس الأوبچكتات اللي
    // CombatEngine.getReplayData().events بترجعها بالظبط (id, tick,
    // timestamp, type, source, target, payload)، هي نفسها اللي اتسجّلت
    // فعليًا أثناء المعركة (BattleTimeline الموجودة أصلًا في
    // simulationEngine.js وCombatEngine بيستخدمها لنفسه) - مفيش أي نظام
    // تسجيل جديد اتعمل هنا خالص، ده بس نقل لنفس البيانات لقاعدة البيانات.
    events: { type: [mongoose.Schema.Types.Mixed], default: [] },

    // لحظة التسجيل نفسها (وقت finish()) - مختلفة عن finish_time بتاعة
    // المعركة نفسها لو حبينا نفرّق بينهم لاحقًا (عمليًا نفس اللحظة تقريبًا).
    recorded_at: { type: Date, default: null },
  },
  { _id: false }
);

const battleSchema = new mongoose.Schema(
  {
    // معرّف عرض فريد وقابل للمشاركة (زي BTL-100001) - منفصل عن _id بتاع
    // Mongo عشان يبان واضح في اللوجات/الواجهة/الـ Replay لاحقًا.
    battle_id: { type: String, required: true, unique: true, index: true },

    // ربط اختياري بالمسير (March) اللي بدأ الهجوم ده - لو المعركة اتولّدت
    // من نظام المسايرات الحالي. ممكن يفضل null لو المعركة اتعملت مباشرة
    // (مثلاً اختبار داخلي أو مسار مستقبلي غير المسايرات).
    march_id: { type: mongoose.Schema.Types.ObjectId, ref: 'March', default: null },

    attacker: { type: battleParticipantSchema, required: true },
    defender: { type: battleParticipantSchema, required: true },

    // اللقطة الكاملة (Snapshot) لحظة بدء الهجوم - ده اللي بيخلي المعركة
    // "مستقلة" عن أي تغيير لاحق في قلعة أي طرف.
    snapshot: {
      attacker: { type: attackerSnapshotSchema, required: true },
      defender: { type: defenderSnapshotSchema, required: true },
    },

    // ====== حالة المحاكاة الحية - حاوية عامة (شكلها النهائي هيتحدد في
    // Simulation Engine) بتتحدّث تيك بتيك وهي المعركة شغالة. ======
    current_state: { type: mongoose.Schema.Types.Mixed, default: createInitialCurrentState },
    current_tick: { type: Number, default: 0 },

    status: {
      type: String,
      enum: Object.values(BATTLE_STATUS),
      default: BATTLE_STATUS.PREPARING,
      index: true,
    },

    // start_time: لحظة ما المحاكاة الفعلية بدأت (status بقت running) - مش
    // نفس created_at (وقت تسجيل المعركة/بدء الهجوم).
    start_time: { type: Date, default: null },
    finish_time: { type: Date, default: null },

    winner: { type: String, enum: WINNER_VALUES, default: null },

    statistics: { type: statisticsSchema, default: createDefaultStatistics },

    // ====== Phase 2: Battle Integration & Persistence - النتيجة الكاملة
    // اللي رجّعها Battle Resolution Engine المتزامن (modules/battleResolution)
    // لحظة ما مسير الهجوم بتاع المعركة دي وصل فعليًا (راجع
    // battle.service.resolveBattleForMarch و march.service.resolveAttackArrival).
    // null لحد ما المعركة تتحسم. Mixed عمدًا (مش sub-schema صارمة) عشان شكل
    // نتيجة المحرك ده (resultBuilder.js) يفضل مسؤولية موديول battleResolution
    // وحده، من غير ما نحتاج نعدّل الموديل ده تاني لو شكل النتيجة اتغيّر هناك.
    // بيتخزن هنا بنفس شكل نتيجة المحرك بالظبط (winner/final_scores/casualties/
    // remaining_troops/defender_participants/loot/building_damage/wall_damage/
    // tower_damage/battle_duration_seconds/key_battle_events) - winner
    // و battle_events موجودين كمان فوق على مستوى المستند نفسه (battle.winner/
    // battle.battle_events) للفهرسة والاستعلام السريع، لكن لازم يتكرروا هنا
    // جوه battle_result بردو لأن الـ consumers الحقيقيين (ReportsMailPanel.jsx
    // في الفرونت إند، وupdateLifetimeStats في battleConsequencesService)
    // بيقروهم من جوه battle_result نفسها مش من الحقول العلوية. attack_score/
    // defense_score اتسابوا كمان جنب final_scores للتوافق مع
    // listBattleHistoryForUser القديمة. ======
    battle_result: { type: mongoose.Schema.Types.Mixed, default: null },

    // ====== ميتاداتا المعركة (Battle Metadata) - إضافات الأساس الجديدة ======

    // بذرة عشوائية ثابتة اتسجّلت وقت إنشاء المعركة - أساس أي إعادة تشغيل
    // (Replay) حتمية (deterministic) لاحقًا. راجع generateRandomSeed في battle.config.js
    random_seed: { type: Number, required: true },

    // إصدار محرك المعارك وقت إنشاء هذه المعركة بالظبط (راجع BATTLE_VERSION
    // في battle.config.js) - يفرّق معارك قديمة عن معارك بمنطق محركات مختلف لاحقًا
    battle_version: { type: String, default: BATTLE_VERSION },

    // سجل الأحداث الأعلى مستوى (مختلف عن current_state.events الخام) - فاضي
    // من أول يوم لحد ما Simulation/Combat Engine يبدأوا يضيفوا فيه فعليًا
    battle_events: { type: [mongoose.Schema.Types.Mixed], default: createEmptyBattleEvents },

    // ====== Phase 4: Replay System Persistence - لقطة إعادة اللعب الكاملة
    // (راجع تعليق replaySchema فوق لتفاصيل ليه الشكل ده بالظبط). null لحد
    // ما المعركة تخلص فعليًا (battle.runner.js's finish()) - المعارك اللي
    // لسه شغالة أو لسه preparing/ready مفيهاش replay خالص، ده متوقع تمامًا. ======
    replay: { type: replaySchema, default: null },

    // نمط/سياق المعركة (راجع BATTLE_MODE في battle.config.js) - افتراضيًا PvP
    // لأنه النمط الوحيد المتصل فعليًا بمسار لعب حقيقي دلوقتي (عن طريق march.service)
    battle_mode: {
      type: String,
      enum: Object.values(BATTLE_MODE),
      default: BATTLE_MODE.PVP,
    },

    // ====== Phase 6: Battle Consequences - علم بسيط (idempotency guard) بيتسجّل
    // لحظة ما modules/battleConsequences.applyBattleConsequences تخلص تطبّق
    // نتيجة المعركة دي فعليًا على العالم الحي (موارد/جنود/أسوار/إحصائيات) -
    // مش نفس finish_time (لحظة ما المعركة "خلصت" كحسم/نتيجة) ولا resolved_at
    // جوه battle_result (لحظة ما battleResolutionEngine حسب النتيجة) - دي
    // بالتحديد لحظة "تطبيق" النتيجة دي على القلعتين، عشان نضمن التطبيق ده
    // بيحصل مرة واحدة بالظبط حتى لو applyBattleConsequences اتنادت أكتر من
    // مرة (retry بعد فشل جزئي، سباق...). null لحد ما يتطبّق فعليًا. ======
    consequences_applied_at: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

// ====== فهارس مساعدة عشان "معاركي كمهاجم" و"معاركي كمدافع" يترجعوا بسرعة
// من غير full collection scan، زي نفس فلسفة marchSchema.index في march.model ======
battleSchema.index({ 'attacker.user_id': 1, status: 1 });
battleSchema.index({ 'defender.user_id': 1, status: 1 });

module.exports = mongoose.model('Battle', battleSchema);
