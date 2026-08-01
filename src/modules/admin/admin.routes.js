const express = require('express');
const { protect, authorize } = require('../../middleware/auth.middleware');
const {
  listUsers,
  setUserStatus,
  getUserDetail,
  updateUserRole,
  getRevenueStats,
  getOverviewStats,
  listTransactions,
  getTransaction,
  reverseTransaction,
  listPackages,
  createPackage,
  updatePackage,
  deletePackage,
  getReportsSummary,
  getZakatReport,
  creditPlayer,
  debitPlayer,
  grantBonus,
  updatePlayerProfile,
  getPlayerAuditLog,
  listAdminAuditLog,
} = require('./admin.controller');

const router = express.Router();

// كل الـ routes هنا لازم تكون protected + admin role بس، مفيش أي استثناء
router.use(protect, authorize('admin'));

// إدارة المستخدمين
router.get('/users', listUsers);
router.get('/users/:userId', getUserDetail);
router.patch('/users/:userId/status', setUserStatus);
router.patch('/users/:userId/role', updateUserRole);

// إدارة رصيد اللاعبين (Player Management) - كل عملية بتمر بـ wallet.service.js
// وبتتسجل في الـ ledger + الـ audit log، مش موجودة في أي API عامة
router.post('/players/:userId/wallet/credit', creditPlayer);
router.post('/players/:userId/wallet/debit', debitPlayer);
router.post('/players/:userId/wallet/bonus', grantBonus);
router.patch('/players/:userId/profile', updatePlayerProfile);
router.get('/players/:userId/audit-log', getPlayerAuditLog);

// سجل تدقيق عام لكل الإجراءات الإدارية (فلترة اختيارية حسب الأدمن/نوع الإجراء)
router.get('/audit-log', listAdminAuditLog);

// مراقبة الأرباح والإحصائيات
router.get('/stats/overview', getOverviewStats);
router.get('/stats/revenue', getRevenueStats);
router.get('/reports/summary', getReportsSummary);
// تقرير الوعاء الزكوي: ?as_of=2026-12-31 (افتراضياً الآن لو مش مبعوت)
router.get('/reports/zakat', getZakatReport);

// إدارة المعاملات (Transactions)
router.get('/transactions', listTransactions);
router.get('/transactions/:transactionId', getTransaction);
router.post('/transactions/:transactionId/reverse', reverseTransaction);

// إدارة باقات وأسعار الـ Coins
router.get('/coin-packages', listPackages);
router.post('/coin-packages', createPackage);
router.patch('/coin-packages/:packageId', updatePackage);
router.delete('/coin-packages/:packageId', deletePackage);

module.exports = router;