const adminService = require('./admin.service');

async function listUsers(req, res) {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const skip = Math.max(parseInt(req.query.skip) || 0, 0);
    const { role, is_active, search } = req.query;

    const filters = { limit, skip, search };
    if (role) filters.role = role;
    if (is_active !== undefined) filters.isActive = is_active === 'true';

    const { users, total } = await adminService.listUsers(filters);

    return res.json({ users, total, limit, skip });
  } catch (err) {
    console.error('[Admin] listUsers error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch users' });
  }
}

async function setUserStatus(req, res) {
  try {
    const { userId } = req.params;
    const { is_active } = req.body;

    if (typeof is_active !== 'boolean') {
      return res.status(400).json({ error: 'is_active must be a boolean' });
    }

    const user = await adminService.setUserStatus(userId, is_active);
    return res.json({ user });
  } catch (err) {
    console.error('[Admin] setUserStatus error:', err.message);
    return res.status(400).json({ error: err.message });
  }
}

async function getUserDetail(req, res) {
  try {
    const { userId } = req.params;
    const detail = await adminService.getUserDetail(userId);
    return res.json(detail);
  } catch (err) {
    console.error('[Admin] getUserDetail error:', err.message);
    return res.status(404).json({ error: err.message });
  }
}

async function updateUserRole(req, res) {
  try {
    const { userId } = req.params;
    const { role } = req.body;
    const user = await adminService.updateUserRole(userId, role, req.user._id);
    return res.json({ user });
  } catch (err) {
    console.error('[Admin] updateUserRole error:', err.message);
    return res.status(400).json({ error: err.message });
  }
}

async function getRevenueStats(req, res) {
  try {
    const { from, to } = req.query;
    const stats = await adminService.getRevenueStats({ from, to });
    return res.json(stats);
  } catch (err) {
    console.error('[Admin] getRevenueStats error:', err.message);
    return res.status(400).json({ error: err.message });
  }
}

async function getOverviewStats(req, res) {
  try {
    const stats = await adminService.getOverviewStats();
    return res.json(stats);
  } catch (err) {
    console.error('[Admin] getOverviewStats error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch overview stats' });
  }
}

async function listTransactions(req, res) {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const skip = Math.max(parseInt(req.query.skip) || 0, 0);
    const { user_id: userId, type, status, from, to } = req.query;

    const { transactions, total } = await adminService.listTransactions({
      userId,
      type,
      status,
      from,
      to,
      limit,
      skip,
    });

    return res.json({ transactions, total, limit, skip });
  } catch (err) {
    console.error('[Admin] listTransactions error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch transactions' });
  }
}

async function getTransaction(req, res) {
  try {
    const transaction = await adminService.getTransactionById(req.params.transactionId);
    return res.json({ transaction });
  } catch (err) {
    console.error('[Admin] getTransaction error:', err.message);
    return res.status(404).json({ error: err.message });
  }
}

async function reverseTransaction(req, res) {
  try {
    const { reason } = req.body;
    const result = await adminService.reverseTransaction(req.params.transactionId, req.user._id, reason);
    return res.json(result);
  } catch (err) {
    console.error('[Admin] reverseTransaction error:', err.message);
    return res.status(400).json({ error: err.message });
  }
}

async function listPackages(req, res) {
  try {
    const packages = await adminService.listAllPackages();
    return res.json({ packages });
  } catch (err) {
    console.error('[Admin] listPackages error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch coin packages' });
  }
}

async function createPackage(req, res) {
  try {
    const pkg = await adminService.createPackage(req.body);
    return res.status(201).json({ package: pkg });
  } catch (err) {
    console.error('[Admin] createPackage error:', err.message);
    return res.status(400).json({ error: err.message });
  }
}

async function updatePackage(req, res) {
  try {
    const pkg = await adminService.updatePackage(req.params.packageId, req.body);
    return res.json({ package: pkg });
  } catch (err) {
    console.error('[Admin] updatePackage error:', err.message);
    return res.status(400).json({ error: err.message });
  }
}

async function deletePackage(req, res) {
  try {
    await adminService.deletePackage(req.params.packageId);
    return res.json({ deleted: true });
  } catch (err) {
    console.error('[Admin] deletePackage error:', err.message);
    return res.status(400).json({ error: err.message });
  }
}

