const paymentService = require('./payment.service');

async function initiateDeposit(req, res) {
  try {
    const { amount, package_id: packageId } = req.body;
    const result = await paymentService.initiateDeposit(req.user._id, { amount, packageId });
    return res.status(201).json(result);
  } catch (err) {
    console.error('[Payments] initiateDeposit error:', err.message);
    return res.status(400).json({ error: err.message });
  }
}

async function getDepositStatus(req, res) {
  try {
    const { paymentId } = req.params;
    const status = await paymentService.getDepositStatus(req.user._id, paymentId);
    return res.json(status);
  } catch (err) {
    console.error('[Payments] getDepositStatus error:', err.message);
    return res.status(404).json({ error: err.message });
  }
}

/**
 * ====== Moyasar Webhook Receiver ======
 * لازم يرجع 2xx بسرعة (زي ما موصى بيه في docs Moyasar) قبل أي معالجة معقدة ممكن
 * تعمل timeout. المعالجة هنا بسيطة وسريعة كفاية (query واحد + fetch واحد للـ API)
 * فمفيش داعي لـ queue منفصلة دلوقتي، لكن لو الحجم كبر ده أول حاجة تتعمل async.
 */
async function moyasarWebhook(req, res) {
  try {
    const result = await paymentService.handleMoyasarWebhook(req.body);
    return res.status(200).json({ received: true, ...result });
  } catch (err) {
    console.error('[Payments] moyasarWebhook error:', err.message);
    // بنرجع 400 مش 500 لو السبب إن الـ secret غلط أو الـ payload ناقص -
    // عشان Moyasar متكررش تبعت webhook هيفضل يفشل بنفس الشكل
    return res.status(400).json({ error: err.message });
  }
}

/**
 * ====== تأكيد إيداع وهمي (وضع التطوير فقط) ======
 * متاحة بس لما PAYMENT_PROVIDER=mock. بديل الـ webhook الحقيقي، الفرونت إند
 * بينادي عليها بعد ما اللاعب يدوس "تأكيد الدفع (وضع تجريبي)".
 */
async function mockCompleteDeposit(req, res) {
  try {
    const { paymentId } = req.params;
    const { success } = req.body || {};
    const result = await paymentService.mockCompleteDeposit(req.user._id, paymentId, {
      success: success !== false,
    });
    return res.status(200).json(result);
  } catch (err) {
    console.error('[Payments] mockCompleteDeposit error:', err.message);
    return res.status(400).json({ error: err.message });
  }
}

module.exports = { initiateDeposit, getDepositStatus, moyasarWebhook, mockCompleteDeposit };
