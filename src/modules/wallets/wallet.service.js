const mongoose = require('mongoose');
const Wallet = require('./wallet.model');
const WalletTransaction = require('./walletTransaction.model');
const auditLogService = require('../audit/auditLog.service');

/**
 * بيحسب gross/vat/net حسب tax_mode:
 * - inclusive: المبلغ المدخل شامل الضريبة بالفعل (net = gross / (1 + rate))
 * - exclusive: المبلغ المدخل صافي والضريبة بتتضاف عليه (gross = net * (1 + rate))
 * - not_applicable: مفيش ضريبة (مكافآت مثلاً)
 */
function calculateTax({ amount, taxMode, vatRate }) {
  const rate = vatRate / 100;

  if (taxMode === 'not_applicable' || !vatRate) {
    return {
      gross_amount: amount,
      vat_amount: 0,
      net_amount: amount,
    };
  }

  if (taxMode === 'inclusive') {
    const net = amount / (1 + rate);
    const vat = amount - net;
    return {
      gross_amount: round2(amount),
      vat_amount: round2(vat),
      net_amount: round2(net),
    };
  }

  if (taxMode === 'exclusive') {
    const vat = amount * rate;
    const gross = amount + vat;
    return {
      gross_amount: round2(gross),
      vat_amount: round2(vat),
      net_amount: round2(amount),
    };
  }

  throw new Error(`Unknown tax_mode: ${taxMode}`);
}

function round2(num) {
  return Math.round(num * 100) / 100;
}

function toDecimal(num) {
  return mongoose.Types.Decimal128.fromString(num.toFixed(2));
}

/**
 * إنشاء محفظة جديدة لمستخدم (بيتنادى تلقائياً عند التسجيل)
 */
async function createWalletForUser(userId, currency = 'SAR') {
  const existing = await Wallet.findOne({ user_id: userId });
  if (existing) return existing;

  return Wallet.create({
    user_id: userId,
    balance: toDecimal(0),
    currency,
  });
}

/**
 * العملية الأساسية: إضافة أو خصم رصيد + تسجيل transaction
 * كل حاجة بتحصل جوا MongoDB session عشان الرصيد والسجل يتزامنوا (atomic)
 *
 * دي نفس نقطة الدخول الوحيدة اللي أي رصيد بيتغير منها في المنصة كلها - سواء
 * كانت العملية جاية من اللاعب نفسه (لعب/دفع) أو من الأدمن (تعديل يدوي). الفرق
 * الوحيد بين المصدرين هو source/initiated_by/reason، ومنطق الحساب والتحقق
 * والقفل الذري (atomic) واحد بالظبط لكل الحالات - يعني مفيش "مسار مختصر" لأي
 * طرف يقدر يتجاوز بيه القواعد دي.
 *
 * @param {Object} params
 * @param {string} params.userId
 * @param {string} params.type - deposit | reward | spend | reversal | admin_credit | admin_debit
 * @param {number} params.amount - المبلغ (معناه بيتحدد حسب taxMode)
 * @param {string} params.taxMode - inclusive | exclusive | not_applicable
 * @param {number} params.vatRate - نسبة الضريبة (مثلاً 15)
 * @param {string} [params.paymentRef] - مرجع بوابة الدفع لو موجود
 * @param {string} [params.reversalOf] - id عملية سابقة لو دي Reversal
 * @param {string} [params.source] - user | admin | system | payment_gateway (افتراضي: user)
 * @param {string} [params.initiatedBy] - id الأدمن اللي نفّذ العملية، لو source = admin
 * @param {string} [params.reason] - سبب العملية - إجباري لو source = admin
 * @param {string} [params.category] - تصنيف اختياري (topup/deduction/bonus/correction/penalty)
 * @param {number} [params.creditAmount] - مقدار الكوين الفعلي اللي يتغير بيه
 *   رصيد المحفظة، لو مختلف عن `amount` (اللي بيتحسب منه gross/vat/net بس).
 *   محتاجينها لما إيداع مربوط بباقة (CoinPackage) فيها بونص - اللاعب بيدفع
 *   `amount` ريال حقيقي، لكن المفروض ياخد `creditAmount` كوين في محفظته.
 *   لو مش موجودة، السلوك زي الأول تمامًا (coin_amount = net/gross حسب النوع).
 */
