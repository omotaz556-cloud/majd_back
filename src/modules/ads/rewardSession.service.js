const { randomUUID } = require('crypto');
const RewardSession = require('./models/rewardSession.model');
const AdView = require('./models/adView.model');
const User = require('../users/user.model');
const Castle = require('../castle/castle.model');
const Battle = require('../battle/battle.model');
const castleService = require('../castle/castle.service');
const { signSession, verifySessionToken } = require('./rewardSessionToken.util');
const {
  ADS_PROVIDER,
  ADS_ENABLED,
  REWARD_SESSION_TTL_SECONDS,
} = require('./ads.config');
const {
  REWARD_KIND,
  REWARD_KIND_VALUES,
  RESOURCE_TYPES,
  RESOURCE_REWARD_AMOUNTS,
  DOUBLE_REWARD_MULTIPLIER,
  DAILY_DOUBLE_MULTIPLIER,
  DAILY_DOUBLE_COOLDOWN_HOURS,
  HOURLY_GIFT_COOLDOWN_HOURS,
  HOURLY_GIFT_POOL,
  SPEEDUP_CONSTRUCTION_FLAT_SECONDS,
  SPEEDUP_CONSTRUCTION_PERCENT,
  SPEEDUP_CONSTRUCTION_MIN_REMAINING_SECONDS,
} = require('./rewardKinds.config');
const logger = require('./ads.logger');

/**
 * ====== Rewarded Ads Gameplay System (Castle Game) ======
 *
 * المشروع ده فيه لعبة واحدة بس (Castle Game) - النظام ده مبني حوالين
 * جيمبلاي القلعة تحديدًا، مش نظام عام لأي لعبة. مفيش "Wallet: Watch Ad &
 * Earn Coins" تاني - الإعلانات المكافئة بقت جزء من اللعب نفسه عن طريق
 * أنواع مكافآت (Reward Kinds) مختلفة:
 *
 *   - resources            : إضافة Gold/Wood/Stone لقلعة اللاعب مباشرة
 *   - double_reward        : مضاعفة غنيمة (loot) آخر معركة خلصها اللاعب وكسبها
 *   - daily_double          : مضاعفة مكافأة يومية (مرة كل عدد ساعات محدد)
 *   - hourly_gift           : جايزة عشوائية من حوض جوائز (مرة كل ساعة افتراضيًا)
 *   - speedup_construction  : تسريع ترقية/إنشاء مبنى شغال حاليًا (يقتطع جزء
 *                             من الوقت المتبقي، مش يخلّصها فورًا) - مرة واحدة
 *                             بس لكل ترقية (راجع ad_speedup_used)
 *
 * المكافأة أبداً ما بتتمنح من الفرونت إند مباشرة - نفس تدفق الحماية القديم:
 *
 *   1) startRewardSession(kind, context)
 *      -> بينشئ RewardSession بحالة "pending" + signedToken + expiresAt.
 *         الـ context (مثلاً { battleId }) بيتخزن كـ payload، وأي قيمة
 *         مكافأة فعلية (كمية مورد، نسبة مضاعفة...) بتتحسب من
 *         rewardKinds.config.js بس - الـ service ده أبداً ما بيخترع رقم.
 *
 *   2) الفرونت إند بيعرض الإعلان الفعلي (GPT rewarded slot)
 *
 *   3) completeRewardSession(sessionId, userId, signedToken, providerPayload)
 *      -> بيتحقق من: وجود الجلسة، ملكيتها، التوقيع، الحالة (لسه pending)،
 *         عدم انتهاء الصلاحية - ثم بينفذ المكافأة حسب kind (راجع
 *         executeReward تحت) ويمنع أي محاولة تانية تستخدم نفس sessionId.
 */

// ====== اختيار عنصر عشوائي موزون (weighted random) من حوض هدية الساعة -
// كل عنصر بوزنه بيحدد احتمالية ظهوره (وزن أعلى = يظهر أكتر). المنطق ده بس
// "طريقة الاختيار" - القيم نفسها (resource/amount/weight) بتيجي بالكامل من
// rewardKinds.config.js، مفيش أي رقم هنا. ======
function pickWeightedGift(pool) {
  const totalWeight = pool.reduce((sum, item) => sum + (Number(item.weight) || 0), 0);
  if (totalWeight <= 0) return pool[0];

  let roll = Math.random() * totalWeight;
  for (const item of pool) {
    roll -= Number(item.weight) || 0;
    if (roll <= 0) return item;
  }
  return pool[pool.length - 1]; // احتياطي دفاعي (تقريب عشري نادر)
}

