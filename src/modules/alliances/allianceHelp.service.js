const Alliance = require('./alliance.model');
const AllianceHelpRequest = require('./allianceHelp.model');
const Castle = require('../castle/castle.model');
const Hospital = require('../hospital/hospital.model');
const CastleDefense = require('../defense/defense.model');
const { assertRole } = require('./alliance.service');
const { MAX_HELP_COUNT, HELP_SECONDS_REDUCTION } = require('./allianceHelp.config');

const HELP_TYPES = ['building', 'healing', 'repair'];
const ANY_MEMBER_ROLES = ['leader', 'officer', 'member'];

async function getAllianceOrThrow(allianceId) {
  const alliance = await Alliance.findById(allianceId);
  if (!alliance) throw new Error('التحالف غير موجود');
  return alliance;
}

// ====== بيدوّر على العنصر الحقيقي الشغال (مبنى بيترقّى / دفعة علاج /
// قطعة دفاعية بتتصلّح) ويرجّع واجهة موحّدة (isActive/get/set/save) عشان
// requestHelp/giveHelp يتعاملوا مع الثلاث أنواع بنفس الكود من غير ما
// يعرفوا تفاصيل كل موديول - نفس فكرة الـ queue/calculator split
// المستخدمة في hospital وrepair، بس هنا موحّدة لمصدر واحد. ======
async function loadTarget(helpType, castleId, targetId) {
  if (helpType === 'building') {
    const castle = await Castle.findById(castleId);
    if (!castle) throw new Error('القلعة غير موجودة');
    const building = castle.buildings.id(targetId);
    if (!building) throw new Error('المبنى غير موجود');

    return {
      isActive: Boolean(building.upgrade?.in_progress && building.upgrade?.completes_at),
      getCompletesAt: () => building.upgrade.completes_at,
      setCompletesAt: (date) => {
        building.upgrade.completes_at = date;
      },
      save: () => castle.save(),
    };
  }

  if (helpType === 'healing') {
    const hospital = await Hospital.findOne({ castle_id: castleId });
    if (!hospital) throw new Error('المستشفى غير موجود');
    const batch = hospital.queue.id(targetId);
    if (!batch) throw new Error('دفعة العلاج غير موجودة');

    return {
      isActive: batch.status === 'healing' && Boolean(batch.heal_completes_at),
      getCompletesAt: () => batch.heal_completes_at,
      setCompletesAt: (date) => {
        batch.heal_completes_at = date;
      },
      save: () => hospital.save(),
    };
  }

  if (helpType === 'repair') {
    const defense = await CastleDefense.findOne({ castle_id: castleId });
    if (!defense) throw new Error('نظام دفاع القلعة غير موجود');
    const structure = defense.structures.id(targetId);
    if (!structure) throw new Error('العنصر الدفاعي غير موجود');

    return {
      isActive: Boolean(structure.repair?.completes_at),
      getCompletesAt: () => structure.repair.completes_at,
      setCompletesAt: (date) => {
        structure.repair.completes_at = date;
      },
      save: () => defense.save(),
    };
  }

  throw new Error('نوع مساعدة غير معروف');
}

function remainingSecondsOf(completesAt, now = new Date()) {
  if (!completesAt) return 0;
  return Math.max(0, Math.ceil((new Date(completesAt).getTime() - now.getTime()) / 1000));
}

function formatHelpRequest(helpRequest, completesAt) {
  return {
    id: helpRequest._id,
    alliance_id: helpRequest.alliance_id,
    requester_id: helpRequest.requester_id,
    castle_id: helpRequest.castle_id,
    help_type: helpRequest.help_type,
    target_id: helpRequest.target_id,
    status: helpRequest.status,
    max_helps: helpRequest.max_helps,
    help_count: helpRequest.helpers.length,
    contributors: helpRequest.helpers.map((h) => ({ user_id: h.user_id, helped_at: h.helped_at })),
    remaining_seconds: remainingSecondsOf(completesAt),
  };
}

