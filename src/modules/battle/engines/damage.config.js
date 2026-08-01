// ====== إعدادات نظام الضرر (Damage System Config) - يستخدمها damageEngine.js
// و combatEngine.js فقط ======
// الفلسفة هنا نفس فلسفة battle.config.js / army.config.js بالظبط: الملف ده
// بيحتوي **بس** على قيم/جداول ثابتة قابلة للتعديل + دوال تحقق بسيطة (getters/
// validators) - مفيش أي حساب ضرر فعلي هنا (ده شغل damageEngine.js). الهدف:
// أي تغيير في التوازن (balance) - قوة نوع وحدة ضد التاني، مدى تأثير الدرع
// لكل نوع ضرر... - يتم من الملف ده *بس*، من غير ما حد يلمس damageEngine.js
// أو combatEngine.js نفسهم. ده اللي بيخلي "future skills and technologies"
// تتضاف بسهولة (جدول جديد/قيمة جديدة هنا) من غير ما تغيّر جوهر المحرك.

'use strict';

// ---------------------------------------------------------------------------
// Requirement 3: أنواع الضرر (Damage Types) - المفردات اللي أي فعل قتالي
// (هجوم وحدة عادي، مبنى دفاعي، أو سحر/مهارة مستقبلية) بيوصف بيها *طبيعة*
// الضرر اللي بيسببه، بشكل منفصل تمامًا عن troop_type بتاع المهاجم - وحدة
// "مجانق" (siege) طبيعي تبعت ضرر siege، لكن مهارة مستقبلية ممكن تخلي أي
// وحدة تاني تبعت ضرر fire/magic من غير ما تبقى siege. الفصل ده هو اللي
// بيسيب الباب مفتوح لمهارات/تكنولوجيا تضيف نوع تأثير جديد من غير ما تلمس
// أي منطق تاني.
// ---------------------------------------------------------------------------
const DAMAGE_TYPE = {
  MELEE: 'melee',
  RANGED: 'ranged',
  SIEGE: 'siege',
  FIRE: 'fire',
  MAGIC: 'magic',
  TRUE_DAMAGE: 'true_damage', // بيتجاهل الدرع والدفاع بالكامل - نادر عمدًا
};

// ---------------------------------------------------------------------------
// Requirement 1: أنواع الوحدات القتالية (Troop Types) - تصنيف تكتيكي منفصل
// عن مفاتيح TROOP_TYPES في castle.config.js (اللي بتوصف وحدة تدريب بعينها
// زي "swordsman"/"archer"). أي وحدة تدريب حقيقية المفروض تحمل واحد من
// التصنيفات دي (عن طريق حقل troop_type وقت ما تتسجّل في الـ Combat Engine)
// عشان جدول الـ counters تحت يقدر يشتغل من غير ما يعرف حاجة عن أسماء
// الوحدات الفعلية.
// ---------------------------------------------------------------------------
const TROOP_TYPE = {
  INFANTRY: 'infantry',
  ARCHER: 'archer',
  CAVALRY: 'cavalry',
  SIEGE: 'siege',
};

function isValidDamageType(value) {
  return Object.values(DAMAGE_TYPE).includes(value);
}

function isValidTroopType(value) {
  return Object.values(TROOP_TYPE).includes(value);
}

// ---------------------------------------------------------------------------
// نوع الضرر الافتراضي لكل نوع وحدة - بيتستخدم لما أمر القتال (order) ما
// يحددش damage_type صراحةً (الحالة العادية لمعظم الاشتباكات). مهارة/تكنولوجيا
// مستقبلية تقدر تستبدل القيمة دي بأي وقت عن طريق order.damage_type بدون ما
// تغيّر الجدول ده خالص - ده بس "الافتراضي المنطقي".
// ---------------------------------------------------------------------------
const TROOP_TYPE_DEFAULT_DAMAGE_TYPE = {
  [TROOP_TYPE.INFANTRY]: DAMAGE_TYPE.MELEE,
  [TROOP_TYPE.ARCHER]: DAMAGE_TYPE.RANGED,
  [TROOP_TYPE.CAVALRY]: DAMAGE_TYPE.MELEE,
  [TROOP_TYPE.SIEGE]: DAMAGE_TYPE.SIEGE,
};

function getDefaultDamageTypeForTroopType(troopType) {
  return TROOP_TYPE_DEFAULT_DAMAGE_TYPE[troopType] || DAMAGE_TYPE.MELEE;
}