// ====== حساب سياق/قيمة كل نوع مكافأة وقت /start - من غير أي منطق تنفيذ هنا،
// بس تجهيز الـ payload اللي هيتخزن في الجلسة وهيتقرأ تاني وقت /complete. كل
// قيمة راجعة من rewardKinds.config.js بس - مفيش رقم hardcoded هنا. ======
async function buildStartPayload(kind, context, userId) {
  switch (kind) {
    case REWARD_KIND.RESOURCES: {
      const resource = context?.resource;
      if (!RESOURCE_TYPES.includes(resource)) {
        throw new Error(`Invalid or missing resource for reward kind "resources". Expected one of: ${RESOURCE_TYPES.join(', ')}`);
      }
      const amount = RESOURCE_REWARD_AMOUNTS[resource];
      return { payload: { resource, amount }, reward: amount };
    }

    case REWARD_KIND.DOUBLE_REWARD: {
      const battleId = context?.battleId;
      if (!battleId) {
        throw new Error('Missing battleId for reward kind "double_reward"');
      }
      const battle = await Battle.findOne({ battle_id: battleId }).select(
        'attacker.user_id winner battle_result.loot'
      );
      if (!battle) {
        throw new Error('Battle not found');
      }
      if (String(battle.attacker?.user_id) !== String(userId)) {
        throw new Error('This battle does not belong to this user');
      }
      if (battle.winner !== 'attacker') {
        throw new Error('Only a won battle with loot can be doubled');
      }
      const lootTotal = Number(battle.battle_result?.loot?.total_value) || 0;
      if (lootTotal <= 0) {
        throw new Error('This battle has no loot to double');
      }
      return { payload: { battleId }, reward: null };
    }

    case REWARD_KIND.DAILY_DOUBLE: {
      const castle = await Castle.findOne({ user_id: userId }).select('ads_state');
      if (!castle) {
        throw new Error('Castle not found');
      }
      const lastAt = castle.ads_state?.last_daily_double_at;
      if (lastAt) {
        const cooldownMs = DAILY_DOUBLE_COOLDOWN_HOURS * 60 * 60 * 1000;
        const elapsedMs = Date.now() - new Date(lastAt).getTime();
        if (elapsedMs < cooldownMs) {
          const hoursLeft = Math.ceil((cooldownMs - elapsedMs) / (60 * 60 * 1000));
          throw new Error(`Daily double is not available yet (try again in ~${hoursLeft}h)`);
        }
      }
      return { payload: {}, reward: null };
    }

    case REWARD_KIND.HOURLY_GIFT: {
      const castle = await Castle.findOne({ user_id: userId }).select('ads_state');
      if (!castle) {
        throw new Error('Castle not found');
      }
      const lastAt = castle.ads_state?.last_hourly_gift_at;
      if (lastAt) {
        const cooldownMs = HOURLY_GIFT_COOLDOWN_HOURS * 60 * 60 * 1000;
        const elapsedMs = Date.now() - new Date(lastAt).getTime();
        if (elapsedMs < cooldownMs) {
          const minutesLeft = Math.ceil((cooldownMs - elapsedMs) / (60 * 1000));
          throw new Error(`Hourly gift is not available yet (try again in ~${minutesLeft}m)`);
        }
      }

      // ====== الجايزة بتتحدد عشوائيًا *هنا* (وقت /start، مش /complete) وبتتخزن
      // جوه الجلسة نفسها - يعني نفس الجايزة اللي اتحسبت هنا هي بالظبط اللي
      // هتتمنح بعد ما الإعلان يخلص (مفيش "إعادة رمي زهر" وقت /complete ممكن
      // تدي نتيجة مختلفة). ======
      const gift = pickWeightedGift(HOURLY_GIFT_POOL);
      return { payload: { resource: gift.resource, amount: gift.amount }, reward: gift.amount };
    }

    case REWARD_KIND.SPEEDUP_CONSTRUCTION: {
      const buildingKeyOrId = context?.buildingId || context?.buildingKey;
      if (!buildingKeyOrId) {
        throw new Error('Missing buildingId for reward kind "speedup_construction"');
      }
      // ====== loadCastleCommon مش Castle.findOne خام - عشان لو الترقية
      // خلصت وقتها بالفعل (completes_at فات) بس محدّش عمل أي أكشن على
      // القلعة لسه يسجّل الإكمال، completeFinishedUpgrades هنا بتستكملها
      // وupgrade.in_progress بيبقى false فورًا - فـ assertSpeedupConstructionEligible
      // تحت بترفض صح ("مفيهوش ترقية شغالة") بدل ما تفترض غلط إنها لسه شغالة. ======
      const castle = await castleService.loadCastleCommon(userId);
      const building = assertSpeedupConstructionEligible(castle, buildingKeyOrId);
      // ====== الـ building._id (مش أي key) هو اللي بيتخزن جوه الجلسة - عشان
      // /complete يقدر يلاقي *نفس المبنى بالظبط* حتى لو كان اتباعت بالـ key
      // وقت /start (المبنى ممكن يتشال أو الـ key يبقى غامض لو فيه أكتر من
      // مبنى بنفس الـ key - نادر بس ممكن). ======
      return { payload: { buildingId: building._id.toString() }, reward: null };
    }

    default:
      // لا يصل هنا عمليًا (kind اتفحص أصلًا في startRewardSession) - حارس دفاعي بس
      throw new Error(`Unsupported reward kind: ${kind}`);
  }
}

