// ====== إعدادات "محرك القلاع الاستراتيجي" ======
// كل الأرقام هنا Placeholder مبدئي مبني على معادلات نمو هندسي (زي ألعاب
// نداء الحرب/القلاع الناجحة) - قابلة للتعديل من هنا بس من غير ما تلمس أي
// منطق تاني. القيم الحقيقية النهائية لازم تتظبط بعد اختبار يدوي.

// ====== أنواع الموارد ======
const RESOURCE_TYPES = ['gold', 'wood', 'stone'];

// سعة تخزين مجانية أساسية (حتى من غير أي مبنى تخزين) عشان اللاعب الجديد
// ميبقاش عنده سقف صفر قبل ما يبني أول مخزن.
const BASE_FREE_CAPACITY = 500;

// أبعاد شبكة القلعة الابتدائية (8x8) - نفس الرقم لازم يتطابق مع GRID_SIZE في
// الفرونت إند (pages/CastlePage.jsx) عشان الإحداثيات تتفق. دي بقت "نقطة
// البداية" بس دلوقتي - المدينة بتكبر تلقائيًا فوق الحجم ده مع مستوى المبنى
// الرئيسي (شوف CITY_SIZE_GROWTH/maxCityTilesForLevel تحت)، وكل قلعة بتخزن
// أرضها الفعلية المفتوحة (unlocked_tiles) في قاعدة البيانات مش في GRID_SIZE
// ثابت.
const GRID_SIZE = 8;

// ====== أقصى عدد قطع أرض (خانات) ممكن تفتحها أي قلعة - بيزيد مع مستوى
// المبنى الرئيسي (town_hall) بدل ما يكون رقم ثابت طول اللعبة. مفيش أي شراء
// أرض هنا خالص - كل ما المبنى الرئيسي يرقّي، مساحة المدينة (unlocked_tiles)
// بتتوسّع تلقائيًا للسقف الجديد على طول (شوف expandCityToLevelCap في
// castle.service، بتتنادى تلقائي جوه completeFinishedUpgrades). الجدول
// بيتضاف عليه فوق مساحة البداية (شبكة GRID_SIZE x GRID_SIZE) - قابل للتعديل
// بالكامل من هنا من غير ما يلمس أي منطق تاني.
const CITY_SIZE_GROWTH = {
  // مساحة إضافية (عدد خانات) بتتفتح لكل مستوى وصل له المبنى الرئيسي - بتتجمع
  // (يعني عند مستوى 5 بيبقى عنده كل الزيادات من مستوى 2 لحد 5).
  tiles_per_level: [
    { town_hall_level: 2, extra_tiles: 12 },
    { town_hall_level: 3, extra_tiles: 12 },
    { town_hall_level: 4, extra_tiles: 16 },
    { town_hall_level: 5, extra_tiles: 16 },
    { town_hall_level: 6, extra_tiles: 20 },
    { town_hall_level: 7, extra_tiles: 20 },
    { town_hall_level: 8, extra_tiles: 24 },
    { town_hall_level: 9, extra_tiles: 24 },
    { town_hall_level: 10, extra_tiles: 28 },
  ],
  // بعد أعلى مستوى مذكور فوق، كل مستوى إضافي بيدي نفس الزيادة دي - عشان
  // المدينة تفضل قادرة تكبر حتى لمستويات عالية جدًا (لغاية 100) من غير ما
  // نحتاج نكتب صف لكل مستوى يدويًا.
  extra_tiles_per_level_after_table: 6,
};

// ====== أقصى عدد خانات مسموح بيه لقلعة عند مستوى مبنى رئيسي معيّن - مساحة
// البداية (GRID_SIZE x GRID_SIZE) + كل الزيادات المتجمّعة من CITY_SIZE_GROWTH
// لغاية المستوى ده. ======
function maxCityTilesForLevel(townHallLevel) {
  const level = Math.max(1, townHallLevel || 1);
  const base = GRID_SIZE * GRID_SIZE;

  let extra = 0;
  const table = CITY_SIZE_GROWTH.tiles_per_level;
  const lastRow = table[table.length - 1];

  for (const row of table) {
    if (level >= row.town_hall_level) extra += row.extra_tiles;
  }

  if (lastRow && level > lastRow.town_hall_level) {
    const levelsAfter = level - lastRow.town_hall_level;
    extra += levelsAfter * CITY_SIZE_GROWTH.extra_tiles_per_level_after_table;
  }

  return base + extra;
}

