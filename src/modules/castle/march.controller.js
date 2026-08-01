const marchService = require('./march.service');
const castleController = require('./castle.controller');
const { TROOP_TYPES } = require('./castle.config');

// ====== بيحوّل كومة وحدات (troops snapshot) لشكل جاهز للعرض - اسم كل نوع
// جايي من castle.config عشان الفرونت إند ميحتاجش ينسخه بنفسه ======
function formatTroopStacks(stacks) {
  return (stacks || []).map((s) => ({
    key: s.key,
    name: TROOP_TYPES[s.key]?.name || s.key,
    count: s.count,
  }));
}

// ====== بيحوّل مستند مسير لشكل جاهز للعرض على الخريطة/بانل الجيوش. الوسيط
// الاختياري الثاني (viewerContext) بيتضاف بس لما المسير مش بالضرورة بتاع
// اللاعب الحالي (زي في listNearbyMarches) - عشان الواجهة تقدر تميّز مسير
// اللاعب نفسه عن مسايرات لاعبين تانيين (صديق/عدو) على الخريطة. ======
function formatMarch(march, viewerContext = null) {
  return {
    id: march._id,
    direction: march.direction,
    status: march.status,
    origin_map_slot: march.origin_map_slot,
    target_map_slot: march.target_map_slot,
    target_name: march.target_name,
    target_is_npc: march.target_is_npc,
    battle_plan_id: march.battle_plan_id || null,
    // ====== *** فيكس (Reinforcements must march, not teleport - Requirement 1)
    // *** null لأي مسير هجوم عادي - موجود بس لمسير تعزيز ماشي لمسير هجوم شغال
    // أصلًا (شوف march.model.js وmarch.service.js::sendReinforcementMarchToActiveAttack)،
    // عشان الفرونت إند يقدر يعرضه كـ"تعزيز في الطريق" لو حاب، من غير أي
    // تغيير على السلوك الافتراضي (marchColor/marchSprite لسه بيتعرفوا عليه
    // كهجوم عادي زي ما هو). ======
    reinforces_march_id: march.reinforces_march_id || null,
    troops: formatTroopStacks(march.troops),
    departed_at: march.departed_at,
    arrives_at: march.arrives_at,
    // ====== Phase 1 (Reinforcement & Battle System) - null لأي مسير مش
    // 'attack' أو لسه في حالة 'traveling' (لسه ما بدأش المعركة). موجودة
    // بس لحظة ما المسير يدخل حالة 'battling' - الفرونت إند بيستخدمها عشان
    // يعرض عدّاد "المعركة هتتحسم خلال..." زي عدّاد المسير نفسه بالظبط. ======
    battle_ends_at: march.battle_ends_at || null,
    loot: march.loot,
    report: march.report
      ? {
          outcome: march.report.outcome,
          loot: march.report.loot,
          troops_sent: formatTroopStacks(march.report.troops_sent),
          troops_lost: formatTroopStacks(march.report.troops_lost),
          troops_survived: formatTroopStacks(march.report.troops_survived),
          defender_troops_lost: formatTroopStacks(march.report.defender_troops_lost),
        }
      : null,
    ...(viewerContext
      ? {
          is_mine: viewerContext.is_mine,
          owner_name: viewerContext.owner_name,
          owner_alliance_tag: viewerContext.owner_alliance_tag,
          is_same_alliance: viewerContext.is_same_alliance,
        }
      : { is_mine: true }),
  };
}

async function sendMarch(req, res) {
  try {
    const { target_castle_id: targetCastleId, troops, battle_plan_id: battlePlanId } = req.body || {};
    if (!targetCastleId) {
      return res.status(400).json({ error: 'لازم تحدد الهدف' });
    }
    const { castle, march } = await marchService.startMarch(req.user._id, targetCastleId, troops, battlePlanId || null);
    return res.json({ castle: castleController.formatCastle(castle), march: formatMarch(march) });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function listMarches(req, res) {
  try {
    const marches = await marchService.listMarches(req.user._id);
    return res.json({ marches: marches.map(formatMarch) });
  } catch (err) {
    console.error('[March] listMarches error:', err.message);
    return res.status(500).json({ error: 'تعذر تحميل المسايرات' });
  }
}

// ====== كل المسايرات (بتاعة اللاعب نفسه + لاعبين تانيين) الظاهرة على خريطة
// العالم للاعب الحالي - نفس فلسفة /castle/nearby بالظبط بس للمسايرات مش
// للقلاع. ======
async function listNearbyMarches(req, res) {
  try {
    const visible = await marchService.getVisibleMarches(req.user._id);
    return res.json({ marches: visible.map(({ march, ...ctx }) => formatMarch(march, ctx)) });
  } catch (err) {
    console.error('[March] listNearbyMarches error:', err.message);
    return res.status(500).json({ error: 'تعذر تحميل المسايرات الظاهرة على الخريطة' });
  }
}

async function recallMarch(req, res) {
  try {
    const { id } = req.params;
    const { castle, march } = await marchService.recallMarch(req.user._id, id);
    return res.json({ castle: castleController.formatCastle(castle), march: formatMarch(march) });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

// ====== هجمات معادية جارية على قلعة اللاعب الحالي دلوقتي (لسه ماشية أو
// المعركة شغالة فعليًا) - أساس تنبيه "أنت تحت هجوم" وعداد المعركة اللايف
// في الفرونت إند (راجع marchService.listIncomingAttacks للتفاصيل). ======
async function listIncomingAttacks(req, res) {
  try {
    const attacks = await marchService.listIncomingAttacks(req.user._id);
    return res.json({ attacks });
  } catch (err) {
    console.error('[March] listIncomingAttacks error:', err.message);
    return res.status(500).json({ error: 'تعذر تحميل الهجمات الجارية' });
  }
}

// ====== كل المعارك "الشغالة لايف" بتاعة اللاعب الحالي (مهاجم أو مدافع) -
// نفس مصدر بيانات widget عداد المعركة العايم في الفرونت إند. ======
async function listLiveBattles(req, res) {
  try {
    const battles = await marchService.listLiveBattles(req.user._id);
    return res.json({ battles });
  } catch (err) {
    console.error('[March] listLiveBattles error:', err.message);
    return res.status(500).json({ error: 'تعذر تحميل المعارك الجارية' });
  }
}

// ====== *** إضافة: مشاهدة معركة معيّنة لايف - متاحة لأي مستخدم مسجّل دخول
// بمعرفة march_id بس (مش لازم يكون صاحب القلعة ولا حليفه ولا المهاجم نفسه) -
// راجع marchService.getPublicBattleView. ******
async function getPublicBattleView(req, res) {
  try {
    const battle = await marchService.getPublicBattleView(req.params.marchId);
    if (!battle) {
      return res.status(404).json({ error: 'مفيش معركة شغالة بالمعرّف ده دلوقتي' });
    }
    return res.json({ battle });
  } catch (err) {
    console.error('[March] getPublicBattleView error:', err.message);
    return res.status(500).json({ error: 'تعذر تحميل بيانات المعركة' });
  }
}

module.exports = {
  sendMarch,
  listMarches,
  listNearbyMarches,
  recallMarch,
  listIncomingAttacks,
  listLiveBattles,
  getPublicBattleView,
};
