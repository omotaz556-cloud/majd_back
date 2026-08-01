/**
 * ====== Reward Kinds Config (Castle Game) ======
 *
 * المكان الوحيد اللي بيحدد "أنواع المكافآت" (Reward Kinds) المتاحة في نظام
 * الإعلانات المكافئة، وقيمها الافتراضية القابلة للتهيئة. الهدف:
 *   - rewardSession.service.js أبداً ما بيحسب/يفترض أي رقم بنفسه - كل قيمة
 *     (كمية مورد، نسبة مضاعفة...) بتتقرأ من هنا (أو من env عن طريق هنا)، مش
 *     hardcoded جوه الـ service.
 *   - إضافة نوع مكافأة جديد أو تعديل قيمة موجودة بيتم هنا بس، من غير أي لمس
 *     لمنطق rewardSession.service.js نفسه.
 *
 * هذا المشروع فيه لعبة واحدة بس (Castle Game) - مفيش أي تجريد "multi-game"
 * هنا عمداً (مفيش gameId ولا لعبة تانية)، الإعدادات كلها خاصة بقلعة اللاعب.
 */

const RESOURCE_TYPES = ['gold', 'wood', 'stone'];

const REWARD_KIND = {
  RESOURCES: 'resources',
  DOUBLE_REWARD: 'double_reward',
  DAILY_DOUBLE: 'daily_double',
  HOURLY_GIFT: 'hourly_gift',
  SPEEDUP_CONSTRUCTION: 'speedup_construction',
};

const REWARD_KIND_VALUES = Object.values(REWARD_KIND);

// ====== resources ======
// كمية كل مورد بتتمنح لما اللاعب يشاهد إعلان "مكافأة موارد" - قابلة للتعديل
// بالكامل من env من غير أي تعديل كود. الافتراضي (fallback) بس هو اللي
// موجود هنا كأرقام.
const RESOURCE_REWARD_AMOUNTS = {
  gold: Number(process.env.AD_REWARD_GOLD_AMOUNT) || 500,
  wood: Number(process.env.AD_REWARD_WOOD_AMOUNT) || 300,
  stone: Number(process.env.AD_REWARD_STONE_AMOUNT) || 250,
};

// ====== double_reward ======
// نسبة المضاعفة على غنيمة (loot) آخر معركة خلصت للاعب - 1 يعني "ضعف الغنيمة
// الأصلية" (يعني بيضيف 100% إضافية فوق اللي اتاخد بالفعل).
const DOUBLE_REWARD_MULTIPLIER = Number(process.env.AD_DOUBLE_REWARD_MULTIPLIER) || 1;

// ====== daily_double ======
// نسبة مضاعفة المكافأة اليومية (نفس فكرة double_reward بس لمكافأة يومية
// منفصلة) - وسقف مرة واحدة كل كام ساعة يقدر اللاعب يستخدمها.
const DAILY_DOUBLE_MULTIPLIER = Number(process.env.AD_DAILY_DOUBLE_MULTIPLIER) || 1;
const DAILY_DOUBLE_COOLDOWN_HOURS = Number(process.env.AD_DAILY_DOUBLE_COOLDOWN_HOURS) || 24;

// ====== hourly_gift ======
// "هدية الساعة" - إعلان مكافئ متاح كل عدد ساعات محدد (افتراضي ساعة واحدة)،
// بيمنح جايزة *عشوائية* من حوض جوائز محدد مسبقًا هنا - مش قيمة ثابتة زي
// resources/daily_double. الهدف إن اللاعب محسّش إنها "نفس الهدية" كل مرة.
//
// كل عنصر في الحوض: { resource, amount, weight }
//   - resource : نوع المورد (من RESOURCE_TYPES)
//   - amount   : الكمية اللي بتتمنح لو العنصر ده اتاختار
//   - weight   : الوزن النسبي وقت الاختيار العشوائي (وزن أعلى = احتمال أعلى)
// الحوض قابل للتعديل بالكامل من هنا من غير أي لمس لمنطق rewardSession.service.js.
const HOURLY_GIFT_COOLDOWN_HOURS = Number(process.env.AD_HOURLY_GIFT_COOLDOWN_HOURS) || 1;