async function getReportsSummary(req, res) {
  try {
    const days = Math.min(parseInt(req.query.days) || 14, 90);
    const summary = await adminService.getReportsSummary({ days });
    return res.json(summary);
  } catch (err) {
    console.error('[Admin] getReportsSummary error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch reports summary' });
  }
}

async function getZakatReport(req, res) {
  try {
    const { as_of: asOf } = req.query;
    const report = await adminService.getZakatReport({ asOf });
    return res.json(report);
  } catch (err) {
    console.error('[Admin] getZakatReport error:', err.message);
    return res.status(400).json({ error: err.message });
  }
}

/**
 * ====== إدارة رصيد اللاعبين (Player Management) ======
 * كل الـ endpoints دي محمية أصلاً بـ protect + authorize('admin') على مستوى
 * الراوتر، ومش موجودة في أي API عامة تانية - دي المسار الوحيد اللي أدمن يقدر
 * يعدّل بيه رصيد لاعب، وبيمر بنفس wallet.service.js وبيتسجل كامل في الـ ledger
 * والـ audit log.
 */
function parseAmount(raw) {
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('amount must be a positive number');
  }
  return amount;
}

function requireReason(raw) {
  if (!raw || typeof raw !== 'string' || !raw.trim()) {
    throw new Error('reason is required');
  }
  return raw.trim();
}

async function creditPlayer(req, res) {
  try {
    const amount = parseAmount(req.body.amount);
    const reason = requireReason(req.body.reason);
    const result = await adminService.creditPlayerWallet({
      userId: req.params.userId,
      adminId: req.user._id,
      amount,
      reason,
      category: req.body.category || 'topup',
    });
    return res.json(result);
  } catch (err) {
    console.error('[Admin] creditPlayer error:', err.message);
    return res.status(400).json({ error: err.message });
  }
}

async function debitPlayer(req, res) {
  try {
    const amount = parseAmount(req.body.amount);
    const reason = requireReason(req.body.reason);
    const result = await adminService.debitPlayerWallet({
      userId: req.params.userId,
      adminId: req.user._id,
      amount,
      reason,
      category: req.body.category || 'deduction',
    });
    return res.json(result);
  } catch (err) {
    console.error('[Admin] debitPlayer error:', err.message);
    return res.status(400).json({ error: err.message });
  }
}

async function grantBonus(req, res) {
  try {
    const amount = parseAmount(req.body.amount);
    const reason = requireReason(req.body.reason);
    const result = await adminService.grantPlayerBonus({
      userId: req.params.userId,
      adminId: req.user._id,
      amount,
      reason,
    });
    return res.json(result);
  } catch (err) {
    console.error('[Admin] grantBonus error:', err.message);
    return res.status(400).json({ error: err.message });
  }
}

async function updatePlayerProfile(req, res) {
  try {
    const { name, admin_notes, reason } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (admin_notes !== undefined) updates.admin_notes = admin_notes;

    const user = await adminService.updatePlayerProfile(req.params.userId, req.user._id, updates, reason);
    return res.json({ user });
  } catch (err) {
    console.error('[Admin] updatePlayerProfile error:', err.message);
    return res.status(400).json({ error: err.message });
  }
}

async function getPlayerAuditLog(req, res) {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const skip = Math.max(parseInt(req.query.skip) || 0, 0);
    const { entries, total } = await adminService.getPlayerAuditLog(req.params.userId, { limit, skip });
    return res.json({ entries, total, limit, skip });
  } catch (err) {
    console.error('[Admin] getPlayerAuditLog error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch audit log' });
  }
}

async function listAdminAuditLog(req, res) {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const skip = Math.max(parseInt(req.query.skip) || 0, 0);
    const { admin_id, action } = req.query;
    const { entries, total } = await adminService.listAdminAuditLog({
      adminId: admin_id,
      action,
      limit,
      skip,
    });
    return res.json({ entries, total, limit, skip });
  } catch (err) {
    console.error('[Admin] listAdminAuditLog error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch audit log' });
  }
}

module.exports = {
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
};