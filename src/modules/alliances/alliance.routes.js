const express = require('express');
const { protect } = require('../../middleware/auth.middleware');
const {
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
} = require('./alliance.controller');
const {
  sendMail,
  listMail,
  getUnreadMailCount,
  markMailRead,
  markAllMailRead,
  publishAnnouncement,
  getCurrentAnnouncement,
  listAnnouncementHistory,
} = require('./allianceMail.controller');
const {
  requestHelp,
  listOpenHelpRequests,
  getHelpRequest,
  giveHelp,
  cancelHelpRequest,
} = require('./allianceHelp.controller');
const {
  sendReinforcement,
  recallReinforcement,
  listOutgoing,
  listIncoming,
} = require('./allianceReinforcement.controller');
const {
  createRally,
  joinRally,
  leaveRally,
  cancelRally,
  getRallyStatus,
  listMyAllianceRallies,
} = require('./rally.controller');

const router = express.Router();

router.use(protect);

// تحالفي الحالي + إدارة عامة
router.get('/me', getMyAlliance);
router.post('/', createAlliance);
router.get('/', listAlliances);

// ====== تجمّع التحالف (Alliance Rally - Phase 13) - لازم تتحط هنا، قبل
// GET /:id، عشان "/rallies" segment واحد زي "/:id" وكان بيتفسر غلط كأنه
// getAllianceDetail(id='rallies') فيرجّع خطأ ويوقع صفحة التجمّعات (تعذر
// تحميل التجمّعات). Express بيدي الأولوية لأول راوت متطابق بالترتيب، فلازم
// أي راوت حرفي (literal) زي /rallies يتحط قبل أي راوت فيه :id بنفس عدد
// الأجزاء. ======
router.post('/rallies', createRally);
router.get('/rallies', listMyAllianceRallies);
router.get('/rallies/:rallyId', getRallyStatus);
router.post('/rallies/:rallyId/join', joinRally);
router.post('/rallies/:rallyId/leave', leaveRally);
router.post('/rallies/:rallyId/cancel', cancelRally);

router.get('/:id', getAllianceDetail);
router.patch('/:id', updateAlliance);
router.delete('/:id', disbandAlliance);

// دعوات (التحالف بيدعو لاعب) - قائد/ضابط بس يقدروا يبعتوها/يلغوها
router.post('/:id/invites', invitePlayer);
router.delete('/:id/invites/:inviteId', cancelInvite);

// دعواتي أنا (اللي وصلتلي كلاعب) + الرد عليها
router.get('/invites/mine', listMyInvites);
router.post('/invites/:inviteId/respond', respondToInvite);

// طلبات انضمام (اللاعب بيطلب هو بنفسه) + الرد عليها من قائد/ضابط التحالف
router.post('/:id/join-requests', requestToJoin);
router.delete('/:id/join-requests/mine', cancelJoinRequest);
router.get('/:id/join-requests', listPendingRequests);
router.post('/:id/join-requests/:requestId/respond', respondToRequest);

// إدارة الأعضاء
router.delete('/:id/members/:userId', kickMember);
router.post('/:id/leave', leaveAlliance);
router.patch('/:id/members/:userId/role', setMemberRole);
router.post('/:id/members/:userId/transfer-leadership', transferLeadership);

// بريد التحالف (Alliance Mail) - قائد/ضابط يبعتوا لكل الأعضاء، أي عضو يقرا
router.post('/:id/mail', sendMail);
router.get('/:id/mail', listMail);
router.get('/:id/mail/unread-count', getUnreadMailCount);
router.post('/:id/mail/read-all', markAllMailRead);
router.post('/:id/mail/:mailId/read', markMailRead);

// إعلانات التحالف (Alliance Announcement) - قائد بس ينشر، أي عضو يشوف
// الإعلان المثبّت الحالي أو تاريخ الإعلانات كامل
router.post('/:id/announcements', publishAnnouncement);
router.get('/:id/announcements/current', getCurrentAnnouncement);
router.get('/:id/announcements', listAnnouncementHistory);

// مساعدة التحالف (Alliance Help) - أي عضو يطلب مساعدة على مبنى/علاج/إصلاح
// بتاعه، وأي عضو تاني يقدر يضغط "مساعدة" عليه (مرة واحدة بس لكل طلب)
router.post('/:id/help', requestHelp);
router.get('/:id/help', listOpenHelpRequests);
router.get('/:id/help/:helpId', getHelpRequest);
router.post('/:id/help/:helpId/press', giveHelp);
router.delete('/:id/help/:helpId', cancelHelpRequest);

// ====== تعزيزات التحالف (Alliance Reinforcements - Phase 12) - أي عضو يبعت
// جنود لتحصين قلعة عضو تاني في نفس التحالف، ويقدر يسحبهم أي وقت. الجنود
// بتوصل عن طريق مسير عادي (March direction: 'reinforcement') وبتشارك
// أوتوماتيك في أي معركة تحصل على القلعة لحد ما تتسحب أو التحالف ينكسر. ======
router.post('/reinforcements/send', sendReinforcement);
router.post('/reinforcements/:reinforcementId/recall', recallReinforcement);
router.get('/reinforcements/outgoing', listOutgoing);
router.get('/reinforcements/incoming', listIncoming);

module.exports = router;
