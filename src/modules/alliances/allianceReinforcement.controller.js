const allianceReinforcementService = require('./allianceReinforcement.service');
const { TROOP_TYPES } = require('../castle/castle.config');

// ====== بيحوّل كومة وحدات (troops snapshot) لشكل جاهز للعرض - نفس
// formatTroopStacks بتاعة march.controller.js بالظبط. ======
function formatTroopStacks(stacks) {
  return (stacks || []).map((s) => ({
    key: s.key,
    name: TROOP_TYPES[s.key]?.name || s.key,
    count: s.count,
  }));
}

// ====== *** فيكس Bug 1 (Recall reinforcement -> Cast to ObjectId failed) ***
// السبب الحقيقي: الكونترولر ده كان بيرجّع مستندات Mongoose خام في الـ JSON
// (res.json({ reinforcements }))، ومستند Mongoose خام لما يتحول JSON بيرجع
// حقل _id بس - مفيش حقل id افتراضيًا (الـ id virtual مش متضمّن في toJSON
// إلا لو فُعّل صريح). الفرونت إند (AllianceReinforcementsTab.jsx/
// ReinforcementCard.jsx) بيستخدم reinforcement.id في كل حتة - يعني كان
// دايمًا undefined، فـ recallReinforcement(undefined) كان بيوصل للباك إند
// ويعمل AllianceReinforcement.findById("undefined") -> Cast to ObjectId
// failed for value "undefined". الحل: نفس فلسفة formatMarch في
// march.controller.js - نحوّل كل مستند لشكل عرض واضح فيه id حقيقي (string)
// قبل ما نرجعه في أي response. ======
function formatReinforcement(reinforcement) {
  if (!reinforcement) return null;
  return {
    id: reinforcement._id.toString(),
    alliance_id: reinforcement.alliance_id ? reinforcement.alliance_id.toString() : null,
    origin_user_id: reinforcement.origin_user_id,
    origin_castle_id: reinforcement.origin_castle_id,
    target_user_id: reinforcement.target_user_id,
    target_castle_id: reinforcement.target_castle_id,
    status: reinforcement.status,
    troops: formatTroopStacks(reinforcement.troops),
    stationed_at: reinforcement.stationed_at,
    recalled_at: reinforcement.recalled_at,
    recalled_reason: reinforcement.recalled_reason,
  };
}

// ====== إرسال تعزيزات لقلعة عضو تاني في نفس تحالفك - body: {target_castle_id,
// troops: [{key, quantity}]}. نفس شكل body بتاع بدء مسير هجوم عادي
// (march.controller startMarch) - نفس منطق الفحص والخصم (march.service
// startMarch/sendReinforcement). ======
async function sendReinforcement(req, res) {
  try {
    const { target_castle_id: targetCastleId, troops } = req.body || {};
    const result = await allianceReinforcementService.sendReinforcement(req.user._id, targetCastleId, troops);
    return res.status(201).json({ castle: result.castle, march: result.march });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

// ====== سحب تعزيز واقف - المرسِل الأصلي بس هو اللي يقدر يعمل كده ======
async function recallReinforcement(req, res) {
  try {
    const { reinforcementId } = req.params;
    const result = await allianceReinforcementService.recallReinforcement(req.user._id, reinforcementId, 'manual');
    return res.json({ reinforcement: formatReinforcement(result.reinforcement), march: result.march });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

// ====== تعزيزاتي اللي بعتها ولسه واقفة عند حلفائي ======
async function listOutgoing(req, res) {
  try {
    const reinforcements = await allianceReinforcementService.listOutgoing(req.user._id);
    return res.json({ reinforcements: reinforcements.map(formatReinforcement) });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

// ====== التعزيزات الواقفة في قلعتي دلوقتي (بعتهالي حلفائي) ======
async function listIncoming(req, res) {
  try {
    const reinforcements = await allianceReinforcementService.listIncoming(req.user._id);
    return res.json({ reinforcements: reinforcements.map(formatReinforcement) });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

module.exports = {
  sendReinforcement,
  recallReinforcement,
  listOutgoing,
  listIncoming,
};
