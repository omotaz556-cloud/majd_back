const Castle = require('../castle/castle.model');
const March = require('../castle/march.model');
// ====== *** فيكس Bug 2 (Reinforcements tab -> "castleService.getOrCreateCastle
// is not a function") *** السبب الحقيقي: circular require بين الملف ده و
// castle.service.js - castle.service.js بيعمل require لـ allianceReinforcement
// .service.js (عشان يحسب قوة الدفاع من التعزيزات الواقفة)، وفي نفس الوقت
// الملف ده كان بيعمل require لـ castle.service.js من فوق (top-level). لما
// Node يوصل لأول مرة لسطر الـ require ده من جوه castle.service.js نفسه
// (وهو لسه بيحمّل باقي الـ requires بتاعته)، بيرجع نسخة فاضية من exports
// بتاعته (castle.service.js لسه ما وصلش لسطر module.exports في آخر
// الملف)، فـ castleService هنا كان بيبقى {} فاضي - castleService
// .getOrCreateCastle (مستخدمة في listIncoming) وcastleService
// .loadCastleCommon (مستخدمة في sendReinforcement) كانوا undefined. الحل:
// نأجل الـ require لحد ما الدالة فعلاً تتنفذ (lazy require جوه كل دالة
// بدل أعلى الملف) - وقتها castle.service.js يكون خلص تحميل بالكامل ورجّع
// النسخة الصح من exports بتاعته. ======
function getCastleService() {
  return require('../castle/castle.service');
}
const worldMapService = require('../castle/worldMap.service');
const inboxService = require('../inbox/inbox.service');
const allianceService = require('./alliance.service');
const AllianceReinforcement = require('./allianceReinforcement.model');
const {
  TROOP_TYPES,
  marchSeconds,
  armyStatTotal,
  applyLossFraction,
} = require('../castle/castle.config');

// ====== نفس دالة march.service.js::distanceInSlots بالظبط (منسوخة هنا بدل
// ما تتستورد من march.service عشان نتجنب استيراد دائري: march.service بينادي
// على الملف ده وقت حسم مسير التعزيز - راجع resolveReinforcementArrival هناك). ======
function distanceInSlots(a, b) {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return Math.max(dx, dy) / worldMapService.SLOT_SPACING;
}

async function notify(userId, type, title, body, metadata = {}) {
  try {
    await inboxService.createSystemMessage({ userId, type, title, body, metadata });
  } catch (err) {
    console.error('[AllianceReinforcement] failed to send inbox message:', err.message);
  }
}

