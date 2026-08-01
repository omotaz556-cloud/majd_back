require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const connectDB = require('../../config/db');
const User = require('../users/user.model');
const Castle = require('../castle/castle.model');
const counterService = require('../common/counter.service');

const PLAYER_ID_OFFSET = 100000;
const KINGDOM_ID_OFFSET = 100000;

/**
 * ====== تعبئة Player ID / Kingdom ID للحسابات/القلاع القديمة ======
 * استخدام: node src/modules/castle/backfillWorldIds.js
 *
 * player_id وkingdom_id بيتحددوا تلقائي لأي حساب/قلعة جديدة من دلوقتي (شوف
 * auth.service.js وcastle.service.js) - السكربت ده مطلوب مرة واحدة بس عشان
 * أي حساب أو قلعة اتعملوا قبل إضافة نظام "بحث العالم" (World Search) ولسه
 * من غير رقم، عشان يبقوا قابلين للبحث عنهم زي أي حساب جديد بالظبط. تشغيله
 * تاني على بيانات مكتملة أصلاً آمن (بيتخطى أي حساب/قلعة عنده رقم بالفعل).
 */
async function run() {
  await connectDB();

  const usersWithoutId = await User.find({ player_id: { $exists: false } }).select('_id name');
  for (const user of usersWithoutId) {
    user.player_id = await counterService.nextSequence('player_id', PLAYER_ID_OFFSET);
    await user.save();
    console.log(`[Backfill] Player ID ${user.player_id} -> ${user.name}`);
  }

  const castlesWithoutId = await Castle.find({ is_npc: false, kingdom_id: { $exists: false } }).select('_id');
  for (const castle of castlesWithoutId) {
    castle.kingdom_id = await counterService.nextSequence('kingdom_id', KINGDOM_ID_OFFSET);
    await castle.save();
    console.log(`[Backfill] Kingdom ID ${castle.kingdom_id} -> castle ${castle._id}`);
  }

  console.log(
    `[Backfill] تم - ${usersWithoutId.length} لاعب و${castlesWithoutId.length} مملكة اتحدث لهم رقم.`
  );
  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error('[Backfill] فشل السكربت:', err.message);
  process.exit(1);
});