const HOURLY_GIFT_POOL = [
  { resource: 'gold', amount: 200, weight: 30 },
  { resource: 'gold', amount: 500, weight: 10 },
  { resource: 'wood', amount: 150, weight: 25 },
  { resource: 'wood', amount: 400, weight: 8 },
  { resource: 'stone', amount: 120, weight: 25 },
  { resource: 'stone', amount: 350, weight: 8 },
  // ====== الجايزة الكبرى - وزن قليل عمدًا عشان تفضل نادرة ومثيرة لما تطلع ======
  { resource: 'gold', amount: 1000, weight: 3 },
];

// ====== speedup_construction ======
// إعلان مكافئ لتسريع ترقية/إنشاء مبنى شغال حاليًا - بيقتطع جزء من الوقت
// المتبقي (مش يخلّص الترقية فورًا زي تسريع الجواهر speedupBuildingUpgrade)،
// وبيتسمح باستخدام واحد بس *لكل ترقية* (راجع ad_speedup_used في
// castle.model.js buildingSchema.upgrade).
//
// الوقت المقتطع = أكبر قيمة بين:
//   - SPEEDUP_CONSTRUCTION_FLAT_SECONDS (قيمة ثابتة، افتراضي 15 دقيقة)
//   - SPEEDUP_CONSTRUCTION_PERCENT من إجمالي مدة الترقية الأصلية (started_at → completes_at الأصلية، افتراضي 20%)
// (يعني ترقية طويلة جدًا بتاخد الـ 20% اللي هيبقى أكبر من الـ 15 دقيقة
// الثابتة، وترقية قصيرة بتاخد الـ 15 دقيقة الثابتة كحد أدنى مفيد) - مقتطَع
// أبدًا مش هيتخطى الوقت المتبقي نفسه (completes_at مايوصلش قبل دلوقتي).
const SPEEDUP_CONSTRUCTION_FLAT_SECONDS = Number(process.env.AD_SPEEDUP_CONSTRUCTION_FLAT_SECONDS) || 15 * 60;
const SPEEDUP_CONSTRUCTION_PERCENT = Number(process.env.AD_SPEEDUP_CONSTRUCTION_PERCENT) || 0.2;
// ====== الحد الأدنى للوقت المتبقي عشان الزرار يظهر أصلًا - لو الوقت المتبقي
// أقل من كده، مفيش داعي تشاهد إعلان كامل عشان توفير ثواني قليلة (تجربة
// مستخدم سيئة) - الزرار بيختفي من الفرونت إند، وكمان الباك إند بيرفض أي
// محاولة /start لو الوقت المتبقي وقتها أقل من كده (نفس الحماية اللي
// الفرونت إند بيعرضها، مش بس فرض واجهة). ======
const SPEEDUP_CONSTRUCTION_MIN_REMAINING_SECONDS =
  Number(process.env.AD_SPEEDUP_CONSTRUCTION_MIN_REMAINING_SECONDS) || 5 * 60;

module.exports = {
  RESOURCE_TYPES,
  REWARD_KIND,
  REWARD_KIND_VALUES,
  RESOURCE_REWARD_AMOUNTS,
  DOUBLE_REWARD_MULTIPLIER,
  DAILY_DOUBLE_MULTIPLIER,
  DAILY_DOUBLE_COOLDOWN_HOURS,
  HOURLY_GIFT_COOLDOWN_HOURS,
  HOURLY_GIFT_POOL,
  SPEEDUP_CONSTRUCTION_FLAT_SECONDS,
  SPEEDUP_CONSTRUCTION_PERCENT,
  SPEEDUP_CONSTRUCTION_MIN_REMAINING_SECONDS,
};
