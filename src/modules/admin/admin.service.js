const User = require('../users/user.model');
const Wallet = require('../wallets/wallet.model');
const WalletTransaction = require('../wallets/walletTransaction.model');
const walletService = require('../wallets/wallet.service');
const auditLogService = require('../audit/auditLog.service');
const coinPackageService = require('../coinPackages/coinPackage.service');
const adRevenueService = require('../adRevenue/adRevenue.service');

/**
 * ====== إدارة المستخدمين ======
 */
async function listUsers({ limit = 50, skip = 0, role, isActive, search } = {}) {
  const filter = {};

  if (role) filter.role = role;
  if (typeof isActive === 'boolean') filter.is_active = isActive;
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];
  }

  const [users, total] = await Promise.all([
    User.find(filter).sort({ created_at: -1 }).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);

  return { users, total };
}

async function setUserStatus(userId, isActive) {
  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  user.is_active = isActive;
  await user.save();

  return user;
}

/**
 * ====== تفاصيل مستخدم واحد (للأدمن) ======
 * بيرجع بيانات المستخدم + محفظته + ملخص نشاطه، عشان الأدمن يقدر يراجع حساب معين
 * من غير ما يدور في كذا شاشة
 */
async function getUserDetail(userId) {
  const user = await User.findById(userId).select('+admin_notes');
  if (!user) {
    throw new Error('User not found');
  }

  const [wallet, transactionCount, lastTransactions] = await Promise.all([
    Wallet.findOne({ user_id: userId }),
    WalletTransaction.countDocuments({ user_id: userId }),
    WalletTransaction.find({ user_id: userId }).sort({ created_at: -1 }).limit(10),
  ]);

  return {
    user,
    wallet,
    stats: {
      transaction_count: transactionCount,
    },
    recent_transactions: lastTransactions,
  };
}

/**
 * ====== تعديل دور مستخدم (ترقية/تنزيل أدمن) ======
 * بنمنع الأدمن من تنزيل نفسه عشان مايقفلش الباب على نفسه بالغلط
 */
