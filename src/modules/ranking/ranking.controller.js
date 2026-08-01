const rankingService = require('./ranking.service');

// GET /api/ranking/vip - أفضل 100 لاعب حسب القوة الكلية + مركز اللاعب
// الحالي (حتى لو خارج الـ 100). Query اختياري ?q= للبحث بالاسم داخل التصنيف
// كامله (مش أفضل 100 بس).
async function getVipRanking(req, res) {
  try {
    const { q } = req.query;

    if (q && q.trim()) {
      const searchResult = await rankingService.searchVipRanking(q);
      return res.json(searchResult);
    }

    const result = await rankingService.getVipRanking(req.user._id);
    return res.json(result);
  } catch (err) {
    console.error('[Ranking] getVipRanking error:', err.message);
    return res.status(500).json({ error: 'تعذر تحميل تصنيف الـ VIP الآن' });
  }
}

module.exports = { getVipRanking };