// ====== أنواع المباني ======
// category: 'headquarters' (مبنى رئيسي بيحدد أقصى مستوى للمباني التانية)
//         | 'producer' (بيولّد مورد بمرور الوقت)
//         | 'storage'  (بيزوّد سقف تخزين مورد معيّن)
const BUILDING_TYPES = {
  town_hall: {
    key: 'town_hall',
    name: 'المبنى الرئيسي',
    description: 'قلب القلعة اللي بيحدد أقصى مستوى ممكن تطور له باقي المباني. رقّيه عشان تفتح مستويات أعلى لكل حاجة تانية وتفتح خانات بناء إضافية (شوف SLOT_UNLOCKS).',
    category: 'headquarters',
    // ====== أقصى مستوى للقلعة اتزوّد لـ 99 (كان 20) - time_growth اتقلّل
    // معاه عشان الرقم لسه معقول ولعبة عند مستوى 99 (كان هيبقى غير قابل
    // للعب خالص لو فضل 1.35 على 98 مستوى) - نفس فلسفة الملف: Placeholder
    // قابل للتعديل. المستوى 99: ~80 ساعة، المستوى 50: ~3.6 ساعة، المستوى
    // 10: ~19 دقيقة تقريبًا - نمو هندسي ناعم على مدى اللعبة كلها. ======
    max_level: 99,
    // ====== المبنى الرئيسي بقى بيتكلف موارد زي باقي المباني - وبتكلفة أعلى
    // شوية منها (base_cost أعلى + نفس cost_growth العالي 1.5 بتاع باقي
    // المباني بدل ما يفضل ببلاش) عشان يفضل أهم استثمار في اللعبة. ======
    base_cost: { gold: 500, wood: 500, stone: 500 },
    cost_growth: 1.5,
    base_build_seconds: 600,
    time_growth: 1.065,
  },
  gold_mine: {
    key: 'gold_mine',
    name: 'منجم الدهب',
    description: 'بيولّد الدهب أوتوماتيك كل ساعة. رقّيه عشان تزوّد معدل إنتاج الدهب في قلعتك.',
    category: 'producer',
    resource: 'gold',
    // ====== max_level اتزود لـ 100 (كان 15) عشان يفضل قابل للترقية طول ما
    // المبنى الرئيسي بيتزود لحد 99 - time_soft_cap_level/post_soft_cap_time_growth
    // بيخلوا وقت البناء يفضل معقول بعد المستوى 15 (شوف upgradeSeconds تحت). ======
    max_level: 100,
    base_cost: { gold: 0, wood: 150, stone: 50 },
    cost_growth: 1.5,
    base_build_seconds: 120,
    time_growth: 1.45,
    time_soft_cap_level: 15,
    post_soft_cap_time_growth: 1.035,
    base_output_per_hour: 200,
    output_growth: 1.18,
  },
  sawmill: {
    key: 'sawmill',
    name: 'منشرة الخشب',
    description: 'بتولّد الخشب أوتوماتيك كل ساعة. رقّيها عشان تزوّد معدل إنتاج الخشب في قلعتك.',
    category: 'producer',
    resource: 'wood',
    max_level: 100,
    base_cost: { gold: 150, wood: 0, stone: 50 },
    cost_growth: 1.5,
    base_build_seconds: 120,
    time_growth: 1.45,
    time_soft_cap_level: 15,
    post_soft_cap_time_growth: 1.035,
    base_output_per_hour: 200,
    output_growth: 1.18,
  },
  quarry: {
    key: 'quarry',
    name: 'محجر الحجر',
    description: 'بيولّد الحجر أوتوماتيك كل ساعة. رقّيه عشان تزوّد معدل إنتاج الحجر في قلعتك.',
    category: 'producer',
    resource: 'stone',
    max_level: 100,
    base_cost: { gold: 150, wood: 150, stone: 0 },
    cost_growth: 1.5,
    base_build_seconds: 120,
    time_growth: 1.45,
    time_soft_cap_level: 15,
    post_soft_cap_time_growth: 1.035,
    base_output_per_hour: 160,
    output_growth: 1.18,
  },
  gold_storage: {
    key: 'gold_storage',
    name: 'مخزن الدهب',
    description: 'بيزوّد أقصى سقف تقدر تخزنه من الدهب عشان الإنتاج ميضيعش لما يوصل للسقف.',
    category: 'storage',
    resource: 'gold',
    max_level: 100,
    base_cost: { gold: 0, wood: 200, stone: 100 },
    cost_growth: 1.5,
    base_build_seconds: 180,
    time_growth: 1.45,
    time_soft_cap_level: 15,
    post_soft_cap_time_growth: 1.035,
    base_capacity: 1000,
    cap_growth: 1.22,
  },
  wood_storage: {
    key: 'wood_storage',
    name: 'مخزن الخشب',
    description: 'بيزوّد أقصى سقف تقدر تخزنه من الخشب عشان الإنتاج ميضيعش لما يوصل للسقف.',
    category: 'storage',
    resource: 'wood',
    max_level: 100,
    base_cost: { gold: 200, wood: 0, stone: 100 },
    cost_growth: 1.5,
    base_build_seconds: 180,
    time_growth: 1.45,
    time_soft_cap_level: 15,
    post_soft_cap_time_growth: 1.035,
    base_capacity: 1000,
    cap_growth: 1.22,
  },
  stone_storage: {
    key: 'stone_storage',
    name: 'مخزن الحجر',
    description: 'بيزوّد أقصى سقف تقدر تخزنه من الحجر عشان الإنتاج ميضيعش لما يوصل للسقف.',
    category: 'storage',
    resource: 'stone',
    max_level: 100,
    base_cost: { gold: 200, wood: 200, stone: 0 },
    cost_growth: 1.5,
    base_build_seconds: 180,
    time_growth: 1.45,
    time_soft_cap_level: 15,
    post_soft_cap_time_growth: 1.035,
    base_capacity: 1000,
    cap_growth: 1.22,
  },
  barracks: {
    key: 'barracks',
    name: 'الثكنة',
    description: 'بتدرب جنودك وتفتح أنواع وحدات قتال جديدة كل ما ترقيها. رقّيها كمان عشان تزوّد عدد أوامر التدريب اللي تقدر تصفّها في نفس الوقت.',
    category: 'military',
    max_level: 100,
    base_cost: { gold: 400, wood: 300, stone: 150 },
    cost_growth: 1.5,
    base_build_seconds: 300,
    time_growth: 1.45,
    time_soft_cap_level: 20,
    post_soft_cap_time_growth: 1.035,
  },
};