async function updateUserRole(userId, role, requestingAdminId) {
  if (!['player', 'admin'].includes(role)) {
    throw new Error('role must be either "player" or "admin"');
  }

  if (String(userId) === String(requestingAdminId) && role !== 'admin') {
    throw new Error('You cannot remove your own admin role');
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  user.role = role;
  await user.save();

  return user;
}

/**
 * ====== مراقبة الأرباح ======
 *
 * القاعدة الأساسية هنا: "الإيراد الحقيقي" (real_revenue) بيتكوّن حصرياً من مصدرين
 * اتنين بس، هما الفلوس الحقيقية اللي بتدخل فعلاً للمنصة:
 *   1. deposits  - شحن رصيد حقيقي عن طريق بوابة الدفع (Moyasar)
 *   2. ad_revenue - الإيراد الفعلي اللي شبكة الإعلانات (Google Ad Manager) بتدفعه للمنصة
 *      (مش المكافأة اللي بتتاخد "كوين" للاعب - ده حاجة تانية تماماً، شوف adRevenue module)
 *
 * أي حركة تانية في المحفظة (reward/spend/reversal/admin_credit/admin_debit) هي
 * حركة عملة داخلية (نفس رصيد اللاعب اللي بيظهر كـ"كوين" في الواجهة) ومالهاش أي
 * علاقة بالإيراد الفعلي للمنصة - "reward" تكلفة/مصروف على المنصة (كوين بتديه
 * للاعب)، و"spend" مجرد استهلاك اللاعب لرصيده جوه اللعبة. عشان كده بنفصلهم في
 * wallet_activity منفصل تماماً عن real_revenue، وبنحطهم بوضوح تحت مسمى "نشاط
 * محفظة داخلي - مش إيراد".
 */
async function getRevenueStats({ from, to } = {}) {
  const match = { status: 'completed' };

  if (from || to) {
    match.created_at = {};
    if (from) match.created_at.$gte = new Date(from);
    if (to) match.created_at.$lte = new Date(to);
  }

  const [rows, adRevenue] = await Promise.all([
    WalletTransaction.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$type',
          total_gross_amount: { $sum: { $toDouble: '$gross_amount' } },
          total_vat_amount: { $sum: { $toDouble: '$vat_amount' } },
          total_net_amount: { $sum: { $toDouble: '$net_amount' } },
          total_coin_amount: { $sum: { $toDouble: '$coin_amount' } },
          transaction_count: { $sum: 1 },
        },
      },
    ]),
    adRevenueService.getAdRevenueStats({ from, to }),
  ]);

  const breakdown = {
    deposit: null,
    reward: null,
    spend: null,
    reversal: null,
    admin_credit: null,
    admin_debit: null,
  };
  for (const row of rows) {
    breakdown[row._id] = {
      total_gross_amount: round2(row.total_gross_amount),
      total_vat_amount: round2(row.total_vat_amount),
      total_net_amount: round2(row.total_net_amount),
      // مقدار الكوين الفعلي (مش الريال) - في deposit العادي (من غير باقة)
      // هيكون نفس net_amount، لكن في إيداع مربوط بباقة فيها بونص هيكون أكبر
      total_coin_amount: round2(row.total_coin_amount),
      transaction_count: row.transaction_count,
    };
  }

  const depositNet = breakdown.deposit?.total_net_amount || 0;

  return {
    period: { from: from || null, to: to || null },

    // ====== الإيراد الحقيقي بس - ده المفروض يبقى المرجع الرئيسي في اللوحة ======
    real_revenue: {
      deposits: {
        total_net_amount: round2(depositNet),
        transaction_count: breakdown.deposit?.transaction_count || 0,
      },
      ad_revenue: {
        total_revenue: adRevenue.total_revenue,
        event_count: adRevenue.event_count,
        by_source: adRevenue.by_source,
      },
      total: round2(depositNet + adRevenue.total_revenue),
    },

    // ====== نشاط محفظة داخلي - مش إيراد، بس مفيد تشغيلياً (كوين/تحويلات) ======
    wallet_activity: {
      note: 'الأرقام دي حركة "كوين" (رصيد المحفظة) داخل المنصة - مش إيراد فعلي. reward = مكافأة اتدّت للاعب (تكلفة عليك)، spend = رصيد اتصرف جوه لعبة، reversal/admin_credit/admin_debit = تصحيحات إدارية.',
      breakdown,
    },
  };
}

function round2(num) {
  return Math.round(num * 100) / 100;
}

/**
 * ====== نظرة عامة على المنصة ======
 */
async function getOverviewStats() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [
    totalUsers,
    activeUsers,
    depositRows,
    depositTodayRows,
    adRevenueAllTime,
    adRevenueToday,
  ] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ is_active: true }),
    WalletTransaction.aggregate([
      { $match: { type: 'deposit', status: 'completed' } },
      { $group: { _id: null, total: { $sum: { $toDouble: '$net_amount' } } } },
    ]),
    WalletTransaction.aggregate([
      { $match: { type: 'deposit', status: 'completed', created_at: { $gte: startOfToday } } },
      { $group: { _id: null, total: { $sum: { $toDouble: '$net_amount' } } } },
    ]),
    adRevenueService.getAdRevenueStats({}),
    adRevenueService.getAdRevenueStats({ from: startOfToday }),
  ]);

  const depositsTotal = round2(depositRows[0]?.total || 0);
  const depositsToday = round2(depositTodayRows[0]?.total || 0);

  return {
    users: { total: totalUsers, active: activeUsers },
    // ====== الإيراد الحقيقي فقط: إيداعات حقيقية + إيراد إعلانات فعلي ======
    // مفيش أي كوين/رصيد لعب داخلي جوه الرقم ده
    real_revenue: {
      total: round2(depositsTotal + adRevenueAllTime.total_revenue),
      today: round2(depositsToday + adRevenueToday.total_revenue),
      deposits: { total: depositsTotal, today: depositsToday },
      ad_revenue: { total: adRevenueAllTime.total_revenue, today: adRevenueToday.total_revenue },
    },
  };
}

