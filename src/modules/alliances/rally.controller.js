const rallyService = require('./rally.service');

// ====== إنشاء تجمّع جديد - قائد/ضابط بس. body: {target_castle_id,
// countdown_seconds, battle_plan_id?} - battle_plan_id هي خطة المعركة
// الرسمية بتاعة التجمّع (Phase 15، اختيارية). ======
async function createRally(req, res) {
  try {
    const {
      target_castle_id: targetCastleId,
      countdown_seconds: countdownSeconds,
      battle_plan_id: battlePlanId,
    } = req.body || {};
    const rally = await rallyService.createRally(req.user._id, { targetCastleId, countdownSeconds, battlePlanId });
    return res.status(201).json({ rally });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

// ====== انضمام لتجمّع بجزء من جيشك + مساهمتك الشخصية - body: {troops:
// [{key, quantity}], heroes?, research?, buffs?, battle_plan_id?} (الحقول
// غير troops كلها اختيارية - Phase 15). ======
async function joinRally(req, res) {
  try {
    const { rallyId } = req.params;
    const { troops, heroes, research, buffs, battle_plan_id: battlePlanId } = req.body || {};
    const rally = await rallyService.joinRally(req.user._id, rallyId, troops, { heroes, research, buffs, battlePlanId });
    return res.status(201).json({ rally });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

// ====== سيب تجمّع - وحداتك بترجع فورًا لقلعتك ======
async function leaveRally(req, res) {
  try {
    const { rallyId } = req.params;
    const rally = await rallyService.leaveRally(req.user._id, rallyId);
    return res.json({ rally });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

// ====== إلغاء تجمّع كامل - قائد/ضابط بس، بيرجّع جنود كل المشاركين ======
async function cancelRally(req, res) {
  try {
    const { rallyId } = req.params;
    const rally = await rallyService.cancelRally(req.user._id, rallyId);
    return res.json({ rally });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

// ====== حالة تجمّع واحد (العد التنازلي المتبقي، المشاركين، أو التقرير لو
// اتحسم بالفعل) ======
async function getRallyStatus(req, res) {
  try {
    const { rallyId } = req.params;
    const rally = await rallyService.getRallyStatus(req.user._id, rallyId);
    return res.json({ rally });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

// ====== كل تجمّعات تحالفي (شغالة + آخر تجمّعات اتحسمت/اتلغت) ======
async function listMyAllianceRallies(req, res) {
  try {
    const rallies = await rallyService.listMyAllianceRallies(req.user._id);
    return res.json({ rallies });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

module.exports = {
  createRally,
  joinRally,
  leaveRally,
  cancelRally,
  getRallyStatus,
  listMyAllianceRallies,
};
