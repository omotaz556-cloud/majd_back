// ====== إعدادات "المهام اليومية" ======
// نظام مهام بسيط بيتجدد تلقائيًا كل يوم (24 ساعة)، ومستوى صعوبة المهام
// (وبالتالي حجم مكافآتها) بيزيد تلقائيًا مع ارتفاع مستوى المبنى الرئيسي
// (town_hall) بتاع اللاعب - بدون أي تدخل يدوي من الأدمن. كل الأرقام هنا
// Placeholder مبدئي قابل للتعديل من الملف ده بس من غير ما يلمس أي منطق تاني
// (نفس فلسفة castle.config.js).

// ====== "نطاقات" مستوى اللاعب (Tiers) - كل نطاق بيغطي مدى معيّن من مستوى
// المبنى الرئيسي، وبيحدد صعوبة/مكافأة كل نوع مهمة جوّاه. القيم بتكبر تدريجيًا
// كل ما اللاعب يتقدم، عشان المهام تفضل ذات معنى وهو بيكبر بدل ما تفضل سهلة
// جدًا أو مستحيلة. آخر نطاق (min_level كبير) بيتطبّق على أي مستوى أعلى منه
// كمان (fallback) - مفيش حاجة اسمها "خلص المهام".
const LEVEL_TIERS = [
  { min_level: 1, tier: 0 },
  { min_level: 5, tier: 1 },
  { min_level: 10, tier: 2 },
  { min_level: 15, tier: 3 },
  { min_level: 20, tier: 4 },
  { min_level: 30, tier: 5 },
  { min_level: 40, tier: 6 },
  { min_level: 50, tier: 7 },
  { min_level: 65, tier: 8 },
  { min_level: 80, tier: 9 },
];

// بيرجع رقم الـ tier المناسب لمستوى مبنى رئيسي معيّن.
function tierForLevel(townHallLevel) {
  const level = Math.max(1, townHallLevel || 1);
  let matched = LEVEL_TIERS[0];
  for (const row of LEVEL_TIERS) {
    if (level >= row.min_level) matched = row;
  }
  return matched.tier;
}

// ====== دالة مساعدة: بتحسب رقم متدرّج مع الـ tier (نمو خطي بسيط، مش هندسي،
// عشان الأرقام تفضل قابلة للفهم وسهل ضبطها). ======
function scale(base, perTier, tier) {
  return Math.round(base + perTier * tier);
}

// ====== أنواع المهام المتاحة ======
// كل نوع بيوصف نفسه بمعرّف target_event (بيتوصل بيه لما يحصل الحدث المرتبط
// جوه اللعبة - upgrade_building / train_troops / attack_win / gather_resource
// / join_alliance)، ودالة target(tier) بترجع الهدف الرقمي المطلوب تحقيقه
// عند الـ tier ده، ودالة reward(tier) بترجع المكافأة.
//
// المكافآت في الغالب موارد (gold/wood/stone) لأن دي عملة اللعب اليومية،
// وبعض المهام الصعبة (اللي هدفها كبير أو محتاجة مجهود حقيقي زي كسب معركة)
// بتديها مكافأة كوينز صغيرة (1-2) فوق الموارد كـ "بونص" حقيقي.
const QUEST_TYPES = {
  upgrade_building: {
    key: 'upgrade_building',
    title: 'رقّي مبنى في مدينتك',
    description_fn: (target) => `رقّي أي مبنى ${target} مرة/مرات النهاردة`,
    icon: 'hammer',
    // عدد ترقيات المباني (أي مبنى) المطلوب إنجازها
    target: (tier) => Math.max(1, Math.min(5, 1 + Math.floor(tier / 3))),
    reward: (tier) => ({
      gold: scale(150, 60, tier),
      wood: scale(100, 40, tier),
      stone: scale(100, 40, tier),
      coins: 0,
    }),
  },
  train_troops: {
    key: 'train_troops',
    title: 'درّب قوات جديدة',
    description_fn: (target) => `درّب ${target} وحدة على الأقل من أي نوع`,
    icon: 'swords',
    // عدد الوحدات (مجموع أي أنواع) المطلوب تدريبها
    target: (tier) => scale(10, 8, tier),
    reward: (tier) => ({
      gold: scale(120, 50, tier),
      wood: scale(80, 30, tier),
      stone: scale(60, 25, tier),
      coins: 0,
    }),
  },
  attack_win: {
    key: 'attack_win',
    title: 'اكسب معركة هجومية',
    description_fn: () => 'ابعت مسير هجوم واكسب المعركة',
    icon: 'target',
    // مهمة "نجاح/فشل" (0 أو 1) - أصعب مهمة في القائمة اليومية، فبتدي كوينز
    // حقيقية فوق الموارد بداية من نطاق معيّن.
    target: () => 1,
    reward: (tier) => ({
      gold: scale(200, 90, tier),
      wood: scale(150, 60, tier),
      stone: scale(150, 60, tier),
      coins: tier >= 4 ? 2 : tier >= 1 ? 1 : 0,
    }),
  },
  gather_resource: {
    key: 'gather_resource',
    title: 'اجمع موارد من العالم',
    description_fn: (target) => `اجمع ${target} وحدة موارد من العالم الخارجي`,
    icon: 'pickaxe',
    // إجمالي وحدات موارد (أي نوع) مجموعة من خارج القلعة (حقول/مناجم العالم)
    target: (tier) => scale(300, 150, tier),
    reward: (tier) => ({
      gold: scale(100, 40, tier),
      wood: scale(120, 50, tier),
      stone: scale(120, 50, tier),
      coins: 0,
    }),
  },
  join_alliance_activity: {
    key: 'join_alliance_activity',
    title: 'شارك مع تحالفك',
    description_fn: () => 'ابعت تعزيز لحليف أو شارك في رالي تحالف',
    icon: 'flag',
    target: () => 1,
    reward: (tier) => ({
      gold: scale(120, 50, tier),
      wood: scale(90, 35, tier),
      stone: scale(90, 35, tier),
      coins: tier >= 6 ? 1 : 0,
    }),
  },
};

const QUEST_TYPE_KEYS = Object.keys(QUEST_TYPES);

// ====== عدد المهام اليومية المعروضة للاعب في نفس الوقت ======
const DAILY_QUEST_COUNT = 3;

// المهمة اللي بتفضل موجودة دايمًا (لو موجودة ضمن الاختيار) عشان دايمًا يكون
// فيه مهمة واحدة "صعبة/بمكافأة كوينز" - مش شرط، بس بتتفضّل في الاختيار
// العشوائي.
const FEATURED_QUEST_KEY = 'attack_win';

module.exports = {
  LEVEL_TIERS,
  QUEST_TYPES,
  QUEST_TYPE_KEYS,
  DAILY_QUEST_COUNT,
  FEATURED_QUEST_KEY,
  tierForLevel,
};
