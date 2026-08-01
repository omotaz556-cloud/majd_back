const moyasarClient = require('../moyasarClient');

/**
 * ====== مزوّد الدفع: Moyasar ======
 * بيتفعّل لما PAYMENT_PROVIDER=moyasar. محتاج المفاتيح دي في .env:
 *   MOYASAR_SECRET_KEY, MOYASAR_PUBLISHABLE_KEY, MOYASAR_WEBHOOK_SECRET
 */

/**
 * بيرجع كل حاجة الفرونت إند محتاجها عشان يبني فورم Moyasar.js المستضاف
 * (الفرونت إند هو اللي هيبعت بيانات الكارت مباشرة لـ Moyasar، سيرفرنا محدش يشوفها)
 */
function getClientConfig({ givenId, amount, currency, description, callbackUrl, metadata }) {
  const publishableKey = process.env.MOYASAR_PUBLISHABLE_KEY;
  if (!publishableKey) {
    throw new Error('MOYASAR_PUBLISHABLE_KEY is not configured');
  }

  return {
    provider: 'moyasar',
    publishable_key: publishableKey,
    amount,
    currency,
    description,
    callback_url: callbackUrl,
    given_id: givenId,
    metadata,
  };
}

/**
 * بيجيب حالة الدفع مباشرة من Moyasar (server-to-server) - ده أهم حاجة أمنياً،
 * مش بنصدق حالة الدفع الجايالنا في جسم الـ webhook
 */
async function fetchPayment(paymentId) {
  return moyasarClient.fetchPayment(paymentId);
}

module.exports = { getClientConfig, fetchPayment };
