const Alliance = require('./alliance.model');
const AllianceInvite = require('./allianceInvite.model');
const User = require('../users/user.model');
const inboxService = require('../inbox/inbox.service');
const {
  DEFAULT_MAX_MEMBERS,
  NAME_MIN_LENGTH,
  NAME_MAX_LENGTH,
  TAG_MIN_LENGTH,
  TAG_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  MAX_PENDING_REQUESTS_PER_PLAYER,
} = require('./alliance.config');

// ====== Phase 12: Alliance Reinforcements - "Automatic return" support:
// بتتنادى بمجرد ما رابطة عضوية شخص في تحالف تختفي (طرد/مغادرة/حل تحالف)
// عشان أي تعزيز مرتبط بيه (بعته هو، أو واقف في قلعته هو) يترجع أوتوماتيك.
// require() هنا جوه الدالة (مش أعلى الملف) عن قصد - allianceReinforcement.service.js
// بيستورد alliance.service.js نفسه (getMyAlliance/areAllied)، فـ require متأخر
// هنا بيتجنب مشكلة الاستيراد الدائري (circular require) وقت تحميل الموديولين. ======
async function autoReturnReinforcementsFor(userId) {
  try {
    // eslint-disable-next-line global-require
    const allianceReinforcementService = require('./allianceReinforcement.service');
    await allianceReinforcementService.autoReturnAllForUser(userId);
  } catch (err) {
    console.error('[Alliance] failed to auto-return reinforcements:', err.message);
  }
}

// ====== يبعت رسالة صندوق وارد - بيتلف على أي error من غير ما يفشل العملية
// الأساسية، نفس فلسفة notify في march.service ======
async function notify(userId, type, title, body, metadata = {}) {
  try {
    await inboxService.createSystemMessage({ userId, type, title, body, metadata });
  } catch (err) {
    console.error('[Alliance] failed to send inbox message:', err.message);
  }
}

function validateName(name) {
  const trimmed = String(name || '').trim();
  if (trimmed.length < NAME_MIN_LENGTH || trimmed.length > NAME_MAX_LENGTH) {
    throw new Error(`اسم التحالف لازم يكون بين ${NAME_MIN_LENGTH} و${NAME_MAX_LENGTH} حرف`);
  }
  return trimmed;
}

function validateTag(tag) {
  const trimmed = String(tag || '').trim().toUpperCase();
  if (trimmed.length < TAG_MIN_LENGTH || trimmed.length > TAG_MAX_LENGTH) {
    throw new Error(`اختصار التحالف لازم يكون بين ${TAG_MIN_LENGTH} و${TAG_MAX_LENGTH} حروف`);
  }
  if (!/^[A-Za-z0-9]+$/.test(trimmed)) {
    throw new Error('اختصار التحالف لازم يكون حروف/أرقام إنجليزية بس');
  }
  return trimmed;
}

function validateDescription(description) {
  const trimmed = String(description || '').trim();
  if (trimmed.length > DESCRIPTION_MAX_LENGTH) {
    throw new Error(`وصف التحالف أطول من الحد الأقصى (${DESCRIPTION_MAX_LENGTH} حرف)`);
  }
  return trimmed;
}

// ====== التحالف الحالي بتاع لاعب معيّن (لو عنده واحد) - null لو مش عضو في
// أي تحالف ======
async function getMyAlliance(userId) {
  return Alliance.findOne({ 'members.user_id': userId });
}

function findMember(alliance, userId) {
  return alliance.members.find((m) => m.user_id.toString() === userId.toString());
}

function assertRole(alliance, userId, allowedRoles) {
  const member = findMember(alliance, userId);
  if (!member) throw new Error('انت مش عضو في التحالف ده');
  if (!allowedRoles.includes(member.role)) {
    throw new Error('معندكش صلاحية تعمل الإجراء ده في التحالف');
  }
  return member;
}

// ====== إنشاء تحالف جديد - اللاعب اللي بينشئه بيبقى القائد أوتوماتيك.
// مينفعش يكون عضو في تحالف تاني وقت الإنشاء (لازم يسيب الأول). ======
async function createAlliance(userId, { name, tag, description }) {
  const existing = await getMyAlliance(userId);
  if (existing) throw new Error('انت عضو في تحالف بالفعل - لازم تسيبه الأول');

  const cleanName = validateName(name);
  const cleanTag = validateTag(tag);
  const cleanDescription = validateDescription(description);

  const tagTaken = await Alliance.findOne({ tag: cleanTag });
  if (tagTaken) throw new Error('اختصار التحالف ده متاخد بالفعل - اختَر واحد تاني');

  const alliance = await Alliance.create({
    name: cleanName,
    tag: cleanTag,
    description: cleanDescription,
    founder_id: userId,
    max_members: DEFAULT_MAX_MEMBERS,
    members: [{ user_id: userId, role: 'leader', joined_at: new Date() }],
  });

  return alliance;
}

