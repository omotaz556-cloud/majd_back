const marchService = require('./march.service');

// ====== *** فيكس جذري: "مفيش أي إنذار بيوصل + رسائل صندوق الوارد مش
// مظبوطة" *** قبل الملف ده، resolveDueMarches (اللي بتبدأ المعركة
// beginBattle وتحسمها finalizeAttackBattle - المصدرين الوحيدين لـ
// battle:under_attack/battle:ended وكل رسائل الإشعارات المرتبطة بالمعارك)
// ما كانتش بتتنفذ إلا Scoped بمعرف *لاعب واحد*، ومنادى عليها بس من نقاط
// نهاية بيستخدمها صاحب المسير نفسه (المهاجم) وهو بيتصفح تطبيقه. يعني لو
// المهاجم بعت جيشه وقفل التطبيق، القلعة المستهدفة (المدافع) ما كانتش تستلم
// أي تنبيه ولا أي رسالة نظام لحد ما حد يشغّل نفس الدالة بالصدفة - ده كان
// السبب الحقيقي لغياب الإنذار الفوري ولتأخّر/غياب رسائل البريد.
//
// الحل: جدولة دورية عامة (نفس فلسفة challenge.scheduler.js و
// castleBattleBroadcaster.js بالظبط) بتنادي resolveAllDueMarchesGlobal كل
// كذا ثانية - بتحسم مسايرات *كل اللاعبين* مع بعض تلقائيًا في الخلفية، من غير
// أي اعتماد على مين فاتح التطبيق دلوقتي. كده بداية/نهاية أي معركة بتتحصل في
// معادها الحقيقي بالظبط (arrives_at/battle_ends_at)، والتنبيهات الفورية
// (الويب سوكيت) ورسائل صندوق الوارد بتتبعت في نفس اللحظة دي مش لما حد يصادف
// يفتح صفحة. ======
const MARCH_SCHEDULER_INTERVAL_MS = 3000;

let intervalHandle = null;

async function tick() {
  try {
    await marchService.resolveAllDueMarchesGlobal();
  } catch (err) {
    console.error('[MarchScheduler] tick failed:', err.message);
  }
}

function startMarchScheduler() {
  if (intervalHandle) return; // already running - idempotent
  intervalHandle = setInterval(() => {
    tick();
  }, MARCH_SCHEDULER_INTERVAL_MS);
}

function stopMarchScheduler() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

module.exports = { startMarchScheduler, stopMarchScheduler };
