const battlePlannerService = require('./battlePlanner.service');
const {
  BATTLE_TARGET_TYPES,
  RETREAT_CONDITION_TYPES,
  RETREAT_ACTIONS,
  PROTECTION_RULE_TYPES,
  COMMANDER_PREFERENCE_MODES,
  COMMANDER_ROLE_PREFERENCES,
  BATTLE_PLAN_STATUS,
} = require('./army.config');

function formatPlan(plan) {
  return {
    id: plan._id,
    plan_id: plan.plan_id,
    name: plan.name,
    is_default: plan.is_default,
    status: plan.status,
    assigned_formation_id: plan.assigned_formation_id,
    target_priorities: [...plan.target_priorities].sort((a, b) => a.priority - b.priority),
    retreat_rules: plan.retreat_rules,
    protection_rules: plan.protection_rules,
    commander_preferences: plan.commander_preferences,
    battle_formation: plan.battle_formation,
    strategy_config: plan.strategy_config,
    metadata: plan.metadata,
    last_validation: plan.last_validation,
    notes: plan.notes,
    created_at: plan.created_at,
    updated_at: plan.updated_at,
  };
}

async function listPlans(req, res) {
  try {
    const plans = await battlePlannerService.listPlans(req.user._id);
    return res.json({ battle_plans: plans.map(formatPlan) });
  } catch (err) {
    console.error('[Army] listPlans error:', err.message);
    return res.status(500).json({ error: 'تعذر تحميل خطط المعارك' });
  }
}

async function getDefaultPlan(req, res) {
  try {
    const plan = await battlePlannerService.getDefaultPlan(req.user._id);
    return res.json({ battle_plan: plan ? formatPlan(plan) : null });
  } catch (err) {
    console.error('[Army] getDefaultPlan error:', err.message);
    return res.status(500).json({ error: 'تعذر تحميل خطة المعركة الافتراضية' });
  }
}

async function getPlan(req, res) {
  try {
    const plan = await battlePlannerService.getPlanById(req.user._id, req.params.id);
    return res.json({ battle_plan: formatPlan(plan) });
  } catch (err) {
    return res.status(404).json({ error: err.message || 'خطة المعركة دي مش موجودة' });
  }
}

async function createPlan(req, res) {
  try {
    const plan = await battlePlannerService.createPlan(req.user._id, req.body || {});
    return res.status(201).json({ battle_plan: formatPlan(plan) });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'تعذر إنشاء خطة المعركة' });
  }
}

async function updatePlan(req, res) {
  try {
    const plan = await battlePlannerService.updatePlan(req.user._id, req.params.id, req.body || {});
    return res.json({ battle_plan: formatPlan(plan) });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'تعذر تعديل خطة المعركة' });
  }
}

async function deletePlan(req, res) {
  try {
    const result = await battlePlannerService.deletePlan(req.user._id, req.params.id);
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message || 'تعذر حذف خطة المعركة' });
  }
}

async function setDefaultPlan(req, res) {
  try {
    const plan = await battlePlannerService.setDefaultPlan(req.user._id, req.params.id);
    return res.json({ battle_plan: formatPlan(plan) });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'تعذر تعيين الخطة كافتراضية' });
  }
}

async function validatePlan(req, res) {
  try {
    const result = await battlePlannerService.validatePlan(req.user._id, req.params.id);
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message || 'تعذر التحقق من خطة المعركة' });
  }
}

// =============================================================================
// نظام التشكيل التكتيكي للمعركة (Battle Formation System) - Front/Middle/Back
// Line. تخزين + تحقق + APIs بس - مفيش أي تنفيذ فعلي للتشكيل هنا خالص.
// =============================================================================

async function getFormation(req, res) {
  try {
    const battle_formation = await battlePlannerService.getFormation(req.user._id, req.params.id);
    return res.json({ battle_formation });
  } catch (err) {
    return res.status(404).json({ error: err.message || 'خطة المعركة دي مش موجودة' });
  }
}

async function setFormation(req, res) {
  try {
    const { battle_formation } = req.body || {};
    const plan = await battlePlannerService.setFormation(req.user._id, req.params.id, battle_formation);
    return res.json({ battle_formation: plan.battle_formation });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'تعذر حفظ التشكيل التكتيكي' });
  }
}

