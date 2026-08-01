const { requestPasswordReset, resetPassword } = require('./passwordReset.service');

async function forgotPassword(req, res) {
  try {
    const { email } = req.body || {};
    await requestPasswordReset(email);
    // نفس الرسالة سواء الإيميل موجود أو لأ - راجع ملاحظة user enumeration
    // في passwordReset.service.js
    return res.json({
      message: 'لو الإيميل ده مسجّل عندنا، هتوصلك رسالة فيها رابط استعادة كلمة المرور',
    });
  } catch (err) {
    console.error('[PasswordReset] forgotPassword error:', err.message);
    return res.status(400).json({ error: err.message || 'تعذر إرسال طلب الاستعادة' });
  }
}

async function resetPasswordHandler(req, res) {
  try {
    const { token, new_password } = req.body || {};
    await resetPassword(token, new_password);
    return res.json({ success: true, message: 'تم تغيير كلمة المرور بنجاح' });
  } catch (err) {
    console.error('[PasswordReset] resetPassword error:', err.message);
    return res.status(400).json({ error: err.message || 'تعذر تغيير كلمة المرور' });
  }
}

module.exports = { forgotPassword, resetPasswordHandler };
