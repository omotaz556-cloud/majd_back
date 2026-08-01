// ====== إعدادات "محرك التحالفات" ======
// نفس فلسفة castle.config: أرقام Placeholder مبدئية قابلة للتعديل من هنا
// من غير ما تلمس أي منطق تاني.

// أقصى عدد أعضاء افتراضي لأي تحالف جديد - ممكن يتحول لاحقًا لقيمة بتزيد مع
// "مستوى تحالف" زي ألعاب الاستراتيجية الكبيرة، بس مفيش نظام مستويات دلوقتي.
const DEFAULT_MAX_MEMBERS = 30;

// أقل/أقصى طول لاسم التحالف والـ tag - نفس القيم المستخدمة في alliance.model
// (متكررة هنا كمان عشان الكنترولر/الفرونت إند يقدروا يعرضوها من غير ما
// يفترضوا رقم بأنفسهم).
const NAME_MIN_LENGTH = 3;
const NAME_MAX_LENGTH = 40;
const TAG_MIN_LENGTH = 2;
const TAG_MAX_LENGTH = 5;
const DESCRIPTION_MAX_LENGTH = 500;

// أقصى عدد دعوات/طلبات انضمام معلّقة يقدر لاعب واحد يبعتها لتحالفات مختلفة
// في نفس الوقت (بس لطلبات الانضمام اللي هو بادئها - type='request') - عشان
// محدش يبعت طلب انضمام لكل تحالف في اللعبة دفعة واحدة.
const MAX_PENDING_REQUESTS_PER_PLAYER = 5;

module.exports = {
  DEFAULT_MAX_MEMBERS,
  NAME_MIN_LENGTH,
  NAME_MAX_LENGTH,
  TAG_MIN_LENGTH,
  TAG_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  MAX_PENDING_REQUESTS_PER_PLAYER,
};
