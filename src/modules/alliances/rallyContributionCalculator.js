// ====== Contribution Calculator (Phase 15) ======
// مسؤولية واحدة بس: تحويل قائمة rally.participants (كل واحد فيهم troops +
// heroes + research + buffs + battle_plan_id شخصي) لـ:
//   1) input واحد جاهز لـ battleResolutionEngine (attacker.troops مدموجة +
//      attacker.heroes/research/buffs مجمّعة من كل مشارك)،
//   2) وزن مساهمة كل مشارك (بيتستخدم بعدين في rallyLootDistributor لتوزيع
//      الخسائر/الغنيمة بالعدل حسب "قوة هجوم الجنود اللي بعتهم").
// مفيش أي حساب قتال هنا (ده شغل battleResolutionEngine) - دمج/تلخيص بيانات
// بس، نفس فلسفة bonusAggregator.js في battleResolution.

'use strict';

const { armyStatTotal } = require('../castle/castle.config');

// ====== دمج جنود كل المشاركين في جيش واحد - كل كومة متعلّمة بصاحبها
// (owner_user_id) عشان توزيع الخسائر بعدين يعرف يرجّع الناجيين لصاحب
// الكومة الصح (نفس منطق Phase 12's owner-tagging لتعزيزات الدفاع). ======
function mergeTroops(participants) {
  const merged = [];
  for (const participant of participants) {
    for (const t of participant.troops || []) {
      merged.push({ key: t.key, count: t.count, owner_user_id: participant.user_id });
    }
  }
  return merged;
}

// ====== دمج Heroes/Research/Buffs بتوع كل المشاركين - كلهم أصلًا مصفوفات/
// كائنات "generic" بتتجمع بالجمع البسيط (راجع bonusAggregator.sumPercentBonus
// اللي بتقبل مصفوفة عناصر أو كائن واحد وبتلف عليهم كلهم بنفس الطريقة) - فمفيش
// داعي لأي منطق دمج خاص، مجرد تجميع كل مساهمات المشاركين في مصفوفة واحدة. ======
function mergeContributions(participants) {
  const heroes = [];
  const research = [];
  const buffs = [];

  for (const participant of participants) {
    if (Array.isArray(participant.heroes)) heroes.push(...participant.heroes);
    if (participant.research) research.push(participant.research);
    if (Array.isArray(participant.buffs)) buffs.push(...participant.buffs);
    // ====== ملحوظة: "Battle Plan modifiers" الشخصية لكل مشارك (participant.
    // battle_plan_id) متعمّد إننا منحوّلهاش هنا لأي نسبة % مخترعة - Battle
    // Planner 2.0 (army/battlePlan.model.js) مالوش حقل bonus_percent حقيقي؛
    // خطته عبارة عن قواعد تشكيل/استهداف/انسحاب منظّمة، مش رقم قابل للجمع.
    // مساهمة الخطة الشخصية فعليًا محفوظة (participant.battle_plan_id) وباينة
    // في تقرير المشارك، لكن اللي بيحدد فعليًا تشكيل/هدف الجيش المدموج كله
    // هو خطة القائد الرسمية (rally.battle_plan_id - راجع rallyCoordinator). ======
  }

  return {
    troops: mergeTroops(participants),
    heroes,
    research,
    buffs,
  };
}

// ====== وزن مساهمة كل مشارك = مجموع قوة هجوم جيشه اللي بعته للتجمّع - نفس
// armyStatTotal المستخدمة في كل حساب قوة تاني في المشروع (مفيش صيغة جديدة
// مخترعة هنا). بيرجّع كل الأوزان + الإجمالي مع بعض عشان اللي بينادي عليها
// يقسم عليهم مباشرة (contribution ratio) من غير ما يعيد حساب المجموع. ======
function computeContributionWeights(participants) {
  const weights = participants.map((p) => armyStatTotal(p.troops || [], 'attack'));
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  return { weights, totalWeight };
}

module.exports = {
  mergeTroops,
  mergeContributions,
  computeContributionWeights,
};