// ====== أنواع الوحدات القتالية (تتدرب في الثكنة) ======
// نفس فلسفة BUILDING_TYPES: أرقام Placeholder مبدئية قابلة للتعديل من هنا
// من غير ما تلمس أي منطق تاني. التكلفة والمدة هنا "خطّية" (بتتضرب في العدد
// المطلوب تدريبه مباشرة) عكس ترقيات المباني اللي بتنمو هندسيًا مع المستوى -
// لأن الوحدة نفسها مالهاش "مستوى"، مجرد عدد بيتزود في جيشك.
// stats (attack/defense/hp) مش مستخدمة في أي منطق قتال لسه (مرحلة الهجوم/
// الدفاع جاية لاحقًا) - موجودة هنا بس كأساس جاهز عشان محرك القتال يستخدمها.
// speed: سرعة المسير بوحدة "خانة توزيع على خريطة العالم/الساعة" (راجع
// worldMap.service SLOT_SPACING) - جيش مكوّن من أكتر من نوع وحدة بيمشي
// بسرعة أبطأ وحدة فيه (زي أغلب ألعاب الاستراتيجية).
// carry_capacity: أقصى كمية موارد (من أي نوع) تقدر الوحدة الواحدة تحملها
// كغنيمة راجعة من غارة - بيحدد سقف النهب لأي جيش بتاع اللاعب.
const TROOP_TYPES = {
  swordsman: {
    key: 'swordsman',
    name: 'مقاتل بالسيف',
    description: 'وحدة قتال أساسية رخيصة وسريعة التدريب - مناسبة كأول جيش لأي قلعة.',
    requires_barracks_level: 1,
    cost: { gold: 50, wood: 20, stone: 0 },
    train_seconds: 30,
    stats: { attack: 8, defense: 6, hp: 40 },
    speed: 30,
    carry_capacity: 20,
  },
  archer: {
    key: 'archer',
    name: 'رامي سهام',
    description: 'وحدة هجوم عن بعد - قوة هجومية أعلى من المقاتل العادي لكن دفاع أقل.',
    requires_barracks_level: 3,
    cost: { gold: 90, wood: 60, stone: 0 },
    train_seconds: 55,
    stats: { attack: 14, defense: 3, hp: 30 },
    speed: 26,
    carry_capacity: 12,
  },
  cavalry: {
    key: 'cavalry',
    name: 'فارس',
    description: 'وحدة سريعة وقوية بتكلفة أعلى - أفضل هجوم وتحمّل لكن تدريبها أبطأ.',
    requires_barracks_level: 6,
    cost: { gold: 180, wood: 40, stone: 60 },
    train_seconds: 110,
    stats: { attack: 22, defense: 12, hp: 90 },
    speed: 50,
    carry_capacity: 35,
  },
  // ====== وحدة مميّزة (Premium Troop) - أقوى وحدة في اللعبة، بس مش بمجرد
  // نسخة مكبّرة (+35%) من الفارس على طول الخط: الدفاع بس +35% عن الفارس
  // (16 = 12 * 1.35)، لكن الهجوم والصحة (hp) عندهم ميزة إضافية فوق الـ 35%
  // (attack: +60% تقريبًا، hp: +55% تقريبًا) عشان الوحدة يكون ليها هوية
  // قتالية مختلفة عن باقي الوحدات (مقاتل صدمة هجومي عالي التحمّل) مش بس
  // "نفس الفارس بس أقوى شوية". مش بتتدرب بالموارد العادية خالص (gold/wood/
  // stone) - `is_premium: true` و`cost` بتاعها فاضي عمدًا (صفر على كل
  // الموارد) عشان trainingCost/deductCost العاديين يفضلوا يشتغلوا زي ما هما
  // من غير أي تعديل. التكلفة الحقيقية في `gem_cost_per_unit` (رصيد
  // المحفظة/الكوينز - راجع startPremiumTraining في castle.service.js)
  // وبتتخصم مرة واحدة لكل الدفعة، وبتتضاف للجيش فورًا من غير أي طابور
  // تدريب (train_seconds: 0). ======
  elite_guard: {
    key: 'elite_guard',
    name: 'حارس النخبة',
    description: 'أقوى وحدة قتالية في اللعبة - هجوم وصحة أعلى بكتير من أي وحدة تانية (مش مجرد نسخة أقوى من الفارس)، بتتدرب فورًا بالجواهر بدل الموارد ومفيش طابور تدريب لها.',
    requires_barracks_level: 6,
    is_premium: true,
    cost: { gold: 0, wood: 0, stone: 0 },
    gem_cost_per_unit: 50,
    train_seconds: 0,
    stats: { attack: 35, defense: 16, hp: 140 },
    speed: 50,
    carry_capacity: 35,
  },
};

// ====== وحدة مميّزة (بالجواهر/رصيد المحفظة) ولا لأ - بنستخدمها في أكتر من
// مكان (validation في startPremiumTraining، فلترة troop-types في
// castle.controller) بدل ما نكرر `cfg.is_premium` في كل مكان لوحده. ======
function isPremiumTroopType(troopKey) {
  return Boolean(TROOP_TYPES[troopKey]?.is_premium);
}

// ====== تكلفة الجواهر لدفعة كاملة من وحدة مميّزة - خطّية زي trainingCost
// العادية (بتتضرب في العدد المطلوب مباشرة). ======
function premiumTrainingGemCost(troopKey, quantity) {
  const cfg = TROOP_TYPES[troopKey];
  return cfg.gem_cost_per_unit * quantity;
}

// ====== إعدادات "التسريع بالجواهر" (Instant Speedup) - نفس مبدأ
// premiumTrainingGemCost فوق: بيستخدم رصيد المحفظة (recordTransaction) مش
// موارد عادية. بيتطبّق على حاجتين بس: (1) ترقية/بناء مبنى شغالة فعليًا
// (building.upgrade.in_progress)، (2) أمر تدريب واقف في طابور الثكنة
// (training_queue) - مش الوحدة المميّزة أصلًا (دي already فورية، مالهاش
// معنى تتسرّع). التكلفة خطّية على عدد الثواني المتبقية فعليًا وقت الطلب
// (مش المدة الكلية الأصلية) - يعني لو نص المدة خلصت لوحدها، اللاعب بيدفع
// على النص التاني بس. GEMS_PER_MINUTE هي سعر الدقيقة الواحدة (أو جزء
// منها - بنقرّب لأعلى)، و MIN_SPEEDUP_GEM_COST حد أدنى عشان مفيش تسريع
// بجوهرة واحدة على ثانية باقية. ======
const GEMS_PER_MINUTE = 1;
const MIN_SPEEDUP_GEM_COST = 5;

