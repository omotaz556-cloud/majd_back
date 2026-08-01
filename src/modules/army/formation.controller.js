const formationService = require('./formation.service');
const { FORMATION_TYPES, MARCH_TYPES } = require('./army.config');

// ====== بيحوّل مستند تشكيلة من الموديل لشكل جاهز للعرض - مفيش أي حساب
// إضافي هنا (نفس فلسفة formatStructure في defense.controller.js). ======
function formatFormation(formation) {
  return {
    id: formation._id,
    formation_id: formation.formation_id,
    name: formation.name,
    troops: formation.troops,
    commanders: formation.commanders,
    march_type: formation.march_type,
    movement_speed: formation.movement_speed,
    load_capacity: formation.load_capacity,
    formation_type: formation.formation_type,
    active_skills: formation.active_skills,
    is_selected: formation.is_selected,
    notes: formation.notes,
    created_at: formation.created_at,
    updated_at: formation.updated_at,
  };
}

async function listFormations(req, res) {
  try {
    const formations = await formationService.listFormations(req.user._id);
    return res.json({ formations: formations.map(formatFormation) });
  } catch (err) {
    console.error('[Army] listFormations error:', err.message);
    return res.status(500).json({ error: 'تعذر تحميل التشكيلات' });
  }
}

async function getFormation(req, res) {
  try {
    const formation = await formationService.getFormationById(req.user._id, req.params.id);
    return res.json({ formation: formatFormation(formation) });
  } catch (err) {
    return res.status(404).json({ error: err.message || 'التشكيلة دي مش موجودة' });
  }
}

async function createFormation(req, res) {
  try {
    const formation = await formationService.createFormation(req.user._id, req.body || {});
    return res.status(201).json({ formation: formatFormation(formation) });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'تعذر إنشاء التشكيلة' });
  }
}

async function updateFormation(req, res) {
  try {
    const formation = await formationService.updateFormation(req.user._id, req.params.id, req.body || {});
    return res.json({ formation: formatFormation(formation) });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'تعذر تعديل التشكيلة' });
  }
}

async function deleteFormation(req, res) {
  try {
    const result = await formationService.deleteFormation(req.user._id, req.params.id);
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message || 'تعذر حذف التشكيلة' });
  }
}

async function selectFormation(req, res) {
  try {
    const formation = await formationService.selectFormation(req.user._id, req.params.id);
    return res.json({ formation: formatFormation(formation) });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'تعذر اختيار التشكيلة' });
  }
}

async function unselectFormation(req, res) {
  try {
    const formation = await formationService.unselectFormation(req.user._id, req.params.id);
    return res.json({ formation: formatFormation(formation) });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'تعذر إلغاء اختيار التشكيلة' });
  }
}

async function assignCommanders(req, res) {
  try {
    const { primary, secondary } = req.body || {};
    const formation = await formationService.assignCommanders(req.user._id, req.params.id, { primary, secondary });
    return res.json({ formation: formatFormation(formation) });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'تعذر تعيين القادة' });
  }
}

// ====== قايمة أنواع التشكيلات/المسير المتاحة - مفيدة للفرونت إند عشان
// يعرض الخيارات من غير ما يكرر الـ enum بتاعها يدوي في الواجهة. ======
function listFormationTypes(req, res) {
  return res.json({
    formation_types: Object.values(FORMATION_TYPES),
    march_types: Object.values(MARCH_TYPES),
  });
}

module.exports = {
  listFormations,
  getFormation,
  createFormation,
  updateFormation,
  deleteFormation,
  selectFormation,
  unselectFormation,
  assignCommanders,
  listFormationTypes,
};