async function recordTransaction({
  userId,
  type,
  amount,
  taxMode = 'not_applicable',
  vatRate = 0,
  paymentRef = null,
  reversalOf = null,
  source = 'user',
  initiatedBy = null,
  reason = null,
  category = null,
  creditAmount = null,
}) {
  if (amount <= 0) {
    throw new Error('Amount must be greater than zero');
  }

  // أي عملية مصدرها أدمن لازم يكون ليها منفذ (initiatedBy) وسبب واضح (reason) -
  // ده مش اختياري، عشان الـ audit trail يفضل كامل دايماً ومفيش تعديل رصيد
  // "من غير سبب" ممكن يحصل من لوحة التحكم.
  if (source === 'admin') {
    if (!initiatedBy) {
      throw new Error('initiatedBy is required for admin-sourced transactions');
    }
    if (!reason || !reason.trim()) {
      throw new Error('reason is required for admin-sourced transactions');
    }
  }

  const session = await mongoose.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const wallet = await Wallet.findOne({ user_id: userId }).session(session);
      if (!wallet) {
        throw new Error('Wallet not found for this user');
      }

      const { gross_amount, vat_amount, net_amount } = calculateTax({
        amount,
        taxMode,
        vatRate,
      });

      // deposit/reward/admin_credit بيزودوا الرصيد بالـ net (بعد فصل الضريبة)
      // spend/admin_debit بينقصوا الرصيد بالـ gross (القيمة الكاملة)
      // إلا لو اتبعت creditAmount صراحة (زي إيداع مربوط بباقة فيها بونص) -
      // وقتها هي اللي بتحدد مقدار الكوين الفعلي، منفصلة تمامًا عن الريال
      // الحقيقي المحسوب في gross/vat/net.
      const isCredit = ['deposit', 'reward', 'reversal', 'admin_credit'].includes(type);
      const coinAmount = creditAmount !== null && creditAmount !== undefined
        ? creditAmount
        : (isCredit ? net_amount : gross_amount);
      const deltaForBalance = isCredit ? coinAmount : -coinAmount;

      const currentBalance = parseFloat(wallet.balance.toString());
      const newBalance = currentBalance + deltaForBalance;

      if (newBalance < 0) {
        throw new Error('Insufficient wallet balance');
      }

      wallet.balance = toDecimal(newBalance);
      await wallet.save({ session });

      const [txn] = await WalletTransaction.create(
        [
          {
            user_id: userId,
            wallet_id: wallet._id,
            type,
            tax_mode: taxMode,
            vat_rate: vatRate,
            gross_amount: toDecimal(gross_amount),
            vat_amount: toDecimal(vat_amount),
            net_amount: toDecimal(net_amount),
            coin_amount: toDecimal(coinAmount),
            currency: wallet.currency,
            payment_ref: paymentRef,
            status: 'completed',
            reversal_of: reversalOf,
            source,
            initiated_by: initiatedBy,
            reason,
            category,
          },
        ],
        { session }
      );

      // العمليات الإدارية بتتسجل كمان في الـ Audit Log العام، جوه نفس الـ
      // transaction الذرية بتاعة المحفظة - يعني الاتنين بينجحوا مع بعض أو
      // بيترجعوا مع بعض، مفيش سيناريو الرصيد يتغير والـ audit log يفشل يتسجل.
      if (source === 'admin') {
        const auditAction =
          type === 'admin_credit'
            ? category === 'bonus'
              ? 'wallet.bonus'
              : 'wallet.credit'
            : 'wallet.debit';

        await auditLogService.logAdminAction({
          adminId: initiatedBy,
          action: auditAction,
          targetUserId: userId,
          reason,
          metadata: { amount: gross_amount, category, wallet_transaction_type: type },
          walletTransactionId: txn._id,
          session,
        });
      }

      result = { wallet, transaction: txn };
    });

    return result;
  } finally {
    session.endSession();
  }
}

async function getWalletByUserId(userId) {
  return Wallet.findOne({ user_id: userId });
}

async function getTransactionHistory(userId, { limit = 50, skip = 0 } = {}) {
  return WalletTransaction.find({ user_id: userId })
    .sort({ created_at: -1 })
    .skip(skip)
    .limit(limit);
}

/**
 * ====== تعديلات الأدمن على رصيد لاعب (Player Management) ======
 * غلاف رفيع فوق recordTransaction بنفس القواعد بالظبط (نفس القفل الذري، نفس
 * التحقق من الرصيد، نفس الـ ledger). العملية دي بتتم على حساب لاعب عادي
 * (role: player) زي أي حساب تاني - مفيش أي تجاوز لقواعد اللعب أو الـ
 * anti-cheat أو الـ leaderboard، هي بس إضافة/خصم رصيد موثّق بالكامل.
 *
 * @param {Object} params
 * @param {string} params.userId - اللاعب المستهدف
 * @param {string} params.adminId - الأدمن المنفّذ
 * @param {number} params.amount - المبلغ (موجب دايماً)
 * @param {string} params.reason - سبب العملية - إجباري
 * @param {string} [params.category] - bonus | correction | topup | deduction | penalty
 */
async function adminCreditPlayer({ userId, adminId, amount, reason, category = 'topup' }) {
  return recordTransaction({
    userId,
    type: 'admin_credit',
    amount,
    taxMode: 'not_applicable',
    source: 'admin',
    initiatedBy: adminId,
    reason,
    category,
  });
}

async function adminDebitPlayer({ userId, adminId, amount, reason, category = 'deduction' }) {
  return recordTransaction({
    userId,
    type: 'admin_debit',
    amount,
    taxMode: 'not_applicable',
    source: 'admin',
    initiatedBy: adminId,
    reason,
    category,
  });
}

module.exports = {
  calculateTax,
  createWalletForUser,
  recordTransaction,
  getWalletByUserId,
  getTransactionHistory,
  adminCreditPlayer,
  adminDebitPlayer,
};