// بيحسب تكلفة الجواهر لتسريع فوري كامل بناءً على الثواني المتبقية فقط.
function speedupGemCost(remainingSeconds) {
  const seconds = Math.max(0, Math.ceil(remainingSeconds));
  if (seconds <= 0) return 0;
  const minutes = Math.ceil(seconds / 60);
  return Math.max(MIN_SPEEDUP_GEM_COST, Math.ceil(minutes * GEMS_PER_MINUTE));
}

// ====== إعدادات "محرك مسير الجيوش" (Army March) ======
// نفس فلسفة باقي الإعدادات في الملف ده: أرقام Placeholder مبدئية قابلة
// للتعديل من هنا من غير ما تلمس أي منطق تاني.

// أقل مدة ممكنة لأي مسير حتى لو الهدف قريب جدًا - عشان يفضل حاسس إنه "مسير
// حقيقي" مش نتيجة فورية.
const MARCH_MIN_SECONDS = 20;

// نسبة من مخزون الهدف (لكل مورد) الممكن نهبها في غارة واحدة لو كسب المهاجم
// - سقف إضافي فوق الطاقة الاستيعابية الفعلية لجيش المهاجم (carry_capacity).
const ATTACK_LOOT_FRACTION = 0.22;

// نسبة خسارة الطرفين (مهاجم ودافع) بتتحدد بنسبة قوتهم لبعض - مش رقم ثابت
// للمهاجم بس زي قبل كده. عند تعادل القوى (نسبة = 1) الطرفين بيخسروا نفس
// النسبة الأساسية BASE_LOSS_FRACTION تقريبًا (معركة مكلفة للاتنين)، وكل ما
// طرف يبقى أقوى نسبيًا، خسايره تقل وخساير التاني تزيد - بشكل متماثل ومنطقي.
const BASE_LOSS_FRACTION = 0.35;
const MIN_LOSS_FRACTION = 0.05;
const MAX_LOSS_FRACTION = 0.95;

// دفاع أساسي افتراضي (تحصينات) لأي قلعة (لاعب أو NPC) لكل مستوى من المبنى
// الرئيسي - بيتحسب مع دفاع أي جيش واقف فعليًا جوه القلعة، مش بديل عنه.
const BASE_DEFENSE_PER_TOWNHALL_LEVEL = 9;

// ====== إعدادات "ضباب الحرب" (Fog of War) ======
// نصف قطر الرؤية حوالين قلعة اللاعب (بعدد الخانات على شبكة توزيع القلاع -
// نفس وحدة القياس المستخدمة في worldMap.service). القلاع اللي جوه نصف
// القطر ده بس هي اللي بتتكشف تفاصيلها (مستوى المبنى الرئيسي، عدد المباني،
// تحالف صاحبها...)؛ أي حاجة برّاه مخفية تمامًا (مش حتى بترجع من الـ API).
//
// قواعد أساسية:
// - الرؤية شخصية بحتة لكل لاعب (متحسبة من مكان قلعته هو بس).
// - مفيش نظام "استكشاف/سكاوت" بيوسّع أو يغيّر نصف القطر ده مؤقتًا.
// - مفيش رؤية مشتركة بين أعضاء نفس التحالف - كل عضو شايف حوالين قلعته بس.
const VISION_RADIUS_SLOTS = 4;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// ====== نتيجة معركة حقيقية بين طرفين (مهاجم بجيشه الماشي، ودافع بجيشه
// الواقف في قلعته + تحصيناته) - بيرجع نسبة الخسارة لكل طرف ونتيجة المعركة.
// الطرف الأقوى نسبيًا يخسر أقل، والطرف الأضعف يخسر أكتر - وده بيحصل
// للاتنين مع بعض (عكس النظام القديم اللي كان الدافع مبيخسرش حاجة خالص). ======
function resolveBattle(attackerPower, defenderPower) {
  const safeDefenderPower = Math.max(1, defenderPower);
  const safeAttackerPower = Math.max(1, attackerPower);
  const powerRatio = safeAttackerPower / safeDefenderPower;

  return {
    win: attackerPower >= defenderPower,
    attackerLossFraction: clamp(BASE_LOSS_FRACTION / powerRatio, MIN_LOSS_FRACTION, MAX_LOSS_FRACTION),
    defenderLossFraction: clamp(BASE_LOSS_FRACTION * powerRatio, MIN_LOSS_FRACTION, MAX_LOSS_FRACTION),
  };
}

// ====== بتطبّق نسبة خسارة على كومة وحدات (troops)، وبترجع كومتين: اللي
// اتفقدوا واللي عاشوا - نفس الشكل (key/count) عشان تتخزن في تقرير المعركة
// أو ترجع لجيش القلعة مباشرة. ======
function applyLossFraction(troops, lossFraction) {
  const lost = [];
  const survived = [];
  for (const t of troops || []) {
    const lostCount = Math.min(t.count, Math.round(t.count * lossFraction));
    const survivedCount = t.count - lostCount;
    if (lostCount > 0) lost.push({ key: t.key, count: lostCount });
    if (survivedCount > 0) survived.push({ key: t.key, count: survivedCount });
  }
  return { lost, survived };
}

