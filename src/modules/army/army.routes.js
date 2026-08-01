const express = require('express');
const { protect } = require('../../middleware/auth.middleware');

const formationController = require('./formation.controller');
const battlePlannerController = require('./battlePlanner.controller');

const router = express.Router();

// ====== قوايم القيم الثابتة (Reference Data) - لازم تتحط قبل أي راوت فيه
// :id عشان مفيش أي احتمال تصادم (نفس فلسفة /structure-types في
// defense.routes.js). ======
router.get('/formation-types', protect, formationController.listFormationTypes);
router.get('/target-types', protect, battlePlannerController.listTargetTypes);
router.get('/retreat-condition-types', protect, battlePlannerController.listRetreatConditionTypes);
router.get('/retreat-actions', protect, battlePlannerController.listRetreatActions);
router.get('/protection-rule-types', protect, battlePlannerController.listProtectionRuleTypes);
router.get('/commander-preference-options', protect, battlePlannerController.listCommanderPreferenceOptions);
router.get('/plan-statuses', protect, battlePlannerController.listPlanStatuses);
router.get('/formation-lines', protect, battlePlannerController.listFormationLines);
router.get('/target-priority-types', protect, battlePlannerController.listTargetPriorityTypes);
router.get('/strategic-retreat-rule-types', protect, battlePlannerController.listStrategicRetreatRuleTypes);
router.get('/strategic-protection-rule-types', protect, battlePlannerController.listStrategicProtectionRuleTypes);

// ====== إدارة الجيش (Army Management) - تشكيلات جيش اللاعب ======
router.get('/formations', protect, formationController.listFormations);
router.post('/formations', protect, formationController.createFormation);
router.get('/formations/:id', protect, formationController.getFormation);
router.put('/formations/:id', protect, formationController.updateFormation);
router.delete('/formations/:id', protect, formationController.deleteFormation);

router.post('/formations/:id/select', protect, formationController.selectFormation);
router.post('/formations/:id/unselect', protect, formationController.unselectFormation);
router.put('/formations/:id/commanders', protect, formationController.assignCommanders);

// ====== مخطط المعارك (Battle Planner 2.0) - الطبقة الاستراتيجية فوق الـ
// Rule Engine: تشكيلة + أولويات أهداف + قواعد انسحاب + قواعد حماية +
// تفضيلات قادة. /battle-plans/default لازم يتحط قبل /battle-plans/:id
// عشان "default" متتفسّرش غلط كـ :id. ======
router.get('/battle-plans', protect, battlePlannerController.listPlans);
router.post('/battle-plans', protect, battlePlannerController.createPlan);
router.get('/battle-plans/default', protect, battlePlannerController.getDefaultPlan);
router.get('/battle-plans/:id', protect, battlePlannerController.getPlan);
router.put('/battle-plans/:id', protect, battlePlannerController.updatePlan);
router.delete('/battle-plans/:id', protect, battlePlannerController.deletePlan);
router.post('/battle-plans/:id/set-default', protect, battlePlannerController.setDefaultPlan);
router.post('/battle-plans/:id/validate', protect, battlePlannerController.validatePlan);

// ====== نظام التشكيل التكتيكي للمعركة (Battle Formation System) - توزيع
// مجموعات القوات على خطوط المعركة (Front/Middle/Back Line) جوه خطة معيّنة.
// تخزين + تحقق + APIs بس - مفيش أي تنفيذ فعلي للتشكيل هنا (لسه). ======
router.get('/battle-plans/:id/formation', protect, battlePlannerController.getFormation);
router.put('/battle-plans/:id/formation', protect, battlePlannerController.setFormation);
router.post('/battle-plans/:id/formation/assign', protect, battlePlannerController.assignTroopToSlot);
router.post('/battle-plans/:id/formation/clear', protect, battlePlannerController.clearFormationSlot);

// ====== الإعداد الاستراتيجي (Battle Strategy - Strategic Configuration) -
// أولوية استهداف + قواعد انسحاب + قواعد حماية + تفضيل قائد جوه خطة معيّنة.
// تخزين + تحقق + APIs بس - مفيش أي تنفيذ فعلي أو تشبيك مع Rule Engine هنا. ======
router.get('/battle-plans/:id/strategy', protect, battlePlannerController.getStrategyConfig);
router.put('/battle-plans/:id/strategy', protect, battlePlannerController.setStrategyConfig);
router.patch('/battle-plans/:id/strategy', protect, battlePlannerController.updateStrategyConfig);

module.exports = router;
