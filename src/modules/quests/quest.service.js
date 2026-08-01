const PlayerQuestState = require('./quest.model');
const Castle = require('../castle/castle.model');
const castleService = require('../castle/castle.service');
const walletService = require('../wallets/wallet.service');
const inboxService = require('../inbox/inbox.service');
const { RESOURCE_TYPES } = require('../castle/castle.config');
const {
  QUEST_TYPES,
  QUEST_TYPE_KEYS,
  DAILY_QUEST_COUNT,
  FEATURED_QUEST_KEY,
  tierForLevel,
} = require('./quest.config');

// ====== نظام "المهام اليومية" ======
// قائمة مهام بتتجدد تلقائيًا كل يوم (مفتاح اليوم = تاريخ UTC بصيغة
// YYYY-MM-DD)، وصعوبة/مكافأة كل مهمة بتتحدد حسب "نطاق" (tier) مستوى المبنى
// الرئيسي بتاع اللاعب وقت التوليد (شوف quest.config.js). مفيش أي جدولة
// خلفية منفصلة - التوليد بيحصل lazily أول ما اللاعب يفتح المهام أو يعمل أي
// حدث بيتتبعه نظام المهام، بنفس فلسفة completeFinishedUpgrades في
// castle.service.js (كسل + idempotent بدل cron منفصل).

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

// اختيار عشوائي بدون تكرار لـ n مفتاح من قائمة، مع تفضيل FEATURED_QUEST_KEY
// (لو موجود ضمن الأنواع) عشان يكون دايمًا فيه على الأقل مهمة "صعبة/كوينز"
// واحدة ضمن القائمة اليومية.
function pickQuestKeys(count) {
  const pool = [...QUEST_TYPE_KEYS];
  const picked = [];

  if (pool.includes(FEATURED_QUEST_KEY)) {
    picked.push(FEATURED_QUEST_KEY);
    pool.splice(pool.indexOf(FEATURED_QUEST_KEY), 1);
  }

  while (picked.length < count && pool.length > 0) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(idx, 1)[0]);
  }

  return picked.slice(0, count);
}

function buildQuestFromType(questKey, tier) {
  const type = QUEST_TYPES[questKey];
  const target = type.target(tier);
  const reward = type.reward(tier);
  return {
    quest_key: type.key,
    tier,
    title: type.title,
    description: type.description_fn(target),
    icon: type.icon,
    target,
    progress: 0,
    reward,
    status: 'in_progress',
    completed_at: null,
    claimed_at: null,
  };
}

async function getTownHallLevel(userId) {
  const castle = await Castle.findOne({ user_id: userId }).select('buildings').lean();
  const townHall = castle?.buildings?.find((b) => b.key === 'town_hall');
  return townHall?.level || 1;
}

// بيرجع (وبيولّد لو لازم) قائمة المهام اليومية الحالية بتاعة اللاعب.
// التوليد بيحصل في حالتين بس: (1) أول مرة أصلًا (مفيش مستند)، أو (2) اليوم
// اتغيّر عن آخر تجديد. لو اللاعب رقّى مستواه لنطاق أعلى في نفس اليوم، مهامه
// الحالية بتفضل زي ما هي لحد التجديد اليومي التالي (عشان مايحسّش إن مهامه
// بتتغير من تحته وهو نص تقدم) - المستوى الجديد هيتطبق بس على القائمة الجديدة.
async function getOrGenerateQuests(userId) {
  const day = todayKey();
  let state = await PlayerQuestState.findOne({ user_id: userId });

  if (!state) {
    const tier = tierForLevel(await getTownHallLevel(userId));
    state = await PlayerQuestState.create({
      user_id: userId,
      quests: pickQuestKeys(DAILY_QUEST_COUNT).map((key) => buildQuestFromType(key, tier)),
      generated_tier: tier,
      generated_at: new Date(),
      day_key: day,
    });
    return state;
  }

  if (state.day_key !== day) {
    const tier = tierForLevel(await getTownHallLevel(userId));
    state.quests = pickQuestKeys(DAILY_QUEST_COUNT).map((key) => buildQuestFromType(key, tier));
    state.generated_tier = tier;
    state.generated_at = new Date();
    state.day_key = day;
    await state.save();
  }

  return state;
}

// ====== تسجيل تقدم في أي مهمة نشطة من نوع معيّن - بينادَى من نقاط الحدث في
// اللعبة (ترقية مبنى خلصت، تدريب خلص، معركة اتكسبت، حصاد موارد، تعزيز/رالي
// تحالف). آمن تمامًا لو مفيش مهمة من النوع ده ضمن القائمة اليومية الحالية
// (no-op)، أو لو المهمة خلصت بالفعل. مغلّف بالكامل بـ try/catch عند
// الاستدعاء من باقي الموديولات - فشل تتبع مهمة لازم مايوقفش أي عملية لعب
// أساسية (نفس فلسفة notifyBuildingsCompleted/notifyTrainingCompleted). ======
async function recordQuestProgress(userId, questKey, incrementBy = 1) {
  if (!incrementBy || incrementBy <= 0) return;

  const state = await getOrGenerateQuests(userId);
  const quest = state.quests.find((q) => q.quest_key === questKey && q.status === 'in_progress');
  if (!quest) return;

  quest.progress = Math.min(quest.target, quest.progress + incrementBy);
  if (quest.progress >= quest.target) {
    quest.status = 'completed';
    quest.completed_at = new Date();
    try {
      await inboxService.createSystemMessage({
        userId,
        type: 'quest_completed',
        title: 'مهمة يومية جاهزة',
        body: `خلّصت مهمة "${quest.title}" - استلم مكافأتك من قائمة المهام.`,
        metadata: { quest_key: quest.quest_key },
      });
    } catch (err) {
      console.error('[Quests] failed to send inbox message for quest completion:', err.message);
    }
  }

  await state.save();
}

// استلام مكافأة مهمة خلصت - بيضيف الموارد على قلعة اللاعب مباشرة، وأي
// كوينز مرفقة بتتحط في المحفظة عن طريق نفس مسار المعاملات العادي
// (type: 'reward') عشان تفضل مسجّلة في تاريخ المحفظة زي أي مكافأة تانية.
async function claimQuestReward(userId, questInstanceId) {
  const state = await getOrGenerateQuests(userId);
  const quest = state.quests.id(questInstanceId);
  if (!quest) throw new Error('المهمة دي مش موجودة');
  if (quest.status === 'in_progress') throw new Error('المهمة دي لسه مخلصتش');
  if (quest.status === 'claimed') throw new Error('المكافأة دي اتاستلمت بالفعل');

  const castle = await Castle.findOne({ user_id: userId });
  if (!castle) throw new Error('القلعة مش موجودة');

  castleService.syncResources(castle);

  for (const resource of RESOURCE_TYPES) {
    const amount = quest.reward?.[resource] || 0;
    if (amount <= 0) continue;
    const cap = castleService.computeCapacity(castle, resource);
    const before = castle.resources[resource].stored;
    castle.resources[resource].stored = Math.min(cap, before + amount);
  }
  await castle.save();

  if (quest.reward?.coins > 0) {
    await walletService.recordTransaction({
      userId,
      type: 'reward',
      amount: quest.reward.coins,
      taxMode: 'not_applicable',
      source: 'user',
      reason: `مكافأة مهمة يومية: ${quest.title}`,
      category: 'quest_reward',
    });
  }

  quest.status = 'claimed';
  quest.claimed_at = new Date();
  await state.save();

  return { state, quest, castle };
}

module.exports = {
  getOrGenerateQuests,
  recordQuestProgress,
  claimQuestReward,
};
