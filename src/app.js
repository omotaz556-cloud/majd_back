const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const authRoutes = require('./modules/auth/auth.routes');
// ====== استعادة كلمة المرور (Forgot/Reset Password) - موديول منفصل عشان
// منطق التوكن والإيميل معزول عن auth.routes.js الأساسي. مركّب هنا تحت نفس
// /api/auth كـ /forgot-password و /reset-password. راجع
// modules/passwordReset/emailProviders/index.js لتفاصيل مزوّد الإيميل
// (mock افتراضيًا، resend بعد ما تظبط EMAIL_PROVIDER في .env). ======
const passwordResetRoutes = require('./modules/passwordReset/passwordReset.routes');
const walletRoutes = require('./modules/wallets/wallet.routes');
const adminRoutes = require('./modules/admin/admin.routes');
const { walletDepositRouter, webhookRouter } = require('./modules/payments/payment.routes');
const adsRoutes = require('./modules/ads/ads.routes');
const {
  clientRouter: adRevenueClientRoutes,
  adminRouter: adRevenueAdminRoutes,
} = require('./modules/adRevenue/adRevenue.routes');
const coinPackageRoutes = require('./modules/coinPackages/coinPackage.routes');
const appConfigRoutes = require('./modules/appConfig/appConfig.routes');
const castleRoutes = require('./modules/castle/castle.routes');
const battleRoutes = require('./modules/battle/battle.routes');
const defenseRoutes = require('./modules/defense/defense.routes');
const armyRoutes = require('./modules/army/army.routes');
const { playerRouter: inboxPlayerRoutes, adminRouter: inboxAdminRoutes } = require('./modules/inbox/inbox.routes');
const allianceRoutes = require('./modules/alliances/alliance.routes');
const userRoutes = require('./modules/users/user.routes');
// ====== Phase 6: Battle Consequences - إحصائيات المعارك التراكمية بس
// (راجع modules/battleConsequences/battleConsequences.routes.js). تطبيق
// النتائج نفسه بيحصل داخليًا من battle.service، مفيش تعديل على battleRoutes
// الموجودة فوق. ======
const battleConsequencesRoutes = require('./modules/battleConsequences/battleConsequences.routes');
// ====== Phase 7: Hospital & Recovery System - injured troops after battles.
// battleConsequences.service.js already optionally requires
// modules/hospital/hospital.service.js on its own (admitCasualties hook) -
// this is only the player-facing routes for viewing/managing the queue,
// no change to battleConsequences itself. ======
const hospitalRoutes = require('./modules/hospital/hospital.routes');
// ====== Phase 8: Building Repair System - restores damaged wall/gate/tower
// structures over time. Fully independent from battleConsequences (which
// only ever applies damage) and from the hospital module (untouched) - see
// modules/repair/repair.service.js header comment. ======
const repairRoutes = require('./modules/repair/repair.routes');
// ====== NEW - World Admin API: exposes worldAdmin.service.js (verify/
// repair/regenerate/populate/spawn/remove NPCs, stats) over HTTP, admin-
// only. Independent module, no change to castleRoutes or the generation
// engine itself. ======
const worldAdminRoutes = require('./modules/world/worldAdmin.routes');
const rankingRoutes = require('./modules/ranking/ranking.routes');
// ====== نظام "المهام اليومية" - قائمة مهام بتتجدد كل يوم، مستوى صعوبتها
// بيزيد تلقائيًا مع مستوى المبنى الرئيسي بتاع اللاعب. راجع
// modules/quests/quest.service.js للتفاصيل الكاملة. ======
const questRoutes = require('./modules/quests/quest.routes');
const dailyRewardRoutes = require('./modules/dailyReward/dailyReward.routes');
// ====== نظام الشات بين اللاعبين - شات عام (كل اللاعبين) وشات خاص (بين
// لاعبين محددين)، راجع modules/chat/chat.service.js للتفاصيل الكاملة. ======
const chatRoutes = require('./modules/chat/chat.routes');


const app = express();

// ====== لازم لما السيرفر شغال ورا reverse proxy (Cloudflare Tunnel، Nginx،
// Load Balancer...) - من غيرها express-rate-limit بيرفض يشتغل صح لما هيدر
// X-Forwarded-For موجود، ويرمي ValidationError (ERR_ERL_UNEXPECTED_X_FORWARDED_FOR)
// بدل ما يحدد IP العميل الحقيقي. القيمة 1 معناها: "ثق في أول proxy واحد بس"
// (اللي هو التنل/الـ reverse proxy نفسه) - مش أي عدد proxies زي true.
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10kb' })); // بيمنع body كبيرة زيادة

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'majd-games-backend' });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/auth', passwordResetRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/wallet', walletDepositRouter);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/ad-revenue', adRevenueAdminRoutes);
app.use('/api/webhooks', webhookRouter);
app.use('/api/ads', adsRoutes);
app.use('/api/ads', adRevenueClientRoutes);
app.use('/api/coin-packages', coinPackageRoutes);
app.use('/api/config', appConfigRoutes);
app.use('/api/castle', castleRoutes);
app.use('/api/battles', battleRoutes);
app.use('/api/defense', defenseRoutes);
app.use('/api/army', armyRoutes);
app.use('/api/alliances', allianceRoutes);
app.use('/api/inbox', inboxPlayerRoutes);
app.use('/api/admin/inbox', inboxAdminRoutes);
app.use('/api/users', userRoutes);
app.use('/api/battle-stats', battleConsequencesRoutes);
app.use('/api/hospital', hospitalRoutes);
app.use('/api/repair', repairRoutes);
app.use('/api/admin/world', worldAdminRoutes);
app.use('/api/ranking', rankingRoutes);
app.use('/api/quests', questRoutes);
app.use('/api/daily-reward', dailyRewardRoutes);
app.use('/api/chat', chatRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Global error handler (آخر حاجة في الـ middleware chain)
app.use((err, req, res, next) => {
  console.error('[Unhandled Error]', err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;