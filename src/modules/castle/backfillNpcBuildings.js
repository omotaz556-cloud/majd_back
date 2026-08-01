require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const connectDB = require('../../config/db');
const Castle = require('./castle.model');
const { BUILDING_TYPES } = require('./castle.config');
const { generateNpcBuildings } = require('./npcCastle.generator');
// ====== mulberry32 مش متصدّرة من npcCastle.generator.js (نسخة داخلية بس) -
// بنستخدم نفس الدالة المتصدّرة من world/worldPopulation.generator.js
// (نفس الكود بالظبط، نفس فكرة الاستخدام في worldAdmin.service.js). ======
const { mulberry32 } = require('../world/worldPopulation.generator');

/**
 * ====== تعبئة المباني الناقصة لقلاع الـ NPC القديمة ======
 * استخدام: node src/modules/castle/backfillNpcBuildings.js
 *
 * السياق: npcCastle.generator.generateNpcBuildings اتعدّل قبل كده عشان كل
 * قلعة NPC جديدة تتولّد بكل مباني اللاعب (BUILDING_TYPES كاملة) بدل
 * المبنى الرئيسي (town_hall) بس - لكن التعديل ده أثّر بس على القلاع اللي
 * هتتولّد من دلوقتي فصاعدًا. أي قلعة NPC كانت موجودة بالفعل في قاعدة
 * البيانات قبل التعديل (من مناطق (regions) سبق واتعمّرت) لسه فاضلة بمبناها
 * الرئيسي بس، لأن ensureRegionPopulated بيتخطى أي منطقة سبق واتعمّرت
 * (worldMap.service.js - "already-seeded regions are left untouched").
 * ده اللي كان بيخلي "دخول المملكة" يعرض القلعة الرئيسية بس من غير باقي
 * مباني المملكة (مخازن/مناجم/ثكنة) - مش أي مشكلة في مسار الرسم نفسه
 * (IsometricWorld بيرسم أي مبنى موصوله في buildings[] عادي)، المشكلة إن
 * المستند نفسه في قاعدة البيانات ناقص من الأساس.
 *
 * السكربت ده بيمر على كل قلعة NPC، وبيضيف بس أي مبنى من BUILDING_TYPES
 * مفقود من castle.buildings الحالية (بموقع فاضي على شبكة الـ 8x8 بتاعتها)
 * - من غير ما يلمس أي مبنى موجود بالفعل (مستواه/مكانه/حالة ترقيته) ومن
 * غير ما يلمس أي قلعة لاعب حقيقي خالص (is_npc: true بس). آمن تشغيله أكتر
 * من مرة - أي قلعة عندها كل المباني بالفعل بتتخطى تمامًا.
 */
async function run() {
  await connectDB();

  const npcCastles = await Castle.find({ is_npc: true });
  const allBuildingKeys = Object.keys(BUILDING_TYPES);

  let updatedCount = 0;
  let addedBuildingCount = 0;

  for (const castle of npcCastles) {
    const existingKeys = new Set(castle.buildings.map((b) => b.key));
    const missingKeys = allBuildingKeys.filter((key) => !existingKeys.has(key));
    if (missingKeys.length === 0) continue;

    // ====== بذرة ثابتة (deterministic) من _id القلعة نفسها - نفس فلسفة
    // seed القائم على map_slot في buildNpcCastleDoc، بس هنا بنستخدم _id
    // عشان نفس القلعة ترجع نفس المواقع لو السكربت اتشغّل تاني قبل ما
    // يتحفظ التعديل (idempotent). ======
    const seed = Math.abs(
      castle._id.toString().split('').reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) | 0, 0)
    ) >>> 0;
    const rand = mulberry32(seed || 1);

    const townHall = castle.buildings.find((b) => b.key === 'town_hall');
    const townHallLevel = townHall?.level || 1;

    // ====== بنولّد مجموعة مباني كاملة جديدة (نفس القواعد المستخدمة لأي
    // قلعة NPC جديدة بالظبط - نفس التوزيع العشوائي لمستوى كل مبنى حسب
    // مستوى المبنى الرئيسي الحالي) بس بنستخدم منها بس المباني اللي
    // ناقصة فعليًا - أي مبنى موجود بالفعل في القلعة (حتى لو اتبنى/اتقرقى
    // يدويًا لاحقًا) بيفضل زي ما هو من غير أي تعديل. ======
    const { buildings: freshBuildings, occupied } = generateNpcBuildings(townHallLevel, rand);

    // مواقع المباني الموجودة بالفعل لازم تتحسب "محجوزة" كمان عشان أي مبنى
    // جديد مايتحطش فوقها بالغلط (freshBuildings.occupied لوحدها متعرفش
    // عن مواقع المباني الحقيقية الموجودة أصلًا لو كانت مختلفة عن التوليد
    // الجديد).
    for (const b of castle.buildings) {
      occupied.add(`${b.position.x},${b.position.y}`);
    }

    for (const key of missingKeys) {
      let toAdd = freshBuildings.find((b) => b.key === key);
      // ====== لو مكان المبنى الجديد (من التوليد الجديد) وقع فوق مبنى
      // موجود بالفعل (احتمال نادر لكن ممكن)، بندور على أي خانة فاضية
      // تانية على نفس الشبكة 8x8 بدل ما نتخطى المبنى بالكامل. ======
      if (toAdd) {
        // ====== بنتأكد من مواقع المباني الحقيقية الموجودة فعليًا (مش
        // occupied/existingKeys - دي بترجع مفاتيح مباني زي 'town_hall'،
        // مش مواقع) عشان مبنى جديد مايتحطش فوق مبنى قديم بالغلط. ======
        const alreadyThere = castle.buildings.some(
          (b) => b.position.x === toAdd.position.x && b.position.y === toAdd.position.y
        );
        if (alreadyThere) toAdd = null;
      }
      if (!toAdd) {
        let placed = null;
        for (let x = 0; x < 8 && !placed; x += 1) {
          for (let y = 0; y < 8 && !placed; y += 1) {
            const k = `${x},${y}`;
            if (!occupied.has(k)) placed = { x, y };
          }
        }
        if (!placed) continue; // مفيش خانة فاضية خالص (نظريًا مستحيل مع 8 مباني بس فوق 64 خانة)
        occupied.add(`${placed.x},${placed.y}`);
        const cfg = BUILDING_TYPES[key];
        const cap = Math.max(1, Math.min(cfg.max_level, townHallLevel));
        const low = Math.max(1, Math.floor(cap * 0.35));
        const level = low + Math.floor(rand() * (cap - low + 1));
        toAdd = { key, level, position: placed };
      }

      castle.buildings.push(toAdd);
      addedBuildingCount += 1;
    }

    await castle.save();
    updatedCount += 1;
    console.log(
      `[Backfill] castle ${castle._id} (${castle.npc_name || 'NPC'}) -> added [${missingKeys.join(', ')}]`
    );
  }

  console.log(
    `[Backfill] تم - ${updatedCount} قلعة NPC اتحدّثت، ${addedBuildingCount} مبنى اتضاف إجمالًا.`
  );
  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error('[Backfill] فشل السكربت:', err.message);
  process.exit(1);
});