// ====== طلب مساعدة جديد - أي عضو (مش بس قائد/ضابط) يقدر يطلب مساعدة على
// عنصر شغال فعلاً في قلعته هو بنفسه (مبنى بيترقّى/دفعة علاج/قطعة دفاعية
// بتتصلّح). مينفعش يطلب مساعدة على قلعة/عنصر مش بتاعه، ومينفعش يبقى فيه
// أكتر من طلب مفتوح لنفس العنصر في نفس الوقت (partial unique index على
// الموديل). ======
async function requestHelp(userId, allianceId, { helpType, castleId, targetId }) {
  const alliance = await getAllianceOrThrow(allianceId);
  assertRole(alliance, userId, ANY_MEMBER_ROLES);

  if (!HELP_TYPES.includes(helpType)) {
    throw new Error('نوع مساعدة غير معروف - لازم يكون building أو healing أو repair');
  }
  if (!castleId || !targetId) {
    throw new Error('لازم تحدد castleId وtargetId');
  }

  const castle = await Castle.findOne({ _id: castleId, user_id: userId });
  if (!castle) throw new Error('القلعة دي مش بتاعتك');

  const target = await loadTarget(helpType, castleId, targetId);
  if (!target.isActive) {
    throw new Error('العنصر ده مش شغال دلوقتي - مينفعش تطلب مساعدة عليه');
  }

  const existingOpen = await AllianceHelpRequest.findOne({ target_id: targetId, status: 'open' });
  if (existingOpen) throw new Error('في طلب مساعدة مفتوح بالفعل للعنصر ده');

  const helpRequest = await AllianceHelpRequest.create({
    alliance_id: alliance._id,
    requester_id: userId,
    castle_id: castleId,
    help_type: helpType,
    target_id: targetId,
    max_helps: MAX_HELP_COUNT,
    helpers: [],
  });

  return formatHelpRequest(helpRequest, target.getCompletesAt());
}

// ====== قايمة طلبات المساعدة المفتوحة في التحالف - أي عضو يقدر يشوفها
// عشان يختار يساعد مين. أي طلب اتضح إن عنصره خلص فعلاً (مثلاً اتقفل من
// غير مساعدة) بيتقفل هنا كـ 'completed' بدل ما يفضل ظاهر غلط. ======
async function listOpenHelpRequests(userId, allianceId, { limit = 30, skip = 0 } = {}) {
  const alliance = await getAllianceOrThrow(allianceId);
  assertRole(alliance, userId, ANY_MEMBER_ROLES);

  const requests = await AllianceHelpRequest.find({ alliance_id: alliance._id, status: 'open' })
    .sort({ created_at: -1 })
    .skip(skip)
    .limit(Math.min(limit, 100));

  const results = [];
  for (const helpRequest of requests) {
    try {
      const target = await loadTarget(helpRequest.help_type, helpRequest.castle_id, helpRequest.target_id);
      if (!target.isActive) {
        helpRequest.status = 'completed';
        await helpRequest.save();
        continue;
      }
      results.push(formatHelpRequest(helpRequest, target.getCompletesAt()));
    } catch (err) {
      // العنصر/القلعة الأصلية اتمسحت أو بقت مش متاحة - تجاهل الطلب ده من
      // القايمة من غير ما نفشّل الطلب كله
      continue;
    }
  }
  return results;
}

