const adRevenueService = require('./adRevenue.service');

/**
 * بينادى عليه الفرونت إند نفسه (اللاعب مسجل دخول) وقت حدث دفع من Google Ad Manager (GPT).
 * ده تقرير من التطبيق مش من جوجل مباشرة (زي ما الحال في /ads/ssv)، فمينفعش
 * نعتبره "موقّع/متحقق منه" 100% - بس هو أفضل تقدير فوري متاح لحد ما نضيف
 * استيراد Google Ad Manager Reporting API الرسمي كمصدر تاني للمقارنة.
 */
async function reportClientRevenue(req, res) {
  try {
    const {
      revenue_amount: revenueAmount,
      currency,
      ad_network: adNetwork,
      ad_unit: adUnit,
      ad_format: adFormat,
      precision,
      platform,
      client_transaction_id: clientTransactionId,
    } = req.body;

    const event = await adRevenueService.recordClientAdRevenue({
      userId: req.user._id,
      revenueAmount,
      currency,
      adNetwork,
      adUnit,
      adFormat,
      precision,
      platform,
      clientTransactionId,
    });

    return res.status(201).json({ recorded: true, event });
  } catch (err) {
    console.error('[AdRevenue] reportClientRevenue error:', err.message);
    return res.status(400).json({ error: err.message });
  }
}

async function stats(req, res) {
  try {
    const { from, to } = req.query;
    const data = await adRevenueService.getAdRevenueStats({ from, to });
    return res.json(data);
  } catch (err) {
    console.error('[AdRevenue] stats error:', err.message);
    return res.status(400).json({ error: err.message });
  }
}

async function listEvents(req, res) {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const skip = Math.max(parseInt(req.query.skip) || 0, 0);
    const { source } = req.query;

    const { events, total } = await adRevenueService.listAdRevenueEvents({ limit, skip, source });
    return res.json({ events, total, limit, skip });
  } catch (err) {
    console.error('[AdRevenue] listEvents error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch ad revenue events' });
  }
}

module.exports = { reportClientRevenue, stats, listEvents };