// ====== تعديل اسم/وصف التحالف - القائد بس (الضباط ميقدروش يغيّروا هوية
// التحالف نفسها، بس يقدروا يديروا الأعضاء) ======
async function updateAlliance(userId, allianceId, { name, description }) {
  const alliance = await Alliance.findById(allianceId);
  if (!alliance) throw new Error('التحالف ده مش موجود');
  assertRole(alliance, userId, ['leader']);

  if (name !== undefined) alliance.name = validateName(name);
  if (description !== undefined) alliance.description = validateDescription(description);

  await alliance.save();
  return alliance;
}

// ====== حل التحالف بالكامل - القائد بس، وبس لو هو العضو الوحيد فيه (عشان
// محدش يقدر "يفض" تحالف فيه أعضاء تانيين من غير رضاهم - لازم يطردهم كلهم
// الأول أو ينقل القيادة). بيمسح كل الدعوات/الطلبات المعلّقة المرتبطة بيه. ======
async function disbandAlliance(userId, allianceId) {
  const alliance = await Alliance.findById(allianceId);
  if (!alliance) throw new Error('التحالف ده مش موجود');
  assertRole(alliance, userId, ['leader']);

  if (alliance.members.length > 1) {
    throw new Error('لازم تطرد كل الأعضاء التانيين الأول (أو تنقل القيادة) قبل ما تقدر تحل التحالف');
  }

  await AllianceInvite.deleteMany({ alliance_id: alliance._id });
  await alliance.deleteOne();

  await autoReturnReinforcementsFor(userId);
}

// ====== دعوة لاعب معيّن للانضمام - قائد أو ضابط بس. اللاعب المدعو هو اللي
// بيوافق/يرفض بعد كده (respondToInvite) ======
async function invitePlayer(userId, allianceId, targetUserId) {
  const alliance = await Alliance.findById(allianceId);
  if (!alliance) throw new Error('التحالف ده مش موجود');
  assertRole(alliance, userId, ['leader', 'officer']);

  if (alliance.members.length >= alliance.max_members) {
    throw new Error('التحالف وصل لأقصى عدد أعضاء مسموح بيه');
  }
  if (findMember(alliance, targetUserId)) {
    throw new Error('اللاعب ده عضو في التحالف بالفعل');
  }

  const target = await User.findById(targetUserId);
  if (!target) throw new Error('اللاعب ده مش موجود');

  const targetAlliance = await getMyAlliance(targetUserId);
  if (targetAlliance) throw new Error('اللاعب ده عضو في تحالف تاني بالفعل');

  const existingInvite = await AllianceInvite.findOne({ alliance_id: alliance._id, user_id: targetUserId, type: 'invite' });
  if (existingInvite) throw new Error('اللاعب ده متبعتله دعوة بالفعل - استنى رده');

  const invite = await AllianceInvite.create({
    alliance_id: alliance._id,
    user_id: targetUserId,
    type: 'invite',
    invited_by: userId,
  });

  await notify(
    targetUserId,
    'alliance_invite_received',
    'دعوة انضمام لتحالف',
    `اتدعيت تنضم لتحالف [${alliance.tag}] ${alliance.name}.`,
    { alliance_id: alliance._id, invite_id: invite._id }
  );

  return invite;
}

// ====== إلغاء دعوة لسه معلّقة - قائد أو ضابط بس (نفس صلاحية الدعوة) ======
async function cancelInvite(userId, allianceId, inviteId) {
  const alliance = await Alliance.findById(allianceId);
  if (!alliance) throw new Error('التحالف ده مش موجود');
  assertRole(alliance, userId, ['leader', 'officer']);

  const invite = await AllianceInvite.findOne({ _id: inviteId, alliance_id: alliance._id, type: 'invite' });
  if (!invite) throw new Error('الدعوة دي مش موجودة');

  await invite.deleteOne();
}