// ====== إيجاد مبنى بالـ id (ObjectId) أو الـ key - نفس منطق startUpgrade/
// speedupBuildingUpgrade في castle.service.js بالظبط (بندعم الاتنين عشان
// الفرونت إند يقدر يبعت أي واحد فيهم). ======
function findBuilding(castle, buildingKeyOrId) {
  let building = null;
  if (/^[0-9a-fA-F]{24}$/.test(String(buildingKeyOrId))) {
    building = castle.buildings.id(buildingKeyOrId);
  }
  if (!building) {
    building = castle.buildings.find((b) => b.key === buildingKeyOrId);
  }
  return building;
}

// ====== تحقق مشترك لأهلية "تسريع البناء بإعلان" - بينادى عليه مرتين: مرة
// وقت /start (تجربة مستخدم أسرع - رفض فوري قبل ما اللاعب يشوف الإعلان أصلًا)
// ومرة تانية وقت /complete (الحماية الحقيقية - نفس فلسفة hourly_gift/
// daily_double: الحالة ممكن تتغيّر بين اللحظتين، زي المبنى يخلص من تلقاء
// نفسه أو اللاعب يسرّعه بالجواهر وهو مستني الإعلان يخلص). بيرجّع المبنى نفسه
// لو كل شيء سليم، أو بيرمي Error برسالة واضحة. ======
function assertSpeedupConstructionEligible(castle, buildingKeyOrId) {
  const building = findBuilding(castle, buildingKeyOrId);
  if (!building) {
    throw new Error('المبنى ده مش موجود');
  }
  if (!building.upgrade?.in_progress || !building.upgrade?.completes_at) {
    throw new Error('المبنى ده مفيهوش أي ترقية أو إنشاء شغال دلوقتي');
  }
  if (building.upgrade.ad_speedup_used) {
    throw new Error('اتستخدم إعلان تسريع البناء على الترقية دي بالفعل');
  }

  const remainingSeconds = Math.max(0, (building.upgrade.completes_at.getTime() - Date.now()) / 1000);
  if (remainingSeconds < SPEEDUP_CONSTRUCTION_MIN_REMAINING_SECONDS) {
    throw new Error('الوقت المتبقي قليل جدًا عشان تسريع البناء بإعلان');
  }

  return building;
}

