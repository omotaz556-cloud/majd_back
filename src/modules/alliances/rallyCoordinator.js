// ====== Rally Coordinator (Phase 15) ======
// مسؤولية واحدة بس: تنفيذ التجمّع لحظة ما العد التنازلي يخلص - "Lock
// participants -> Merge armies -> Execute one battle via the existing
// Battle Engine -> Generate one shared Battle Report". الملف ده بيربط بين:
//   - rallyContributionCalculator (دمج troops/heroes/research/buffs +
//     حساب وزن مساهمة كل مشارك)
//   - battleService/battleResolutionEngine (محرك المعركة الموجود بالفعل -
//     مفيش أي تعديل عليه، استهلاك بس زي أي consumer تاني له)
//   - rallyLootDistributor (توزيع الخسائر/الغنيمة بعد الحسم)
// rally.service.js هو الواجهة العامة (create/join/leave/cancel/status) -
// الملف ده بس "محرّك" الإطلاق نفسه، اتقسم لوحده عشان يفضل rally.service
// خفيف ومركّز على إدارة دورة حياة التجمّع.

'use strict';

const Rally = require('./rally.model');
const Alliance = require('./alliance.model');
const Castle = require('../castle/castle.model');
const inboxService = require('../inbox/inbox.service');
const allianceService = require('./alliance.service');
const allianceReinforcementService = require('./allianceReinforcement.service');
const battleService = require('../battle/battle.service');
const battlePlannerService = require('../army/battlePlanner.service');
const { BATTLE_STATUS, BATTLE_MODE } = require('../battle/battle.config');
const battleResolutionEngine = require('../battleResolution');
const battleConsequencesService = require('../battleConsequences/battleConsequences.service');
const { RALLY_STATUS, RALLY_CANCEL_REASON } = require('./rally.config');
const { mergeContributions } = require('./rallyContributionCalculator');
const { distributeLossesAndLoot } = require('./rallyLootDistributor');

// ====== نفس فلسفة notify() المكرّرة في كل alliance service تاني (march.service/
// alliance.service) - بتتلف على أي error من غير ما توقف حسم التجمّع. ======
async function notify(userId, type, title, body, metadata = {}) {
  try {
    await inboxService.createSystemMessage({ userId, type, title, body, metadata });
  } catch (err) {
    console.error('[Rally] failed to send inbox message:', err.message);
  }
}

// ====== إرجاع جنود مشارك واحد فورًا لجيش قلعته - بتتستخدم من rally.service
// (leave/cancel) ومن هنا (إلغاء تلقائي وقت الإطلاق). ======
async function refundParticipant(participant) {
  const castle = await Castle.findById(participant.castle_id);
  if (!castle) return;
  for (const t of participant.troops) {
    const stack = castle.army.find((a) => a.key === t.key);
    if (stack) stack.count += t.count;
    else castle.army.push({ key: t.key, count: t.count });
  }
  await castle.save();
}

async function refundAllParticipants(rally) {
  for (const participant of rally.participants) {
    // eslint-disable-next-line no-await-in-loop
    await refundParticipant(participant);
  }
}

// ====== نفس ترجمة resolveBattlePlanForAttack الموجودة في battle.service
// (الخاصة، مش exported) - بتاخد الخطة الرسمية بتاعة القائد (rally.battle_plan_id)
// وتترجمها لـ formation/battlePlan اللي createBattle بيتوقعهم. أي فشل (خطة
// محذوفة/مش بتاعة القائد) بيرجّع null بهدوء بدل ما يوقف إطلاق التجمّع كله -
// نفس فلسفة الأصل بالظبط. ======
const FORMATION_LINE_TO_ROW = { front_line: 0, middle_line: 1, back_line: 2 };
async function resolveRallyBattlePlan(leaderUserId, battlePlanId) {
  if (!battlePlanId || !leaderUserId) return { formation: null, battlePlan: null };
  try {
    const plan = await battlePlannerService.getPlanById(leaderUserId, battlePlanId);
    const slots = (plan.battle_formation || [])
      .filter((s) => s && s.troop_key)
      .map((s) => ({
        troop_key: s.troop_key,
        row: FORMATION_LINE_TO_ROW[s.line] ?? 1,
        column: s.slot_index ?? 0,
      }));
    return {
      formation: { type: 'battle_plan', slots },
      battlePlan: { objective: 'loot', orders: [], notes: plan.name || null },
    };
  } catch (err) {
    console.error('[Rally] failed to resolve rally battle plan:', err.message);
    return { formation: null, battlePlan: null };
  }
}

