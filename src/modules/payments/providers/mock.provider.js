/**
 * ====== مزوّد الدفع: Mock (وضع التطوير) ======
 * بيتفعّل لما PAYMENT_PROVIDER=mock (القيمة الافتراضية). مش محتاج أي حساب
 * أو مفتاح API ولا اتصال بالإنترنت خالص.
 *
 * بدل ما الفرونت إند يحمّل فورم Moyasar.js الحقيقي، بيعرض شاشة بسيطة فيها زرار
 * "تأكيد الدفع (وضع تجريبي)". الزرار ده بينادي endpoint داخلي
 * (POST /wallet/deposit/:paymentId/mock-complete) بيقفل الـ DepositIntent
 * ويضيف الرصيد للمحفظة مباشرة، بنفس منطق تأكيد الدفع الحقيقي (بدون Moyasar).
 */

function getClientConfig({ givenId, amount, currency, description, callbackUrl, metadata }) {
  return {
    provider: 'mock',
    amount,
    currency,
    description,
    callback_url: callbackUrl,
    given_id: givenId,
    metadata,
  };
}

async function fetchPayment() {
  throw new Error(
    'fetchPayment غير مدعومة في مزوّد الدفع الوهمي - التأكيد بيتم عن طريق endpoint /mock-complete مباشرة'
  );
}

module.exports = { getClientConfig, fetchPayment };