/**
 * ====== إدارة المعاملات (Transactions) ======
 * عرض شامل لكل حركات المحفظة في المنصة، مع فلاتر (مستخدم/نوع/حالة/تاريخ)
 * وإمكانية عمل "استرداد يدوي" (reversal) لمعاملة معينة عند الحاجة (نزاع، خطأ...)
 */
async function listTransactions({
  userId,
  type,
  status,
  from,
  to,
  limit = 50,
  skip = 0,
} = {}) {
  const filter = {};

  if (userId) filter.user_id = userId;
  if (type) filter.type = type;
  if (status) filter.status = status;
  if (from || to) {
    filter.created_at = {};
    if (from) filter.created_at.$gte = new Date(from);
    if (to) filter.created_at.$lte = new Date(to);
  }

  const [transactions, total] = await Promise.all([
    WalletTransaction.find(filter)
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit)
      .populate('user_id', 'name email'),
    WalletTransaction.countDocuments(filter),
  ]);

  return { transactions, total };
}

async function getTransactionById(transactionId) {
  const transaction = await WalletTransaction.findById(transactionId).populate(
    'user_id',
    'name email'
  );
  if (!transaction) {
    throw new Error('Transaction not found');
  }
  return transaction;
}

/**
 * ====== استرداد يدوي لمعاملة (Manual Reversal) ======
 * الـ WalletTransaction append-only بتصميمه (مينفعش يتعدل أو يتمسح)، فالاسترداد
 * بيبقى معاملة جديدة نوعها "reversal" بعكس اتجاه الأصلية، مربوطة بيها عن طريق reversal_of.
 * مينفعش تسترد نفس المعاملة مرتين. زي أي إجراء إداري تاني، لازم سبب واضح ومرتبط
 * بالأدمن اللي نفّذه في الـ audit log.
 */
async function reverseTransaction(transactionId, adminId, reason) {
  if (!reason || !reason.trim()) {
    throw new Error('reason is required to reverse a transaction');
  }

  const original = await WalletTransaction.findById(transactionId);
  if (!original) {
    throw new Error('Transaction not found');
  }

  if (original.status !== 'completed') {
    throw new Error('Only completed transactions can be reversed');
  }

  const alreadyReversed = await WalletTransaction.findOne({ reversal_of: original._id });
  if (alreadyReversed) {
    throw new Error('This transaction has already been reversed');
  }

  const grossAmount = parseFloat(original.gross_amount.toString());

  // لو الأصلية كانت بتزود الرصيد (deposit/reward/admin_credit)، الاسترداد بيتم
  // كـ "admin_debit" (خصم) والعكس صحيح - وبيتسجل دايماً كعملية إدارية موثّقة
  const wasCredit = ['deposit', 'reward', 'reversal', 'admin_credit'].includes(original.type);
  const reversalType = wasCredit ? 'admin_debit' : 'admin_credit';

  const { transaction } = await walletService.recordTransaction({
    userId: original.user_id,
    type: reversalType,
    amount: grossAmount,
    taxMode: 'not_applicable',
    reversalOf: original._id,
    source: 'admin',
    initiatedBy: adminId,
    reason,
    category: 'correction',
  });

  return { original, reversal: transaction };
}

/**
 * ====== إدارة باقات وأسعار الـ Coins ======
 * تفويض مباشر لخدمة الباقات - محتفظين بها كموديول منفصل عشان يستخدم لاحقاً
 * من صفحة الشحن العامة كمان (endpoint النشطة بس)
 */
async function listAllPackages() {
  return coinPackageService.listAllPackages();
}

async function createPackage(data) {
  return coinPackageService.createPackage(data);
}

async function updatePackage(packageId, updates) {
  return coinPackageService.updatePackage(packageId, updates);
}

async function deletePackage(packageId) {
  return coinPackageService.deletePackage(packageId);
}

/**
 * ====== التقارير والإحصائيات ======
 * تكمّل getOverviewStats/getRevenueStats بمنظور زمني (نمو يومي) ومقارنة بين الألعاب،
 * مفيدة لعرضها كـ رسم بياني في لوحة التحكم
 */