// ====== بدء "إرسال تعزيزات" - نفس فلسفة startMarch بالظبط (march.service):
// بيتحقق من الوحدات، يخصمها فورًا من جيش قلعة المرسِل، ويحسب مدة المسير
// حسب المسافة وأبطأ وحدة - بس direction هنا 'reinforcement' مش 'attack'،
// ومفيش أي تسجيل لمعركة (registerBattleFoundation) لمسير التعزيز نفسه. ======
async function sendReinforcement(userId, targetCastleId, requestedTroops) {
  if (!Array.isArray(requestedTroops) || requestedTroops.length === 0) {
    throw new Error('لازم تختار وحدات تبعتها كتعزيز');
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

  const target = await Castle.findById(targetCastleId);
  if (!target) throw new Error('القلعة الهدف مش موجودة');
  if (target.is_npc || !target.user_id) {
    throw new Error('متقدرش تبعت تعزيزات لمعسكر آلي');
  }
  if (target.user_id.toString() === userId.toString()) {
    throw new Error('متقدرش تبعت تعزيزات لقلعتك انت');
  }

  const alliance = await allianceService.getMyAlliance(userId);
  if (!alliance) throw new Error('لازم تكون في تحالف عشان تبعت تعزيزات');
  const allied = await allianceService.areAllied(userId, target.user_id);
  if (!allied) {
    throw new Error('لازم تكون في نفس تحالف اللاعب ده الأول عشان تبعتله تعزيزات');
  }

  const origin = await getCastleService().loadCastleCommon(userId);

  for (const t of troops) {
    const stack = origin.army.find((a) => a.key === t.key);
    if (!stack || stack.count < t.count) {
      throw new Error('معندكش وحدات كفاية من النوع ده جاهزة في قلعتك');
    }
  }
  for (const t of troops) {
    const stack = origin.army.find((a) => a.key === t.key);
    stack.count -= t.count;
  }
  origin.army = origin.army.filter((a) => a.count > 0);

  const distance = distanceInSlots(origin.map_slot, target.map_slot);
  const seconds = marchSeconds(troops, distance);
  const now = new Date();

  const march = await March.create({
    user_id: userId,
    origin_castle_id: origin._id,
    target_castle_id: target._id,
    origin_map_slot: origin.map_slot,
    target_map_slot: target.map_slot,
    target_name: null,
    target_is_npc: false,
    direction: 'reinforcement',
    status: 'traveling',
    troops,
    departed_at: now,
    arrives_at: new Date(now.getTime() + seconds * 1000),
  });

  await origin.save();

  await notify(
    target.user_id,
    'reinforcement_incoming',
    'تعزيزات جاية من حليفك',
    'حليفك في التحالف بعتلك جنود تعزيز - هتوصل قلعتك قريبًا.',
    { march_id: march._id }
  );

  try {
    const questService = require('../quests/quest.service');
    await questService.recordQuestProgress(userId, 'join_alliance_activity', 1);
  } catch (err) {
    console.error('[AllianceReinforcement] failed to track quest progress:', err.message);
  }

  return { castle: origin, march };
}

// ====== بيتنادى من march.service.resolveDueMarches لحظة ما مسير تعزيز يوصل
// فعليًا لقلعة الهدف - بدل ما الجنود ترجع لجيش صاحبها (زي resolveReturnArrival)
// أو تدخل في معركة (زي resolveAttackArrival)، بتـ"تقف" هنا كسجل تعزيز مستقل
// مرتبط بقلعة الهدف، وتفضل واقفة لحد ما تتسحب (recall) أو التحالف ينكسر. ======
async function resolveReinforcementArrival(march) {
  const target = await Castle.findById(march.target_castle_id);

  // ====== الهدف مبقاش موجود (نادر) - نفس فلسفة "الهدف مختفي" في
  // resolveAttackArrival: بنرجّع الجنود فورًا لصاحبها كمسير عودة. ======
  if (!target) {
    march.status = 'resolved';
    await march.save();
    return startReturnMarchFromRaw({
      userId: march.user_id,
      originCastleId: march.target_castle_id,
      originMapSlot: march.target_map_slot,
      targetCastleId: march.origin_castle_id,
      targetMapSlot: march.origin_map_slot,
      troops: march.troops,
    });
  }

  // ====== لو التحالف اتكسر (الاتنين مبقوش حلفاء) وقت الوصول بالظبط -
  // الجنود بترجع أوتوماتيك بدل ما توقف في قلعة عضو مش حليف. ======
  const allied = await allianceService.areAllied(march.user_id, target.user_id);
  if (!allied) {
    march.status = 'resolved';
    await march.save();
    await startReturnMarchFromRaw({
      userId: march.user_id,
      originCastleId: march.target_castle_id,
      originMapSlot: march.target_map_slot,
      targetCastleId: march.origin_castle_id,
      targetMapSlot: march.origin_map_slot,
      troops: march.troops,
    });
    await notify(
      march.user_id,
      'reinforcement_auto_returned',
      'تعزيزاتك رجعت أوتوماتيك',
      'التحالف بينك وبين اللي كنت بتبعتله تعزيز اتكسر قبل ما الجنود توصل، فرجعوا لقلعتك.',
      {}
    );
    return null;
  }

  const alliance = await allianceService.getMyAlliance(target.user_id);

  const reinforcement = await AllianceReinforcement.create({
    alliance_id: alliance ? alliance._id : null,
    origin_user_id: march.user_id,
    origin_castle_id: march.origin_castle_id,
    target_user_id: target.user_id,
    target_castle_id: target._id,
    outgoing_march_id: march._id,
    troops: march.troops,
    status: 'stationed',
    stationed_at: new Date(),
  });

  march.status = 'resolved';
  await march.save();

  await notify(
    target.user_id,
    'reinforcement_arrived',
    'وصلتك تعزيزات',
    'جنود التعزيز من حليفك وصلوا قلعتك ودلوقتي بيشاركوا في الدفاع عنها.',
    { reinforcement_id: reinforcement._id }
  );
  await notify(
    march.user_id,
    'reinforcement_delivered',
    'تعزيزاتك وصلت',
    'الجنود اللي بعتهم كتعزيز وصلوا قلعة حليفك بسلام.',
    { reinforcement_id: reinforcement._id }
  );

  // ====== *** إضافة (Battle Notifications - task 2): بث فوري بالويب سوكيت
  // لصاحب القلعة المدافعة إن تعزيز وصل دلوقتي - نفس فلسفة battle:under_attack/
  // battle:ended (notify() بيسجّل رسالة في صندوق الوارد بس، مبيوصلش فورًا
  // لحظة حصوله زي الويب سوكيت). بيتصرف مع الحدث ده في BattleAlertContext.jsx
  // (توست "🛡️ وصلت تعزيزات" فوري)، من غير ما يستنى دورة الـ polling. ======
  const { emitToUser: emitReinforcementToUser } = require('../../realtime/socket');
  emitReinforcementToUser(target.user_id, 'battle:reinforcement_arrived', {
    reinforcement_id: reinforcement._id,
    target_castle_id: target._id,
  });

  // ====== Phase 1 (Reinforcement & Battle System) - لو القلعة دي تحت هجوم
  // "شغالة" فعليًا دلوقتي، التعزيز اللي لسه استقر زوّد قوة الدفاع فورًا -
  // نبعت تحديث فوري لباور القلعة عن طريق الويب سوكيت بدل ما نستنى دورة
  // castleBattleBroadcaster الجاية (كل 4 ثواني) - عشان شريط الحياة يرتفع في
  // نفس لحظة وصول التعزيز بالظبط. ======
  await broadcastPowerBumpIfBattling(target._id);

  return reinforcement;
}

// ====== تحديث فوري لباور قلعة تحت هجوم شغالة - بيتنادى لحظة ما تعزيز جديد
// يستقر (فوق) عشان الأثر يبان فورًا، بدل ما يستنى البث الدوري العادي. فشل
// هنا (مفيش معركة شغالة أصلًا، أو فشل حساب/بث) ما يأثرش على استقرار
// التعزيز نفسه - هو بالفعل اتسجّل ونجح فوق. ======
async function broadcastPowerBumpIfBattling(castleId) {
  try {
    const activeBattle = await March.findOne({
      target_castle_id: castleId,
      direction: 'attack',
      status: 'battling',
    });
    if (!activeBattle) return;

    const target = await Castle.findById(castleId);
    if (!target || target.is_npc || !target.user_id) return;

    // ====== lazy require - march.service.js بيعمل require للملف ده فوق
    // (top-level)، فلازم نأجل الاتجاه العكسي هنا لحد وقت التنفيذ الفعلي
    // عشان نتجنب دورة استيراد وقت التحميل الأول (نفس فلسفة getCastleService
    // فوق بالظبط). ======
    const marchService = require('../castle/march.service');
    const { emitToUser, emitToAlliance } = require('../../realtime/socket');

    const power = await marchService.computeLiveCastlePowerPct(target, activeBattle);
    const payload = {
      march_id: activeBattle._id,
      castle_id: target._id,
      power_pct: power.power_pct,
      defender_power: power.defender_power,
      attacker_power: power.attacker_power,
    };

    emitToUser(target.user_id, 'castle:power_update', payload);

    const alliance = await allianceService.getMyAlliance(target.user_id);
    if (alliance) emitToAlliance(alliance._id, 'castle:power_update', payload);
  } catch (err) {
    console.error('[AllianceReinforcement] failed to broadcast power bump:', err.message);
  }
}

// ====== نفس شكل مسير العودة اللي resolveAttackArrival بيولّده للناجيين -
// بيتستخدم هنا وقت الاسترجاع (recall) والرجوع التلقائي (auto-return). ======
async function startReturnMarchFromRaw({ userId, originCastleId, originMapSlot, targetCastleId, targetMapSlot, troops }) {
  if (!troops || troops.length === 0) return null;
  const distance = distanceInSlots(originMapSlot, targetMapSlot);
  const seconds = marchSeconds(troops, distance);
  const now = new Date();
  return March.create({
    user_id: userId,
    origin_castle_id: originCastleId,
    target_castle_id: targetCastleId,
    origin_map_slot: originMapSlot,
    target_map_slot: targetMapSlot,
    target_name: null,
    target_is_npc: false,
    direction: 'return',
    status: 'traveling',
    troops,
    departed_at: now,
    arrives_at: new Date(now.getTime() + seconds * 1000),
  });
}

// ====== سحب تعزيز واقف (Recall) - بيتنادى بمعرفة صاحب التعزيز الأصلي بس
// (اللي بعت الجنود، مش صاحب القلعة اللي واقفين فيها). بيولّد مسير عودة
// (direction: 'return') بيرجّع الجنود لقلعة صاحبهم الأصلية - نفس الآلية
// اللي resolveReturnArrival الموجودة أصلًا في march.service بتتعامل معاها من
// غير أي تعديل عليها ("Reuse existing march logic"). ======
async function recallReinforcement(userId, reinforcementId, reason = 'manual') {
  const reinforcement = await AllianceReinforcement.findById(reinforcementId);
  if (!reinforcement || reinforcement.status !== 'stationed') {
    throw new Error('التعزيز ده مش موجود أو مش واقف دلوقتي');
  }
  if (reinforcement.origin_user_id.toString() !== userId.toString()) {
    throw new Error('مقدرش تسحب غير التعزيزات اللي انت بعتها بنفسك');
  }

  const targetCastle = await Castle.findById(reinforcement.target_castle_id);
  const originCastle = await Castle.findById(reinforcement.origin_castle_id);
  if (!targetCastle || !originCastle) throw new Error('قلعة الهدف أو قلعتك مبقتش موجودة');

  const returnMarch = await startReturnMarchFromRaw({
    userId: reinforcement.origin_user_id,
    originCastleId: reinforcement.target_castle_id,
    originMapSlot: targetCastle.map_slot,
    targetCastleId: reinforcement.origin_castle_id,
    targetMapSlot: originCastle.map_slot,
    troops: reinforcement.troops,
  });

  reinforcement.status = 'recalled';
  reinforcement.recalled_reason = reason;
  reinforcement.recalled_at = new Date();
  reinforcement.return_march_id = returnMarch ? returnMarch._id : null;
  await reinforcement.save();

  await notify(
    reinforcement.target_user_id,
    'reinforcement_recalled',
    'حليفك سحب تعزيزاته',
    'حليفك سحب الجنود اللي كانوا بيساعدوك في الدفاع عن قلعتك.',
    { reinforcement_id: reinforcement._id }
  );

  return { reinforcement, march: returnMarch };
}

// ====== الرجوع التلقائي - Support bullet "Automatic return": بتتنادى وقت
// مغادرة/طرد عضو من التحالف (راجع alliance.service kickMember/leaveAlliance/
// disbandAlliance) عشان أي تعزيز مرتبط بيه (سواء هو اللي بعت، أو هو اللي
// كانت واقفة في قلعته) يترجع أوتوماتيك بمجرد ما رابطة التحالف اللي بررت
// وجوده هناك تختفي. ======
async function autoReturnAllForUser(userId) {
  const affected = await AllianceReinforcement.find({
    status: 'stationed',
    $or: [{ origin_user_id: userId }, { target_user_id: userId }],
  });

  const results = [];
  for (const reinforcement of affected) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await recallReinforcement(reinforcement.origin_user_id, reinforcement._id, 'alliance_exit');
      results.push(result);
    } catch (err) {
      console.error('[AllianceReinforcement] auto-return failed:', err.message);
    }
  }
  return results;
}

