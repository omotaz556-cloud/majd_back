const DailyRewardState = require('./dailyReward.model');
const castleService = require('../castle/castle.service');
const { RESOURCE_TYPES } = require('../castle/castle.config');
const { RESOURCE_REWARD_AMOUNTS, multiplierForStreakDay } = require('./dailyReward.config');

/**
 * ====== نظام المكافأة اليومية (Daily Reward) ======
 *
 * الأهلية الفعلية = 24 ساعة كاملة (server time) من آخر استلام حقيقي
 * (last_claim_at) - مش "يوم تقويمي UTC". ده يمنع أي التفاف حول الكولداون
 * (تحديث الصفحة، أو تغيير ساعة الجهاز - الحساب كله على طابع زمني مخزّن على
 * السيرفر، الكلاينت أبداً مش مصدر الوقت).
 *
 * الستريك (current_streak) لسه بيتحسب على "يوم تقويمي UTC" (day_key بصيغة
 * YYYY-MM-DD - نفس فلسفة quest.service.js) عشان منطق الستريك يفضل بديهي
 * (يوم واحد فرق = ستريك مستمر) حتى لو اللاعب استلم الساعة 11 مساءً يوم
 * واحد والساعة 1 فجر اليوم اللي بعده (فرق ساعتين بس لكن يوم تقويمي مختلف):
 *   - أول مطالبة على الإطلاق  → الستريك = 1
 *   - مطالبة في يوم UTC تالي مباشرة لآخر مطالبة → الستريك += 1
 *   - أي فجوة أكبر من يوم واحد (فوّت يوم أو أكتر) → الستريك يترجع لـ 1
 *   - أهلية "الـ24 ساعة" هي اللي بتمنع مطالبة تانية قبل وقتها أصلًا - مش
 *     منطق الستريك (already_claimed_today بيتفعّل فعليًا بس لو حصل سباق
 *     نادر بين قراءة الحالة والـ atomic update تحت).
 *
 * مكافأة كل يوم = RESOURCE_REWARD_AMOUNTS (نفس أساس مكافآت الإعلانات في
 * rewardKinds.config.js - مفيش تكرار لمنطق الموارد) × مضاعف يوم الستريك
 * الحالي (dailyReward.config.js). المضاعفة الإضافية عبر "شاهد إعلان" مسؤولية
 * REWARD_KIND.DAILY_DOUBLE في ads module بالكامل (راجع rewardSession.service.js) -
 * الموديول ده مايكررش أو يتلاعب في منطق الإعلانات، بس بيقرأ نفس أساس الموارد.
 */

const CLAIM_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

function daysBetweenKeys(prevKey, currKey) {
  const prev = new Date(`${prevKey}T00:00:00.000Z`).getTime();
  const curr = new Date(`${currKey}T00:00:00.000Z`).getTime();
  return Math.round((curr - prev) / 86400000);
}

async function getOrCreateState(userId) {
  let state = await DailyRewardState.findOne({ user_id: userId });
  if (!state) {
    try {
      state = await DailyRewardState.create({
        user_id: userId,
        last_claim_date: null,
        last_claim_at: null,
        current_streak: 0,
      });
    } catch (err) {
      // ====== طلب تاني (أول مطالبة على الإطلاق برضو) سبقنا بجزء من الثانية
      // وعمل create له - unique index على user_id بيرفض محاولتنا (E11000).
      // في الحالة دي، نقرأ المستند اللي اتعمل بالفعل بدل ما نرمي error. ======
      if (err?.code === 11000) {
        state = await DailyRewardState.findOne({ user_id: userId });
      } else {
        throw err;
      }
    }
  }
  return state;
}

// ====== يحسب "ستريك اليوم القادم" لو اللاعب طالب دلوقتي - من غير ما يعدّل
// أي حاجة في القاعدة (استخدام للعرض بس في GET /status). ======
function computeNextStreak(state, day) {
  if (!state.last_claim_date) return 1;
  if (state.last_claim_date === day) return state.current_streak; // اتاخدت النهاردة أصلاً
  const gap = daysBetweenKeys(state.last_claim_date, day);
  if (gap === 1) return state.current_streak + 1;
  return 1;
}

