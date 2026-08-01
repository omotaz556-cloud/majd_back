require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const connectDB = require('../../config/db');
const CastleDefense = require('./defense.model');
const { structureCombatStatsPlaceholder } = require('./defense.config');

/**
 * ====== تعبئة combat_stats الناقصة لقطع الدفاع القديمة ======
 * استخدام: node src/modules/defense/backfillCombatStats.js
 *
 * السياق: defense.config.js اتعدّل عشان كل نوع مبنى دفاعي (سور/بوابة/برج/
 * فخ/متراس) يحمل رقم "قوة دفاعية" حقيقي (defense_power عبر
 * combat_stats.defense) + defense_bonus_percent - دول اللي
 * defensePowerCalculator بيقراهم فعليًا عشان مباني الدفاع تبقى جزء حقيقي
 * من قوة دفاع القلعة الكلية جنب الجنود، مش مجرد أهداف hp.
 *
 * لكن combat_stats بتتحسب فعليًا بس وقت: إنشاء القطعة (addStructure)، أو
 * اكتمال ترقيتها (completeFinishedStructureUpgrades)، أو ترقية فورية
 * لأدمن (upgradeStructure adminBypass). أي قطعة اتبنت قبل التعديل ده
 * فاضلة بـ combat_stats القديمة (defense: 0, defense_bonus_percent: 0)
 * محفوظة في قاعدة البيانات - مش هتتحدّث لوحدها لحد ما حد يرقّيها تاني.
 *
 * السكربت ده بيمر على كل مستندات CastleDefense، وبيعيد حساب combat_stats
 * لكل قطعة فيها (بمستواها الحالي level - بدون أي تغيير على level/hp/
 * position/upgrade نفسها) عن طريق نفس الدالة اللي أي بناء/ترقية بتستخدمها.
 * آمن تشغيله أكتر من مرة (idempotent) - نفس المدخلات (type, level) دايمًا
 * بترجّع نفس القيم.
 */
async function run() {
  await connectDB();

  const allDefenses = await CastleDefense.find({});

  let updatedDefenseCount = 0;
  let updatedStructureCount = 0;

  for (const defense of allDefenses) {
    let changed = false;

    for (const s of defense.structures) {
      const fresh = structureCombatStatsPlaceholder(s.type, s.level);
      const current = s.combat_stats || {};
      const isStale =
        Number(current.defense ?? 0) !== fresh.defense ||
        Number(current.defense_bonus_percent ?? 0) !== fresh.defense_bonus_percent ||
        Number(current.damage ?? 0) !== fresh.damage ||
        Number(current.range ?? 0) !== fresh.range;

      if (isStale) {
        s.combat_stats = fresh;
        changed = true;
        updatedStructureCount += 1;
      }
    }

    if (changed) {
      await defense.save();
      updatedDefenseCount += 1;
      console.log(`[Backfill] castle_id ${defense.castle_id} -> combat_stats اتحدّثت`);
    }
  }

  console.log(
    `[Backfill] تم - ${updatedDefenseCount} مستند دفاع اتحدّث، ${updatedStructureCount} قطعة دفاعية اتحدّثت إجمالًا.`
  );
  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error('[Backfill] فشل السكربت:', err.message);
  process.exit(1);
});