// ====== لو وقت التجمّع خلص (launch_at <= الآن) ولسه gathering، ننفّذه دلوقتي
// - نفس فلسفة resolveDueMarches في march.service (lazy resolution وقت
// القراءة/الكتابة، مفيش cron شغال كل ثانية). ======
async function resolveIfDue(rally) {
  if (rally.status === RALLY_STATUS.GATHERING && rally.launch_at <= new Date()) {
    await launchRally(rally);
  }
  return rally;
}

// ====== جوهر التجمّع: قفل المشاركين -> دمج الجيوش (+ Heroes/Research/Buffs/
// Battle Plan modifiers لكل مشارك) -> معركة واحدة عن طريق الـ Battle Engine
// الموجود -> توزيع خسائر/غنيمة حسب مساهمة كل مشارك -> تقرير مشترك واحد.
// ====== *** فيكس Race Condition (نفس فلسفة march.service.js::
// resolveDueMarchesQuery بالظبط) *** الدالة دي ممكن تتنادى من كذا مصدر مستقل
// في نفس اللحظة تقريبًا (rally.service.js وقت أي action من عضو - join/leave/
// status - + الجدولة العامة الجديدة rallyScheduler.js كل كذا ثانية). لو
// نداءين وصلوا سوا، الاتنين كانوا ممكن يلاقوا rally.status لسه GATHERING
// ويعالجوه مرتين (جيوش بتتضاعف، معركتين بدل واحدة). الحل: نحجز التجمّع
// بعملية atomic واحدة (findOneAndUpdate بشرط status لسه GATHERING، بنغيّره
// فورًا لـ RESOLVED كحجز مؤقت) قبل أي معالجة - لو نداء تاني وصل بعدنا
// بلحظة، هيلاقي الحجز اتعمل فعلًا (findOneAndUpdate هيرجّع null) ومش
// هيعالجه تاني. لو المعالجة فشلت في أي خطوة بعد كده، بنرجّع الحالة يدويًا
// (finally block) عشان مانخسرش التجمّع للأبد. ======
async function launchRally(rally) {
  if (rally.status !== RALLY_STATUS.GATHERING) return rally;

  const claimed = await Rally.findOneAndUpdate(
    { _id: rally._id, status: RALLY_STATUS.GATHERING },
    { status: RALLY_STATUS.RESOLVED },
    { new: false }
  );
  if (!claimed) {
    // ====== نداء تاني حجزه فعلًا (أو خلص معالجته بالفعل) - نرجّع أحدث نسخة
    // من المستند عشان اللي بينادي يشوف الحالة الحقيقية، مش نسخة قديمة معاه. ======
    return Rally.findById(rally._id);
  }
  // ====== الحجز نجح - نكمل بنفس مستند rally الأصلي (لسه معاه participants
  // كاملة قبل أي تعديل)، بس بحالة GATHERING محليًا عشان باقي الدالة تحت
  // (اللي بتتحقق من rally.status) تكمل شغلها الطبيعي زي الأول. ======
  rally.status = RALLY_STATUS.GATHERING;

  // ====== Lock the participant list" - من اللحظة دي، مفيش أي joinRally/
  // leaveRally هيقدر يعدّل rally.participants (status مبقاش GATHERING). ======
  if (rally.participants.length === 0) {
    rally.status = RALLY_STATUS.CANCELLED;
    rally.cancelled_reason = RALLY_CANCEL_REASON.NO_PARTICIPANTS;
    await rally.save();
    return rally;
  }

  const target = await Castle.findById(rally.target_castle_id);
  if (!target) {
    await refundAllParticipants(rally);
    rally.status = RALLY_STATUS.CANCELLED;
    rally.cancelled_reason = RALLY_CANCEL_REASON.TARGET_MISSING;
    await rally.save();
    return rally;
  }

  // ====== فحص "النار الصديقة" تاني وقت الإطلاق (زي resolveReinforcementArrival
  // في allianceReinforcement.service) - لو الهدف بقى حليف بين إنشاء التجمّع
  // ولحظة إطلاقه، بنلغي تلقائي بدل ما نهاجم عضو تحالف. ======
  if (!target.is_npc && target.user_id) {
    const allied = await allianceService.areAllied(rally.created_by, target.user_id);
    if (allied) {
      await refundAllParticipants(rally);
      rally.status = RALLY_STATUS.CANCELLED;
      rally.cancelled_reason = RALLY_CANCEL_REASON.TARGET_NOW_ALLIED;
      await rally.save();
      return rally;
    }
  }

  // ====== "Merge all participating armies" - Contribution Calculator بيدمج
  // troops (متعلّمة بصاحبها) + heroes/research/buffs كل المشاركين. ======
  const merged = mergeContributions(rally.participants);

  const leaderParticipant =
    rally.participants.find((p) => p.user_id.toString() === rally.created_by.toString()) || rally.participants[0];
  const leaderCastle = await Castle.findById(leaderParticipant.castle_id);
  const alliance = await Alliance.findById(rally.alliance_id);

  // ====== خطة معركة التجمّع الرسمية (اختارها القائد وقت الإنشاء) - بتحدد
  // التشكيل/الهدف بتاع الجيش المدموج كله، زي أي هجوم عادي (march.service). ======
  const { formation, battlePlan } = await resolveRallyBattlePlan(rally.created_by, rally.battle_plan_id);

  let reinforcements = [];
  try {
    reinforcements = await allianceReinforcementService.getStationedForCastle(target._id);
  } catch (err) {
    console.error('[Rally] failed to load stationed reinforcements for battle snapshot:', err.message);
  }

  // ====== "Execute a single battle using the existing Battle Engine" - نفس
  // battleService.createBattle المستخدمة في march.service.registerBattleFoundation،
  // بس هنا troops مدموجة من كذا مشارك + commanders = Heroes المدموجة (تتسجل
  // في battle.snapshot.attacker.commanders للشفافية/التقرير). ======
  const battle = await battleService.createBattle({
    attackerCastle: leaderCastle,
    defenderCastle: target,
    troops: merged.troops,
    commanders: merged.heroes,
    formation,
    battlePlan,
    marchId: null,
    attackerName: alliance ? `[${alliance.tag}] ${alliance.name}` : null,
    defenderName: target.is_npc ? target.npc_name : null,
    battleMode: BATTLE_MODE.ALLIANCE_RALLY,
    reinforcements,
  });

  // ====== نفس محرك battleResolutionEngine اللي battle.service.resolveBattleForMarch
  // بتستخدمه بالظبط، على نفس اللقطة (snapshot) اللي اتسجلت في createBattle
  // فوق - بس هنا attacker.heroes/research/buffs بتوصل من الدمج المباشر
  // (merged) مش من الـ snapshot (اللي مالوش حقول research/buffs لسه - راجع
  // battle.snapshot.service "generic placeholder" philosophy). ======
  const snapshot = battle.snapshot || {};
  const attackerInput = {
    troops: snapshot.attacker?.troops || [],
    battlePlan: snapshot.attacker?.battle_plan || null,
    heroes: merged.heroes,
    research: merged.research,
    buffs: merged.buffs,
  };
  const defenderInput = {
    troops: snapshot.defender?.troops || [],
    buildings: snapshot.defender?.buildings || [],
    wall: snapshot.defender?.walls || [],
    towers: snapshot.defender?.towers || [],
    resources: snapshot.defender?.resources || {},
  };

  const result = battleResolutionEngine.resolveBattle(attackerInput, defenderInput);

  battle.status = BATTLE_STATUS.FINISHED;
  battle.winner = result.winner;
  battle.finish_time = new Date();
  battle.battle_events = result.key_battle_events;
  // ====== نفس تصحيح battle.service.resolveBattleForMarch بالظبط - battle_result
  // لازم يحمل winner/final_scores/key_battle_events/defender_participants
  // (شكل battleResolutionEngine الحقيقي) عشان نفس الـ consumers (تقرير
  // المعركة في الفرونت إند + updateLifetimeStats/rallyLootDistributor تحت)
  // يلاقوا الحقول اللي فعليًا بيدوّروا عليها. attack_score/defense_score
  // القدام اتسابوا للتوافق مع أي consumer قديم. ======
  battle.battle_result = {
    winner: result.winner,
    final_scores: result.final_scores,
    attack_score: result.final_scores.attacker,
    defense_score: result.final_scores.defender,
    power_breakdown: result.power_breakdown,
    casualties: result.casualties,
    remaining_troops: result.remaining_troops,
    defender_participants: result.defender_participants,
    loot: result.loot,
    building_damage: result.building_damage,
    wall_damage: result.wall_damage,
    tower_damage: result.tower_damage,
    battle_duration_seconds: result.battle_duration_seconds,
    key_battle_events: result.key_battle_events,
    resolved_at: new Date(),
  };
  await battle.save();

  // ====== إعادة استخدام خط الأنابيب الموجود لنتائج الدافع (موارد/جيش/أسوار
  // وأبراج/إحصائيات المعركة/الإحصائيات التراكمية) - بيحط الغنيمة كلها مؤقتًا
  // على leaderCastle بس - rallyLootDistributor تحت بيصحّح ده فورًا بعد كده. ======
  try {
    await battleConsequencesService.applyBattleConsequences(battle);
  } catch (err) {
    console.error('[Rally] failed to apply shared battle consequences:', err.message);
  }

  // ====== "Casualties distributed fairly" + "Loot distributed proportionally" ======
  const participantReports = await distributeLossesAndLoot(rally, battle);

  rally.status = RALLY_STATUS.RESOLVED;
  rally.battle_id = battle._id;
  rally.report = {
    winner: result.winner,
    total_loot: {
      gold: result.loot?.looted?.gold || 0,
      wood: result.loot?.looted?.wood || 0,
      stone: result.loot?.looted?.stone || 0,
    },
    participants: participantReports,
    resolved_at: new Date(),
  };
  await rally.save();

  await notifyRallyOutcome(rally, battle, target);

  return rally;
}

