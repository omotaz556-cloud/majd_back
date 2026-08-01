// ====== Damage Engine (امتداد لخطوة 5 - Combat Engine) ======
// الملف ده مسؤول **بس** عن حساب رقم الضرر النهائي لاشتباك واحد (attacker vs
// target) بشكل حتمي (deterministic) - مفيش أي عشوائية (Math.random) هنا
// خالص، نفس فلسفة الـ combat log اللي المفروض يقدر "يتعاد" بنفس النتيجة
// بالظبط. مفيش هنا أي معرفة بالـ Event Bus، الـ Order/Tick، أو أي حاجة من
// combatEngine.js نفسه - دوال pure functions بس بتاخد أرقام/كائنات وترجّع
// رقم/نتيجة، بنفس فلسفة evaluateConditionNode في ruleEngine.js تمامًا. ده
// اللي بيخلي الملف قابل للاختبار المباشر من غير أي setup تاني، وقابل لإعادة
// الاستخدام في battle simulation, damage preview (UI), أو أي مكان تاني
// محتاج "لو الاشتباك ده حصل، الضرر هيبقى كام" من غير ما يشغّل معركة كاملة.
//
// ====== ليه ملف منفصل عن damage.config.js؟ ======
// damage.config.js بيحمل بس القيم/الجداول (التوازن). الملف ده بيحمل *الخطوات
// الحسابية الثابتة* اللي بتقرا من الجداول دي. الفصل ده يضمن إن أي حد يوازن
// اللعبة (يغيّر رقم) محتاج يفتح ملف واحد بس (damage.config.js) - مايحتاجش
// يفهم أو يلمس الـ pipeline نفسه.

'use strict';

const {
  DAMAGE_TYPE,
  getTroopCounterMultiplier,
  getStructureDamageModifier,
  getMitigationProfile,
  MITIGATION_SCALING_CONSTANT,
  MAX_MITIGATION_FRACTION,
  MIN_DAMAGE_FLOOR,
  DEFAULT_ATTACK_SPEED,
} = require('./damage.config');

// =============================================================================
// Requirement: "Keep the system modular so future skills and technologies can
// be added without changing the core engine" - نقطة التوسّع (extension point)
// الأساسية: أي مهارة/تكنولوجيا مستقبلية (buff هجوم مؤقت، اختراق دروع، مقاومة
// عنصر معيّن...) بتتمثّل كـ "modifier" بسيط بيتحط في `attacker.modifiers` أو
// `target.modifiers` وقت التسجيل/التحديث - من غير ما يحتاج حد يفتح الملف ده
// أو combatEngine.js تاني. كل modifier بيستهدف "مرحلة" واحدة محددة من مراحل
// الحساب تحت (stage) وبيوصف تأثيره كـ:
//   - { stage, kind: 'multiplier', value }        -> يضرب القيمة الحالية
//   - { stage, kind: 'flat', value }               -> يضيف/يطرح رقم ثابت
//   - { stage: 'armor_penetration', value }        -> نسبة (0-1) اختراق درع
// =============================================================================
const MODIFIER_STAGE = {
  BASE_ATTACK: 'base_attack', // على attack الخام قبل أي حاجة تانية
  PRE_MITIGATION: 'pre_mitigation', // بعد الـ counter/structure modifier، قبل الدرع
  ARMOR_PENETRATION: 'armor_penetration', // نسبة تتخصم من فاعلية درع الهدف
  POST_MITIGATION: 'post_mitigation', // على الرقم النهائي بعد التخفيف بالكامل
};

function applyValueModifiers(value, modifiers, stage) {
  if (!Array.isArray(modifiers) || modifiers.length === 0) return value;
  let result = value;
  for (const modifier of modifiers) {
    if (!modifier || modifier.stage !== stage || !Number.isFinite(modifier.value)) continue;
    if (modifier.kind === 'flat') {
      result += modifier.value;
    } else {
      // 'multiplier' هو الافتراضي لو kind مش محدد صراحةً
      result *= modifier.value;
    }
  }
  return result;
}

/** نسبة اختراق الدرع الإجمالية (0-1) من كل modifiers الـ armor_penetration
 * المتراكمة على المهاجم - بتتجمّع بالإضافة (additive) ومتحدودة في [0, 1]. */
function getArmorPenetrationFraction(modifiers) {
  if (!Array.isArray(modifiers) || modifiers.length === 0) return 0;
  let total = 0;
  for (const modifier of modifiers) {
    if (modifier && modifier.stage === MODIFIER_STAGE.ARMOR_PENETRATION && Number.isFinite(modifier.value)) {
      total += modifier.value;
    }
  }
  return Math.min(1, Math.max(0, total));
}

// =============================================================================
// Requirement 3: معادلة التخفيف (Mitigation) - منحنى عائد متناقص واحد بيتستخدم
// لكل من armor و defense، كل واحد فيهم بوزن (effectiveness) خاص بنوع الضرر
// (راجع getMitigationProfile في damage.config.js). النتيجة نسبة واحدة نهائية
// (0 = مفيش تخفيف خالص، MAX_MITIGATION_FRACTION = أقصى تخفيف ممكن).
// =============================================================================
function computeMitigationFraction({ damageType, armor, defense, armorPenetration }) {
  const profile = getMitigationProfile(damageType);
  const effectiveArmor = Math.max(0, armor || 0) * (1 - armorPenetration);
  const weightedArmor = effectiveArmor * profile.armor_effectiveness;
  const weightedDefense = Math.max(0, defense || 0) * profile.defense_effectiveness;
  const weightedTotal = weightedArmor + weightedDefense;

  if (weightedTotal <= 0) return 0;

  const raw = weightedTotal / (weightedTotal + MITIGATION_SCALING_CONSTANT);
  return Math.min(MAX_MITIGATION_FRACTION, raw);
}