// ====== إعدادات "مدة المعركة" (Battle Duration) ======
// المعركة نفسها ليها مدة حقيقية منفصلة عن مدة المسير: المسير بيوصل الهدف
// الأول (arrives_at، حسب المسافة زي ما هو)، وبعدين المعركة "تبدأ" وتفضل
// شغالة (march.status: 'battling') لحد ما تخلص مدتها (march.battle_ends_at)،
// وبعدين بس بتتحسب النتيجة النهائية (خسائر/غنيمة) - النتيجة أبداً ما بتتحسب
// فور وصول الهجوم.
//
// "حجم المعركة" بيتحدد بإجمالي قوة الطرفين مع بعض (نفس الأرقام اللي
// resolveBattle أصلًا بتستخدمها لهجوم/دفاع) - كل ما المعركة أكبر (جيوش
// أكتر/أقوى، تحصينات أعلى)، كل ما استغرقت وقت أطول. المسافة بين المهاجم
// والهدف عامل إضافي (كل ما بعُد الهدف، كل ما المعركة نفسها أطول شوية -
// جيش وصل من بعيد بياخد وقت أطول يرتب نفسه ويحسم قتاله) - مش العامل
// الرئيسي زي حجم الجيوش، بس موجود زي ما اتطلب.
//
// المستويات المستهدفة (تقريبية - نفس الترتيب المطلوب):
//   معركة صغيرة (اشتباك بسيط، عشرات الوحدات)        -> ~5-10 دقايق
//   معركة متوسطة (مئات الوحدات، تحصينات متوسطة)      -> ~30-60 دقيقة
//   معركة كبيرة (آلاف الوحدات، تحصينات قوية)          -> عدة ساعات
//   معركة ضخمة (تجمّع تحالف/هجوم ضخم على قلعة متحصنة) -> لحد كذا يوم
const BATTLE_DURATION_MIN_SECONDS = 5 * 60; // أصغر معركة ممكنة (اشتباك بسيط) - 5 دقايق
const BATTLE_DURATION_MAX_SECONDS = 4 * 24 * 60 * 60; // أكبر مدة ممكنة (4 أيام) لمعارك ضخمة جدًا

// ====== تدرّج لوغاريتمي "متسارع" (مش خطي في عدد المراحل العشرية) - أول
// تجربتين كانوا بيستخدموا sizeSeconds = MIN + decades * PER_DECADE (خطي في
// decades)، وده طلع "مسطّح" جدًا في الطرف العالي: المدى الكامل الواقعي
// لقوة المعركة (attackerPower + defenderPower) بين أصغر اشتباك (عشرات
// وحدات، ~مئات القوة) وأضخم حصار تحالف (~مئات الملايين من القوة) هو حوالي
// 5-6 "مراحل عشرية" بس - مش كفاية عشان نمو خطي بسيط يوصل من دقايق لأيام من
// غير ما يبقى إما سريع جدًا في النص أو بطيء جدًا في الآخر. الحل: نرفع عدد
// المراحل العشرية لأس EXPONENT (حاليًا 2) بدل ما نضربه في ثابت مباشرة -
// يعني المدة بتتسارع كل ما المعركة تكبر (فرق صغير بين "عشرات" و"مئات"
// الوحدات، فرق ضخم بين "آلاف" و"ملايين") - بالظبط زي المطلوب: صغيرة ~دقايق،
// متوسطة ~ساعة، كبيرة ~عدة ساعات، ضخمة ~أيام. القيم Placeholder قابلة
// للتعديل من هنا بس من غير ما تلمس أي منطق تاني. ======
const BATTLE_DURATION_BASE_POWER = 300; // القوة الإجمالية اللي عندها المدة = الحد الأدنى (BATTLE_DURATION_MIN_SECONDS) - قريبة من قوة اشتباك صغير حقيقي (عشرات وحدات)
const BATTLE_DURATION_DECADES_EXPONENT = 2; // الأس اللي بيتحط على عدد المراحل العشرية - أكبر من 1 يعني نمو متسارع (مش خطي) مع حجم المعركة
// أقصى "مرجع قوة" نظريًا (مئات الملايين - حصار تحالف ضخم جدًا بوحدات مميزة)
// اللي المفروض عندها المدة توصل لأقصى حد (BATTLE_DURATION_MAX_SECONDS) بالظبط -
// بيتحسب منها BATTLE_DURATION_SIZE_COEFFICIENT تلقائيًا تحت (بدل ثابت مقطوع
// من الهوا) عشان لو غيّرنا BASE_POWER أو MAX_SECONDS يفضل الحساب متسق لوحده.
const BATTLE_DURATION_MAX_REFERENCE_POWER = 100000000;
const BATTLE_DURATION_MAX_DECADES = Math.log10(
  BATTLE_DURATION_MAX_REFERENCE_POWER / BATTLE_DURATION_BASE_POWER
);
// المعامل اللي بيتضرب في (decades ** EXPONENT) عشان نوصل بالظبط لـ
// BATTLE_DURATION_MAX_SECONDS عند BATTLE_DURATION_MAX_REFERENCE_POWER.
const BATTLE_DURATION_SIZE_COEFFICIENT =
  (BATTLE_DURATION_MAX_SECONDS - BATTLE_DURATION_MIN_SECONDS) /
  BATTLE_DURATION_MAX_DECADES ** BATTLE_DURATION_DECADES_EXPONENT;

// ====== المسافة (Requirement: "Distance (if applicable)") - عامل إضافي
// بسيط فوق حجم المعركة، مش بديل عنه: كل خانة مسافة إضافية بتضيف كذا ثانية
// بس، وبسقف أقصى معقول (BATTLE_DURATION_MAX_DISTANCE_BONUS_SECONDS) عشان
// هجوم من أقصى الخريطة ميحوّلش معركة صغيرة لمعركة أيام بسبب المسافة لوحدها. ======
const BATTLE_DURATION_SECONDS_PER_DISTANCE_SLOT = 2;
const BATTLE_DURATION_MAX_DISTANCE_BONUS_SECONDS = 6 * 60 * 60; // سقف 6 ساعات إضافية بسبب المسافة بس

