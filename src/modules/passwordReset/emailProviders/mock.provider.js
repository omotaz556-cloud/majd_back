/**
 * ====== مزوّد الإيميل: Mock (وضع التطوير) ======
 * بيتفعّل لما EMAIL_PROVIDER=mock (القيمة الافتراضية، ومفيش حاجة تتغيّر
 * لحد ما تخلّص إعداد DNS بتاع Resend). مش بيبعت أي إيميل حقيقي - بس بيطبع
 * رابط الاستعادة كامل في الـ console عشان تقدر تختبر الفلو كله محليًا من
 * غير أي اتصال بالإنترنت أو حساب Resend.
 */
async function sendPasswordResetEmail({ to, resetUrl, userName }) {
  console.log('\n====== [Email/Mock] رابط استعادة كلمة المرور ======');
  console.log(`إلى: ${to} (${userName || 'مستخدم'})`);
  console.log(`الرابط: ${resetUrl}`);
  console.log('===================================================\n');
  return { id: 'mock-email', provider: 'mock' };
}

module.exports = { sendPasswordResetEmail };