// ====== إبلاغ كل المشاركين (نتيجتهم الشخصية) + صاحب قلعة الهدف (لو لاعب
// حقيقي) - نفس فلسفة notify() في march.service.resolveAttackArrival. ======
async function notifyRallyOutcome(rally, battle, target) {
  const win = battle.winner === 'attacker';

  for (const p of rally.report.participants) {
    const lostCount = p.troops_lost.reduce((sum, t) => sum + t.count, 0);
    const lootTotal = p.loot_share.gold + p.loot_share.wood + p.loot_share.stone;
    const body = win
      ? `التجمّع كسب المعركة! نصيبك من الغنيمة ${lootTotal} وحدة موارد، وخسرت ${lostCount} جندي.`
      : `التجمّع خسر المعركة. خسرت ${lostCount} جندي من جيشك.`;
    // eslint-disable-next-line no-await-in-loop
    await notify(p.user_id, 'rally_battle_report', win ? 'كسب التجمّع!' : 'خسر التجمّع', body, {
      rally_id: rally._id,
      battle_id: battle._id,
    });
  }

  if (target && !target.is_npc && target.user_id) {
    await notify(
      target.user_id,
      'rally_defended',
      win ? 'قلعتك اتهاجمت بتجمّع تحالف' : 'قلعتك صدّت تجمّع تحالف',
      win ? 'تجمّع تحالف هاجم قلعتك وسرق جزء من مواردك.' : 'تجمّع تحالف هاجم قلعتك بس اتصدّ.',
      { rally_id: rally._id, battle_id: battle._id }
    );
  }
}

