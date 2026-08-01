const crypto = require('crypto');
const { randomUUID } = require('crypto');
const { PAYMENT_PROVIDER } = require('../../config/providers');
const paymentProvider = require('./providers');
const moyasarClient = require('./moyasarClient');
const DepositIntent = require('./depositIntent.model');
const CoinPackage = require('../coinPackages/coinPackage.model');
const walletService = require('../wallets/wallet.service');

/**
 * بيحول مبلغ بالعملة الأساسية (مثلاً 25.50 SAR) للوحدة الأصغر (هللة) اللي Moyasar بتطلبها
 * SAR فيها 100 هللة للريال، وده افتراض صحيح لمعظم العملات اللي بيدعمها Moyasar حالياً
 * (بنستخدم نفس التحويل في وضع الـ mock عشان الأرقام تفضل متسقة بين المزودين)
 */
function toSmallestUnit(amount) {
  return Math.round(amount * 100);
}

/**
 * ====== بدء عملية إيداع ======
 * بننشئ DepositIntent محلي الأول (status: pending) باستخدام given_id بنولده إحنا.
 * بعدين بنسأل المزوّد الفعّال (mock أو moyasar) عن الإعدادات اللي الفرونت إند محتاجها
 * عشان يكمل عملية الدفع. الفرونت إند بيعرف يفرق بين المزودين من قيمة `provider`
 * الراجعة في `payment_config`.
 *
 * ====== ربط الباقة (مهم) ======
 * لو `packageId` اتبعتت: السعر وعدد الكوين بيتحددوا من الباقة نفسها في قاعدة
 * البيانات - مش من أي رقم جاي من الفرونت إند - عشان محدش يقدر يغيّر قيمة
 * `amount` في الطلب ويدفع أقل من سعر الباقة الحقيقي. عدد الكوين المستحق
 * (coins_amount + bonus_coins) بيتقفل هنا في الـ DepositIntent وبيفضل ثابت
 * لحد ما الدفع يتأكد، حتى لو الأدمن عدّل الباقة بعد كده.
 *
 * لو مفيش packageId (مبلغ مخصص من غير باقة): بيفضل السلوك القديم -
 * 1 ريال = 1 كوين، من غير أي بونص.
 */
async function initiateDeposit(userId, { amount, packageId } = {}) {
  let finalAmount;
  let coinsToCredit;

  if (packageId) {
    const pkg = await CoinPackage.findOne({ _id: packageId, is_active: true });
    if (!pkg) {
      throw new Error('Coin package not found or not active');
    }
    // السعر وعدد الكوين بيتحددوا من الباقة نفسها - أي amount جاية من العميل بتتجاهل تمامًا
    finalAmount = pkg.price;
    coinsToCredit = pkg.coins_amount + (pkg.bonus_coins || 0);
  } else {
    if (typeof amount !== 'number' || amount <= 0) {
      throw new Error('Amount must be a positive number');
    }
    finalAmount = amount;
    coinsToCredit = amount; // مبلغ مخصص من غير باقة: 1 ريال = 1 كوين (زي ما كان قبل كده)
  }

  const currency = process.env.DEPOSIT_CURRENCY || process.env.MOYASAR_CURRENCY || 'SAR';
  const givenId = randomUUID();
  const baseCallbackUrl = process.env.DEPOSIT_CALLBACK_URL || process.env.MOYASAR_DEPOSIT_CALLBACK_URL;

  if (!baseCallbackUrl) {
    throw new Error('DEPOSIT_CALLBACK_URL is not configured');
  }

  // ====== مهم: بنحط given_id بتاعنا في نفس الـ callback_url كـ query param ======
  // Moyasar بترجع للفرونت إند بارامترات id/status/message بس عند الـ redirect
  // (زي ?id=<moyasar_payment_id>&status=paid) - الـ id ده هو payment.id
  // الخاص بـ Moyasar نفسها، مش given_id بتاعنا، ومفيش metadata في الـ redirect.
  // لو اعتمدنا على "id" بس في صفحة الكولباك، هنستعلم بمعرّف غلط ومش هنلاقي
  // الـ DepositIntent خالص (هو ده كان سبب "الرصيد بيتأكد بس الجواهر مش
  // بتزيد"). فبنحط given_id بأنفسنا في الرابط قبل ما نبعته لـ Moyasar، عشان
  // يترجعله تاني زي ما هو ضمن الـ redirect.
  const callbackUrl = `${baseCallbackUrl}${baseCallbackUrl.includes('?') ? '&' : '?'}given_id=${givenId}`;

  await DepositIntent.create({
    user_id: userId,
    moyasar_payment_id: givenId, // اسم الحقل قديم تاريخياً، وبيشتغل كـ "provider payment id" عام لأي مزود
    amount: finalAmount,
    currency,
    coin_package_id: packageId || null,
    coins_to_credit: coinsToCredit,
    status: 'pending',
  });

  const payment_config = paymentProvider.getClientConfig({
    givenId,
    amount: toSmallestUnit(finalAmount),
    currency,
    description: `Majd Games wallet deposit - user ${userId}`,
    callbackUrl,
    metadata: { user_id: String(userId), given_id: givenId },
  });

  return { payment_config };
}

