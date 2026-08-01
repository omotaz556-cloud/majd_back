require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const connectDB = require('../../config/db');
const User = require('./user.model');

/**
 * ====== ترقية مستخدم لدور أدمن ======
 * استخدام: node src/modules/users/promoteAdmin.js user@example.com
 *
 * المستخدم لازم يكون عمل تسجيل (register) عادي في المنصة الأول، السكربت ده
 * بس بيغيّر الـ role بتاعه لـ 'admin'. مفيش endpoint في الـ API لعمل ده عمداً -
 * ترقية أدمن لازم تتم من سيرفر موثوق (CLI) مش من أي طلب HTTP.
 */
async function run() {
  const email = process.argv[2];

  if (!email) {
    console.error('استخدام: node src/modules/users/promoteAdmin.js user@example.com');
    process.exit(1);
  }

  await connectDB();

  const user = await User.findOne({ email: email.toLowerCase() });

  if (!user) {
    console.error(`[Admin] لا يوجد مستخدم بالبريد الإلكتروني: ${email}`);
    await mongoose.disconnect();
    process.exit(1);
  }

  user.role = 'admin';
  await user.save();

  console.log(`[Admin] تمت ترقية "${user.name}" (${user.email}) إلى أدمن بنجاح`);
  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error('[Admin] فشل السكربت:', err.message);
  process.exit(1);
});