// ====== *** فيكس "التجمّع مش بيتنفّذ لوحده" *** قبل الدالة دي، الوحيدة
// اللي كانت بتشغّل launchRally هي resolveIfDue (فوق)، ومنادى عليها بس من
// نقاط نهاية بيستخدمها عضو تحالف بيتفاعل مع نفس التجمّع ده بالذات (ينضم/
// يسيب/يلغي/يشوف حالته - راجع rally.service.js). يعني لو كل الأعضاء اللي
// انضموا قفلوا التطبيق بعد كده، والعد التنازلي خلص، التجمّع كان بيفضل
// GATHERING للأبد لحد ما حد يصادف يفتح صفحة التجمّع تاني - نفس المشكلة
// بالظبط اللي marchScheduler.js اتعمل أصلًا عشان يحلّها للمسايرات العادية.
// الحل هنا مطابق تمامًا: استعلام عام (من غير فلتر تحالف/لاعب) عن أي تجمّع
// GATHERING خلص وقته (launch_at <= الآن)، ونعدّي كل واحد فيهم على
// launchRally (اللي بقى فيه حجز atomic بنفسه فوق - فمفيش خطر تضاعف حتى لو
// نداء تاني من rally.service.js جه في نفس اللحظة بالظبط). ======
async function resolveAllDueRalliesGlobal() {
  const now = new Date();
  const dueRallyIds = await Rally.find({
    status: RALLY_STATUS.GATHERING,
    launch_at: { $lte: now },
  })
    .sort({ launch_at: 1 })
    .select('_id');

  for (const { _id } of dueRallyIds) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const rally = await Rally.findById(_id);
      if (!rally || rally.status !== RALLY_STATUS.GATHERING) continue; // eslint-disable-line no-continue -- نداء تاني حسمه فعلًا

      // eslint-disable-next-line no-await-in-loop
      await launchRally(rally);
    } catch (err) {
      console.error('[RallyScheduler] resolveAllDueRalliesGlobal failed for rally', _id.toString(), err.message);
    }
  }
}

module.exports = {
  resolveIfDue,
  launchRally,
  refundParticipant,
  refundAllParticipants,
  resolveAllDueRalliesGlobal,
};