// ====== طلب لاعب الانضمام لتحالف بنفسه - القائد/الضباط هم اللي بيوافقوا
// بعد كده (respondToRequest) ======
async function requestToJoin(userId, allianceId) {
  const existing = await getMyAlliance(userId);
  if (existing) throw new Error('انت عضو في تحالف بالفعل - لازم تسيبه الأول');

  const alliance = await Alliance.findById(allianceId);
  if (!alliance) throw new Error('التحالف ده مش موجود');

  if (alliance.members.length >= alliance.max_members) {
    throw new Error('التحالف وصل لأقصى عدد أعضاء مسموح بيه');
  }

  const existingRequest = await AllianceInvite.findOne({ alliance_id: alliance._id, user_id: userId, type: 'request' });
  if (existingRequest) throw new Error('عندك طلب انضمام معلّق للتحالف ده بالفعل');

  const pendingCount = await AllianceInvite.countDocuments({ user_id: userId, type: 'request' });
  if (pendingCount >= MAX_PENDING_REQUESTS_PER_PLAYER) {
    throw new Error(`متقدرش تبعت أكتر من ${MAX_PENDING_REQUESTS_PER_PLAYER} طلبات انضمام معلّقة في نفس الوقت`);
  }

  const request = await AllianceInvite.create({
    alliance_id: alliance._id,
    user_id: userId,
    type: 'request',
  });

  const officersAndLeader = alliance.members.filter((m) => m.role === 'leader' || m.role === 'officer');
  const requester = await User.findById(userId);
  for (const m of officersAndLeader) {
    await notify(
      m.user_id,
      'alliance_join_request',
      'طلب انضمام جديد',
      `${requester?.name || 'لاعب'} طلب ينضم لتحالف [${alliance.tag}] ${alliance.name}.`,
      { alliance_id: alliance._id, request_id: request._id }
    );
  }

  return request;
}

// ====== سحب طلب انضمام لاعب بعته بنفسه ======
async function cancelJoinRequest(userId, allianceId) {
  const request = await AllianceInvite.findOne({ alliance_id: allianceId, user_id: userId, type: 'request' });
  if (!request) throw new Error('الطلب ده مش موجود');
  await request.deleteOne();
}

// ====== نتيجة إضافة عضو فعلي للتحالف - بترفض لو التحالف بقى مليان أو
// اللاعب بقى عضو في تحالف تاني (سباق محتمل لو أكتر من دعوة وصلت مع بعض) -
// وبتمسح أي دعوات/طلبات تانية معلّقة لنفس اللاعب (مع أي تحالف) بمجرد ما
// ينضم لواحد ======
async function admitMember(alliance, targetUserId) {
  if (alliance.members.length >= alliance.max_members) {
    throw new Error('التحالف وصل لأقصى عدد أعضاء مسموح بيه');
  }
  const targetAlliance = await getMyAlliance(targetUserId);
  if (targetAlliance) {
    throw new Error('اللاعب ده بقى عضو في تحالف تاني قبل ما تتوافق الدعوة');
  }

  alliance.members.push({ user_id: targetUserId, role: 'member', joined_at: new Date() });
  await alliance.save();

  await AllianceInvite.deleteMany({ user_id: targetUserId });
}

// ====== رد اللاعب المدعو على دعوة - accept بينضم فورًا، decline بيمسح
// الدعوة بس ======
async function respondToInvite(userId, inviteId, accept) {
  const invite = await AllianceInvite.findOne({ _id: inviteId, user_id: userId, type: 'invite' });
  if (!invite) throw new Error('الدعوة دي مش موجودة');

  const alliance = await Alliance.findById(invite.alliance_id);
  if (!alliance) {
    await invite.deleteOne();
    throw new Error('التحالف ده مبقاش موجود');
  }

  if (!accept) {
    await invite.deleteOne();
    return { alliance: null, joined: false };
  }

  await admitMember(alliance, userId);

  await notify(
    alliance.founder_id,
    'alliance_member_joined',
    'عضو جديد في التحالف',
    `عضو جديد انضم لتحالف [${alliance.tag}] ${alliance.name}.`,
    { alliance_id: alliance._id }
  );

  return { alliance, joined: true };
}

// ====== رد قائد/ضابط التحالف على طلب انضمام لاعب - accept بيضمّه فورًا،
// decline بيمسح الطلب بس ======
async function respondToRequest(userId, allianceId, requestId, accept) {
  const alliance = await Alliance.findById(allianceId);
  if (!alliance) throw new Error('التحالف ده مش موجود');
  assertRole(alliance, userId, ['leader', 'officer']);

  const request = await AllianceInvite.findOne({ _id: requestId, alliance_id: alliance._id, type: 'request' });
  if (!request) throw new Error('الطلب ده مش موجود');

  const applicantId = request.user_id;

  if (!accept) {
    await request.deleteOne();
    return { alliance, joined: false };
  }

  await admitMember(alliance, applicantId);

  await notify(
    applicantId,
    'alliance_request_accepted',
    'اتقبلت في التحالف',
    `طلب انضمامك لتحالف [${alliance.tag}] ${alliance.name} اتقبل.`,
    { alliance_id: alliance._id }
  );

  return { alliance, joined: true };
}

