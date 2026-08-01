const battleService = require('./battle.service');
const { BATTLE_STATUS } = require('./battle.config');
const { startBattleRunner, stopBattleRunner, issueLiveCommand } = require('./battle.runner');
const { COMBAT_ACTION_TYPE } = require('./engines/combatEngine');

// ====== إنشاء معركة مباشرة عن طريق الـ API - مسار مستقل عن نظام المسايرات
// الحالي (march.service بيعمل createBattleFromAttack لوحده وقت بدء أي مسير
// هجوم). المسار ده مفيد لأي استخدام مباشر (اختبار، أو لو حبينا مستقبلًا
// نبدأ معركة من غير ما نعدي بمسير). ======
async function createBattle(req, res) {
  try {
    const { defenderCastleId, troops, commanders, formation, battlePlan, battleMode } = req.body || {};

    if (!defenderCastleId) {
      return res.status(400).json({ error: 'لازم تحدد قلعة الدافع (defenderCastleId)' });
    }
    if (!Array.isArray(troops) || troops.length === 0) {
      return res.status(400).json({ error: 'لازم تحدد الوحدات المشاركة في الهجوم (troops)' });
    }

    const battle = await battleService.createBattleForUser(req.user._id, {
      defenderCastleId,
      troops,
      commanders,
      formation,
      battlePlan,
      battleMode, // اختياري - لو مش مبعوت، createBattleForUser/createBattle هيستخدموا PvP كـ default
    });

    return res.status(201).json({ battle });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'تعذر إنشاء المعركة' });
  }
}

// ====== تحميل معركة واحدة عن طريق battleId - لازم يكون الطالب طرف فيها
// (مهاجم/دافع) أو أدمن ======
async function getBattle(req, res) {
  try {
    const battle = await battleService.getBattleForParticipant(req.params.battleId, req.user);
    return res.json({ battle });
  } catch (err) {
    return res.status(404).json({ error: err.message || 'المعركة دي مش موجودة' });
  }
}

// ====== بدء تشغيل المعركة فعليًا (Battle Frontend Integration) - دي نقطة
// الدخول اللي "لما المسير يوصل، ابدأ المعركة تلقائيًا" المفروض تتنادى منها.
// مفيش أي منطق قتال هنا خالص - بس:
//   1. لو المعركة لسه "preparing"، بننقلها لـ "ready" الأول (عن طريق
//      battleService.transitionStatus الموجودة بالفعل - نفس قاعدة الانتقال
//      المسموحة في battle.config.ALLOWED_TRANSITIONS، مفيش قاعدة جديدة هنا).
//   2. بننادي battle.runner.startBattleRunner اللي بيوصّل الـ Simulation/
//      Rule/Combat Engines الموجودين فعلاً ببعض ويشغّلهم - مفيش أي حساب
//      قتال أو محاكاة جديدة اتضافت، الملف ده كله plumbing بس.
// idempotent: لو المعركة شغالة بالفعل (running) ومحرك شغال ليها في
// runningBattles، startBattleRunner بيرجّع نفس الـ handle من غير ما يعيد
// تشغيلها من الأول - آمن يتنادى أكتر من مرة (زي لو الفرونت إند حاول تاني
// بعد timeout في الشبكة مثلاً).
async function startBattle(req, res) {
  try {
    const battle = await battleService.getBattleForParticipant(req.params.battleId, req.user);

    if (battle.status === BATTLE_STATUS.PREPARING) {
      await battleService.transitionStatus(req.params.battleId, req.user, BATTLE_STATUS.READY);
    } else if (
      battle.status !== BATTLE_STATUS.READY &&
      battle.status !== BATTLE_STATUS.RUNNING
    ) {
      return res.status(400).json({ error: `متقدرش تبدأ معركة في حالة "${battle.status}"` });
    }

    await startBattleRunner(req.params.battleId);

    const updated = await battleService.getBattleForParticipant(req.params.battleId, req.user);
    return res.json({ battle: updated });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'تعذر بدء المعركة' });
  }
}

// ====== جيب المعركة المرتبطة بمسير معيّن (march_id) - دي نقطة الدخول اللي
// المفروض الفرونت إند يستخدمها عشان "يسترجع" battle_id بتاع مسير من الباك
// إند مباشرة (مصدر الحقيقة الوحيد)، بدل ما يحتفظ بـ mapping محلي (client-only)
// ممكن يضيع لو الصفحة اترفريشت. بترجع { battle: null } (مش 404) لو مفيش
// معركة اتسجّلت للمسير ده لسه - ده حالة طبيعية (مثلاً لسه المسير لحظات من
// الإرسال ومعركته لسه ما اتسجلتش من march.service)، مش خطأ. ======
async function getBattleByMarch(req, res) {
  try {
    const battle = await battleService.getBattleByMarchId(req.params.marchId, req.user);
    return res.json({ battle });
  } catch (err) {
    return res.status(403).json({ error: err.message || 'مالكش صلاحية تشوف المعركة دي' });
  }
}

// ====== كل معارك اللاعب الحالي - كمهاجم و/أو كمدافع، مع فلترة اختيارية
// بالدور (?role=attacker|defender) والحالة (?status=running) ======
async function listMyBattles(req, res) {
  try {
    const { role, status } = req.query;
    const battles = await battleService.listBattlesForUser(req.user._id, { role, status });
    return res.json({ battles });
  } catch (err) {
    return res.status(500).json({ error: 'تعذر تحميل المعارك' });
  }
}