// ====== الضغط على "مساعدة" - أي عضو تاني في نفس التحالف غير صاحب الطلب،
// مرة واحدة بس لكل طلب (Prevent duplicate help)، وطول ما لسه معدّاش أقصى
// عدد مساعدات (Maximum help count). كل مساعدة بتقلل الوقت المتبقي فعليًا
// على العنصر الأصلي مباشرة، وبترجّع الوقت المتبقي المحدّث. ======
async function giveHelp(helperUserId, allianceId, helpRequestId) {
  const alliance = await getAllianceOrThrow(allianceId);
  assertRole(alliance, helperUserId, ANY_MEMBER_ROLES);

  const helpRequest = await AllianceHelpRequest.findOne({ _id: helpRequestId, alliance_id: alliance._id });
  if (!helpRequest) throw new Error('طلب المساعدة غير موجود');
  if (helpRequest.status !== 'open') throw new Error('طلب المساعدة ده مقفول بالفعل');

  if (helpRequest.requester_id.toString() === helperUserId.toString()) {
    throw new Error('متقدرش تساعد نفسك في طلبك انت');
  }

  const alreadyHelped = helpRequest.helpers.some((h) => h.user_id.toString() === helperUserId.toString());
  if (alreadyHelped) throw new Error('انت ساعدت في الطلب ده قبل كده');

  if (helpRequest.helpers.length >= helpRequest.max_helps) {
    helpRequest.status = 'completed';
    await helpRequest.save();
    throw new Error('طلب المساعدة ده وصل لأقصى عدد مساعدات مسموح بيه');
  }

  const target = await loadTarget(helpRequest.help_type, helpRequest.castle_id, helpRequest.target_id);
  if (!target.isActive) {
    helpRequest.status = 'completed';
    await helpRequest.save();
    throw new Error('العنصر ده خلص بالفعل - مفيش داعي مساعدة');
  }

  const now = new Date();
  const currentCompletesAt = new Date(target.getCompletesAt());
  const newCompletesAt = new Date(
    Math.max(now.getTime(), currentCompletesAt.getTime() - HELP_SECONDS_REDUCTION * 1000)
  );
  target.setCompletesAt(newCompletesAt);
  await target.save();

  helpRequest.helpers.push({ user_id: helperUserId, helped_at: now });
  const remainingSeconds = remainingSecondsOf(newCompletesAt, now);
  if (remainingSeconds <= 0 || helpRequest.helpers.length >= helpRequest.max_helps) {
    helpRequest.status = 'completed';
  }
  await helpRequest.save();

  return formatHelpRequest(helpRequest, newCompletesAt);
}

// ====== تفاصيل طلب مساعدة واحد (وقت متبقي حي + قايمة المساهمين) - أي
// عضو في التحالف يقدر يشوفه. ======
async function getHelpRequest(userId, allianceId, helpRequestId) {
  const alliance = await getAllianceOrThrow(allianceId);
  assertRole(alliance, userId, ANY_MEMBER_ROLES);

  const helpRequest = await AllianceHelpRequest.findOne({ _id: helpRequestId, alliance_id: alliance._id });
  if (!helpRequest) throw new Error('طلب المساعدة غير موجود');

  if (helpRequest.status !== 'open') {
    return formatHelpRequest(helpRequest, null);
  }

  const target = await loadTarget(helpRequest.help_type, helpRequest.castle_id, helpRequest.target_id);
  return formatHelpRequest(helpRequest, target.isActive ? target.getCompletesAt() : null);
}

// ====== إلغاء طلب مساعدة مفتوح - صاحب الطلب نفسه، أو قائد/ضابط التحالف
// (نفس صلاحيات إدارة الأعضاء التانية) - نفس منطق "Reuse existing alliance
// permissions". ======
async function cancelHelpRequest(userId, allianceId, helpRequestId) {
  const alliance = await getAllianceOrThrow(allianceId);
  const member = assertRole(alliance, userId, ANY_MEMBER_ROLES);

  const helpRequest = await AllianceHelpRequest.findOne({ _id: helpRequestId, alliance_id: alliance._id });
  if (!helpRequest) throw new Error('طلب المساعدة غير موجود');
  if (helpRequest.status !== 'open') throw new Error('طلب المساعدة ده مقفول بالفعل');

  const isOwner = helpRequest.requester_id.toString() === userId.toString();
  const isLeaderOrOfficer = member.role === 'leader' || member.role === 'officer';
  if (!isOwner && !isLeaderOrOfficer) {
    throw new Error('معندكش صلاحية تلغي طلب المساعدة ده');
  }

  helpRequest.status = 'cancelled';
  await helpRequest.save();
  return { cancelled: true };
}

module.exports = {
  requestHelp,
  listOpenHelpRequests,
  giveHelp,
  getHelpRequest,
  cancelHelpRequest,
};