// ====== طرد عضو - قائد بيقدر يطرد أي حد (غير نفسه)، الضابط بيقدر يطرد
// الأعضاء العاديين بس (مش ضباط تانيين ولا القائد) ======
async function kickMember(userId, allianceId, targetUserId) {
  const alliance = await Alliance.findById(allianceId);
  if (!alliance) throw new Error('التحالف ده مش موجود');

  const actor = assertRole(alliance, userId, ['leader', 'officer']);
  if (targetUserId.toString() === userId.toString()) {
    throw new Error('متقدرش تطرد نفسك - استخدم مسار مغادرة التحالف');
  }

  const target = findMember(alliance, targetUserId);
  if (!target) throw new Error('اللاعب ده مش عضو في التحالف ده');

  if (actor.role === 'officer' && target.role !== 'member') {
    throw new Error('الضابط يقدر يطرد الأعضاء العاديين بس');
  }
  if (target.role === 'leader') {
    throw new Error('متقدرش تطرد القائد');
  }

  alliance.members = alliance.members.filter((m) => m.user_id.toString() !== targetUserId.toString());
  await alliance.save();

  await autoReturnReinforcementsFor(targetUserId);

  await notify(
    targetUserId,
    'alliance_kicked',
    'اتطردت من التحالف',
    `اتطردت من تحالف [${alliance.tag}] ${alliance.name}.`,
    { alliance_id: alliance._id }
  );

  return alliance;
}

// ====== مغادرة التحالف بمبادرة اللاعب نفسه - القائد مينفعش يسيب التحالف
// وهو لسه قائد (لازم ينقل القيادة الأول أو يحل التحالف لو هو العضو الوحيد) ======
async function leaveAlliance(userId, allianceId) {
  const alliance = await Alliance.findById(allianceId);
  if (!alliance) throw new Error('التحالف ده مش موجود');

  const member = findMember(alliance, userId);
  if (!member) throw new Error('انت مش عضو في التحالف ده');

  if (member.role === 'leader') {
    throw new Error('لازم تنقل القيادة لعضو تاني الأول (أو تحل التحالف لو انت العضو الوحيد)');
  }

  alliance.members = alliance.members.filter((m) => m.user_id.toString() !== userId.toString());
  await alliance.save();

  await autoReturnReinforcementsFor(userId);

  return alliance;
}

// ====== ترقية عضو عادي لضابط، أو تنزيل ضابط لعضو عادي - القائد بس ======
async function setMemberRole(userId, allianceId, targetUserId, role) {
  if (!['officer', 'member'].includes(role)) {
    throw new Error('دور غير معروف');
  }

  const alliance = await Alliance.findById(allianceId);
  if (!alliance) throw new Error('التحالف ده مش موجود');
  assertRole(alliance, userId, ['leader']);

  const target = findMember(alliance, targetUserId);
  if (!target) throw new Error('اللاعب ده مش عضو في التحالف ده');
  if (target.role === 'leader') throw new Error('متقدرش تغيّر دور القائد بالطريقة دي');

  target.role = role;
  await alliance.save();

  await notify(
    targetUserId,
    role === 'officer' ? 'alliance_promoted' : 'alliance_demoted',
    role === 'officer' ? 'اترقّيت لضابط' : 'اترجّعت لعضو عادي',
    role === 'officer'
      ? `بقيت ضابط في تحالف [${alliance.tag}] ${alliance.name}.`
      : `مبقتش ضابط في تحالف [${alliance.tag}] ${alliance.name}.`,
    { alliance_id: alliance._id }
  );

  return alliance;
}

