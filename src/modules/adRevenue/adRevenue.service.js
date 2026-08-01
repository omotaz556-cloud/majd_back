const mongoose = require('mongoose');
const AdRevenueEvent = require('./adRevenueEvent.model');

function round2(num) {
  return Math.round(num * 100) / 100;
}

function toDecimal(num) {
  return mongoose.Types.Decimal128.fromString(Number(num).toFixed(4));
}

/**
 * ====== تسجيل حدث إيراد إعلان حقيقي من التطبيق (client SDK) ======
 * بينادى عليه الفرونت إند (ويب) وقت حدث دفع من Google Ad Manager (GPT)، بعد ما إعلان
 * (أي نوع - مش بس rewarded) يتعرض فعلاً. القيمة دي تقدير جوجل الفوري للإيراد،
 * ومفيهاش أي علاقة بالكوين اللي ممكن يتاخد كمكافأة على نفس الإعلان.
 */
async function recordClientAdRevenue({
  userId,
  revenueAmount,
  currency = 'SAR',
  adNetwork = 'google-ad-manager',
  adUnit = null,
  adFormat = null,
  precision = 'estimated',
  platform = null,
  clientTransactionId = null,
}) {
  const amount = Number(revenueAmount);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('revenueAmount must be a non-negative number');
  }

  try {
    return await AdRevenueEvent.create({
      user_id: userId || null,
      source: 'client_sdk',
      ad_network: adNetwork,
      ad_unit: adUnit,
      ad_format: adFormat,
      precision,
      revenue_amount: toDecimal(amount),
      currency,
      platform,
      client_transaction_id: clientTransactionId,
      revenue_date: new Date(),
    });
  } catch (err) {
    // idempotency: لو نفس client_transaction_id اتبعت قبل كده (retry من التطبيق)، تجاهل بأمان
    if (err.code === 11000) {
      return AdRevenueEvent.findOne({ client_transaction_id: clientTransactionId });
    }
    throw err;
  }
}

/**
 * ====== ملخص إيراد الإعلانات الحقيقي ======
 */
async function getAdRevenueStats({ from, to } = {}) {
  const match = {};
  if (from || to) {
    match.revenue_date = {};
    if (from) match.revenue_date.$gte = new Date(from);
    if (to) match.revenue_date.$lte = new Date(to);
  }

  const [totalRows, bySourceRows] = await Promise.all([
    AdRevenueEvent.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          total_revenue: { $sum: { $toDouble: '$revenue_amount' } },
          event_count: { $sum: 1 },
        },
      },
    ]),
    AdRevenueEvent.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$source',
          total_revenue: { $sum: { $toDouble: '$revenue_amount' } },
          event_count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const bySource = { client_sdk: null, network_report_import: null, manual_admin_entry: null };
  for (const row of bySourceRows) {
    bySource[row._id] = {
      total_revenue: round2(row.total_revenue),
      event_count: row.event_count,
    };
  }

  return {
    period: { from: from || null, to: to || null },
    total_revenue: round2(totalRows[0]?.total_revenue || 0),
    event_count: totalRows[0]?.event_count || 0,
    by_source: bySource,
  };
}

/**
 * ====== اتجاه الإيراد اليومي (لرسم بياني) ======
 */
async function getAdRevenueTrend({ since }) {
  return AdRevenueEvent.aggregate([
    { $match: { revenue_date: { $gte: since } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$revenue_date' } },
        total_revenue: { $sum: { $toDouble: '$revenue_amount' } },
        event_count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);
}

async function listAdRevenueEvents({ limit = 50, skip = 0, source } = {}) {
  const filter = {};
  if (source) filter.source = source;

  const [events, total] = await Promise.all([
    AdRevenueEvent.find(filter)
      .sort({ revenue_date: -1 })
      .skip(skip)
      .limit(limit)
      .populate('recorded_by', 'name email'),
    AdRevenueEvent.countDocuments(filter),
  ]);

  return { events, total };
}

module.exports = {
  recordClientAdRevenue,
  getAdRevenueStats,
  getAdRevenueTrend,
  listAdRevenueEvents,
};