// ====== GET status لهدية الساعة - بيرجّع للفرونت إند هل اللاعب مستحق دلوقتي
// ولا لأ + كام ثانية باقية للكولداون، عشان الكارت يقدر يعرض عدّاد تنازلي حي
// من غير ما يحاول /start ويعتمد على رسالة الخطأ. مفيش أي منطق منح هنا - قراءة
// بس، نفس القيم اللي buildStartPayload بيتحقق منها بالظبط. ======
async function getHourlyGiftStatus(userId) {
  const castle = await Castle.findOne({ user_id: userId }).select('ads_state');
  if (!castle) {
    throw new Error('Castle not found');
  }

  const cooldownMs = HOURLY_GIFT_COOLDOWN_HOURS * 60 * 60 * 1000;
  const lastAt = castle.ads_state?.last_hourly_gift_at;

  if (!lastAt) {
    return { eligible: true, secondsRemaining: 0, cooldownHours: HOURLY_GIFT_COOLDOWN_HOURS };
  }

  const elapsedMs = Date.now() - new Date(lastAt).getTime();
  const remainingMs = Math.max(0, cooldownMs - elapsedMs);

  return {
    eligible: remainingMs <= 0,
    secondsRemaining: Math.ceil(remainingMs / 1000),
    cooldownHours: HOURLY_GIFT_COOLDOWN_HOURS,
  };
}

