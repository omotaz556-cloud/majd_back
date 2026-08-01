// ====== إعدادات الأبطال (Heroes) ======
// كل لاعب بيختار بطل واحد قبل ما يبدأ اللعب فعليًا (وقت إنشاء أول قلعة له)
// - اختيار نهائي، مفيش تغيير بعد كده. كل بطل بيدّي بونص ثابت واحد بس (هجوم
// عام أو دفاع عام) بيتطبّق طول اللعب في كل معركة يخوضها اللاعب ده، سواء
// كمهاجم أو كمدافع.
//
// الشكل هنا نفس شكل "heroes[].bonuses" اللي محرك حسم المعارك
// (modules/battleResolution/calculators/bonusAggregator.js) أصلًا بيفهمه
// ويطبّقه - attack_percent بيدخل في حساب قوة الهجوم، defense_percent بيدخل
// في حساب قوة الدفاع. مفيش أي حساب هنا، بس بيانات وصفية للأبطال المتاحين.

'use strict';

const HERO_KEY = {
  GENERAL_ROSTAM: 'general_rostam',
  QUEEN_AMANI: 'queen_amani',
  WARLORD_KANE: 'warlord_kane',
};

const HEROES = {
  [HERO_KEY.GENERAL_ROSTAM]: {
    key: HERO_KEY.GENERAL_ROSTAM,
    name: 'الجنرال رستم',
    title: 'سيف الهجوم',
    description: 'قائد ميداني بيحمّس جيشه في كل غارة (بونص هجوم قريب من كين) وكمان بينظّم الثكنة عشان تدرب وحدات أسرع.',
    // ====== بونص هجوم اتقرّب من كين (كان 0.1) + ميزة إضافية حقيقية
    // (training_speed_percent) بتقلّل وقت تدريب أي وحدة عادية (راجع
    // startTraining في castle.service.js - trainingSeconds بتتضرب في
    // (1 - training_speed_percent)). كده رستم بقى فيه مقايضة حقيقية مع كين:
    // هجوم شبه متساوي تقريبًا + تدريب أسرع، مقابل هجوم أعلى شوية بس من غير
    // أي ميزة تانية. ======
    bonuses: { attack_percent: 0.13, training_speed_percent: 0.1 },
  },
  [HERO_KEY.QUEEN_AMANI]: {
    key: HERO_KEY.QUEEN_AMANI,
    name: 'الملكة أماني',
    title: 'درع المملكة',
    description: 'استراتيجية دفاعية محنّكة - بتقوّي دفاع قلعتك في كل معركة تتعرض لها.',
    bonuses: { defense_percent: 0.1 },
  },
  [HERO_KEY.WARLORD_KANE]: {
    key: HERO_KEY.WARLORD_KANE,
    name: 'أمير الحرب كين',
    title: 'صدمة المعركة',
    description: 'محارب شرس بيدفع جيشه للأمام - بونص هجوم أعلى من أي بطل تاني، بس على حساب أي دفاع أو ميزة إضافية.',
    bonuses: { attack_percent: 0.15 },
  },
};

const HERO_KEYS = Object.values(HERO_KEY);

function isValidHeroKey(key) {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(HEROES, key);
}

function heroInfo(key) {
  return HEROES[key] || null;
}

function listHeroes() {
  return HERO_KEYS.map((key) => HEROES[key]);
}

// ====== بيحوّل مفتاح بطل مخزّن على القلعة لشكل "heroes[]" الجاهز اللي
// محرك حسم المعارك بيتوقعه (bonusAggregator.sumPercentBonus) - مصفوفة فيها
// عنصر واحد بس لو اللاعب اختار بطل، أو مصفوفة فاضية لو لسه معندوش (قلاع NPC
// مثلًا مفيش عندها بطل خالص). ======
function heroToBattleInput(key) {
  const hero = heroInfo(key);
  if (!hero) return [];
  return [{ commander_key: hero.key, name: hero.name, bonuses: hero.bonuses }];
}

module.exports = {
  HERO_KEY,
  HEROES,
  HERO_KEYS,
  isValidHeroKey,
  heroInfo,
  listHeroes,
  heroToBattleInput,
};
