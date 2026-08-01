// ====== إعدادات نظام المعارك (Battle System) - مرحلة "Battle Foundation" بس ======
// الملف ده بيحتوي على القيم الثابتة والـ enums اللي محتاجينها عشان نبني معركة
// (Battle Instance) وندير دورة حياتها (lifecycle) - مفيش أي منطق قتال حقيقي
// هنا لسه (مش Rule Engine ولا Combat Engine ولا Simulation Engine)، ده كله
// هيتضاف في خطوات لاحقة زي ما موضّح في modules/battle/README.md.

// ====== حالات المعركة (Battle Status) ======
// preparing : المعركة اتسجّلت (لسه المهاجم في الطريق - "بداية الهجوم")
// ready     : المسير وصل لهدفه، المعركة جاهزة تبدأ بس محرك المحاكاة لسه ما اشتغلش
// running   : محرك المحاكاة (Simulation Engine) شغال دلوقتي وبيحسب التيكات
// paused    : موقوفة مؤقتًا (مفيدة لمراجعة الحالة بين تيك وتيك - مستقبلي)
// finished  : خلصت المعركة وطلعت نتيجة نهائية (فيها winner)
// cancelled : اتلغت قبل ما تخلص (مثلاً المسير اترجع/اتسحب قبل ما يوصل)
const BATTLE_STATUS = {
  PREPARING: 'preparing',
  READY: 'ready',
  RUNNING: 'running',
  PAUSED: 'paused',
  FINISHED: 'finished',
  CANCELLED: 'cancelled',
};

// ====== خريطة الانتقالات المسموحة بين الحالات (Battle Lifecycle) ======
// أي محاولة تغيير حالة المعركة لحالة مش موجودة في القايمة المسموحة لحالتها
// الحالية المفروض تترفض - عشان نمنع حالات غير منطقية زي معركة "خلصت"
// (finished) ترجع تاني "شغالة" (running).
const ALLOWED_TRANSITIONS = {
  [BATTLE_STATUS.PREPARING]: [BATTLE_STATUS.READY, BATTLE_STATUS.CANCELLED],
  [BATTLE_STATUS.READY]: [BATTLE_STATUS.RUNNING, BATTLE_STATUS.CANCELLED],
  [BATTLE_STATUS.RUNNING]: [BATTLE_STATUS.PAUSED, BATTLE_STATUS.FINISHED],
  [BATTLE_STATUS.PAUSED]: [BATTLE_STATUS.RUNNING, BATTLE_STATUS.CANCELLED],
  [BATTLE_STATUS.FINISHED]: [],
  [BATTLE_STATUS.CANCELLED]: [],
};

function isValidTransition(fromStatus, toStatus) {
  return Array.isArray(ALLOWED_TRANSITIONS[fromStatus]) && ALLOWED_TRANSITIONS[fromStatus].includes(toStatus);
}

// ====== نتيجة المعركة (Winner) - null لحد ما تتحسم فعليًا ======
const WINNER_VALUES = ['attacker', 'defender', 'draw', null];

// ====== نوع المعركة (Battle Mode) - بيوصف "سياق" المعركة (مين ضد مين ولإيه)
// من غير ما يأثر خالص على منطق القتال نفسه (لسه مش موجود). كل الأنماط دي
// هتتبنى بالتدريج فوق نفس الأساس ده - دلوقتي بس بنسجّل النمط كـ metadata
// عشان أي فلترة/عرض مستقبلي (زي "معاركي في التحالف" أو "معارك الوحش
// العالمي") يلاقي الحقل ده جاهز من غير ما نحتاج نعدّل الموديل تاني. ======
const BATTLE_MODE = {
  PVP: 'pvp',
  PVE: 'pve',
  ALLIANCE_RALLY: 'alliance_rally',
  REINFORCEMENT: 'reinforcement',
  CASTLE_DEFENSE: 'castle_defense',
  WORLD_BOSS: 'world_boss',
  EVENT_BATTLE: 'event_battle',
};

