const Alliance = require('./alliance.model');
const AllianceMail = require('./allianceMail.model');
const AllianceMailRead = require('./allianceMailRead.model');
const AllianceAnnouncement = require('./allianceAnnouncement.model');
const { assertRole } = require('./alliance.service');

const MAIL_TITLE_MAX_LENGTH = 200;
const MAIL_BODY_MAX_LENGTH = 2000;
const ANNOUNCEMENT_BODY_MAX_LENGTH = 2000;

// كل أعضاء التحالف (أي دور) - بيستخدم في فحص "هو عضو أصلاً" قبل قراءة
// البريد/الإعلانات (بعكس الإرسال/النشر اللي مقصور على leader/officer أو
// leader بس).
const ANY_MEMBER_ROLES = ['leader', 'officer', 'member'];

async function getAllianceOrThrow(allianceId) {
  const alliance = await Alliance.findById(allianceId);
  if (!alliance) throw new Error('التحالف غير موجود');
  return alliance;
}

// ====================== Alliance Mail ======================

// ====== إرسال بريد لكل أعضاء التحالف - القائد والضابط بس يقدروا يبعتوا
// (نفس صلاحيات دعوة عضو/الرد على طلب انضمام في alliance.service). ======
async function sendMail(userId, allianceId, { title, body }) {
  const alliance = await getAllianceOrThrow(allianceId);
  assertRole(alliance, userId, ['leader', 'officer']);

  const cleanTitle = String(title || '').trim();
  const cleanBody = String(body || '').trim();

  if (!cleanTitle) throw new Error('لازم تكتب عنوان الرسالة');
  if (cleanTitle.length > MAIL_TITLE_MAX_LENGTH) {
    throw new Error(`عنوان الرسالة أطول من الحد الأقصى (${MAIL_TITLE_MAX_LENGTH} حرف)`);
  }
  if (!cleanBody) throw new Error('لازم تكتب نص الرسالة');
  if (cleanBody.length > MAIL_BODY_MAX_LENGTH) {
    throw new Error(`نص الرسالة أطول من الحد الأقصى (${MAIL_BODY_MAX_LENGTH} حرف)`);
  }

  return AllianceMail.create({
    alliance_id: alliance._id,
    sender_id: userId,
    title: cleanTitle,
    body: cleanBody,
  });
}

// ====== سجل بريد التحالف كامل (تاريخ الرسائل) لعضو معيّن - أي عضو (مش بس
// قائد/ضابط) يقدر يقرا. كل رسالة بترجع is_read/read_at الخاصين بالعضو ده
// (مش بحالة عامة، لأن الرسالة مستند واحد مشترك). ======
async function listMail(userId, allianceId, { limit = 30, skip = 0 } = {}) {
  const alliance = await getAllianceOrThrow(allianceId);
  assertRole(alliance, userId, ANY_MEMBER_ROLES);

  const mails = await AllianceMail.find({ alliance_id: alliance._id })
    .sort({ sent_at: -1 })
    .skip(skip)
    .limit(Math.min(limit, 100))
    .lean();

  const mailIds = mails.map((m) => m._id);
  const reads = await AllianceMailRead.find({ user_id: userId, mail_id: { $in: mailIds } }).lean();
  const readMap = new Map(reads.map((r) => [r.mail_id.toString(), r.read_at]));

  return mails.map((m) => ({
    id: m._id,
    alliance_id: m.alliance_id,
    sender_id: m.sender_id,
    title: m.title,
    body: m.body,
    sent_at: m.sent_at,
    is_read: readMap.has(m._id.toString()),
    read_at: readMap.get(m._id.toString()) || null,
  }));
}

// ====== عدد رسائل التحالف اللي لسه معلّمة "غير مقروءة" لعضو معيّن. ======
async function getUnreadMailCount(userId, allianceId) {
  const alliance = await getAllianceOrThrow(allianceId);
  assertRole(alliance, userId, ANY_MEMBER_ROLES);

  const mailIds = await AllianceMail.find({ alliance_id: alliance._id }).distinct('_id');
  if (mailIds.length === 0) return 0;

  const readCount = await AllianceMailRead.countDocuments({
    user_id: userId,
    mail_id: { $in: mailIds },
  });

  return mailIds.length - readCount;
}