// ---------------------------------------------------------------------------
// Requirement 2: جدول الـ Counters بين أنواع الوحدات (Troop Counter Matrix) -
// مضاعف ضرر (attacker_troop_type -> target_troop_type -> multiplier) بيتطبق
// **بس** لما الهدف وحدة (مش مبنى - المباني ليها جدولها الخاص تحت). أي زوج
// مش مكتوب هنا صراحةً بياخد DEFAULT_COUNTER_MULTIPLIER (تعادل تكتيكي، مفيش
// ميزة ولا عيب). الأرقام Placeholder توازن كلاسيكي (حجر/ورقة/مقص عسكري):
// - المشاة (Infantry) كويسة ضد المجانق (بطيئة وسهلة التطويق)
// - الفرسان (Cavalry) كويسين ضد الرماية (بيوصلوا بسرعة قبل ما ترمي كتير)
// - الرماية (Archer) كويسة ضد المشاة (مدى + ضرر مساحي على تشكيلات كثيفة)
// - المجانق (Siege) ضعيفة نسبيًا لما تتقاتل مباشرة مع وحدات (مصممة للمباني)
// كل القيم دي قابلة للتعديل من هنا *بس* من غير ما تلمس damageEngine.js.
// ---------------------------------------------------------------------------
const DEFAULT_COUNTER_MULTIPLIER = 1.0;

const TROOP_COUNTER_MATRIX = {
  [TROOP_TYPE.INFANTRY]: {
    [TROOP_TYPE.CAVALRY]: 1.0,
    [TROOP_TYPE.ARCHER]: 1.0,
    [TROOP_TYPE.SIEGE]: 1.35,
    [TROOP_TYPE.INFANTRY]: 1.0,
  },
  [TROOP_TYPE.ARCHER]: {
    [TROOP_TYPE.INFANTRY]: 1.25,
    [TROOP_TYPE.SIEGE]: 1.0,
    [TROOP_TYPE.CAVALRY]: 0.85,
    [TROOP_TYPE.ARCHER]: 1.0,
  },
  [TROOP_TYPE.CAVALRY]: {
    [TROOP_TYPE.ARCHER]: 1.25,
    [TROOP_TYPE.INFANTRY]: 0.85,
    [TROOP_TYPE.SIEGE]: 1.1,
    [TROOP_TYPE.CAVALRY]: 1.0,
  },
  [TROOP_TYPE.SIEGE]: {
    [TROOP_TYPE.INFANTRY]: 0.75,
    [TROOP_TYPE.ARCHER]: 0.75,
    [TROOP_TYPE.CAVALRY]: 0.75,
    [TROOP_TYPE.SIEGE]: 1.0,
  },
};

/** بيرجّع مضاعف الـ counter بين نوعين - أو الافتراضي (تعادل) لو الزوج مش
 * معرّف صراحةً أو أي طرف troop_type مش معروف (بيانات قديمة/ناقصة). */
function getTroopCounterMultiplier(attackerTroopType, targetTroopType) {
  const row = TROOP_COUNTER_MATRIX[attackerTroopType];
  if (!row) return DEFAULT_COUNTER_MULTIPLIER;
  const value = row[targetTroopType];
  return Number.isFinite(value) ? value : DEFAULT_COUNTER_MULTIPLIER;
}

// ---------------------------------------------------------------------------
// Requirement 4: نفس خط أنابيب القتال (Combat Pipeline) بيتستخدم مع المباني -
// المباني مالهاش troop_type (مش وحدة قتال)، فبدل جدول counters، بتاخد مضاعف
// حسب *نوع الضرر* نفسه (damage_type) - المجانق (siege) طبيعي يبقى قوي جدًا
// ضد الأسوار/الأبراج، والضرر الجسدي العادي (melee/ranged) أضعف بكتير ضد
// حجر/خشب المباني. أي نوع ضرر مش مكتوب هنا بياخد 1.0 (افتراضي محايد).
// ---------------------------------------------------------------------------
const STRUCTURE_DAMAGE_TYPE_MODIFIER = {
  [DAMAGE_TYPE.MELEE]: 0.5,
  [DAMAGE_TYPE.RANGED]: 0.65,
  [DAMAGE_TYPE.SIEGE]: 1.5,
  [DAMAGE_TYPE.FIRE]: 1.15,
  [DAMAGE_TYPE.MAGIC]: 1.0,
  [DAMAGE_TYPE.TRUE_DAMAGE]: 1.0,
};

function getStructureDamageModifier(damageType) {
  const value = STRUCTURE_DAMAGE_TYPE_MODIFIER[damageType];
  return Number.isFinite(value) ? value : 1.0;
}