// ====== Battle Reports removal - endpoint سجل المعارك (GET /battles/history)
// اتشال بالكامل: تقرير أي معركة منتهية بقى بيوصل كرسالة بريد كاملة
// (راجع battleConsequences.service.js::sendBattleMail) بدل ما يتقرا من
// endpoint منفصل. listBattleHistoryForUser في battle.service.js اتشالت
// كمان معاها (مفيش أي consumer تاني ليها). ======

// ====== تحديث حالة المعركة (Battle Lifecycle) - body: { status: 'ready' } ======
async function updateBattleStatus(req, res) {
  try {
    const { status } = req.body || {};
    if (!status) {
      return res.status(400).json({ error: 'لازم تحدد الحالة الجديدة (status)' });
    }
    const battle = await battleService.transitionStatus(req.params.battleId, req.user, status);
    return res.json({ battle });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'تعذر تحديث حالة المعركة' });
  }
}

// ====== تحديث حالة المحاكاة الحية (current_state/current_tick) - نقطة
// دخول جاهزة لـ Simulation Engine في خطوة لاحقة. body: { currentState, currentTick } ======
async function updateBattleState(req, res) {
  try {
    const { currentState, currentTick } = req.body || {};
    const battle = await battleService.updateCurrentState(req.params.battleId, req.user, {
      currentState,
      currentTick,
    });
    return res.json({ battle });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'تعذر تحديث حالة المحاكاة' });
  }
}

// ====== Phase 2: قناة الأوامر الحية - بس طرف حقيقي في المعركة (مهاجم أو
// دافع، مش أدمن بيتفرّج) يقدر يبعت أمر قتالي لحظي لوحدة بتاعته وقت ما
// المعركة شغالة فعليًا. body: { source, type, target? }
//   - source: id الوحدة المُصدِرة للأمر (شكلها "attacker:archer:0" مثلاً -
//     نفس id المرجوع في units[].id من GET /:battleId، راجع summarizeEngines
//     في battle.runner.js)
//   - type: أحد قيم COMBAT_ACTION_TYPE (attack_unit/attack_building/
//     defend_position/hold_position)
//   - target: اختياري - id الهدف (وحدة أو منشأة عدو) للأوامر اللي محتاجة
//     هدف يدوي؛ لو متبعتش، CombatEngine هيستخدم استراتيجية اختيار الهدف
//     الافتراضية بتاعته (نفس سلوك الأمر الابتدائي وقت بدء المعركة)
//
// كل التحقق من "هل ده فعلاً طرف في المعركة دي؟" و"هل الوحدة دي بتاعته
// فعلاً؟" بيحصل هنا (الطبقة اللي فاهمة req.user/battle.attacker.defender) -
// battle.runner.issueLiveCommand نفسها بتعمل بس فحوصات داخل المحرك (الوحدة/
// الهدف موجودين وحيين، الهدف مش من نفس الفريق). ======
async function issueBattleCommand(req, res) {
  try {
    const battle = await battleService.getBattleForParticipant(req.params.battleId, req.user);

    const userId = req.user._id.toString();
    const isAttacker = battle.attacker.user_id && battle.attacker.user_id.toString() === userId;
    const isDefender = battle.defender.user_id && battle.defender.user_id.toString() === userId;

    // ملحوظة: عمدًا مفيش استثناء للأدمن هنا (بخلاف getBattleForParticipant
    // اللي بتسمحله بس بالمشاهدة) - أدمن بيتفرّج على معركة مش طرف فيها مالوش
    // "جيش بتاعه" يديله أوامر أصلًا، فمفيش owner منطقي نربط بيه الأمر.
    if (!isAttacker && !isDefender) {
      return res.status(403).json({ error: 'بس طرف فعلي في المعركة (مهاجم أو دافع) يقدر يبعت أوامر حية لجيشه' });
    }
    const owner = isAttacker ? 'attacker' : 'defender';

    const { source, type, target } = req.body || {};
    if (!source || typeof source !== 'string') {
      return res.status(400).json({ error: 'لازم تحدد الوحدة اللي هتبعتلها الأمر (source)' });
    }
    if (!Object.values(COMBAT_ACTION_TYPE).includes(type)) {
      return res.status(400).json({ error: `نوع أمر غير معروف: "${type}"` });
    }
    // id الوحدة شكله "owner:troop_key:index" (راجع buildCombatUnitsFromSnapshot
    // في battle.runner.js) - ده أبسط وأضمن فحص إن الوحدة دي فعلاً من جيش
    // نفس الطرف اللي بيبعت الأمر، من غير ما نحتاج نحمّل حالة المحرك مرتين.
    if (!source.startsWith(`${owner}:`)) {
      return res.status(403).json({ error: 'متقدرش تتحكم في وحدة مش بتاعتك' });
    }

    const order = issueLiveCommand(req.params.battleId, {
      source,
      type,
      manual_target_id: target || null,
    });

    return res.json({ order });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'تعذر تنفيذ الأمر' });
  }
}

// ====== إلغاء معركة لسه ما بدأتش (preparing/ready) ======
async function cancelBattle(req, res) {
  try {
    const battle = await battleService.cancelBattle(req.params.battleId, req.user);
    // لو فيه محرك شغال ليها في الذاكرة (نادر - المفروض الإلغاء بيحصل قبل
    // "ready" غالبًا، بس ممكن يحصل سباق)، نوقفه برضه - نفس فلسفة
    // stopBattleRunner: إيقاف تيمر بس، مفيش أي منطق قتال هنا.
    stopBattleRunner(req.params.battleId);
    return res.json({ battle });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'تعذر إلغاء المعركة' });
  }
}

module.exports = {
  createBattle,
  getBattle,
  getBattleByMarch,
  startBattle,
  listMyBattles,
  updateBattleStatus,
  updateBattleState,
  issueBattleCommand,
  cancelBattle,
};
