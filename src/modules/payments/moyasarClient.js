/**
 * ====== Moyasar API Client ======
 * Wrapper خفيف حوالين Moyasar REST API. مفيش SDK خارجي هنا عشان نقلل الـ dependencies -
 * مبني على global fetch (متاح افتراضياً من Node.js 18+).
 *
 * المصادقة: HTTP Basic Auth، الـ secret key كـ username والـ password فاضي.
 * (https://docs.moyasar.com/api/authentication)
 */

const MOYASAR_API_BASE = 'https://api.moyasar.com/v1';

function getAuthHeader() {
  const secretKey = process.env.MOYASAR_SECRET_KEY;
  if (!secretKey) {
    throw new Error('MOYASAR_SECRET_KEY is not configured');
  }
  const encoded = Buffer.from(`${secretKey}:`).toString('base64');
  return `Basic ${encoded}`;
}

/**
 * ينشئ عملية دفع جديدة على Moyasar
 * ملحوظة: مش بنبعت بيانات كارت من هنا - الفرونت إند هو اللي هيستخدم Moyasar.js
 * (بالـ publishable key) عشان يجمع بيانات الكارت مباشرة من المتصفح للمتصفح-لـ-Moyasar
 * من غير ما بيانات الكارت تعدي على السيرفر بتاعنا خالص (PCI scope أقل بكتير)
 */
async function createPayment({ givenId, amount, currency, description, callbackUrl, metadata }) {
  const response = await fetch(`${MOYASAR_API_BASE}/payments`, {
    method: 'POST',
    headers: {
      Authorization: getAuthHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      given_id: givenId,
      amount,
      currency,
      description,
      callback_url: callbackUrl,
      metadata,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    const message = data?.message || 'Moyasar payment creation failed';
    throw new Error(message);
  }

  return data;
}

/**
 * بيجيب حالة عملية دفع مباشرة من Moyasar (server-to-server)
 * ده أهم دالة في المديول كله من ناحية الأمان: بنستخدمها عشان نتأكد من حالة الدفع
 * الحقيقية بدل ما نصدق أي بيانات جايالنا في الـ webhook body من غير تحقق
 */
async function fetchPayment(paymentId) {
  const response = await fetch(`${MOYASAR_API_BASE}/payments/${paymentId}`, {
    method: 'GET',
    headers: {
      Authorization: getAuthHeader(),
    },
  });

  const data = await response.json();

  if (!response.ok) {
    const message = data?.message || 'Failed to fetch payment from Moyasar';
    throw new Error(message);
  }

  return data;
}

module.exports = { createPayment, fetchPayment };
