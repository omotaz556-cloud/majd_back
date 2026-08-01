const rallyCoordinator = require('./rallyCoordinator');

// ====== *** فيكس "التجمّع مش بيتنفّذ لوحده" *** قبل الملف ده، إطلاق أي
// تجمّع خلص العد التنازلي بتاعه (launchRally عن طريق resolveIfDue) ما كانش
// بيحصل إلا لما عضو تحالف يعمل action على نفس التجمّع (ينضم/يسيب/يلغي/يشوف
// حالته - راجع rally.service.js). لو كل الأعضاء اللي انضموا قفلوا التطبيق
// بعد الانضمام، والعد التنازلي خلص، التجمّع كان بيفضل "gathering" للأبد -
// جيوش المشاركين المتخصومة فعلًا من قلاعهم بتفضل "واقفة" جوه مستند التجمّع
// من غير أي معركة تتنفذ خالص، لحد ما حد يصادف يفتح صفحة التجمّع تاني.
//
// نفس فلسفة marchScheduler.js بالظبط: جدولة دورية عامة (من غير أي فلتر
// تحالف/لاعب) بتنادي resolveAllDueRalliesGlobal كل كذا ثانية - بتحسم أي
// تجمّع مستحق لأي تحالف مع بعض تلقائيًا في الخلفية، من غير أي اعتماد على
// مين فاتح التطبيق دلوقتي. المعركة المدموجة بتتنفذ في معادها الحقيقي
// بالظبط (launch_at)، والإشعارات (rally_battle_report/rally_defended)
// بتتبعت في نفس اللحظة دي مش لما حد يصادف يفتح صفحة. ======
const RALLY_SCHEDULER_INTERVAL_MS = 3000;

let intervalHandle = null;

async function tick() {
  try {
    await rallyCoordinator.resolveAllDueRalliesGlobal();
  } catch (err) {
    console.error('[RallyScheduler] tick failed:', err.message);
  }
}

function startRallyScheduler() {
  if (intervalHandle) return; // already running - idempotent
  intervalHandle = setInterval(() => {
    tick();
  }, RALLY_SCHEDULER_INTERVAL_MS);
}

function stopRallyScheduler() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

module.exports = { startRallyScheduler, stopRallyScheduler };
