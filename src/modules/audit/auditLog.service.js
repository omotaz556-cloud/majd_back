const AdminAuditLog = require('./auditLog.model');

/**
 * بيسجل إجراء إداري. لو اتبعتله session (من عملية محفظة جوه transaction)،
 * السجل بيتكتب جوه نفس الـ atomic transaction عشان الـ ledger والـ audit log
 * يفضلوا متزامنين مع بعض دايماً - أو الاتنين بينجحوا أو الاتنين بيترجعوا (rollback).
 */
async function logAdminAction({
  adminId,
  action,
  targetUserId,
  reason = null,
  metadata = {},
  walletTransactionId = null,
  session = null,
}) {
  const [entry] = await AdminAuditLog.create(
    [
      {
        admin_id: adminId,
        action,
        target_user_id: targetUserId,
        reason,
        metadata,
        wallet_transaction_id: walletTransactionId,
      },
    ],
    session ? { session } : {}
  );

  return entry;
}

async function getAuditLogForUser(targetUserId, { limit = 50, skip = 0 } = {}) {
  const [entries, total] = await Promise.all([
    AdminAuditLog.find({ target_user_id: targetUserId })
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit)
      .populate('admin_id', 'name email')
      .populate('wallet_transaction_id'),
    AdminAuditLog.countDocuments({ target_user_id: targetUserId }),
  ]);

  return { entries, total };
}

async function listAuditLog({ adminId, action, limit = 50, skip = 0 } = {}) {
  const filter = {};
  if (adminId) filter.admin_id = adminId;
  if (action) filter.action = action;

  const [entries, total] = await Promise.all([
    AdminAuditLog.find(filter)
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit)
      .populate('admin_id', 'name email')
      .populate('target_user_id', 'name email'),
    AdminAuditLog.countDocuments(filter),
  ]);

  return { entries, total };
}

module.exports = { logAdminAction, getAuditLogForUser, listAuditLog };
