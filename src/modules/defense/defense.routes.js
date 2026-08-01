const express = require('express');
const { protect } = require('../../middleware/auth.middleware');
const {
  getDefenseOverview,
  viewDefense,
  listStructureTypes,
  addStructure,
  upgradeStructure,
  speedupStructureUpgrade,
  repairStructure,
  reportDamage,
  setGateState,
  removeStructure,
  moveStructure,
  getLayout,
  getWallLayout,
  setWallLayout,
  addWallSegment,
  removeWallSegment,
  assignGarrison,
  disbandGarrison,
  listGarrisons,
  reserveArmy,
  listReservedArmy,
  getDefensePlan,
  setDefensePlan,
} = require('./defense.controller');

const router = express.Router();

// ====== نظرة عامة كاملة على دفاع القلعة (بيتستخدم بالذات في مشهد إدارة
// الدفاع في الفرونت إند) - لازم تتحط قبل أي راوت حرفي تاني زي /me في
// castle.routes، مفيش تعارض هنا أصلًا لأن كل الراوتات التانية لها segment
// إضافي واضح. ======
router.get('/', protect, getDefenseOverview);
router.get('/structure-types', protect, listStructureTypes);

// ====== عرض قطع دفاع أي قلعة تانية (Read-only) - نفس فلسفة
// /castle/:id/view بالظبط: لازم تتحط قبل أي راوت حرفي زي "/" فوق مفيش
// تعارض هنا أصلًا (كل الراوتات التانية جوه الملف ده لها segment إضافي
// واضح زي structure-types/wall-layout...، مفيش /:id عام على الجذر). أي حد
// مسجّل دخول (protect) يقدر يشوفها - مفيش قيد ملكية هنا عمدًا (زي
// getCastleView بالظبط)، القيد الوحيد الفعلي هو نطاق رؤية /castle/nearby
// اللي بيحدد أصلًا أي قلعة تبان كماركر قابل للضغط. ======
router.get('/view/:castleId', protect, viewDefense);

// ====== المباني الدفاعية (القطع الموحّدة: أسوار/بوابات/أبراج/فخاخ/متاريس) ======
router.post('/structures', protect, addStructure);
router.post('/structures/:id/upgrade', protect, upgradeStructure);
router.post('/structures/:id/upgrade/speedup', protect, speedupStructureUpgrade);
router.post('/structures/:id/repair', protect, repairStructure);
router.post('/structures/:id/damage', protect, reportDamage);
router.post('/structures/:id/gate-state', protect, setGateState);
router.post('/structures/:id/move', protect, moveStructure);
router.delete('/structures/:id', protect, removeStructure);

// ====== التخطيط الدفاعي (مواقع الأبراج/البوابات/الفخاخ/المباني الدفاعية
// مجمّعة بالفئة) ======
router.get('/layout', protect, getLayout);

// ====== محرر الأسوار (تخزين الشكل الهندسي بس - مفيش واجهة تحرير هنا) ======
router.get('/wall-layout', protect, getWallLayout);
router.put('/wall-layout', protect, setWallLayout);
router.post('/wall-layout/segments', protect, addWallSegment);
router.delete('/wall-layout/segments/:id', protect, removeWallSegment);

// ====== الحاميات (تعيين جيش لموقع دفاعي بعينه) ======
router.get('/garrisons', protect, listGarrisons);
router.post('/garrisons', protect, assignGarrison);
router.delete('/garrisons/:id', protect, disbandGarrison);

// ====== الجيش الاحتياطي المخصص للدفاع (مينفعش يخرج في مسير هجوم) ======
router.get('/reserved-army', protect, listReservedArmy);
router.put('/reserved-army', protect, reserveArmy);

// ====== خطة الدفاع (تخزين إعدادات بس - مفيش تنفيذ آلي لسه) ======
router.get('/plan', protect, getDefensePlan);
router.put('/plan', protect, setDefensePlan);

module.exports = router;