async function assignTroopToSlot(req, res) {
  try {
    const { line, slot_index, troop_key } = req.body || {};
    const plan = await battlePlannerService.assignTroopToSlot(req.user._id, req.params.id, {
      line,
      slot_index,
      troop_key,
    });
    return res.json({ battle_formation: plan.battle_formation });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'تعذر تعيين مجموعة القوات في الخانة' });
  }
}

async function clearFormationSlot(req, res) {
  try {
    const { line, slot_index } = req.body || {};
    const plan = await battlePlannerService.clearFormationSlot(req.user._id, req.params.id, { line, slot_index });
    return res.json({ battle_formation: plan.battle_formation });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'تعذر تفريغ الخانة' });
  }
}

function listFormationLines(req, res) {
  return res.json({ formation_lines: battlePlannerService.listFormationLines() });
}

// =============================================================================
// الإعداد الاستراتيجي (Battle Strategy - Strategic Configuration) - أولوية
// استهداف + قواعد انسحاب + قواعد حماية + تفضيل قائد. تخزين + تحقق + APIs بس -
// مفيش أي تنفيذ فعلي أو تشبيك مع Rule Engine هنا خالص.
// =============================================================================

async function getStrategyConfig(req, res) {
  try {
    const strategy_config = await battlePlannerService.getStrategyConfig(req.user._id, req.params.id);
    return res.json({ strategy_config });
  } catch (err) {
    return res.status(404).json({ error: err.message || 'خطة المعركة دي مش موجودة' });
  }
}

async function updateStrategyConfig(req, res) {
  try {
    const plan = await battlePlannerService.updateStrategyConfig(req.user._id, req.params.id, req.body || {});
    return res.json({ strategy_config: plan.strategy_config });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'تعذر تحديث الإعداد الاستراتيجي' });
  }
}

async function setStrategyConfig(req, res) {
  try {
    const plan = await battlePlannerService.setStrategyConfig(req.user._id, req.params.id, req.body || {});
    return res.json({ strategy_config: plan.strategy_config });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'تعذر حفظ الإعداد الاستراتيجي' });
  }
}

function listTargetPriorityTypes(req, res) {
  return res.json({ target_priority_types: battlePlannerService.listTargetPriorityTypes() });
}

function listStrategicRetreatRuleTypes(req, res) {
  return res.json({ strategic_retreat_rule_types: battlePlannerService.listStrategicRetreatRuleTypes() });
}

function listStrategicProtectionRuleTypes(req, res) {
  return res.json({ strategic_protection_rule_types: battlePlannerService.listStrategicProtectionRuleTypes() });
}

// ====== قوايم القيم الثابتة (Reference Data) - مفيدة للفرونت إند عشان يبني
// قوايم منسدلة (dropdowns) في واجهة المخطط من غير ما يكرر الـ enums يدوي. ======
function listTargetTypes(req, res) {
  return res.json({ target_types: Object.values(BATTLE_TARGET_TYPES) });
}

function listRetreatConditionTypes(req, res) {
  return res.json({ retreat_condition_types: Object.values(RETREAT_CONDITION_TYPES) });
}

function listRetreatActions(req, res) {
  return res.json({ retreat_actions: Object.values(RETREAT_ACTIONS) });
}

function listProtectionRuleTypes(req, res) {
  return res.json({ protection_rule_types: Object.values(PROTECTION_RULE_TYPES) });
}

function listCommanderPreferenceOptions(req, res) {
  return res.json({
    assignment_modes: Object.values(COMMANDER_PREFERENCE_MODES),
    role_preferences: Object.values(COMMANDER_ROLE_PREFERENCES),
  });
}

function listPlanStatuses(req, res) {
  return res.json({ statuses: Object.values(BATTLE_PLAN_STATUS) });
}

module.exports = {
  listPlans,
  getDefaultPlan,
  getPlan,
  createPlan,
  updatePlan,
  deletePlan,
  setDefaultPlan,
  validatePlan,
  getFormation,
  setFormation,
  assignTroopToSlot,
  clearFormationSlot,
  listFormationLines,
  getStrategyConfig,
  updateStrategyConfig,
  setStrategyConfig,
  listTargetPriorityTypes,
  listStrategicRetreatRuleTypes,
  listStrategicProtectionRuleTypes,
  listTargetTypes,
  listRetreatConditionTypes,
  listRetreatActions,
  listProtectionRuleTypes,
  listCommanderPreferenceOptions,
  listPlanStatuses,
};
