/**
 * ====== مزوّد الإيميل: Resend (الإنتاج) ======
 * بيتفعّل لما EMAIL_PROVIDER=resend. بيستخدم Resend API مباشرة عن طريق
 * fetch عادي - مفيش حاجة لتثبيت SDK بتاعهم، الـ API بسيط عبارة عن POST
 * واحد لـ https://api.resend.com/emails بهيدر Authorization: Bearer.
 *
 * محتاج المتغيرات دي في .env قبل ما تشتغل:
 *   RESEND_API_KEY     - من Resend Dashboard > API Keys
 *   RESEND_FROM_EMAIL   - لازم يكون على دومين تم التحقق منه (verified) في
 *                         Resend Dashboard > Domains (يعني لازم تخلّص إعداد
 *                         الـ DNS الأول - قبل كده الإرسال هيفشل برسالة
 *                         "domain is not verified" من Resend نفسها)
 */
const RESEND_API_URL = 'https://api.resend.com/emails';

function buildEmailHtml({ resetUrl, userName }) {
  return `
    <div dir="rtl" style="font-family: Tahoma, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; background: #0f1115; color: #f5f0e6; border-radius: 12px;">
      <h2 style="color: #d4af37; margin-bottom: 8px;">استعادة كلمة المرور - مجد</h2>
      <p style="color: #cfcabf; line-height: 1.6;">
        أهلاً ${userName || ''}،<br />
        وصلنا طلب لاستعادة كلمة المرور بتاعة حسابك في مجد. اضغط على الزرار
        تحت عشان تختار كلمة مرور جديدة. الرابط ده هيفضل شغال لمدة ساعة واحدة بس.
      </p>
      <a href="${resetUrl}"
         style="display: inline-block; margin: 16px 0; padding: 12px 28px; background: linear-gradient(135deg, #d4af37, #b8860b); color: #0f1115; text-decoration: none; border-radius: 8px; font-weight: bold;">
        إعادة تعيين كلمة المرور
      </a>
      <p style="color: #9a948a; font-size: 13px; line-height: 1.6;">
        لو مطلبتش استعادة كلمة المرور، تجاهل الإيميل ده ببساطة - حسابك آمن
        ومفيش أي تغيير هيحصل.
      </p>
    </div>
  `;
}

async function sendPasswordResetEmail({ to, resetUrl, userName }) {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;

  if (!apiKey || !fromEmail) {
    throw new Error(
      'RESEND_API_KEY أو RESEND_FROM_EMAIL مش موجودين في .env - راجع الملاحظات فوق قبل تفعيل EMAIL_PROVIDER=resend'
    );
  }

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [to],
      subject: 'استعادة كلمة المرور - مجد',
      html: buildEmailHtml({ resetUrl, userName }),
    }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    // بيوضّح غالبًا لو السبب عدم تحقق الدومين (لسه DNS مش متظبط) - راجع
    // الملاحظة فوق قبل ما تفضل تدور في المشكلة
    throw new Error(`Resend API error: ${data?.message || res.statusText}`);
  }

  return { id: data?.id, provider: 'resend' };
}

module.exports = { sendPasswordResetEmail };