// ====== نقل القيادة لعضو تاني - القائد الحالي بس، والعضو المستلم لازم
// يكون عضو فعلي في نفس التحالف بالفعل ======
async function transferLeadership(userId, allianceId, targetUserId) {
  const alliance = await Alliance.findById(allianceId);
  if (!alliance) throw new Error('التحالف ده مش موجود');
  assertRole(alliance, userId, ['leader']);

  if (targetUserId.toString() === userId.toString()) {
    throw new Error('انت القائد بالفعل');
  }

  const target = findMember(alliance, targetUserId);
  if (!target) throw new Error('اللاعب ده مش عضو في التحالف ده');

  const currentLeader = findMember(alliance, userId);
  currentLeader.role = 'officer';
  target.role = 'leader';

  await alliance.save();

  await notify(
    targetUserId,
    'alliance_leadership_transferred',
    'بقيت قائد التحالف',
    `القيادة اتنقلت لك في تحالف [${alliance.tag}] ${alliance.name}.`,
    { alliance_id: alliance._id }
  );

  return alliance;
}

// ====== كل الدعوات/الطلبات المعلّقة الخاصة بلاعب معيّن (اللي هو مستلمها -
// يعني دعوات اتبعتله type='invite') - لعرضها في صندوق الوارد بتاعه ======
async function listMyInvites(userId) {
  const invites = await AllianceInvite.find({ user_id: userId, type: 'invite' }).sort({ created_at: -1 });
  const allianceIds = invites.map((i) => i.alliance_id);
  const alliances = await Alliance.find({ _id: { $in: allianceIds } });
  const allianceMap = new Map(alliances.map((a) => [a._id.toString(), a]));

  return invites
    .map((invite) => ({ invite, alliance: allianceMap.get(invite.alliance_id.toString()) }))
    .filter((entry) => entry.alliance);
}

// ====== كل طلبات الانضمام المعلّقة اللي محتاجة رد من التحالف ده - قائد/
// ضابط بس ======
async function listPendingRequests(userId, allianceId) {
  const alliance = await Alliance.findById(allianceId);
  if (!alliance) throw new Error('التحالف ده مش موجود');
  assertRole(alliance, userId, ['leader', 'officer']);

  const requests = await AllianceInvite.find({ alliance_id: alliance._id, type: 'request' }).sort({ created_at: -1 });
  const userIds = requests.map((r) => r.user_id);
  const users = await User.find({ _id: { $in: userIds } }).select('name');
  const userMap = new Map(users.map((u) => [u._id.toString(), u]));

  return requests
    .map((request) => ({ request, user: userMap.get(request.user_id.toString()) }))
    .filter((entry) => entry.user);
}

// ====== كل التحالفات الموجودة، مع عدد الأعضاء - لصفحة "تصفّح التحالفات" ======
async function listAlliances({ search = '' } = {}) {
  const filter = search
    ? { $or: [{ name: new RegExp(escapeRegex(search), 'i') }, { tag: new RegExp(escapeRegex(search), 'i') }] }
    : {};
  return Alliance.find(filter).sort({ created_at: -1 }).limit(100);
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ====== تفاصيل تحالف واحد كاملة (أعضاؤه) - لصفحة تفاصيل التحالف ======
async function getAllianceDetail(allianceId) {
  const alliance = await Alliance.findById(allianceId);
  if (!alliance) throw new Error('التحالف ده مش موجود');

  const userIds = alliance.members.map((m) => m.user_id);
  const users = await User.find({ _id: { $in: userIds } }).select('name');
  const userMap = new Map(users.map((u) => [u._id.toString(), u]));

  return { alliance, userMap };
}

// ====== هل اللاعبين دول في نفس التحالف - بتستخدم في march.service عشان
// تمنع الهجوم على أعضاء نفس التحالف (friendly fire protection). بترجع
// false لو أي واحد فيهم (أو الاتنين) مش عضو في أي تحالف أصلاً. ======
async function areAllied(userIdA, userIdB) {
  if (!userIdA || !userIdB) return false;
  if (userIdA.toString() === userIdB.toString()) return false;

  const alliance = await Alliance.findOne({
    'members.user_id': { $all: [userIdA, userIdB] },
  });
  return Boolean(alliance);
}

module.exports = {
  getMyAlliance,
  createAlliance,
  updateAlliance,
  disbandAlliance,
  invitePlayer,
  cancelInvite,
  requestToJoin,
  cancelJoinRequest,
  respondToInvite,
  respondToRequest,
  kickMember,
  leaveAlliance,
  setMemberRole,
  transferLeadership,
  listMyInvites,
  listPendingRequests,
  listAlliances,
  getAllianceDetail,
  areAllied,
  // مُصدّرة عشان تتستخدم في allianceMail.service.js (بريد/إعلانات التحالف)
  // من غير ما نكرر نفس منطق فحص العضوية/الدور - "Reuse existing alliance
  // permissions".
  findMember,
  assertRole,
};