/**
 * ====== التحقق من الـ webhook secret ======
 * بنستخدم timingSafeEqual عشان نمنع timing attacks حتى لو الفرق بسيط
 */
function isValidWebhookSecret(receivedSecret) {
  const expectedSecret = process.env.MOYASAR_WEBHOOK_SECRET;

  if (!expectedSecret || !receivedSecret) {
    return false;
  }

  const expectedBuffer = Buffer.from(expectedSecret);
  const receivedBuffer = Buffer.from(receivedSecret);

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

/**
 * ====== معالجة الـ webhook (Moyasar فقط) ======
 * أهم قاعدة هنا: مش بنصدق حالة الدفع الجايالنا في جسم الـ webhook.
 * بنستخدمها بس عشان نعرف مين الـ payment اللي نروح نتأكد منه، وبعدين بنعمل
 * fetchPayment مباشرة من Moyasar (server-to-server بالـ secret key) قبل ما نأكد أي إيداع.
 */
async function handleMoyasarWebhook(payload) {
  if (PAYMENT_PROVIDER !== 'moyasar') {
    // بنرفض بأمان لو حد بعت webhook حقيقي والسيرفر شغال بمزوّد تاني (mock)
    throw new Error('PAYMENT_PROVIDER is not "moyasar" - webhook rejected');
  }

  const { secret_token: secretToken, type, data } = payload || {};

  if (!isValidWebhookSecret(secretToken)) {
    throw new Error('Invalid webhook secret token');
  }

  if (!['payment_paid', 'payment_failed'].includes(type)) {
    // إحنا مسجلين بس للـ events دي، أي حاجة تانية بنتجاهلها بأمان
    return { ignored: true, type };
  }

  const paymentId = data?.id;
  // ====== مهم جداً: Moyasar بتولّد الـ payment id بتاعها هي (UUID خاص بيها) -
  // مفيش أي مفهوم "given_id" في Moyasar API بيخلي السيرفر يحدد الـ id بنفسه.
  // الـ given_id المحلي اللي ولّدناه إحنا في initiateDeposit بيوصل فعليًا في
  // data.metadata.given_id (لأننا بعتناه كـ metadata وقت الإنشاء)، ده هو
  // المفتاح الصحيح للمطابقة مع DepositIntent.moyasar_payment_id - مش data.id.
  // (كان بيستخدم data.id غلط قبل كده، فالمطابقة كانت دايماً بتفشل والـ
  // webhook كان بيتجاهل بصمت من غير ما الرصيد يتزود خالص).
  const givenId = data?.metadata?.given_id;

  if (!paymentId) {
    throw new Error('Webhook payload missing payment id');
  }
  if (!givenId) {
    return { ignored: true, reason: 'Webhook payload missing metadata.given_id' };
  }

  const depositIntent = await DepositIntent.findOne({ moyasar_payment_id: givenId });
  if (!depositIntent) {
    // مش لازم يبقى error فادح - ممكن يكون payment مش خاص بالإيداعات (لو الحساب
    // بيستخدم Moyasar لحاجات تانية غير المنصة دي)
    return { ignored: true, reason: 'No matching deposit intent' };
  }

  // Idempotency: لو الـ intent خلص حالته قبل كده (paid أو failed)، منعملش حاجة تاني
  // مهم جداً عشان Moyasar بتعيد إرسال الـ webhook لحد 5 مرات لو مرجعناش 2xx بسرعة
  if (depositIntent.status !== 'pending') {
    return { alreadyProcessed: true, status: depositIntent.status };
  }

  // التحقق الحقيقي: بنجيب حالة الدفع مباشرة من Moyasar، مش من جسم الـ webhook
  const payment = await moyasarClient.fetchPayment(paymentId);

  if (payment.status !== 'paid') {
    depositIntent.status = 'failed';
    depositIntent.failure_reason = payment.status;
    await depositIntent.save();
    return { processed: true, status: 'failed' };
  }

  // فحص إضافي: المبلغ اللي اتدفع فعلاً لازم يطابق اللي طلبناه وقت الـ initiate
  const expectedSmallestUnit = toSmallestUnit(depositIntent.amount);
  if (payment.amount !== expectedSmallestUnit) {
    depositIntent.status = 'failed';
    depositIntent.failure_reason = `Amount mismatch: expected ${expectedSmallestUnit}, got ${payment.amount}`;
    await depositIntent.save();
    throw new Error('Payment amount does not match deposit intent amount');
  }

  const { transaction } = await creditDeposit(depositIntent, payment.id);

  return { processed: true, status: 'paid', transaction_id: transaction._id };
}

/**
 * ====== تأكيد إيداع وهمي (Mock فقط) ======
 * بديل الـ webhook الحقيقي وقت التطوير: مفيش Moyasar هنا خالص، الفرونت إند
 * بينادي الـ endpoint ده مباشرة بعد ما اللاعب يدوس "تأكيد الدفع (وضع تجريبي)"،
 * وإحنا بنضيف الرصيد فوراً من غير أي تحقق خارجي (مقصود، لأنه وضع تطوير بس).
 *
 * لو PAYMENT_PROVIDER != mock، الدالة بترفض فوراً عشان محدش يقدر يستخدمها
 * كطريقة للتحايل على الدفع الحقيقي بالغلط في بيئة إنتاج.
 */
async function mockCompleteDeposit(userId, paymentId, { success = true } = {}) {
  if (PAYMENT_PROVIDER !== 'mock') {
    throw new Error('mockCompleteDeposit is only available when PAYMENT_PROVIDER=mock');
  }

  const depositIntent = await DepositIntent.findOne({
    moyasar_payment_id: paymentId,
    user_id: userId,
  });

  if (!depositIntent) {
    throw new Error('Deposit not found');
  }

  if (depositIntent.status !== 'pending') {
    return { alreadyProcessed: true, status: depositIntent.status };
  }

  if (!success) {
    depositIntent.status = 'failed';
    depositIntent.failure_reason = 'mock_failure_requested';
    await depositIntent.save();
    return { processed: true, status: 'failed' };
  }

  const { transaction } = await creditDeposit(depositIntent, `mock_${paymentId}`);

  return { processed: true, status: 'paid', transaction_id: transaction._id };
}

/**
 * منطق إضافة الرصيد المشترك بين تأكيد Moyasar الحقيقي وتأكيد الـ mock،
 * عشان مفيش تكرار ومفيش فرصة يفترقوا بالغلط لاحقاً
 */
async function creditDeposit(depositIntent, paymentRef) {
  const taxMode = process.env.DEFAULT_TAX_MODE || 'not_applicable';
  const vatRate = Number(process.env.DEFAULT_VAT_RATE) || 0;

  const { transaction } = await walletService.recordTransaction({
    userId: depositIntent.user_id,
    type: 'deposit',
    amount: depositIntent.amount, // الريال الحقيقي - لأغراض الضريبة/الإيراد فقط
    taxMode,
    vatRate,
    paymentRef,
    // عدد الكوين الفعلي اللي يتحط في المحفظة (يشمل أي بونص من الباقة) -
    // منفصل تمامًا عن الريال المدفوع فوق
    creditAmount: depositIntent.coins_to_credit,
  });

  depositIntent.status = 'paid';
  depositIntent.wallet_transaction_id = transaction._id;
  await depositIntent.save();

  return { transaction };
}

/**
 * ====== استعلام حالة إيداع ======
 * دي endpoint بس للعرض/الـ polling من الفرونت إند بعد ما اللاعب يرجع من صفحة الدفع.
 * مش بتعمل أي تعديل على الرصيد - الاعتماد الوحيد لتحديث الرصيد هو الـ webhook
 * (أو mock-complete وقت التطوير).
 */
async function getDepositStatus(userId, paymentId) {
  const depositIntent = await DepositIntent.findOne({
    moyasar_payment_id: paymentId,
    user_id: userId,
  });

  if (!depositIntent) {
    throw new Error('Deposit not found');
  }

  return {
    status: depositIntent.status,
    amount: depositIntent.amount,
    currency: depositIntent.currency,
    failure_reason: depositIntent.failure_reason,
  };
}

module.exports = {
  initiateDeposit,
  handleMoyasarWebhook,
  mockCompleteDeposit,
  getDepositStatus,
};