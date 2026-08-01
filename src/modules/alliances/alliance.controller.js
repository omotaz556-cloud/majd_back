const allianceService = require('./alliance.service');

// ====== بيحوّل مستند تحالف لشكل جاهز للعرض - userMap اختياري (Map من
// user_id لمستند User) عشان نضيف اسم كل عضو من غير populate إضافي لو
// الكولر عنده الماب جاهز بالفعل (زي getAllianceDetail) ======
function formatAlliance(alliance, userMap = null) {
  return {
    id: alliance._id,
    name: alliance.name,
    tag: alliance.tag,
    description: alliance.description,
    founder_id: alliance.founder_id,
    max_members: alliance.max_members,
    member_count: alliance.members.length,
    created_at: alliance.created_at,
    members: alliance.members
      .map((m) => ({
        user_id: m.user_id,
        name: userMap?.get(m.user_id.toString())?.name || null,
        role: m.role,
        joined_at: m.joined_at,
      }))
      .sort((a, b) => roleWeight(a.role) - roleWeight(b.role)),
  };
}

function roleWeight(role) {
  if (role === 'leader') return 0;
  if (role === 'officer') return 1;
  return 2;
}

// ====== نسخة مختصرة من التحالف (بدون قائمة أعضاء كاملة) - لقوائم التصفّح
// وشارة "تحالفي الحالي" ======
function formatAllianceSummary(alliance) {
  return {
    id: alliance._id,
    name: alliance.name,
    tag: alliance.tag,
    description: alliance.description,
    member_count: alliance.members.length,
    max_members: alliance.max_members,
    created_at: alliance.created_at,
  };
}

function formatInvite(invite, alliance) {
  return {
    id: invite._id,
    alliance: alliance ? formatAllianceSummary(alliance) : null,
    created_at: invite.created_at,
  };
}

function formatRequest(request, user) {
  return {
    id: request._id,
    user_id: request.user_id,
    user_name: user?.name || null,
    created_at: request.created_at,
  };
}

async function getMyAlliance(req, res) {
  try {
    const alliance = await allianceService.getMyAlliance(req.user._id);
    if (!alliance) return res.json({ alliance: null });

    const { userMap } = await allianceService.getAllianceDetail(alliance._id);
    return res.json({ alliance: formatAlliance(alliance, userMap) });
  } catch (err) {
    console.error('[Alliance] getMyAlliance error:', err.message);
    return res.status(500).json({ error: 'تعذر تحميل التحالف' });
  }
}

async function createAlliance(req, res) {
  try {
    const { name, tag, description } = req.body || {};
    const alliance = await allianceService.createAlliance(req.user._id, { name, tag, description });
    return res.json({ alliance: formatAlliance(alliance) });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function updateAlliance(req, res) {
  try {
    const { id } = req.params;
    const { name, description } = req.body || {};
    const alliance = await allianceService.updateAlliance(req.user._id, id, { name, description });
    return res.json({ alliance: formatAlliance(alliance) });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function disbandAlliance(req, res) {
  try {
    const { id } = req.params;
    await allianceService.disbandAlliance(req.user._id, id);
    return res.json({ disbanded: true });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function listAlliances(req, res) {
  try {
    const { search } = req.query || {};
    const alliances = await allianceService.listAlliances({ search });
    return res.json({ alliances: alliances.map(formatAllianceSummary) });
  } catch (err) {
    console.error('[Alliance] listAlliances error:', err.message);
    return res.status(500).json({ error: 'تعذر تحميل قائمة التحالفات' });
  }
}

async function getAllianceDetail(req, res) {
  try {
    const { id } = req.params;
    const { alliance, userMap } = await allianceService.getAllianceDetail(id);
    return res.json({ alliance: formatAlliance(alliance, userMap) });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function invitePlayer(req, res) {
  try {
    const { id } = req.params;
    const { user_id: targetUserId } = req.body || {};
    if (!targetUserId) return res.status(400).json({ error: 'لازم تحدد اللاعب اللي هتدعوه' });
    const invite = await allianceService.invitePlayer(req.user._id, id, targetUserId);
    return res.json({ invite: { id: invite._id, user_id: invite.user_id, created_at: invite.created_at } });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function cancelInvite(req, res) {
  try {
    const { id, inviteId } = req.params;
    await allianceService.cancelInvite(req.user._id, id, inviteId);
    return res.json({ cancelled: true });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function requestToJoin(req, res) {
  try {
    const { id } = req.params;
    const request = await allianceService.requestToJoin(req.user._id, id);
    return res.json({ request: { id: request._id, created_at: request.created_at } });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function cancelJoinRequest(req, res) {
  try {
    const { id } = req.params;
    await allianceService.cancelJoinRequest(req.user._id, id);
    return res.json({ cancelled: true });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function listMyInvites(req, res) {
  try {
    const entries = await allianceService.listMyInvites(req.user._id);
    return res.json({ invites: entries.map(({ invite, alliance }) => formatInvite(invite, alliance)) });
  } catch (err) {
    console.error('[Alliance] listMyInvites error:', err.message);
    return res.status(500).json({ error: 'تعذر تحميل الدعوات' });
  }
}

async function respondToInvite(req, res) {
  try {
    const { inviteId } = req.params;
    const { accept } = req.body || {};
    const result = await allianceService.respondToInvite(req.user._id, inviteId, Boolean(accept));
    return res.json({ joined: result.joined, alliance: result.alliance ? formatAllianceSummary(result.alliance) : null });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function listPendingRequests(req, res) {
  try {
    const { id } = req.params;
    const entries = await allianceService.listPendingRequests(req.user._id, id);
    return res.json({ requests: entries.map(({ request, user }) => formatRequest(request, user)) });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function respondToRequest(req, res) {
  try {
    const { id, requestId } = req.params;
    const { accept } = req.body || {};
    const result = await allianceService.respondToRequest(req.user._id, id, requestId, Boolean(accept));
    return res.json({ joined: result.joined, alliance: formatAllianceSummary(result.alliance) });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function kickMember(req, res) {
  try {
    const { id, userId: targetUserId } = req.params;
    const alliance = await allianceService.kickMember(req.user._id, id, targetUserId);
    const { userMap } = await allianceService.getAllianceDetail(alliance._id);
    return res.json({ alliance: formatAlliance(alliance, userMap) });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function leaveAlliance(req, res) {
  try {
    const { id } = req.params;
    await allianceService.leaveAlliance(req.user._id, id);
    return res.json({ left: true });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function setMemberRole(req, res) {
  try {
    const { id, userId: targetUserId } = req.params;
    const { role } = req.body || {};
    const alliance = await allianceService.setMemberRole(req.user._id, id, targetUserId, role);
    const { userMap } = await allianceService.getAllianceDetail(alliance._id);
    return res.json({ alliance: formatAlliance(alliance, userMap) });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function transferLeadership(req, res) {
  try {
    const { id, userId: targetUserId } = req.params;
    const alliance = await allianceService.transferLeadership(req.user._id, id, targetUserId);
    const { userMap } = await allianceService.getAllianceDetail(alliance._id);
    return res.json({ alliance: formatAlliance(alliance, userMap) });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

module.exports = {
  getMyAlliance,
  createAlliance,
  updateAlliance,
  disbandAlliance,
  listAlliances,
  getAllianceDetail,
  invitePlayer,
  cancelInvite,
  requestToJoin,
  cancelJoinRequest,
  listMyInvites,
  respondToInvite,
  listPendingRequests,
  respondToRequest,
  kickMember,
  leaveAlliance,
  setMemberRole,
  transferLeadership,
  formatAlliance,
  formatAllianceSummary,
};