// ====== GET /api/daily-reward/status ======
// الأهلية (eligible) ومصدرها الوحيد: last_claim_at + 24 ساعة، محسوبة كلها
// بتوقيت السيرفر (Date.now()) - العميل بيرسلش ولا بيقرأش أي وقت هنا، فمفيش
// طريقة يلتف بيها حول الكولداون بتحديث الصفحة أو تغيير ساعة جهازه.
async function getStatus(userId) {
  const day = todayKey();
  const state = await getOrCreateState(userId);

  const lastClaimAtMs = state.last_claim_at ? new Date(state.last_claim_at).getTime() : null;
  const elapsedMs = lastClaimAtMs ? Date.now() - lastClaimAtMs : null;
  const eligible = lastClaimAtMs === null || elapsedMs >= CLAIM_COOLDOWN_MS;
  const secondsRemaining = eligible ? 0 : Math.ceil((CLAIM_COOLDOWN_MS - elapsedMs) / 1000);

  const nextStreak = computeNextStreak(state, day);
  const previewMultiplier = multiplierForStreakDay(nextStreak);
  const previewAmounts = {};
  for (const resource of RESOURCE_TYPES) {
    previewAmounts[resource] = Math.floor((RESOURCE_REWARD_AMOUNTS[resource] || 0) * previewMultiplier);
  }

  return {
    eligible,
    seconds_remaining: secondsRemaining,
    current_streak: state.current_streak,
    next_streak: nextStreak,
    last_claim_date: state.last_claim_date,
    preview_reward: previewAmounts,
  };
}