async function getReportsSummary({ days = 14 } = {}) {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - (days - 1));

  const [userGrowth, revenueTrend, adRevenueTrend] = await Promise.all([
    // نمو المستخدمين الجدد يومياً
    User.aggregate([
      { $match: { created_at: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    // إيرادات الإيداعات يومياً (فلوس حقيقية من شحن الرصيد بس)
    WalletTransaction.aggregate([
      { $match: { type: 'deposit', status: 'completed', created_at: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } },
          total_net_amount: { $sum: { $toDouble: '$net_amount' } },
          transaction_count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    // إيراد الإعلانات الحقيقي يومياً (مش المكافآت اللي اتدّت للاعبين)
    adRevenueService.getAdRevenueTrend({ since }),
  ]);

  // بندمج إيداعات + إيراد إعلانات حقيقي في خط واحد "الإيراد الحقيقي" حسب اليوم -
  // ده الرقم اللي المفروض يتعرض كـ"الأرباح" في اللوحة، منفصل عن أي كوين/رصيد لعب
  const dateMap = new Map();
  for (const r of revenueTrend) {
    dateMap.set(r._id, { date: r._id, deposits: round2(r.total_net_amount), ad_revenue: 0 });
  }
  for (const r of adRevenueTrend) {
    const existing = dateMap.get(r._id) || { date: r._id, deposits: 0, ad_revenue: 0 };
    existing.ad_revenue = round2(r.total_revenue);
    dateMap.set(r._id, existing);
  }
  const realRevenueTrend = Array.from(dateMap.values())
    .map((d) => ({ ...d, total: round2(d.deposits + d.ad_revenue) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  return {
    period_days: days,
    user_growth: userGrowth.map((r) => ({ date: r._id, new_users: r.count })),
    // الإيراد الحقيقي فقط (إيداعات + إعلانات) - ده اللي يستخدم للعرض كأرباح
    real_revenue_trend: realRevenueTrend,
    // محتفظين بيه للتوافق - إيداعات بس (بدون إعلانات)
    revenue_trend: revenueTrend.map((r) => ({
      date: r._id,
      total_net_amount: round2(r.total_net_amount),
      transaction_count: r.transaction_count,
    })),
  };
}

/**
 * ====== تقرير الوعاء الزكوي (Zakat Base Report) ======
 * الهدف: إعطاء الأدمن لقطة (snapshot) رقمية دقيقة، في أي تاريخ يحدده (عادة نهاية
 * الحول/السنة المالية)، لصافي الأموال المحفوظة داخل محافظ اللاعبين + ملخص تدفق
 * الكاش من الإيداعات - عشان يسهّل حساب الوعاء الزكوي على المحاسب/الجهة الشرعية.
 *
 * ملحوظة مهمة: التقرير ده بيانات محاسبية خام بس (مش فتوى ولا احتساب شرعي جاهز).
 * "صافي الأصول المتداولة" و"الوعاء الزكوي" قرار محاسبي/شرعي يحتاج مراجعة بشرية
 * مختصة - إحنا هنا بس بنجيب الأرقام الدقيقة اللي القرار ده هيتبني عليها.
 *
 * الطريقة: بما إن Wallet.balance بيعكس بس الرصيد الحالي اللحظي (مش بيحتفظ
 * بتاريخ)، وبما إن كل محفظة بتتحرك حصرياً عن طريق wallet.service.js (append-only
 * ledger)، فأي "رصيد كما كان في تاريخ سابق" بيتحسب بإعادة تشغيل نفس معادلة
 * الرصيد (نفس منطق isCredit/net_amount أو gross_amount المستخدم فعلياً وقت
 * التنفيذ في recordTransaction) على كل المعاملات المكتملة لغاية التاريخ المطلوب.
 * ده بيدي رقم مطابق تماماً للرصيد الحقيقي وقتها، مش تقدير.
 */
async function getZakatReport({ asOf } = {}) {
  const asOfDate = asOf ? new Date(asOf) : new Date();
  if (Number.isNaN(asOfDate.getTime())) {
    throw new Error('asOf must be a valid date (e.g. 2026-12-31)');
  }

  const match = { status: 'completed', created_at: { $lte: asOfDate } };

  // نفس تصنيف "أنواع تزود الرصيد" المستخدم في wallet.service.js بالظبط -
  // لازم يفضل متطابق معاه، لأن أي فرق هنا هيدي رقم رصيد غلط
  const CREDIT_TYPES = ['deposit', 'reward', 'reversal', 'admin_credit'];

  const [balanceRows, typeRows, walletsCreated] = await Promise.all([
    WalletTransaction.aggregate([
      { $match: match },
      {
        $project: {
          // بنستخدم coin_amount (مقدار الكوين الفعلي اللي اتغير في الرصيد)
          // مش net/gross (اللي بيوصفوا الريال الحقيقي بس) - عشان في إيداعات
          // الباقات ذات البونص، الكوين اللي دخل المحفظة ممكن يكون أكبر من
          // الريال المدفوع، فلازم إعادة حساب الرصيد التاريخي يعتمد على
          // coin_amount عشان يطابق الرصيد الفعلي.
          signed_amount: {
            $cond: [
              { $in: ['$type', CREDIT_TYPES] },
              { $toDouble: '$coin_amount' },
              { $multiply: [{ $toDouble: '$coin_amount' }, -1] },
            ],
          },
        },
      },
      { $group: { _id: null, total: { $sum: '$signed_amount' } } },
    ]),
    WalletTransaction.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$type',
          total_gross_amount: { $sum: { $toDouble: '$gross_amount' } },
          total_vat_amount: { $sum: { $toDouble: '$vat_amount' } },
          total_net_amount: { $sum: { $toDouble: '$net_amount' } },
          transaction_count: { $sum: 1 },
        },
      },
    ]),
    Wallet.countDocuments({ created_at: { $lte: asOfDate } }),
  ]);

  const breakdown = {
    deposit: null,
    reward: null,
    spend: null,
    reversal: null,
    admin_credit: null,
    admin_debit: null,
  };
  for (const row of typeRows) {
    breakdown[row._id] = {
      total_gross_amount: round2(row.total_gross_amount),
      total_vat_amount: round2(row.total_vat_amount),
      total_net_amount: round2(row.total_net_amount),
      transaction_count: row.transaction_count,
    };
  }

  return {
    as_of: asOfDate.toISOString(),
    currency: 'SAR',
    disclaimer:
      'تقرير بيانات محاسبية خام من سجل المعاملات (ledger) - وليس فتوى أو احتساباً شرعياً جاهزاً. يجب مراجعته من محاسب/جهة شرعية مختصة قبل اعتماده كوعاء زكوي نهائي.',
    wallets: {
      wallets_created_to_date: walletsCreated,
      // صافي الأموال المحفوظة داخل محافظ كل اللاعبين مجتمعة، كما كانت فعلياً
      // في هذا التاريخ بالضبط (مش الرصيد الحالي اللحظي إلا لو asOf = الآن)
      total_balance_held: round2(balanceRows[0]?.total || 0),
    },
    cash_flow_to_date: {
      // إجمالي اللي دخل كاش حقيقي من بوابة الدفع (شامل الضريبة)
      total_gross_deposits: round2(breakdown.deposit?.total_gross_amount || 0),
      // ضريبة القيمة المضافة المفصولة من الإيداعات - ليست جزءاً من أصول المنصة
      total_vat_collected: round2(breakdown.deposit?.total_vat_amount || 0),
      // صافي الكاش اللي دخل فعلياً لحساب المنصة بعد فصل الضريبة
      total_net_deposits: round2(breakdown.deposit?.total_net_amount || 0),
    },
    // مكافآت اتوزعت (إعلانات/تحديات) - عملة داخلية بس، مش كاش حقيقي خرج
    rewards_granted_to_date: round2(breakdown.reward?.total_net_amount || 0),
    // عملة اتصرفت جوه المنصة (خرجت من أرصدة اللاعبين على تحديات/ميزات)
    spend_to_date: round2(breakdown.spend?.total_gross_amount || 0),
    // استردادات إدارية (Reversals) على معاملات سابقة
    reversals_to_date: round2(breakdown.reversal?.total_net_amount || 0),
    admin_adjustments_to_date: {
      total_credited: round2(breakdown.admin_credit?.total_net_amount || 0),
      total_debited: round2(breakdown.admin_debit?.total_gross_amount || 0),
    },
    breakdown_by_type: breakdown,
  };
}

/**
 * ====== إدارة رصيد اللاعبين (Player Management) ======
 * كل العمليات هنا بتمر بنفس wallet.service.js بالظبط (نفس القفل الذري، نفس
 * التحقق من الرصيد الموجب، نفس الـ append-only ledger) - الفرق الوحيد إن
 * source بيبقى "admin" وبيتفرض سبب واضح. الحساب المستهدف بيفضل لاعب عادي زي
 * أي حساب تاني - مفيش أي تغيير في role أو في قواعد اللعب أو الـ leaderboard.
 */
async function creditPlayerWallet({ userId, adminId, amount, reason, category }) {
  if (!amount || amount <= 0) {
    throw new Error('amount must be greater than zero');
  }
  const target = await User.findById(userId);
  if (!target) {
    throw new Error('User not found');
  }
  return walletService.adminCreditPlayer({ userId, adminId, amount, reason, category });
}

async function debitPlayerWallet({ userId, adminId, amount, reason, category }) {
  if (!amount || amount <= 0) {
    throw new Error('amount must be greater than zero');
  }
  const target = await User.findById(userId);
  if (!target) {
    throw new Error('User not found');
  }
  return walletService.adminDebitPlayer({ userId, adminId, amount, reason, category });
}

async function grantPlayerBonus({ userId, adminId, amount, reason }) {
  return creditPlayerWallet({ userId, adminId, amount, reason, category: 'bonus' });
}

/**
 * تعديل بيانات محدودة على حساب لاعب - قائمة الحقول المسموحة صريحة (allow-list)
 * عشان محدش يقدر يبعت role أو password_hash أو أي حقل حساس من هنا بالغلط.
 * admin_notes حقل داخلي بحت (مش بيتعرض في أي API عام ولا بيأثر على أي منطق لعب).
 */
const ALLOWED_PROFILE_FIELDS = ['name', 'admin_notes'];

async function updatePlayerProfile(userId, adminId, updates, reason) {
  const user = await User.findById(userId).select('+admin_notes');
  if (!user) {
    throw new Error('User not found');
  }

  const before = {};
  const after = {};
  let changed = false;

  for (const field of ALLOWED_PROFILE_FIELDS) {
    if (updates[field] !== undefined && updates[field] !== user[field]) {
      before[field] = user[field] ?? null;
      after[field] = updates[field];
      user[field] = updates[field];
      changed = true;
    }
  }

  if (!changed) {
    return user;
  }

  await user.save();

  await auditLogService.logAdminAction({
    adminId,
    action: 'user.profile_update',
    targetUserId: userId,
    reason: reason || null,
    metadata: { before, after },
  });

  return user;
}

async function getPlayerAuditLog(userId, { limit, skip } = {}) {
  return auditLogService.getAuditLogForUser(userId, { limit, skip });
}

async function listAdminAuditLog(filters) {
  return auditLogService.listAuditLog(filters);
}

module.exports = {
  listUsers,
  setUserStatus,
  getUserDetail,
  updateUserRole,
  getRevenueStats,
  getOverviewStats,
  listTransactions,
  getTransactionById,
  reverseTransaction,
  listAllPackages,
  createPackage,
  updatePackage,
  deletePackage,
  getReportsSummary,
  getZakatReport,
  creditPlayerWallet,
  debitPlayerWallet,
  grantPlayerBonus,
  updatePlayerProfile,
  getPlayerAuditLog,
  listAdminAuditLog,
};