// =============================================================================
// Requirement 1+2+3+4: خط أنابيب حساب الضرر الكامل والحتمي (Deterministic
// Damage Pipeline). دي الدالة الوحيدة اللي المفروض combatEngine.js ينادي
// عليها لحساب أي ضرر - سواء الهدف وحدة أو مبنى (Requirement 4: نفس الـ
// pipeline للاتنين، بس الهدف اللي بيختلف حسب kind الهدف جوه الخطوات).
//
// @param {object} params
// @param {object} params.attacker - لازم يكون فيه stats.attack (أو attack
//   مباشرة)، واختياريًا troop_type + modifiers[]
// @param {object} params.target - لازم يكون فيه kind ('unit'|'structure') +
//   إما stats.{defense,armor} (وحدة) أو defense/armor مباشرة (مبنى)،
//   واختياريًا troop_type (للوحدات) + modifiers[]
// @param {string} [params.damageType] - واحد من DAMAGE_TYPE.* - افتراضي melee
// @returns {{ damage:number, breakdown:object }} - breakdown موجود للشفافية/
//   الـ debugging والـ Battle Report المستقبلي (يوضح كل خطوة أثرت إزاي)
// =============================================================================
function computeDamage({ attacker, target, damageType } = {}) {
  const resolvedDamageType = damageType || DAMAGE_TYPE.MELEE;

  const baseAttackRaw = attacker?.stats?.attack ?? attacker?.attack ?? 0;
  const attackerModifiers = attacker?.modifiers;
  const targetModifiers = target?.modifiers;

  // ---- Requirement: base_attack stage (مهارات هجوم مؤقتة، buffs...) ----
  const baseAttack = applyValueModifiers(baseAttackRaw, attackerModifiers, MODIFIER_STAGE.BASE_ATTACK);

  const isStructureTarget = target?.kind === 'structure';

  // ---- Requirement 2: الـ counter بين أنواع الوحدات - بس لما الهدف وحدة ----
  const counterMultiplier = isStructureTarget
    ? 1
    : getTroopCounterMultiplier(attacker?.troop_type, target?.troop_type);

  // ---- Requirement 4: مضاعف نوع الضرر ضد المباني (نفس الـ pipeline) ----
  const structureModifier = isStructureTarget ? getStructureDamageModifier(resolvedDamageType) : 1;

  let preMitigation = baseAttack * counterMultiplier * structureModifier;
  preMitigation = applyValueModifiers(preMitigation, attackerModifiers, MODIFIER_STAGE.PRE_MITIGATION);
  preMitigation = Math.max(0, preMitigation);

  // ---- Requirement 1: armor/defense الهدف (وحدة أو مبنى - نفس القراءة) ----
  const targetArmor = target?.stats?.armor ?? target?.armor ?? 0;
  const targetDefense = target?.stats?.defense ?? target?.defense ?? 0;
  const armorPenetration = getArmorPenetrationFraction(attackerModifiers);

  const mitigationFraction = computeMitigationFraction({
    damageType: resolvedDamageType,
    armor: targetArmor,
    defense: targetDefense,
    armorPenetration,
  });

  let postMitigation = preMitigation * (1 - mitigationFraction);
  postMitigation = applyValueModifiers(postMitigation, targetModifiers, MODIFIER_STAGE.POST_MITIGATION);

  const damage = Math.max(MIN_DAMAGE_FLOOR, Math.round(postMitigation));

  return {
    damage,
    breakdown: {
      damage_type: resolvedDamageType,
      base_attack: baseAttack,
      counter_multiplier: counterMultiplier,
      structure_modifier: structureModifier,
      pre_mitigation: preMitigation,
      target_armor: targetArmor,
      target_defense: targetDefense,
      armor_penetration: armorPenetration,
      mitigation_fraction: mitigationFraction,
      post_mitigation: postMitigation,
    },
  };
}

// =============================================================================
// Requirement: attack_speed - تحويل "هجمة/ثانية" لعدد تيكات تبريد (cooldown)
// حسب معدل تيك محرك المحاكاة الفعلي (tickRateMs) - أي وحدة/مبنى ما حددش
// attack_speed بياخد DEFAULT_ATTACK_SPEED (هجمة واحدة/ثانية).
// =============================================================================
function computeCooldownTicks(attackSpeed, tickRateMs) {
  const speed = Number.isFinite(attackSpeed) && attackSpeed > 0 ? attackSpeed : DEFAULT_ATTACK_SPEED;
  const rate = Number.isFinite(tickRateMs) && tickRateMs > 0 ? tickRateMs : 250;
  const ticksPerSecond = 1000 / rate;
  return Math.max(1, Math.round(ticksPerSecond / speed));
}

/** هل المهاجم جاهز يضرب تاني في التيك ده - حسب آخر تيك ضرب فيه فعليًا
 * (lastAttackTick، null يعني لسه ما ضربش خالص - جاهز فورًا) وسرعة هجومه. */
function isAttackReady({ lastAttackTick, currentTick, attackSpeed, tickRateMs }) {
  if (lastAttackTick === null || lastAttackTick === undefined) return true;
  const cooldown = computeCooldownTicks(attackSpeed, tickRateMs);
  return currentTick - lastAttackTick >= cooldown;
}

module.exports = {
  MODIFIER_STAGE,
  applyValueModifiers,
  getArmorPenetrationFraction,
  computeMitigationFraction,
  computeDamage,
  computeCooldownTicks,
  isAttackReady,
};
