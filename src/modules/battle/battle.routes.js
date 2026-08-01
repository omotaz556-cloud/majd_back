const express = require('express');
const { protect } = require('../../middleware/auth.middleware');
const {
  createBattle,
  getBattle,
  getBattleByMarch,
  startBattle,
  listMyBattles,
  updateBattleStatus,
  updateBattleState,
  issueBattleCommand,
  cancelBattle,
} = require('./battle.controller');

const router = express.Router();

// ====== راوتات حرفية (literal) زي /me في castle.routes - لازم تتحط قبل أي
// راوت فيه :battleId عشان مفيش أي احتمال تصادم. ======
router.get('/', protect, listMyBattles);
router.post('/', protect, createBattle);

// ====== استرجاع المعركة عن طريق march_id - راوت حرفي (/by-march/...) برضه،
// لازم يتحط قبل /:battleId عشان "by-march" ميتفسرش غلط كـ battleId. ======
router.get('/by-march/:marchId', protect, getBattleByMarch);

// ====== Battle Reports removal - راوت /history (سجل المعارك) اتشال بالكامل.
// تقرير أي معركة منتهية بقى بيوصل كرسالة بريد كاملة بدل endpoint منفصل. ======

router.get('/:battleId', protect, getBattle);
// ====== يبدأ تشغيل المعركة فعليًا (Simulation/Rule/Combat Engines) - دي
// نقطة الدخول اللي المفروض "لما المسير يوصل، ابدأ المعركة تلقائيًا" تنادي
// عليها. راجع battle.controller.startBattle/battle.runner.startBattleRunner. ======
router.post('/:battleId/start', protect, startBattle);
router.post('/:battleId/status', protect, updateBattleStatus);
router.post('/:battleId/state', protect, updateBattleState);
// ====== Phase 2: قناة الأوامر الحية - راجع issueBattleCommand في
// battle.controller.js لتفاصيل الصلاحيات وشكل الـ body. ======
router.post('/:battleId/command', protect, issueBattleCommand);
router.post('/:battleId/cancel', protect, cancelBattle);

module.exports = router;
