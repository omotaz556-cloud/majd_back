const Rally = require('./rally.model');
const Alliance = require('./alliance.model');
const Castle = require('../castle/castle.model');
const castleService = require('../castle/castle.service');
const inboxService = require('../inbox/inbox.service');
const allianceService = require('./alliance.service');
const battlePlannerService = require('../army/battlePlanner.service');
const rallyCoordinator = require('./rallyCoordinator');
const { TROOP_TYPES } = require('../castle/castle.config');
const {
  RALLY_STATUS,
  RALLY_CANCEL_REASON,
  RALLY_MANAGE_ROLES,
  RALLY_ANY_MEMBER_ROLES,
  MIN_COUNTDOWN_SECONDS,
  MAX_COUNTDOWN_SECONDS,
  MAX_ACTIVE_RALLIES_PER_ALLIANCE,
  MAX_HEROES_PER_PARTICIPANT,
  MAX_BUFFS_PER_PARTICIPANT,
} = require('./rally.config');

// ====== Rally Service (Phase 13، ديّل الطلب - Phase 15) ======
// الواجهة العامة لدورة حياة "تجمّع التحالف" (Create/Join/Leave/Cancel/Status/
// List). أي منطق "تنفيذ" فعلي (دمج جيوش/معركة/توزيع خسائر وغنيمة) نُقل لـ
// rallyCoordinator.js (+ rallyContributionCalculator.js + rallyLootDistributor.js)
// عشان يفضل الملف ده مركّز بس على "مين يقدر يعمل إيه ووقت إيه". ======

// ====== يبعت رسالة صندوق وارد - نفس فلسفة notify() في march.service/
// alliance.service: بيتلف على أي error من غير ما يفشل العملية الأساسية. ======
async function notify(userId, type, title, body, metadata = {}) {
  try {
    await inboxService.createSystemMessage({ userId, type, title, body, metadata });
  } catch (err) {
    console.error('[Rally] failed to send inbox message:', err.message);
  }
}

function validateTroops(requestedTroops) {
  if (!Array.isArray(requestedTroops) || requestedTroops.length === 0) {
    throw new Error('لازم تختار وحدات تنضم بيها للتجمّع');
  }
  const troops = [];
  for (const item of requestedTroops) {
    const key = item?.key;
    const qty = Number(item?.quantity);
    if (!TROOP_TYPES[key]) throw new Error('نوع وحدة غير معروف');
    if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty < 1) {
      throw new Error('عدد الوحدات غير صحيح');
    }
    troops.push({ key, count: qty });
  }
  return troops;
}

// ====== Phase 15 - تحقق بسيط من شكل heroes/research/buffs المرسلة (كائنات/
// مصفوفات حرة، نفس فلسفة snapshotCommanders/bonusAggregator: مفيش نظام
// حقيقي وراهم لسه، بس بنحدد حد أقصى للعدد عشان محدش يبعت payload ضخم). ======
function validateContributionExtras({ heroes, research, buffs }) {
  if (heroes !== undefined && heroes !== null) {
    if (!Array.isArray(heroes)) throw new Error('شكل الأبطال (heroes) غير صحيح');
    if (heroes.length > MAX_HEROES_PER_PARTICIPANT) {
      throw new Error(`متقدرش تبعت أكتر من ${MAX_HEROES_PER_PARTICIPANT} أبطال في نفس المساهمة`);
    }
  }
  if (research !== undefined && research !== null && typeof research !== 'object') {
    throw new Error('شكل الأبحاث (research) غير صحيح');
  }
  if (buffs !== undefined && buffs !== null) {
    if (!Array.isArray(buffs)) throw new Error('شكل التعزيزات (buffs) غير صحيح');
    if (buffs.length > MAX_BUFFS_PER_PARTICIPANT) {
      throw new Error(`متقدرش تبعت أكتر من ${MAX_BUFFS_PER_PARTICIPANT} تعزيزة في نفس المساهمة`);
    }
  }
}

// ====== لو battlePlanId اتبعت، نتأكد إنه فعلاً موجود وبتاع صاحب الطلب -
// getPlanById بترمي error لو مش لاقياها/مش بتاعته (نفس التحقق المستخدم في
// أي مكان تاني بيقرأ خطة معركة). ======
async function assertOwnsBattlePlan(userId, battlePlanId) {
  if (!battlePlanId) return;
  await battlePlannerService.getPlanById(userId, battlePlanId);
}

async function requireAllianceMembership(userId, rally, allowedRoles = RALLY_ANY_MEMBER_ROLES) {
  const alliance = await Alliance.findById(rally.alliance_id);
  if (!alliance) throw new Error('التحالف بتاع التجمّع ده مش موجود');
  allianceService.assertRole(alliance, userId, allowedRoles);
  return alliance;
}