// ====== كل التعزيزات الواقفة حاليًا في قلعة معيّنة - بتتستخدم من
// march.service وbattle.service وقت حساب قوة الدفاع الفعلية (جيش القلعة +
// تعزيزات الحلفاء) ووقت تحديد ملكية الخسائر في تقرير المعركة. ======
async function getStationedForCastle(castleId) {
  return AllianceReinforcement.find({ target_castle_id: castleId, status: 'stationed' });
}

// ====== تطبيق نسبة خسارة معركة (نفس battle.config::resolveBattle) على كل
// تعزيز واقف في قلعة الدافع - بيتنادى بس من march.service.resolveAttackArrival
// بعد ما تتحسب battle.defenderLossFraction، ومفيش أي حساب قتال جديد هنا،
// استهلاك applyLossFraction الموجودة بالظبط زي ما بتتستخدم على جيش القلعة
// نفسه (نفس نسبة الخسارة بتتطبّق بشكل مستقل على كل كومة/كل تعزيز - رياضيًا
// مكافئ لتطبيقها على المجموع الكلي، من غير ما نحتاج نعيد بناء منطق applyLossFraction). ======
async function applyBattleLossesToStationedTroops(castleId, lossFraction) {
  const stationed = await getStationedForCastle(castleId);
  const ownerLosses = [];

  for (const reinforcement of stationed) {
    const { lost, survived } = applyLossFraction(reinforcement.troops, lossFraction);
    if (lost.length === 0) continue; // eslint-disable-line no-continue

    ownerLosses.push({
      owner_user_id: reinforcement.origin_user_id,
      reinforcement_id: reinforcement._id,
      troops_lost: lost,
      troops_survived: survived,
    });

    reinforcement.troops = survived;
    if (survived.length === 0) {
      // كل الجنود اتفقدوا - مفيش حاجة ترجع، بس نقفل السجل عشان مايفضلش
      // "واقف" بجيش فاضي.
      reinforcement.status = 'returned';
      reinforcement.recalled_at = new Date();
    }
    // eslint-disable-next-line no-await-in-loop
    await reinforcement.save();
  }

  return ownerLosses;
}