// ====== تعليم رسالة واحدة كمقروءة - upsert عشان الضغط على "قرأت" أكتر من
// مرة ميعملش duplicate key error. ======
async function markMailRead(userId, allianceId, mailId) {
  const alliance = await getAllianceOrThrow(allianceId);
  assertRole(alliance, userId, ANY_MEMBER_ROLES);

  const mail = await AllianceMail.findOne({ _id: mailId, alliance_id: alliance._id });
  if (!mail) throw new Error('الرسالة غير موجودة');

  await AllianceMailRead.updateOne(
    { user_id: userId, mail_id: mail._id },
    { $setOnInsert: { user_id: userId, mail_id: mail._id, read_at: new Date() } },
    { upsert: true }
  );

  return { read: true, mail_id: mail._id };
}

// ====== تعليم كل رسائل التحالف كمقروءة لعضو معيّن دفعة واحدة. ======
async function markAllMailRead(userId, allianceId) {
  const alliance = await getAllianceOrThrow(allianceId);
  assertRole(alliance, userId, ANY_MEMBER_ROLES);

  const mailIds = await AllianceMail.find({ alliance_id: alliance._id }).distinct('_id');
  if (mailIds.length === 0) return { marked: 0 };

  const alreadyRead = await AllianceMailRead.find({
    user_id: userId,
    mail_id: { $in: mailIds },
  }).distinct('mail_id');
  const alreadyReadSet = new Set(alreadyRead.map((id) => id.toString()));

  const toInsert = mailIds
    .filter((id) => !alreadyReadSet.has(id.toString()))
    .map((id) => ({ user_id: userId, mail_id: id, read_at: new Date() }));

  if (toInsert.length > 0) {
    await AllianceMailRead.insertMany(toInsert, { ordered: false });
  }

  return { marked: toInsert.length };
}

// ====================== Alliance Announcements ======================

// ====== نشر إعلان جديد (مثبّت) - القائد بس (بعكس البريد اللي مسموح
// للضابط كمان). كل نشر بيبقى مستند جديد فالتاريخ القديم بيفضل محفوظ. ======
async function publishAnnouncement(userId, allianceId, { body }) {
  const alliance = await getAllianceOrThrow(allianceId);
  assertRole(alliance, userId, ['leader']);

  const cleanBody = String(body || '').trim();
  if (!cleanBody) throw new Error('لازم تكتب نص الإعلان');
  if (cleanBody.length > ANNOUNCEMENT_BODY_MAX_LENGTH) {
    throw new Error(`نص الإعلان أطول من الحد الأقصى (${ANNOUNCEMENT_BODY_MAX_LENGTH} حرف)`);
  }

  return AllianceAnnouncement.create({
    alliance_id: alliance._id,
    author_id: userId,
    body: cleanBody,
  });
}

// ====== الإعلان المثبّت الحالي (أحدث واحد اتنشر) - null لو مفيش إعلانات
// خالص لسه. أي عضو يقدر يشوفه (زي ما اتطلب: "Members always receive the
// latest announcement"). ======
async function getCurrentAnnouncement(userId, allianceId) {
  const alliance = await getAllianceOrThrow(allianceId);
  assertRole(alliance, userId, ANY_MEMBER_ROLES);

  return AllianceAnnouncement.findOne({ alliance_id: alliance._id }).sort({ created_at: -1 });
}

// ====== تاريخ كل الإعلانات اللي اتنشرت في التحالف (الأحدث الأول). ======
async function listAnnouncementHistory(userId, allianceId, { limit = 30, skip = 0 } = {}) {
  const alliance = await getAllianceOrThrow(allianceId);
  assertRole(alliance, userId, ANY_MEMBER_ROLES);

  return AllianceAnnouncement.find({ alliance_id: alliance._id })
    .sort({ created_at: -1 })
    .skip(skip)
    .limit(Math.min(limit, 100));
}

module.exports = {
  sendMail,
  listMail,
  getUnreadMailCount,
  markMailRead,
  markAllMailRead,
  publishAnnouncement,
  getCurrentAnnouncement,
  listAnnouncementHistory,
};
