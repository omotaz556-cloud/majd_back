require('dotenv').config({ quiet: true });

const http = require('http');
const app = require('./app');
const connectDB = require('./config/db');
const { PAYMENT_PROVIDER, ADS_PROVIDER } = require('./config/providers');
const { initializeWorldOnStartup } = require('./modules/world/worldInit.service');
// ====== Phase 1 (Reinforcement & Battle System) - طبقة الويب سوكيت (إشعارات
// "تحت الهجوم" فورية + باور القلعة الحي) لازم تتركب فوق http.Server خام
// (مش app.listen مباشرة زي قبل كده) عشان socket.io يقدر يشارك نفس الـ port. ======
const { initSocket } = require('./realtime/socket');
const {
  startCastleBattleBroadcaster,
  stopCastleBattleBroadcaster,
} = require('./modules/castle/castleBattleBroadcaster');
// ====== فيكس جذري: من غير الجدولة دي، بداية/نهاية المعارك (وبالتالي كل
// تنبيهات الويب سوكيت ورسائل صندوق الوارد المرتبطة بيها) ما كانتش بتتحصل
// إلا لما صاحب المسير نفسه يفتح حاجة في التطبيق - راجع marchScheduler.js
// للتفاصيل الكاملة. ======
const { startMarchScheduler, stopMarchScheduler } = require('./modules/castle/marchScheduler');
// ====== نفس فيكس marchScheduler بالظبط بس لتجمّعات التحالف (Rally) - من
// غيرها، إطلاق أي تجمّع خلص عد تنازلي بتاعه كان بيعتمد على عضو تحالف
// يفتح صفحة التجمّع بالصدفة (راجع rallyScheduler.js للتفاصيل الكاملة). ======
const { startRallyScheduler, stopRallyScheduler } = require('./modules/alliances/rallyScheduler');

const PORT = process.env.PORT || 5000;

async function start() {
  try {
    await connectDB();

    // ====== NPC World System: idempotent world init on every boot - logs
    // "World already initialized." on restarts, or generates once on a
    // fresh database. Never requires a manual script after deployment.
    // Failures are logged but never crash the server (existing player
    // traffic must keep working even if world generation had a problem). ======
    await initializeWorldOnStartup();

    const httpServer = http.createServer(app);
    initSocket(httpServer);

    httpServer.listen(PORT, () => {
      console.log(`[Server] Majd Games backend running on port ${PORT}`);
      console.log(`[Server] PAYMENT_PROVIDER=${PAYMENT_PROVIDER} | ADS_PROVIDER=${ADS_PROVIDER}`);
      console.log('[Server] Realtime (Socket.IO) attached for castle-under-attack + live power updates');
    });

    // ====== بث دوري لباور أي قلعة تحت هجوم شغالة دلوقتي (راجع
    // castleBattleBroadcaster.js) - نفس فلسفة startChallengeScheduler فوق. ======
    startCastleBattleBroadcaster();

    // ====== جدولة عامة تحسم كل المسايرات المستحقة لكل اللاعبين مع بعض -
    // بداية/نهاية أي معركة، ووصول أي تعزيز/عودة - من غير أي اعتماد على مين
    // فاتح التطبيق دلوقتي (راجع marchScheduler.js). ======
    startMarchScheduler();

    // ====== جدولة عامة تحسم أي تجمّع تحالف (Rally) خلص العد التنازلي
    // بتاعه - نفس فلسفة startMarchScheduler فوق بالظبط (راجع
    // rallyScheduler.js). ======
    startRallyScheduler();
  } catch (err) {
    console.error('[Server] Failed to start:', err.message);
    process.exit(1);
  }
}

// إيقاف نضيف للجدولة عند إيقاف السيرفر (deploys، restarts، إلخ)
process.on('SIGTERM', () => {
  stopCastleBattleBroadcaster();
  stopMarchScheduler();
  stopRallyScheduler();
  process.exit(0);
});
process.on('SIGINT', () => {
  stopCastleBattleBroadcaster();
  stopMarchScheduler();
  stopRallyScheduler();
  process.exit(0);
});

start();