// ---------------------------------------------------------------------------
// Requirement 3: بروفايل تخفيف الضرر (Mitigation Profile) لكل نوع ضرر - بيوصف
// "قد إيه armor/defense الهدف فعليًا بيأثروا على الضرر ده" كنسبة (0 = بيتجاهل
// القيمة تمامًا، 1 = بتأثر بالكامل). ده اللي بيدي فرق حقيقي بين الأنواع:
// - melee/ranged: الدرع والدفاع العاديين بيشتغلوا زي المتوقع
// - siege: بيخترق جزء كبير من الدرع (مصمم يهد حجر مش يتلخبط في دبابيس دروع)
//   لكن دفاع الوحدة التكتيكي لسه شغال بشكل معقول
// - fire: بيحرق أغلب تأثير الدرع لكن التنظيم/الدفاع التكتيكي لسه يفرق شوية
// - magic: بيتجاهل أغلب الدرع والدفاع (طبيعته خارقة للطبيعي)
// - true_damage: بيتجاهل الاتنين بالكامل (0/0) - نتيجة الصفرين دي هي اللي
//   بتخليه "true" فعلاً من غير أي حالة خاصة في الكود نفسه
// ---------------------------------------------------------------------------
const DAMAGE_TYPE_MITIGATION_PROFILE = {
  [DAMAGE_TYPE.MELEE]: { armor_effectiveness: 1.0, defense_effectiveness: 1.0 },
  [DAMAGE_TYPE.RANGED]: { armor_effectiveness: 0.75, defense_effectiveness: 1.0 },
  [DAMAGE_TYPE.SIEGE]: { armor_effectiveness: 0.4, defense_effectiveness: 0.6 },
  [DAMAGE_TYPE.FIRE]: { armor_effectiveness: 0.3, defense_effectiveness: 0.8 },
  [DAMAGE_TYPE.MAGIC]: { armor_effectiveness: 0.15, defense_effectiveness: 0.5 },
  [DAMAGE_TYPE.TRUE_DAMAGE]: { armor_effectiveness: 0, defense_effectiveness: 0 },
};

const DEFAULT_MITIGATION_PROFILE = { armor_effectiveness: 1.0, defense_effectiveness: 1.0 };

function getMitigationProfile(damageType) {
  return DAMAGE_TYPE_MITIGATION_PROFILE[damageType] || DEFAULT_MITIGATION_PROFILE;
}

// ---------------------------------------------------------------------------
// معادلة التخفيف نفسها بتستخدم منحنى "عائد متناقص" (diminishing returns) -
// نفس الأسلوب المستخدم في ألعاب استراتيجية كتير عشان درع/دفاع عاليين جدًا
// يفضلوا مفيدين لكن من غير ما يوصلوا لمناعة كاملة (100% تخفيف) أبدًا. القيم
// هنا هي كل "التوازن" اللي بيتحكم في حدة المنحنى - قابلة للتعديل من هنا بس.
// ---------------------------------------------------------------------------
// K: كل ما زادت، كل ما احتجت armor/defense أعلى عشان توصل لنفس نسبة تخفيف
// (منحنى أهدأ). القيمة دي Placeholder مبدئية متسقة مع أرقام attack/defense/hp
// الموجودة فعلاً في castle.config.js TROOP_TYPES (8-22 attack، 3-12 defense).
const MITIGATION_SCALING_CONSTANT = 20;

// أقصى نسبة تخفيف ممكنة مهما علت قيم armor/defense - بيضمن إن أي هجوم (غير
// true_damage) يفضل ليه تأثير حقيقي حتى ضد أعلى دفاع متاح في اللعبة.
const MAX_MITIGATION_FRACTION = 0.85;

// أقل ضرر ممكن يوصل لهدف بعد كل الحسابات - نفس فلسفة الـ placeholder القديم
// بالظبط (أي اشتباك لازم يفضل ليه تأثير حقيقي).
const MIN_DAMAGE_FLOOR = 1;

// ---------------------------------------------------------------------------
// Requirement: سرعة الهجوم (attack_speed) - عدد الهجمات في الثانية. بيتحول
// لعدد "تيكات تبريد" (cooldown ticks) عن طريق معدل تيك محرك المحاكاة نفسه
// (tickRateMs من simulationEngine.js) - مفيش رقم تيكات ثابت هنا عشان الحساب
// يفضل صحيح حتى لو معدل التيك اتغيّر مستقبلًا.
// ---------------------------------------------------------------------------
const DEFAULT_ATTACK_SPEED = 1; // هجمة واحدة/ثانية لأي وحدة/مبنى ما حددش قيمة

module.exports = {
  DAMAGE_TYPE,
  TROOP_TYPE,
  isValidDamageType,
  isValidTroopType,

  TROOP_TYPE_DEFAULT_DAMAGE_TYPE,
  getDefaultDamageTypeForTroopType,

  DEFAULT_COUNTER_MULTIPLIER,
  TROOP_COUNTER_MATRIX,
  getTroopCounterMultiplier,

  STRUCTURE_DAMAGE_TYPE_MODIFIER,
  getStructureDamageModifier,

  DAMAGE_TYPE_MITIGATION_PROFILE,
  DEFAULT_MITIGATION_PROFILE,
  getMitigationProfile,

  MITIGATION_SCALING_CONSTANT,
  MAX_MITIGATION_FRACTION,
  MIN_DAMAGE_FLOOR,

  DEFAULT_ATTACK_SPEED,
};
