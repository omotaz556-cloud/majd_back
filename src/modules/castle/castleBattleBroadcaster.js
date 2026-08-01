const March = require('./march.model');
const Castle = require('./castle.model');
const allianceService = require('../alliances/alliance.service');
const { emitToUser, emitToAlliance, emitToBattle } = require('../../realtime/socket');

// ====== Phase 1 (Reinforcement & Battle System) - بثّ دوري لباور كل قلعة
// تحت هجوم "شغالة" فعليًا (march.status === 'battling') عن طريق الويب
// سوكيت. المعادلة نفسها (march.service.js::computeLiveCastlePowerPct) هي
// نفسها اللي هتتستخدم وقت الحسم النهائي - هنا بس بنبثّها كل كذا ثانية عشان
// شريط الحياة في الـ HUD يفضل شغال "لايف" حقيقي، من غير ما نلمس محرك الحسم
// النهائي نفسه (finalizeAttackBattle) خالص. فشل جولة واحدة (قلعة اتمسحت،
// قاعدة بيانات مشغولة...) ما يوقفش باقي الجولة ولا الحلقة نفسها. ======
const BROADCAST_INTERVAL_MS = 4000;

let intervalHandle = null;

async function broadcastOnce() {
  // ====== lazy require عشان نتجنب دورة استيراد: march.service.js بيعمل
  // require لـ allianceReinforcement.service.js واللي بدوره ممكن يحتاج
  // الملف ده لاحقًا - نفس فلسفة getCastleService في allianceReinforcement
  // .service.js بالظبط. ======
  const marchService = require('./march.service');

  const battling = await March.find({ direction: 'attack', status: 'battling' }).select(
    'target_castle_id battle_started_at battle_ends_at troops user_id'
  );
  if (battling.length === 0) return;

  for (const march of battling) {
    try {
      const target = await Castle.findById(march.target_castle_id).select('user_id is_npc army buildings');
      // ====== قلاع NPC/كائنات العالم مالهاش صاحب حقيقي - مفيش HUD حي ولا
      // تحالف يتبلّغ عنها، فمفيش داعي نحسب أو نبعت أي حاجة ليها. ======
      if (!target || target.is_npc || !target.user_id) continue; // eslint-disable-line no-continue

      const power = await marchService.computeLiveCastlePowerPct(target, march);
      const payload = {
        march_id: march._id,
        castle_id: target._id,
        power_pct: power.power_pct,
        defender_power: power.defender_power,
        attacker_power: power.attacker_power,
      };

      emitToUser(target.user_id, 'castle:power_update', payload);

      const alliance = await allianceService.getMyAlliance(target.user_id);
      if (alliance) emitToAlliance(alliance._id, 'castle:power_update', payload);

      // ====== *** إضافة: بث لأي متفرّج منضم لغرفة المعركة العامة (مش
      // بالضرورة صاحبها أو حليفه) - راجع battle:watch في realtime/socket.js. ======
      emitToBattle(march._id, 'castle:power_update', payload);
    } catch (err) {
      console.error('[CastleBattleBroadcaster] failed for march', march._id.toString(), err.message);
    }
  }
}

function startCastleBattleBroadcaster() {
  if (intervalHandle) return; // already running - idempotent
  intervalHandle = setInterval(() => {
    broadcastOnce().catch((err) => console.error('[CastleBattleBroadcaster] tick failed:', err.message));
  }, BROADCAST_INTERVAL_MS);
}

function stopCastleBattleBroadcaster() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

module.exports = { startCastleBattleBroadcaster, stopCastleBattleBroadcaster, broadcastOnce };
