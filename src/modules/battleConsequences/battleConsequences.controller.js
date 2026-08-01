// ====== Phase 6: Battle Consequences - HTTP handler لإحصائيات اللاعب
// التراكمية (lifetime) بس. تطبيق النتائج نفسه (applyBattleConsequences)
// بيتنادى داخليًا من battle.service.resolveBattleForMarch - مفيش endpoint
// عام يشغّله يدويًا (نفس فلسفة battleResolutionEngine.resolveBattle -
// consumer داخلي بس، مش جزء من الـ API العام). ======

const battleConsequencesService = require('./battleConsequences.service');

async function getMyBattleStats(req, res) {
  try {
    const stats = await battleConsequencesService.getLifetimeStats(req.user._id);
    return res.json({ stats });
  } catch (err) {
    return res.status(500).json({ error: 'تعذر تحميل إحصائيات المعارك' });
  }
}

module.exports = {
  getMyBattleStats,
};