// ====== إنشاء تجمّع جديد - قائد أو ضابط بس (RALLY_MANAGE_ROLES). بيحدد
// الهدف، مدة العد التنازلي، وخطة المعركة الرسمية بتاعة التجمّع (اختيارية -
// "Choose: Target City, Rally Duration, Battle Plan"). لسه من غير أي جيش -
// الأعضاء، بما فيهم منشئ التجمّع نفسه، بينضموا بجيوشهم عن طريق joinRally
// لوحدها. ======
async function createRally(userId, { targetCastleId, countdownSeconds, battlePlanId } = {}) {
  const alliance = await allianceService.getMyAlliance(userId);
  if (!alliance) throw new Error('لازم تكون في تحالف عشان تعمل تجمّع (Rally)');
  allianceService.assertRole(alliance, userId, RALLY_MANAGE_ROLES);

  const seconds = Number(countdownSeconds);
  if (!Number.isFinite(seconds) || !Number.isInteger(seconds) || seconds < MIN_COUNTDOWN_SECONDS || seconds > MAX_COUNTDOWN_SECONDS) {
    throw new Error(`مدة العد التنازلي لازم تكون بين ${MIN_COUNTDOWN_SECONDS} و${MAX_COUNTDOWN_SECONDS} ثانية`);
  }

  const target = await Castle.findById(targetCastleId);
  if (!target) throw new Error('الهدف ده مش موجود');

  if (!target.is_npc && target.user_id) {
    if (target.user_id.toString() === userId.toString()) {
      throw new Error('متقدرش تعمل تجمّع على قلعتك انت');
    }
    const allied = await allianceService.areAllied(userId, target.user_id);
    if (allied) throw new Error('متقدرش تعمل تجمّع على عضو في نفس تحالفك');
  }

  const activeCount = await Rally.countDocuments({ alliance_id: alliance._id, status: RALLY_STATUS.GATHERING });
  if (activeCount >= MAX_ACTIVE_RALLIES_PER_ALLIANCE) {
    throw new Error('وصلت لأقصى عدد تجمّعات شغالة في نفس الوقت لتحالفك');
  }

  await assertOwnsBattlePlan(userId, battlePlanId);

  const now = new Date();
  const rally = await Rally.create({
    alliance_id: alliance._id,
    created_by: userId,
    target_castle_id: target._id,
    target_name: target.is_npc ? target.npc_name : null,
    target_is_npc: Boolean(target.is_npc),
    battle_plan_id: battlePlanId || null,
    countdown_seconds: seconds,
    launch_at: new Date(now.getTime() + seconds * 1000),
    status: RALLY_STATUS.GATHERING,
    participants: [],
  });

  // ====== إبلاغ باقي أعضاء التحالف بالتجمّع الجديد - نفس فلسفة إعلانات
  // التحالف (allianceMail.service.publishAnnouncement)، بس تلقائي هنا. ======
  const targetLabel = target.is_npc ? target.npc_name : 'قلعة معادية';
  for (const member of alliance.members) {
    if (member.user_id.toString() === userId.toString()) continue; // eslint-disable-line no-continue
    // eslint-disable-next-line no-await-in-loop
    await notify(
      member.user_id,
      'rally_created',
      'تجمّع تحالف جديد',
      `تحالفك بيجهّز تجمّع ضد ${targetLabel} - عندك ${seconds} ثانية تنضم بجيشك.`,
      { rally_id: rally._id }
    );
  }

  return rally;
}

// ====== انضمام لتجمّع بجزء من جيش قلعتك + مساهمتك الشخصية (Heroes/Research
// bonuses/Buffs/خطة معركة شخصية اختيارية) - بيتحقق ويخصم الوحدات فورًا من
// جيش قلعتك (نفس فلسفة startMarch/sendReinforcement بالظبط). لو انضممت
// أكتر من مرة، وحداتك والمساهمة الإضافية بتتجمع في نفس المشاركة (مش
// مشاركتين منفصلتين) - آخر research/battle_plan_id مبعوت بيحل محل اللي قبله. ======
async function joinRally(userId, rallyId, requestedTroops, extras = {}) {
  const rally = await Rally.findById(rallyId);
  if (!rally) throw new Error('التجمّع ده مش موجود');

  await rallyCoordinator.resolveIfDue(rally);
  if (rally.status !== RALLY_STATUS.GATHERING) {
    throw new Error('التجمّع ده مقفول للانضمام دلوقتي (خلص أو اتلغى)');
  }

  await requireAllianceMembership(userId, rally, RALLY_ANY_MEMBER_ROLES);

  const troops = validateTroops(requestedTroops);
  const { heroes = [], research = null, buffs = [], battlePlanId = null } = extras || {};
  validateContributionExtras({ heroes, research, buffs });
  await assertOwnsBattlePlan(userId, battlePlanId);

  const castle = await castleService.loadCastleCommon(userId);

  for (const t of troops) {
    const stack = castle.army.find((a) => a.key === t.key);
    if (!stack || stack.count < t.count) {
      throw new Error('معندكش وحدات كفاية من النوع ده جاهزة في قلعتك');
    }
  }
  for (const t of troops) {
    const stack = castle.army.find((a) => a.key === t.key);
    stack.count -= t.count;
  }
  castle.army = castle.army.filter((a) => a.count > 0);
  await castle.save();

  const existing = rally.participants.find((p) => p.user_id.toString() === userId.toString());
  if (existing) {
    for (const t of troops) {
      const stack = existing.troops.find((s) => s.key === t.key);
      if (stack) stack.count += t.count;
      else existing.troops.push({ key: t.key, count: t.count });
    }
    if (heroes.length) existing.heroes.push(...heroes);
    if (research) existing.research = research;
    if (buffs.length) existing.buffs.push(...buffs);
    if (battlePlanId) existing.battle_plan_id = battlePlanId;
  } else {
    rally.participants.push({
      user_id: userId,
      castle_id: castle._id,
      troops,
      heroes,
      research,
      buffs,
      battle_plan_id: battlePlanId,
      joined_at: new Date(),
    });
  }

  await rally.save();

  try {
    const questService = require('../quests/quest.service');
    await questService.recordQuestProgress(userId, 'join_alliance_activity', 1);
  } catch (err) {
    console.error('[Rally] failed to track quest progress:', err.message);
  }

  return rally;
}