// ====== POST /api/daily-reward/claim ======
// الأهلية بتتحقق هنا بنفس المصدر بالظبط اللي getStatus بيستخدمه: طابع زمني
// مخزّن على السيرفر (last_claim_at) + 24 ساعة - مفيش أي وقت جاي من العميل
// بيتصدّق عليه هنا خالص. ده اللي بيمنع الالتفاف حول الكولداون بتحديث
// الصفحة أو تغيير ساعة الجهاز: حتى لو الكلاينت "فكّر" إنه مستحق، السيرفر
// بيرفض أي مطالبة قبل ما الـ 24 ساعة الحقيقية تخلص فعليًا.
async function claim(userId) {
  const day = todayKey();
  const now = new Date();

  // ====== Atomic claim (يحل الـ TOCTOU race condition) ======
  // النسخة القديمة كانت بتعمل: قراءة الحالة (getOrCreateState) → تحسب
  // newStreak/multiplier بناءً عليها → تمنح الموارد → تحفظ last_claim_at/
  // current_streak. لو طلبين اتبعتوا في نفس اللحظة (double-submit، تبويبين
  // مفتوحين، إلخ)، الاتنين كانوا يقدروا يقرأوا نفس last_claim_at (وقت
  // سابق) قبل ما أي حد منهم يحفظ - فيتنفذ منح الموارد مرتين والستريك
  // يتزود مرتين لنفس الفترة.
  //
  // الحل: أول حاجة بنعملها هي findOneAndUpdate بشرط "last_claim_at لسه هو
  // نفس القيمة اللي قرأناها" *في نفس الاستعلام الواحد* - عملية ذرية
  // (compare-and-swap) على مستوى الداتابيز. لو طلبين اتسابقوا، واحد بس
  // هيلاقي مستند يطابق الشرط ده ويعدّل last_claim_at/current_streak،
  // والتاني هيرجع null فورًا من غير أي فرصة يكمل لمنح الموارد أصلاً.
  const currentState = await getOrCreateState(userId);

  const lastClaimAtMs = currentState.last_claim_at ? new Date(currentState.last_claim_at).getTime() : null;
  const elapsedMs = lastClaimAtMs ? now.getTime() - lastClaimAtMs : null;
  const stillOnCooldown = lastClaimAtMs !== null && elapsedMs < CLAIM_COOLDOWN_MS;
  if (stillOnCooldown) {
    const err = new Error('تم استلام المكافأة اليومية بالفعل - انتظر حتى تكتمل 24 ساعة');
    err.code = 'already_claimed_today';
    throw err;
  }

  const newStreak = computeNextStreak(currentState, day);
  const multiplier = multiplierForStreakDay(newStreak);

  // ====== الـ compare-and-swap الفعلي: بنشترط إن last_claim_at لسه هو
  // نفس القيمة اللي قرأناها فوق (مش "أي قيمة غير مؤهلة" - عشان نضمن مفيش
  // تعديل حصل من قراءتنا لحد دلوقتي، مش بس مفيش claim مؤهل). ======
  const claimedState = await DailyRewardState.findOneAndUpdate(
    { user_id: userId, last_claim_at: currentState.last_claim_at },
    { $set: { last_claim_date: day, last_claim_at: now, current_streak: newStreak } },
    { new: true }
  );

  if (!claimedState) {
    // ====== طلب تاني سبقنا (أو عدّل الحالة بأي شكل) بين القراءة فوق
    // ودلوقتي - نتأكد هو فعلاً استلم مكافأة اليوم ده (لسه في الكولداون)
    // قبل ما نرفض. ======
    const latest = await DailyRewardState.findOne({ user_id: userId });
    const latestClaimAtMs = latest?.last_claim_at ? new Date(latest.last_claim_at).getTime() : null;
    const latestElapsedMs = latestClaimAtMs ? Date.now() - latestClaimAtMs : null;
    if (latestClaimAtMs !== null && latestElapsedMs < CLAIM_COOLDOWN_MS) {
      const err = new Error('تم استلام المكافأة اليومية بالفعل - انتظر حتى تكتمل 24 ساعة');
      err.code = 'already_claimed_today';
      throw err;
    }
    // ====== حالة نادرة جدًا (تعارض مش بسبب claim تاني في نفس الفترة) -
    // نرفض برسالة عامة بدل ما نفترض نجاح غير مضمون. ======
    const err = new Error('تعذر استلام المكافأة اليومية، حاول تاني');
    err.code = 'claim_conflict';
    throw err;
  }

  // ====== من هنا، إحنا (وإحنا بس) اللي كسبنا حق منح مكافأة الفترة دي -
  // مفيش طلب تاني ممكن يوصل هنا لنفس الـ24 ساعة. منح الموارد الفعلي على القلعة. ======
  let grantedAmounts = {};
  try {
    const castle = await castleService.loadCastleCommon(userId);
    for (const resource of RESOURCE_TYPES) {
      const baseAmount = RESOURCE_REWARD_AMOUNTS[resource] || 0;
      const bonusAmount = Math.floor(baseAmount * multiplier);
      if (bonusAmount <= 0) continue;

      const cap = castleService.computeCapacity(castle, resource);
      const before = castle.resources[resource].stored;
      castle.resources[resource].stored = Math.min(cap, before + bonusAmount);
      grantedAmounts[resource] = Math.round(castle.resources[resource].stored - before);
    }
    await castle.save();
  } catch (err) {
    // ====== منح الموارد فشل بعد ما الـ claim اتسجل بالفعل - بنرجّع الحالة
    // القديمة (rollback) عشان اللاعب ميضيعش مطالبة يومه من غير ما ياخد أي
    // حاجة فعلًا. ده أفضل من ترك الستريك اتزود من غير مكافأة فعلية. ======
    await DailyRewardState.updateOne(
      { user_id: userId, last_claim_at: now },
      {
        $set: {
          last_claim_date: currentState.last_claim_date,
          last_claim_at: currentState.last_claim_at,
          current_streak: currentState.current_streak,
        },
      }
    );
    throw err;
  }

  return {
    current_streak: claimedState.current_streak,
    last_claim_date: claimedState.last_claim_date,
    granted: grantedAmounts,
  };
}

module.exports = {
  getStatus,
  claim,
};