// ====== إجمالي قوة الدفاع من كل التعزيزات الواقفة في قلعة معيّنة (لإضافتها
// على defenderArmyPower في march.service.resolveAttackArrival) - reuse
// castle.config::armyStatTotal بالظبط، من غير أي معادلة قتال جديدة. ======
function stationedDefensePower(stationedList, stat = 'defense') {
  return stationedList.reduce((sum, r) => sum + armyStatTotal(r.troops, stat), 0);
}

// ====== قائمة التعزيزات اللي أنا بعتها (لسه واقفة عند حلفائي) ======
async function listOutgoing(userId) {
  return AllianceReinforcement.find({ origin_user_id: userId, status: 'stationed' }).sort({ stationed_at: -1 });
}

// ====== قائمة التعزيزات الواقفة في قلعتي (بعتهالي حلفائي) ======
async function listIncoming(userId) {
  const castle = await getCastleService().getOrCreateCastle(userId);
  return AllianceReinforcement.find({ target_castle_id: castle._id, status: 'stationed' }).sort({ stationed_at: -1 });
}

module.exports = {
  sendReinforcement,
  resolveReinforcementArrival,
  recallReinforcement,
  autoReturnAllForUser,
  getStationedForCastle,
  applyBattleLossesToStationedTroops,
  stationedDefensePower,
  listOutgoing,
  listIncoming,
};