// ====== مدة المعركة بالثواني - بتتحسب مرة واحدة بس لحظة ما المسير يوصل
// هدفه (بداية المعركة)، وبتفضل ثابتة طول عمر المعركة (مبتتغيرش حتى لو
// تعزيزات جديدة وصلت بعدين - دي بتشارك في نتيجة المعركة نفسها بس مش في
// مدتها، راجع march.service.js::finalizeAttackBattle).
//
// distanceSlots اختياري (default 0) عشان أي نداء قديم/تقديري من غير مسافة
// معروفة لسه يشتغل زي ما هو (نفس فلسفة أي باراميتر اختياري تاني في الملف ده). ======
function battleDurationSeconds(attackerPower, defenderPower, distanceSlots = 0) {
  const totalPower = Math.max(0, attackerPower) + Math.max(0, defenderPower);

  // ====== لوغاريتم أساس 10 لعدد "المراحل العشرية" فوق BATTLE_DURATION_BASE_POWER
  // - قوة أقل من أو تساوي القاعدة = صفر مراحل (تفضل عند الحد الأدنى). بعد كده
  // بنرفع العدد ده لأس BATTLE_DURATION_DECADES_EXPONENT (مش بنضربه في ثابت
  // مباشرة زي الطريقة القديمة) عشان المدة تتسارع كل ما المعركة تكبر - فرق
  // بسيط بين معارك صغيرة/متوسطة، وفرق ضخم (ساعات → أيام) بين معارك كبيرة/ضخمة. ======
  const powerRatio = Math.max(1, totalPower / BATTLE_DURATION_BASE_POWER);
  const decades = Math.log10(powerRatio);
  const sizeSeconds =
    BATTLE_DURATION_MIN_SECONDS +
    BATTLE_DURATION_SIZE_COEFFICIENT * decades ** BATTLE_DURATION_DECADES_EXPONENT;

  const distanceBonusSeconds = Math.min(
    BATTLE_DURATION_MAX_DISTANCE_BONUS_SECONDS,
    Math.max(0, distanceSlots) * BATTLE_DURATION_SECONDS_PER_DISTANCE_SLOT
  );

  return clamp(Math.round(sizeSeconds + distanceBonusSeconds), BATTLE_DURATION_MIN_SECONDS, BATTLE_DURATION_MAX_SECONDS);
}

// ====== سرعة الجيش المكوّن من أكتر من نوع وحدة = أبطأ وحدة فيه ======
function armyMinSpeed(troops) {
  let min = Infinity;
  for (const t of troops) {
    const cfg = TROOP_TYPES[t.key];
    if (cfg && cfg.speed < min) min = cfg.speed;
  }
  return Number.isFinite(min) ? min : null;
}

// ====== مدة المسير بالثواني لجيش معيّن على مسافة معيّنة (بوحدة "خانة") ======
function marchSeconds(troops, distanceSlots) {
  const speed = armyMinSpeed(troops);
  if (!speed || speed <= 0) return MARCH_MIN_SECONDS;
  const hours = distanceSlots / speed;
  return Math.max(MARCH_MIN_SECONDS, Math.round(hours * 3600));
}

// ====== أقصى كمية موارد (من أي نوع) الجيش ده يقدر يحملها كغنيمة ======
function armyCarryCapacity(troops) {
  let total = 0;
  for (const t of troops) {
    const cfg = TROOP_TYPES[t.key];
    if (cfg) total += cfg.carry_capacity * t.count;
  }
  return total;
}

// ====== مجموع قيمة إحصائية معيّنة (attack/defense/hp) لجيش كامل ======
function armyStatTotal(troops, stat) {
  let total = 0;
  for (const t of troops) {
    const cfg = TROOP_TYPES[t.key];
    if (cfg) total += cfg.stats[stat] * t.count;
  }
  return total;
}

// أقصى عدد وحدات مسموح بيه في أمر تدريب واحد - عشان محدش يبعت رقم ضخم
// غريب (زي مليار وحدة) يعمل مشاكل في حساب التكلفة/المدة.
const MAX_TRAINING_BATCH = 500;

// عدد أوامر التدريب اللي ممكن تتصف في نفس الوقت في طابور الثكنة - بيزيد كل
// 5 مستويات من مستوى الثكنة (مستوى 1-4: أمر واحد بس، 5-9: أمرين، وهكذا).
function maxQueueSize(barracksLevel) {
  return 1 + Math.floor(Math.max(0, barracksLevel - 1) / 5);
}

// ====== تكلفة/مدة تدريب دفعة وحدات (خطّية - مفيش نمو هندسي زي المباني) ======
function trainingCost(troopKey, quantity) {
  const cfg = TROOP_TYPES[troopKey];
  return {
    gold: cfg.cost.gold * quantity,
    wood: cfg.cost.wood * quantity,
    stone: cfg.cost.stone * quantity,
  };
}

function trainingSeconds(troopKey, quantity) {
  const cfg = TROOP_TYPES[troopKey];
  return cfg.train_seconds * quantity;
}

// المباني اللي بتتبني تلقائي لكل قلعة جديدة (level 1 لكل واحد)، ومكانها
// المبدئي على شبكة القلعة (grid ثابت 8x8 - x,y من 0 لـ 7)
const INITIAL_BUILDINGS = [
  { key: 'town_hall', position: { x: 3, y: 3 } },
  { key: 'gold_mine', position: { x: 1, y: 1 } },
  { key: 'sawmill', position: { x: 6, y: 1 } },
  { key: 'quarry', position: { x: 1, y: 6 } },
];

