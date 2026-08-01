const express = require('express');
const { protect, authorize } = require('../../middleware/auth.middleware');
const { reportClientRevenue, stats, listEvents } = require('./adRevenue.controller');

// ====== راوتر التطبيق (اللاعب مسجل دخول) ======
// بينادى عليه الفرونت إند نفسه وقت حدث دفع من Google Ad Manager (GPT) - مختلف تماماً عن
// /ads/ssv (اللي جوجل بتنادي عليه مباشرة للمكافآت). هنا بنسجل الإيراد الحقيقي.
const clientRouter = express.Router();
clientRouter.post('/revenue-event', protect, reportClientRevenue);

// ====== راوتر الأدمن ======
const adminRouter = express.Router();
adminRouter.use(protect, authorize('admin'));
adminRouter.get('/stats', stats);
adminRouter.get('/events', listEvents);

module.exports = { clientRouter, adminRouter };