// ====== سيب التجمّع قبل ما يتنفّذ - وحداتك بترجع فورًا لقلعتك (زي recallMarch) ======
async function leaveRally(userId, rallyId) {
  const rally = await Rally.findById(rallyId);
  if (!rally) throw new Error('التجمّع ده مش موجود');

  await rallyCoordinator.resolveIfDue(rally);
  if (rally.status !== RALLY_STATUS.GATHERING) {
    throw new Error('متقدرش تسيب تجمّع خلص أو اتلغى بالفعل');
  }

  const index = rally.participants.findIndex((p) => p.user_id.toString() === userId.toString());
  if (index === -1) throw new Error('انت مش منضم للتجمّع ده أصلًا');

  const [participant] = rally.participants.splice(index, 1);
  await rallyCoordinator.refundParticipant(participant);
  await rally.save();

  return rally;
}

// ====== إلغاء تجمّع كامل - قائد/ضابط بس، وقبل ما ينفّذ. كل المشاركين
// بياخدوا جنودهم فورًا (نفس leaveRally لكل واحد فيهم). ======
async function cancelRally(userId, rallyId) {
  const rally = await Rally.findById(rallyId);
  if (!rally) throw new Error('التجمّع ده مش موجود');

  await rallyCoordinator.resolveIfDue(rally);
  if (rally.status !== RALLY_STATUS.GATHERING) {
    throw new Error('متقدرش تلغي تجمّع خلص أو اتلغى بالفعل');
  }

  await requireAllianceMembership(userId, rally, RALLY_MANAGE_ROLES);

  await rallyCoordinator.refundAllParticipants(rally);
  rally.status = RALLY_STATUS.CANCELLED;
  rally.cancelled_reason = RALLY_CANCEL_REASON.MANUAL;
  await rally.save();

  for (const participant of rally.participants) {
    // eslint-disable-next-line no-await-in-loop
    await notify(participant.user_id, 'rally_cancelled', 'اتلغى التجمّع', 'قائد/ضابط التحالف لغى التجمّع ورجعلك جنودك.', {
      rally_id: rally._id,
    });
  }

  return rally;
}

// ====== حالة تجمّع واحد (بيحسم لو وقته خلص أولاً - lazy resolution).
// بيرجّع الحالة، العد التنازلي (launch_at)، وقائمة المشاركين الحاليين. ======
async function getRallyStatus(userId, rallyId) {
  const rally = await Rally.findById(rallyId);
  if (!rally) throw new Error('التجمّع ده مش موجود');
  await requireAllianceMembership(userId, rally, RALLY_ANY_MEMBER_ROLES);
  await rallyCoordinator.resolveIfDue(rally);
  return rally;
}

// ====== كل تجمّعات تحالفي - بتحسم أي تجمّع فات وقته الأول ======
async function listMyAllianceRallies(userId) {
  const alliance = await allianceService.getMyAlliance(userId);
  if (!alliance) throw new Error('لازم تكون في تحالف عشان تشوف تجمّعاته');

  const due = await Rally.find({
    alliance_id: alliance._id,
    status: RALLY_STATUS.GATHERING,
    launch_at: { $lte: new Date() },
  });
  for (const rally of due) {
    // eslint-disable-next-line no-await-in-loop
    await rallyCoordinator.launchRally(rally);
  }

  return Rally.find({ alliance_id: alliance._id }).sort({ created_at: -1 }).limit(30);
}

module.exports = {
  createRally,
  joinRally,
  leaveRally,
  cancelRally,
  getRallyStatus,
  listMyAllianceRallies,
};