// أقصى مستوى مسموح لأي مبنى (غير المبنى الرئيسي نفسه) بالنسبة لمستوى
// المبنى الرئيسي الحالي - عشان تفضل الترقيات متوازنة ومتنافسية زي أي لعبة
// قلاع ناجحة (مينفعش تفضل الموارد قافزة من غير ما تطور المبنى الرئيسي).
function maxLevelForTownHall(townHallLevel) {
  return townHallLevel + 2;
}

// ====== نظام "فتح خانات بناء إضافية" (Slot Unlocks) ======
// بدل ما عدد مباني الموارد/المباني العسكرية يفضل ثابت طول اللعبة (منجم دهب
// واحد، منشرة واحدة، محجر واحد، ثكنة واحدة بس)، كل قلعة عندها "خانات" متاحة
// لكل فئة (producer = مباني موارد، military = مباني عسكرية)، وعدد الخانات
// ده بيزيد كل ما مستوى المبنى الرئيسي يوصل لمستوى معيّن - الجدول هنا هو
// المصدر الوحيد للحقيقة (source of truth) وقابل للتعديل بالكامل (تقدر تضيف/
// تشيل/تغيّر أي عنصر) من غير ما تلمس أي منطق تاني في الخدمة (castle.service).
//
// كل عنصر: { castle_level, category, slots } - يعني "عند وصول المبنى
// الرئيسي للمستوى ده أو أكتر، يتفتح (slots) خانة/خانات إضافية من الفئة دي".
const SLOT_UNLOCKS = [
  { castle_level: 10, category: 'producer', slots: 1 },
  { castle_level: 20, category: 'producer', slots: 1 },
  { castle_level: 30, category: 'producer', slots: 1 },
  { castle_level: 40, category: 'producer', slots: 1 },
  { castle_level: 50, category: 'producer', slots: 1 },
  { castle_level: 60, category: 'producer', slots: 1 },
  { castle_level: 70, category: 'producer', slots: 1 },
  { castle_level: 80, category: 'producer', slots: 1 },
  { castle_level: 90, category: 'producer', slots: 1 },
  { castle_level: 15, category: 'military', slots: 1 },
  { castle_level: 35, category: 'military', slots: 1 },
  { castle_level: 55, category: 'military', slots: 1 },
  { castle_level: 75, category: 'military', slots: 1 },
  { castle_level: 95, category: 'military', slots: 1 },
];

// عدد الخانات الأساسي المتاح لكل فئة من مستوى 1 - نفس عدد المباني
// الابتدائية اللي بتتبني تلقائي لأي قلعة جديدة (INITIAL_BUILDINGS تحت):
// 3 مباني موارد (دهب/خشب/حجر) + ثكنة واحدة.
const BASE_CATEGORY_SLOTS = {
  producer: 3,
  military: 1,
};

// ====== أقصى عدد خانات مفتوحة لفئة معيّنة عند مستوى قلعة معيّن - بيجمع
// الخانات الأساسية + أي خانة اتفتحت من SLOT_UNLOCKS لغاية المستوى ده. ======
function unlockedSlotsForCategory(category, castleLevel) {
  const base = BASE_CATEGORY_SLOTS[category] || 0;
  const extra = SLOT_UNLOCKS.filter(
    (u) => u.category === category && castleLevel >= u.castle_level
  ).reduce((sum, u) => sum + u.slots, 0);
  return base + extra;
}

// ====== أقرب فتحة خانة جاية (لسه مش وصلها اللاعب) لفئة معيّنة - مفيدة
// للعرض في الواجهة ("رقّي لمستوى 20 عشان تفتح خانة موارد جديدة"). ======
function nextSlotUnlock(category, castleLevel) {
  const upcoming = SLOT_UNLOCKS.filter(
    (u) => u.category === category && u.castle_level > castleLevel
  ).sort((a, b) => a.castle_level - b.castle_level);
  return upcoming[0] || null;
}

// ====== قائمة كل خانات شبكة القلعة الابتدائية (0..GRID_SIZE-1 لكل محور) -
// بتتحط في unlocked_tiles وقت إنشاء أي قلعة جديدة (castle.service createCastle) ======
function generateInitialTiles() {
  const tiles = [];
  for (let x = 0; x < GRID_SIZE; x += 1) {
    for (let y = 0; y < GRID_SIZE; y += 1) {
      tiles.push({ x, y });
    }
  }
  return tiles;
}

// ====== توليد شبكة "مربعة" متمركزة حوالين نفس نص شبكة البداية (GRID_SIZE)،
// بحجم كافي إنها تحتوي على الأقل tileCount خانة - مستخدمة وقت ما المدينة
// تكبر تلقائيًا (castle.service expandCityToLevelCap) عشان شكل المدينة يفضل
// مربع منتظم حوالين المبنى الرئيسي في كل اتجاه بدل ما يكبر بشكل عشوائي.
// بترجع أكبر شوية من tileCount أحيانًا (لأن حجم الضلع لازم يكون رقم صحيح)،
// وده مقصود ومظبوط - castle.service بتاخد بس أول tileCount خانة مرتبة من
// الأقرب للمنتصف لغاية السقف بالظبط. ======
function generateSquareRingTiles(tileCount) {
  const center = (GRID_SIZE - 1) / 2;
  // نحسب طول ضلع كافي (عدد فردي دايمًا عشان يفضل متمركز بالظبط حوالين
  // center) - بندور على أصغر ضلع فردي مربعه >= tileCount.
  let side = GRID_SIZE % 2 === 0 ? GRID_SIZE + 1 : GRID_SIZE;
  while (side * side < tileCount) side += 2;

  const half = (side - 1) / 2;
  const startX = Math.round(center - half);
  const startY = Math.round(center - half);

  const tiles = [];
  for (let x = startX; x < startX + side; x += 1) {
    for (let y = startY; y < startY + side; y += 1) {
      tiles.push({ x, y });
    }
  }
  return tiles;
}

