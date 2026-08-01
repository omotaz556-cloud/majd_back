const express = require('express');
const { protect } = require('../../middleware/auth.middleware');
const { getMyBattleStats } = require('./battleConsequences.controller');

const router = express.Router();

// ====== Phase 6: إحصائيات المعارك التراكمية بتاعة اللاعب الحالي (Total
// Battles/Victories/Defeats/Troops Lost/Troops Killed/Resources Looted/
// Resources Lost) - راجع battleStats.model.js. مسار منفصل تمامًا عن
// /api/battles (battle.routes.js) عشان محدش يحتاج يعدّل الراوت الموجود أو
// يخلط بين "معركة واحدة" و"إحصائيات كل المعارك". ======
router.get('/me', protect, getMyBattleStats);

module.exports = router;
