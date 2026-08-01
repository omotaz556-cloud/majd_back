// ====== Loot Distributor (Phase 15) ======
// مسؤولية واحدة بس: بعد ما battleResolutionEngine يحسم المعركة المدموجة
// (نتيجة واحدة للجيش كله)، الملف ده بيوزّع النتيجة دي "بالعدل" على كل
// مشارك حسب نصيبه من قوة الهجوم اللي بعتها (Contribution Calculator هو اللي
// حاسب الوزن ده) - "Casualties distributed fairly" + "Loot distributed
// proportionally". مفيش أي حساب معركة هنا (ده خلص خالص قبل ما الملف ده
// يتنادى) - توزيع/تطبيق نتيجة بس، نفس فلسفة battleConsequencesService لكن
// contribution-aware بدل قلعة واحدة.
//
// اتنقل هنا من rally.service.js (كان اسمه distributeRallyOutcome) عشان
// يبقى موديول مستقل زي ما الـ spec طالب (Rally Service / Rally Coordinator /
// Contribution Calculator / Loot Distributor).

'use strict';

const Castle = require('../castle/castle.model');
const castleService = require('../castle/castle.service');
const { RESOURCE_TYPES, applyLossFraction } = require('../castle/castle.config');
const { computeContributionWeights } = require('./rallyContributionCalculator');

// ====== نسبة خسارة المهاجم موحّدة على كل الجيش المدموج (نفس منطق
// casualtyCalculator: نسبة واحدة مطبّقة على كل الكومات) - بنطبّقها بشكل
// مستقل على كومة كل مشارك لوحده، رياضيًا مكافئ لتطبيقها على المجموع الكلي،
// بالظبط نفس فلسفة allianceReinforcementService.applyBattleLossesToStationedTroops.
//
// الغنيمة كلها اتحطت فعليًا على قلعة "المرجع" (leaderCastle) قبل كده عن
// طريق battleConsequencesService.applyBattleConsequences - بنشيلها من هناك
// تاني عشان نوزّعها بعد كده على كل مشارك حسب نصيبه الحقيقي. ======
async function distributeLossesAndLoot(rally, battle) {
  const result = battle.battle_result;
  const lossFraction = result.casualties?.attacker?.loss_percent_applied ?? 0;
  const totalLoot = result.loot?.looted || {};

  const { weights, totalWeight } = computeContributionWeights(rally.participants);

  const leaderCastle = await Castle.findById(battle.attacker.castle_id);
  if (leaderCastle) {
    for (const resource of RESOURCE_TYPES) {
      const amount = Math.max(0, Number(totalLoot[resource]) || 0);
      if (amount > 0) {
        leaderCastle.resources[resource].stored = Math.max(0, leaderCastle.resources[resource].stored - amount);
      }
    }
  }

  const participantReports = [];
  for (let i = 0; i < rally.participants.length; i += 1) {
    const participant = rally.participants[i];
    const { lost, survived } = applyLossFraction(participant.troops, lossFraction);
    const contributionRatio = totalWeight > 0 ? weights[i] / totalWeight : 1 / rally.participants.length;

    const lootShare = {};
    for (const resource of RESOURCE_TYPES) {
      lootShare[resource] = Math.floor((Number(totalLoot[resource]) || 0) * contributionRatio);
    }

    // eslint-disable-next-line no-await-in-loop
    const castle = await Castle.findById(participant.castle_id);
    if (castle) {
      for (const t of survived) {
        const stack = castle.army.find((a) => a.key === t.key);
        if (stack) stack.count += t.count;
        else castle.army.push({ key: t.key, count: t.count });
      }
      for (const resource of RESOURCE_TYPES) {
        const cap = castleService.computeCapacity(castle, resource);
        const current = castle.resources[resource].stored;
        castle.resources[resource].stored = Math.min(cap, current + lootShare[resource]);
      }
      // eslint-disable-next-line no-await-in-loop
      await castle.save();
    }

    participantReports.push({
      user_id: participant.user_id,
      troops_sent: participant.troops,
      troops_lost: lost,
      troops_survived: survived,
      loot_share: lootShare,
      contribution_percent: Math.round(contributionRatio * 10000) / 100,
      had_heroes: Array.isArray(participant.heroes) && participant.heroes.length > 0,
      had_research: Boolean(participant.research),
      had_buffs: Array.isArray(participant.buffs) && participant.buffs.length > 0,
      had_battle_plan: Boolean(participant.battle_plan_id),
    });
  }

  if (leaderCastle) await leaderCastle.save();

  return participantReports;
}

module.exports = {
  distributeLossesAndLoot,
};
