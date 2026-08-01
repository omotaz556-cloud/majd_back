const questService = require('./quest.service');

// GET /api/quests - قائمة المهام اليومية الحالية بتاعة اللاعب (بتتولد
// تلقائيًا لو أول مرة أو لو اليوم اتغيّر)
async function listMyQuests(req, res) {
  try {
    const state = await questService.getOrGenerateQuests(req.user._id);
    return res.json({
      quests: state.quests,
      generated_tier: state.generated_tier,
      day_key: state.day_key,
    });
  } catch (err) {
    console.error('[Quests] listMyQuests error:', err.message);
    return res.status(500).json({ error: 'تعذر تحميل المهام اليومية الآن' });
  }
}

// POST /api/quests/:questId/claim - استلام مكافأة مهمة خلصت
async function claimQuest(req, res) {
  try {
    const { questId } = req.params;
    const { state, quest } = await questService.claimQuestReward(req.user._id, questId);
    return res.json({
      quest,
      quests: state.quests,
    });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'تعذر استلام المكافأة' });
  }
}

module.exports = { listMyQuests, claimQuest };