// ====== معادلات النمو الإجرائي ======
function upgradeCost(buildingKey, nextLevel) {
  const cfg = BUILDING_TYPES[buildingKey];
  const growth = cfg.cost_growth ?? 1.3;
  const factor = growth ** (nextLevel - 1);
  return {
    gold: Math.round(cfg.base_cost.gold * factor),
    wood: Math.round(cfg.base_cost.wood * factor),
    stone: Math.round(cfg.base_cost.stone * factor),
  };
}

// ====== مدة ترقية مبنى معيّن للمستوى الجاي - بتستخدم نمو هندسي "على
// مرحلتين" (soft cap): من مستوى 1 لحد time_soft_cap_level (لو موجود) بيتحسب
// بنفس time_growth الأصلي (بالظبط زي ما كان قبل توسيع المستويات)، وبعد كده
// بيتحول لنمو أهدأ (post_soft_cap_time_growth) عشان مستويات 99/100 تفضل
// قابلة للعب فعليًا بدل ما توصل لمدد فلكية. لو مبنى مالوش الحقلين دول (زي
// المبنى الرئيسي اللي أقصى مستوى بتاعه هو نفسه soft cap أصلاً) بترجع لنفس
// المعادلة القديمة زي ما هي بالظبط. ======
function upgradeSeconds(buildingKey, nextLevel) {
  const cfg = BUILDING_TYPES[buildingKey];
  const growth = cfg.time_growth ?? 1.28;
  const softCapLevel = cfg.time_soft_cap_level ?? cfg.max_level;
  const postGrowth = cfg.post_soft_cap_time_growth ?? growth;

  const primarySteps = Math.min(nextLevel - 1, softCapLevel - 1);
  const extraSteps = Math.max(0, nextLevel - 1 - (softCapLevel - 1));

  const factor = growth ** primarySteps * postGrowth ** extraSteps;
  return Math.round(cfg.base_build_seconds * factor);
}

function producerOutputPerHour(buildingKey, level) {
  const cfg = BUILDING_TYPES[buildingKey];
  if (cfg.category !== 'producer' || level < 1) return 0;
  return Math.round(cfg.base_output_per_hour * (cfg.output_growth ?? 1.18) ** (level - 1));
}

function storageCapacity(buildingKey, level) {
  const cfg = BUILDING_TYPES[buildingKey];
  if (cfg.category !== 'storage' || level < 1) return 0;
  return Math.round(cfg.base_capacity * (cfg.cap_growth ?? 1.22) ** (level - 1));
}

// ====== "قوة" (Power) تقديرية للقلعة - رقم واحد ملخّص لقوة اللاعب الكلية،
// مستخدم بس للعرض (ترتيب/بحث العالم World Search) - نفس فلسفة باقي الأرقام
// في الملف ده: Placeholder مبدئي بأوزان متساوية لكل نوع مبنى/وحدة، قابل
// للتعديل من هنا بس من غير ما يلمس أي منطق تاني. مالوش أي تأثير على نتيجة
// أي معركة فعلية - ده بيعتمد على resolveBattle بمعادلتها المستقلة تمامًا.
const POWER_PER_BUILDING_LEVEL = 15;
const POWER_PER_TROOP_STAT_POINT = 2; // لكل نقطة (هجوم+دفاع+تحمل) في الوحدة الواحدة

function computeCastlePower(castle) {
  const buildingPower = (castle.buildings || []).reduce(
    (sum, b) => sum + (b.level || 0) * POWER_PER_BUILDING_LEVEL,
    0
  );
  const armyPower = (castle.army || []).reduce((sum, stack) => {
    const cfg = TROOP_TYPES[stack.key];
    if (!cfg) return sum;
    const statTotal = cfg.stats.attack + cfg.stats.defense + cfg.stats.hp;
    return sum + stack.count * statTotal * POWER_PER_TROOP_STAT_POINT;
  }, 0);
  return Math.round(buildingPower + armyPower);
}

module.exports = {
  RESOURCE_TYPES,
  BASE_FREE_CAPACITY,
  GRID_SIZE,
  maxCityTilesForLevel,
  BUILDING_TYPES,
  INITIAL_BUILDINGS,
  TROOP_TYPES,
  MAX_TRAINING_BATCH,
  maxLevelForTownHall,
  SLOT_UNLOCKS,
  BASE_CATEGORY_SLOTS,
  unlockedSlotsForCategory,
  nextSlotUnlock,
  generateInitialTiles,
  generateSquareRingTiles,
  upgradeCost,
  upgradeSeconds,
  producerOutputPerHour,
  storageCapacity,
  maxQueueSize,
  trainingCost,
  trainingSeconds,
  isPremiumTroopType,
  premiumTrainingGemCost,
  GEMS_PER_MINUTE,
  MIN_SPEEDUP_GEM_COST,
  speedupGemCost,
  MARCH_MIN_SECONDS,
  ATTACK_LOOT_FRACTION,
  BASE_LOSS_FRACTION,
  MIN_LOSS_FRACTION,
  MAX_LOSS_FRACTION,
  BASE_DEFENSE_PER_TOWNHALL_LEVEL,
  VISION_RADIUS_SLOTS,
  BATTLE_DURATION_MIN_SECONDS,
  BATTLE_DURATION_MAX_SECONDS,
  battleDurationSeconds,
  armyMinSpeed,
  marchSeconds,
  armyCarryCapacity,
  armyStatTotal,
  resolveBattle,
  applyLossFraction,
  computeCastlePower,
};
