const dailyRewardService = require('./dailyReward.service');

// GET /api/daily-reward/status - حالة المكافأة اليومية الحالية (الأهلية،
// الستريك الحالي والقادم، ومعاينة قيمة المكافأة لو استلم النهاردة)
async function getStatus(req, res) {
  try {
    const status = await dailyRewardService.getStatus(req.user._id);
    return res.json(status);
  } catch (err) {
    console.error('[DailyReward] getStatus error:', err.message);
    return res.status(500).json({ error: 'تعذر تحميل حالة المكافأة اليومية الآن' });
  }
}

// POST /api/daily-reward/claim - استلام مكافأة اليوم (مرة واحدة كل يوم UTC)
async function claim(req, res) {
  try {
    const result = await dailyRewardService.claim(req.user._id);
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message || 'تعذر استلام المكافأة اليومية' });
  }
}

module.exports = { getStatus, claim };