// ====== إصدار محرك المعارك (Battle Version) - بيتسجّل جوه كل معركة وقت
// إنشائها عشان نعرف بالظبط أي نسخة من المحركات (Simulation/Rule/Combat...)
// المفروض تتستخدم لو حبينا نعيد حساب/نعيد تشغيل (Replay) المعركة دي بعد ما
// المحركات تتطور لاحقًا. لسه رقم شكلي بس لحد ما المحركات نفسها تتبنى. ======
const BATTLE_VERSION = '0.1.0-foundation';

// ====== توليد بذرة عشوائية (Random Seed) لكل معركة - أساس أي حسم عشوائي
// (crit chance, miss chance, loot variance...) هيحتاجه الـ Combat/Simulation
// Engine لاحقًا. تسجيلها هنا من أول لحظة (وقت الإنشاء) يضمن إن المعركة تقدر
// "تتعاد" (deterministic replay) بنفس النتيجة بالظبط. القيمة نفسها مش
// مستخدمة في أي حساب دلوقتي (مفيش Combat Engine لسه). ======
function generateRandomSeed() {
  return Math.floor(Math.random() * 2 ** 31);
}

// ====== توليد battleId فريد وقابل للعرض (زي kingdom_id في castle.model) ======
// بيستخدم common/counter.service لعداد تسلسلي atomic - مفيش احتمال تكرار
// حتى لو أكتر من هجوم بدأ في نفس اللحظة بالظبط.
const BATTLE_ID_PREFIX = 'BTL';
const BATTLE_ID_COUNTER_NAME = 'battle_id';
const BATTLE_ID_OFFSET = 100000; // شكلي بس (زي رقم مملكة) - مالوش تأثير على التفرد نفسه

// ====== إحصائيات افتراضية للمعركة - كل القيم بتبدأ صفر/فاضية وهتتملى فعليًا
// لما الـ Combat Engine وBattle Report يتبنوا في خطوات لاحقة. موجودة هنا
// دلوقتي بس عشان الشكل (shape) النهائي يكون واضح من أول يوم. ======
function createDefaultStatistics() {
  return {
    attacker_troops_lost: 0,
    attacker_troops_survived: 0,
    defender_troops_lost: 0,
    defender_troops_survived: 0,
    buildings_damaged: 0,
    buildings_destroyed: 0,
    walls_breached: 0,
    towers_destroyed: 0,
    gates_destroyed: 0,
    resources_looted: { gold: 0, wood: 0, stone: 0 },
    total_ticks: 0,
  };
}

// ====== سجل أحداث المعركة الأعلى مستوى (battle_events) - مختلف عن
// current_state.events (سجل خام تيك بتيك للمحاكاة الحية). battle_events هنا
// المفروض يحتوي أحداث "مهمة" ومختصرة (سور اتخرق، برج اتدمر، بوابة اتفتحت،
// قائد مات...) هتتفيد منها الـ Replay System وBattle Report بعد ما المعركة
// تخلص - من غير ما يحتاجوا يعيدوا تفسير كل تيك خام. فاضية من أول يوم لحد ما
// Simulation/Combat Engine يبدأوا يضيفوا فيها فعليًا. ======
function createEmptyBattleEvents() {
  return [];
}

// ====== حاوية فاضية لحالة المحاكاة الحية (current_state) - شكلها الحقيقي
// (مواقع الوحدات، حالة كل مبنى/سور/برج وقت كذا...) هيتحدد بالظبط لما
// الـ Simulation Engine يتبنى. دلوقتي هي مجرد حاوية عامة فاضية. ======
function createInitialCurrentState() {
  return {
    engine_version: null, // هيتحدد لما الـ Simulation Engine يتبنى
    entities: [], // placeholder - الوحدات/العناصر الحية جوه المعركة
    events: [], // placeholder - سجل الأحداث لحظة بلحظة (يفيد الـ Replay System لاحقًا)
  };
}

module.exports = {
  BATTLE_STATUS,
  ALLOWED_TRANSITIONS,
  isValidTransition,
  WINNER_VALUES,
  BATTLE_MODE,
  BATTLE_VERSION,
  generateRandomSeed,
  BATTLE_ID_PREFIX,
  BATTLE_ID_COUNTER_NAME,
  BATTLE_ID_OFFSET,
  createDefaultStatistics,
  createInitialCurrentState,
  createEmptyBattleEvents,
};