async function startRewardSession({ userId, adUnit, kind, context = {} }) {
  if (!ADS_ENABLED) {
    throw new Error('Ads are disabled (ADS_ENABLED=false)');
  }

  if (!REWARD_KIND_VALUES.includes(kind)) {
    throw new Error(`Invalid reward kind. Expected one of: ${REWARD_KIND_VALUES.join(', ')}`);
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  const { payload, reward } = await buildStartPayload(kind, context, userId);

  const sessionId = randomUUID();
  const signedToken = signSession(sessionId, userId);
  const expiresAt = new Date(Date.now() + REWARD_SESSION_TTL_SECONDS * 1000);

  const session = await RewardSession.create({
    sessionId,
    userId,
    provider: ADS_PROVIDER,
    adUnit: adUnit || null,
    kind,
    payload,
    reward,
    status: 'pending',
    completed: false,
    signedToken,
    expiresAt,
  });

  await AdView.create({
    userId,
    provider: ADS_PROVIDER,
    adType: 'rewarded',
    adUnit: adUnit || null,
    status: 'requested',
    sessionId,
  });

  logger.info('Reward session started', { sessionId, userId: String(userId), kind });

  return {
    sessionId: session.sessionId,
    signedToken,
    kind: session.kind,
    payload: session.payload,
    reward: session.reward,
    expiresAt: session.expiresAt,
  };
}

// ====== تنفيذ فعلي للمكافأة حسب kind - بينادى بس من جوه completeRewardSession
// بعد ما كل التحققات الأمنية (ownership/token/status/expiry) عدّت بنجاح.
// بيرجع { grantedSummary } عشان completeRewardSession يقدر يبني رد واضح
// للفرونت إند. ======
async function executeReward(session) {
  const { kind, payload, userId } = session;

  switch (kind) {
    case REWARD_KIND.RESOURCES: {
      const { resource, amount } = payload || {};
      const { granted } = await castleService.grantResources(userId, resource, amount);
      logger.debug('Resources granted via reward session', {
        sessionId: session.sessionId,
        resource,
        granted,
      });
      return { grantedSummary: { resource, amount: granted } };
    }

    case REWARD_KIND.DOUBLE_REWARD: {
      const { battleId } = payload || {};
      const battle = await Battle.findOne({ battle_id: battleId });
      if (!battle) {
        throw new Error('Battle not found');
      }
      if (String(battle.attacker?.user_id) !== String(userId)) {
        throw new Error('This battle does not belong to this user');
      }
      if (battle.winner !== 'attacker') {
        throw new Error('Only a won battle with loot can be doubled');
      }

      const looted = battle.battle_result?.loot?.looted || {};
      const castle = await castleService.loadCastleCommon(userId);

      const doubledAmounts = {};
      for (const resource of RESOURCE_TYPES) {
        const originalAmount = Math.max(0, Number(looted[resource]) || 0);
        if (originalAmount <= 0) continue;

        const bonusAmount = Math.floor(originalAmount * DOUBLE_REWARD_MULTIPLIER);
        if (bonusAmount <= 0) continue;

        const cap = castleService.computeCapacity(castle, resource);
        const before = castle.resources[resource].stored;
        castle.resources[resource].stored = Math.min(cap, before + bonusAmount);
        doubledAmounts[resource] = Math.round(castle.resources[resource].stored - before);
      }

      await castle.save();

      logger.debug('Battle loot doubled via reward session', {
        sessionId: session.sessionId,
        battleId,
        doubledAmounts,
      });

      return { grantedSummary: { battleId, doubled: doubledAmounts } };
    }

    case REWARD_KIND.DAILY_DOUBLE: {
      const castle = await castleService.loadCastleCommon(userId);

      const lastAt = castle.ads_state?.last_daily_double_at;
      if (lastAt) {
        const cooldownMs = DAILY_DOUBLE_COOLDOWN_HOURS * 60 * 60 * 1000;
        const elapsedMs = Date.now() - new Date(lastAt).getTime();
        if (elapsedMs < cooldownMs) {
          throw new Error('Daily double is not available yet');
        }
      }

      // ====== المكافأة اليومية المضاعفة هنا معناها: إضافة كمية إضافية من
      // كل مورد بنسبة DAILY_DOUBLE_MULTIPLIER فوق "الأساس اليومي" المحدد في
      // rewardKinds.config.js (RESOURCE_REWARD_AMOUNTS - نفس القيم المستخدمة
      // في مكافأة resources العادية، ده هو "الأساس" اللي بيتضاعف). ======
      const grantedAmounts = {};
      for (const resource of RESOURCE_TYPES) {
        const baseAmount = RESOURCE_REWARD_AMOUNTS[resource];
        const bonusAmount = Math.floor(baseAmount * DAILY_DOUBLE_MULTIPLIER);
        if (bonusAmount <= 0) continue;

        const cap = castleService.computeCapacity(castle, resource);
        const before = castle.resources[resource].stored;
        castle.resources[resource].stored = Math.min(cap, before + bonusAmount);
        grantedAmounts[resource] = Math.round(castle.resources[resource].stored - before);
      }

      castle.ads_state = { ...(castle.ads_state || {}), last_daily_double_at: new Date() };
      await castle.save();

      logger.debug('Daily double granted via reward session', {
        sessionId: session.sessionId,
        grantedAmounts,
      });

      return { grantedSummary: { granted: grantedAmounts } };
    }

    case REWARD_KIND.HOURLY_GIFT: {
      const { resource, amount } = payload || {};
      if (!resource || !amount) {
        throw new Error('Missing gift resource/amount in session payload');
      }

      // ====== إعادة تحقق الكولداون هنا كمان (مش بس وقت /start) - نفس فلسفة
      // double_reward/daily_double: الفحص وقت /start بس تجربة مستخدم أسرع
      // (رفض فوري قبل ما يشوف الإعلان أصلًا)، لكن الحماية الحقيقية اللي
      // بتمنع استغلال فعلي (فتح جلستين متتاليتين بسرعة) هي هنا وقت التنفيذ
      // الفعلي، فوق نفس مستند القلعة اللي هيتحفظ. ======
      const castle = await castleService.loadCastleCommon(userId);

      const lastAt = castle.ads_state?.last_hourly_gift_at;
      if (lastAt) {
        const cooldownMs = HOURLY_GIFT_COOLDOWN_HOURS * 60 * 60 * 1000;
        const elapsedMs = Date.now() - new Date(lastAt).getTime();
        if (elapsedMs < cooldownMs) {
          throw new Error('Hourly gift is not available yet');
        }
      }

      const cap = castleService.computeCapacity(castle, resource);
      const before = castle.resources[resource].stored;
      castle.resources[resource].stored = Math.min(cap, before + amount);
      const granted = Math.round(castle.resources[resource].stored - before);

      castle.ads_state = { ...(castle.ads_state || {}), last_hourly_gift_at: new Date() };
      await castle.save();

      logger.debug('Hourly gift granted via reward session', {
        sessionId: session.sessionId,
        resource,
        granted,
      });

      return { grantedSummary: { resource, amount: granted } };
    }

    case REWARD_KIND.SPEEDUP_CONSTRUCTION: {
      const { buildingId } = payload || {};
      if (!buildingId) {
        throw new Error('Missing buildingId in session payload');
      }

      // ====== إعادة تحقق كاملة هنا كمان (مش بس وقت /start) - نفس فلسفة
      // hourly_gift/daily_double بالظبط: الفحص وقت /start تجربة مستخدم أسرع
      // بس، الحماية الحقيقية اللي بتمنع استغلال فعلي (المبنى خلص أو اتسرّع
      // بالجواهر أو اتلغى وهو مستني الإعلان يخلص) هي هنا وقت التنفيذ الفعلي،
      // فوق نفس مستند القلعة اللي هيتحفظ. loadCastleCommon (مش findOne خام)
      // عشان completeFinishedUpgrades تستكمل أي ترقية خلصت فعليًا الأول. ======
      const castle = await castleService.loadCastleCommon(userId);
      const building = assertSpeedupConstructionEligible(castle, buildingId);

      const now = Date.now();
      const totalDurationMs = building.upgrade.completes_at.getTime() - building.upgrade.started_at.getTime();
      const remainingMs = building.upgrade.completes_at.getTime() - now;

      // ====== الوقت المقتطَع = أكبر قيمة بين الثواني الثابتة والنسبة
      // المئوية من *إجمالي* مدة الترقية الأصلية (مش من الوقت المتبقي) - نفس
      // فلسفة rewardKinds.config.js بالظبط. مقتطَع أبدًا مش هيتخطى الوقت
      // المتبقي نفسه (Math.min مع remainingMs) عشان completes_at مايوصلش
      // قبل دلوقتي (لو كان بيتخطاه، كان معناه المبنى المفروض يخلص فورًا -
      // ده مقبول ومحسوب صح برضه، بس بنوضحه صراحة هنا). ======
      const flatMs = SPEEDUP_CONSTRUCTION_FLAT_SECONDS * 1000;
      const percentMs = totalDurationMs * SPEEDUP_CONSTRUCTION_PERCENT;
      const skipMs = Math.min(remainingMs, Math.max(flatMs, percentMs));

      building.upgrade.completes_at = new Date(building.upgrade.completes_at.getTime() - skipMs);
      building.upgrade.ad_speedup_used = true;

      // ====== لو الاقتطاع خلّى completes_at الجديد يبقى دلوقتي أو قبلها،
      // نستكمل الترقية فورًا بدل ما نسيب upgrade.in_progress=true بـ
      // completes_at فات - نفس أثر completeFinishedUpgrades بالظبط (بما في
      // ذلك توسيع مساحة المدينة لو المبنى الرئيسي هو اللي اترقّى)، عشان
      // القلعة تفضل متسقة فورًا من غير ما تستنى استعلام تاني يمرّ من
      // loadCastleCommon. ======
      let completedNow = false;
      if (building.upgrade.completes_at.getTime() <= now) {
        const targetLevel = building.upgrade.target_level;
        building.level = targetLevel;
        building.upgrade.in_progress = false;
        building.upgrade.target_level = null;
        building.upgrade.started_at = null;
        building.upgrade.completes_at = null;
        completedNow = true;
        if (building.key === 'town_hall') {
          castleService.expandCityToLevelCap(castle);
        }
      }

      await castle.save();

      logger.debug('Construction sped up via reward session', {
        sessionId: session.sessionId,
        buildingId,
        skippedSeconds: Math.round(skipMs / 1000),
        completedNow,
      });

      // ====== مفيش castle كامل بيترجع من هنا عمدًا (نفس فلسفة كل الـ
      // grantedSummary التانية فوق - resources/double_reward/daily_double/
      // hourly_gift كلهم بيرجّعوا بس ملخّص بسيط، مش المستند الخام). الفرونت
      // إند بيعتمد على grantedSummary عشان يحدّث عدّاد الترقية فورًا (بدري
      // من غير ما يستنى استعلام تاني)، والقلعة كاملة بترجع فعليًا كجزء
      // طبيعي من أي getMyCastle() الجاي (نفس ما بيحصل مع أي أكشن تاني على
      // القلعة). ======
      return {
        grantedSummary: {
          buildingId,
          buildingKey: building.key,
          skippedSeconds: Math.round(skipMs / 1000),
          completedNow,
          newLevel: completedNow ? building.level : null,
          newCompletesAt: completedNow ? null : building.upgrade.completes_at,
        },
      };
    }

    default:
      throw new Error(`Unsupported reward kind: ${kind}`);
  }
}

async function completeRewardSession({ sessionId, userId, signedToken, providerPayload = null }) {
  if (!sessionId || !userId || !signedToken) {
    throw new Error('sessionId, userId and signedToken are required');
  }

  const session = await RewardSession.findOne({ sessionId });
  if (!session) {
    logger.warn('Reward rejected: session not found', { sessionId });
    throw new Error('Reward session not found');
  }

  if (String(session.userId) !== String(userId)) {
    logger.warn('Reward rejected: session/user mismatch', { sessionId, userId: String(userId) });
    throw new Error('Session does not belong to this user');
  }

  // Idempotency / replay protection: لو الجلسة اتكملت أو اتعمّلها reject قبل
  // كده، منرجعش نمنح تاني - بنرد بنتيجة واضحة بدل ما نرمي error غامض
  if (session.completed || session.status === 'completed') {
    logger.info('Reward already completed (idempotent)', { sessionId });
    return { alreadyProcessed: true, sessionId, kind: session.kind, reward: session.reward };
  }

  if (session.status === 'rejected' || session.status === 'expired') {
    logger.warn('Reward rejected: session already closed', { sessionId, status: session.status });
    throw new Error(`Session already ${session.status}`);
  }

  if (session.expiresAt.getTime() < Date.now()) {
    await RewardSession.updateOne(
      { sessionId, status: 'pending' },
      { $set: { status: 'expired' } }
    );
    logger.warn('Reward rejected: session expired', { sessionId });
    throw new Error('Reward session has expired');
  }

  const isValidToken = verifySessionToken(sessionId, userId, signedToken);
  if (!isValidToken) {
    await RewardSession.updateOne(
      { sessionId, status: 'pending' },
      { $set: { status: 'rejected' } }
    );
    logger.warn('Reward rejected: invalid signed token', { sessionId });
    throw new Error('Invalid session token');
  }

  const user = await User.findById(userId);
  if (!user) {
    await RewardSession.updateOne(
      { sessionId, status: 'pending' },
      { $set: { status: 'rejected' } }
    );
    throw new Error('User not found');
  }

  // ====== Atomic claim (يحل الـ TOCTOU race condition) ======
  // كل التحققات فوق (ownership/token/expiry) ممكن يعدّيها أكتر من طلب
  // متزامن في نفس اللحظة وهما لسه شايفين نفس نسخة الجلسة بحالة 'pending'.
  // الحماية الحقيقية هنا: findOneAndUpdate بشرط status:'pending' *جوه نفس
  // الاستعلام الواحد* - عملية ذرية على مستوى الداتابيز نفسها (compare-and-
  // swap). لو طلبين اتسابقوا، واحد بس هيلاقي مستند يطابق status:'pending'
  // وقت تنفيذ الأمر ده بالظبط ويحوّله لـ 'processing'، والتاني هيرجع null
  // فورًا من غير أي فرصة إنه ينفّذ executeReward أصلاً - مش بعد ما ينفّذها.
  //
  // ====== Stale 'processing' recovery ======
  // لو السيرفر كرّش (أو الـ process اتقفل) بالظبط بين لحظة claim ولحظة ما
  // الجلسة تتحول completed/rejected، هتفضل عالقة على 'processing' للأبد -
  // مافيش أي طلب تاني (حتى لو شرعي) هيقدر يستولي عليها تاني، لأن الشرط
  // status:'pending' مش هيطابقها. عشان كده بنسمح بإعادة المطالبة لو الجلسة
  // فضلت processing لمدة أطول من فترة سماح معقولة (updatedAt أقدم من كذا
  // ثانية) - ده استثناء ضيق جدًا (crash recovery بس)، مش باب خلفي لأي حد
  // يعيد المحاولة وقت عادي.
  const STALE_PROCESSING_GRACE_MS = 30 * 1000;
  const claimedSession = await RewardSession.findOneAndUpdate(
    {
      sessionId,
      $or: [
        { status: 'pending' },
        { status: 'processing', updatedAt: { $lt: new Date(Date.now() - STALE_PROCESSING_GRACE_MS) } },
      ],
    },
    { $set: { status: 'processing' } },
    { new: true }
  );

  if (!claimedSession) {
    // ====== حد تاني (أو نفس الطلب اتبعت مرتين بالصدفة) سبقنا واستولى على
    // الجلسة، أو حالتها اتغيرت من تحتينا بين القراءة الأولى فوق ودلوقتي.
    // نعيد قراءة الحالة الحالية ونرجع رد متسق بدل ما نفترض حاجة. ======
    const current = await RewardSession.findOne({ sessionId });
    if (current && (current.completed || current.status === 'completed')) {
      logger.info('Reward already completed (idempotent, race detected)', { sessionId });
      return { alreadyProcessed: true, sessionId, kind: current.kind, reward: current.reward };
    }
    if (current && current.status === 'processing') {
      // ====== طلب تاني بيتنفذ فعليًا دلوقتي - لسه مش completed. مافيش
      // نتيجة نرجعها بأمان غير رفض واضح؛ الفرونت إند يقدر يعيد المحاولة. ======
      logger.info('Reward already being processed by a concurrent request', { sessionId });
      throw new Error('Reward is already being processed');
    }
    logger.warn('Reward rejected: session no longer claimable', {
      sessionId,
      status: current?.status,
    });
    throw new Error(`Session already ${current?.status || 'closed'}`);
  }

  logger.debug('Reward claimed atomically, executing reward kind', { sessionId, kind: claimedSession.kind });

  let executionResult;
  try {
    executionResult = await executeReward(claimedSession);
  } catch (err) {
    // ====== لو تنفيذ المكافأة نفسه فشل (مثلاً المعركة اتغيرت حالتها بين
    // /start و/complete)، الجلسة بترفض صراحة - مايفضلش "processing" معلق
    // ممكن يتحاول يتنفذ تاني بحالة غير متسقة. ======
    await RewardSession.updateOne(
      { sessionId, status: 'processing' },
      { $set: { status: 'rejected' } }
    );
    logger.warn('Reward rejected: execution failed', { sessionId, error: err.message });
    throw err;
  }

  // ====== إغلاق الجلسة نهائيًا. الشرط status:'processing' هنا دفاعي بس -
  // إحنا الوحيدين اللي كان ممكن يوصلوا للسطر ده أصلاً (claimedSession
  // فوق ضمن كده). ======
  await RewardSession.updateOne(
    { sessionId, status: 'processing' },
    {
      $set: {
        status: 'completed',
        completed: true,
        providerPayload,
      },
    }
  );

  await AdView.findOneAndUpdate(
    { sessionId },
    {
      status: 'closed',
      rewardGranted: true,
      rewardAmount: claimedSession.reward || 0,
    }
  );

  logger.info('Reward granted', {
    sessionId,
    userId: String(userId),
    kind: claimedSession.kind,
  });

  return {
    processed: true,
    sessionId,
    kind: claimedSession.kind,
    reward: claimedSession.reward,
    ...executionResult,
  };
}

/**
 * ====== Webhook handler (لمزوّدين مستقبليين) ======
 * بعض شبكات الإعلانات بتدعم إرسال webhook مباشر للسيرفر كمصدر تحقق إضافي.
 * ده مجرد نقطة استقبال عامة بتسجّل الـ payload وتحاول تربطه بجلسة موجودة.
 */
async function handleProviderWebhook(payload) {
  logger.info('Webhook received', { provider: ADS_PROVIDER });

  const sessionId = payload?.sessionId || payload?.session_id || null;
  if (!sessionId) {
    logger.warn('Webhook missing sessionId, stored as unlinked event', {});
    return { linked: false };
  }

  const session = await RewardSession.findOne({ sessionId });
  if (!session) {
    logger.warn('Webhook sessionId does not match any session', { sessionId });
    return { linked: false };
  }

  session.providerPayload = { ...(session.providerPayload || {}), webhook: payload };
  await session.save();

  return { linked: true, sessionId };
}

module.exports = {
  startRewardSession,
  completeRewardSession,
  handleProviderWebhook,
  getHourlyGiftStatus,
};
