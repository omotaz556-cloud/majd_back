const { Server } = require('socket.io');
const { verifyToken } = require('../modules/auth/auth.service');
const User = require('../modules/users/user.model');

// ====== طبقة الويب سوكيت (Real-time Layer) - Phase 1 (Reinforcement &
// Battle System): بثّ حي لحدثين أساسيين لأي عميل متصل:
//   1) 'battle:under_attack' / 'battle:ally_under_attack' - إشعار فوري إن
//      قلعة تحت الهجوم (لصاحبها ولكل أعضاء تحالفه).
//   2) 'castle:power_update' - باور القلعة الحي أثناء معركة شغالة (بيقل مع
//      الوقت حسب قوة المهاجم، وبيرتفع فورًا لو تعزيز جديد وصل - راجع
//      modules/castle/march.service.js::computeLiveCastlePowerPct
//      وmodules/castle/castleBattleBroadcaster.js).
//
// كل عميل بينضم تلقائيًا لغرفتين وقت الاتصال: غرفة شخصية (user:<id>) وغرفة
// تحالفه الحالي لو عنده واحد (alliance:<id>) - البث بعدين بيبقى مجرد
// io.to(room).emit(...) من أي مكان في الباك إند من غير ما يحتاج يعرف مين
// بالظبط متصل دلوقتي. ======

let io = null;

// ====== *** إضافة: نظام الحضور (Presence) - Map من user_id لعدد الاتصالات
// (sockets) المفتوحة له دلوقتي. بنستخدم عداد مش boolean عشان لو اللاعب فاتح
// أكتر من تاب/جهاز في نفس الوقت، قفل تاب واحد بس ميخليهوش يظهر "أوفلاين"
// غلط طول ما لسه عنده اتصال شغال في تاب تاني. لما العداد يوصل صفر (آخر
// اتصال اتقفل)، فعليًا نعتبره "أوفلاين" ونبثّ chat:user_offline. ******
const onlineCounts = new Map();

function isUserOnline(userId) {
  return (onlineCounts.get(userId.toString()) || 0) > 0;
}

function getOnlineUserIds() {
  return Array.from(onlineCounts.keys());
}

function userRoom(userId) {
  return `user:${userId}`;
}

function allianceRoom(allianceId) {
  return `alliance:${allianceId}`;
}

// ====== *** إضافة: غرفة عامة لكل معركة (مسير هجوم) - أي عميل متصل (مش
// بالضرورة صاحب القلعة المهاجَمة أو حليفه) يقدر ينضم لها عشان يتابع اللايف
// (castle:power_update / battle:live_started / battle:ended) بمجرد ما يعرف
// march_id، زي أي متفرّج بيشاهد قلعة حد تاني وهي تحت هجوم. راجع
// joinBattleRoom/leaveBattleRoom تحت. ******
function battleRoom(marchId) {
  return `march:${marchId}`;
}

// ====== *** إضافة: غرفة عامة واحدة لكل اللاعبين المتصلين - مستخدمة في نظام
// الشات العام (chat module) بس. كل عميل بينضم لها تلقائيًا وقت الاتصال (زي
// userRoom بالظبط) عشان أي رسالة شات عامة توصل فورًا لكل اللاعبين المتصلين
// من غير ما الباك إند يحتاج يعرف مين بالظبط متصل دلوقتي. ******
const GLOBAL_CHAT_ROOM = 'chat:global';

// ====== lazy require لـ alliance.service - نفس فلسفة getCastleService في
// allianceReinforcement.service.js: بنأجل الاستيراد لحد ما فعليًا نحتاجه
// عشان نتجنب أي مشكلة ترتيب تحميل بين الموديولات وقت startup. ======
async function resolveAllianceRoomIdForUser(userId) {
  try {
    const allianceService = require('../modules/alliances/alliance.service');
    const alliance = await allianceService.getMyAlliance(userId);
    return alliance ? alliance._id.toString() : null;
  } catch (err) {
    console.error('[Socket] failed to resolve alliance room for user:', err.message);
    return null;
  }
}

function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: '*' },
  });

  // ====== نفس فلسفة middleware/auth.middleware.js::protect بالظبط، بس هنا
  // على مستوى الاتصال نفسه (handshake) مش كل request - العميل بيبعت التوكن
  // في socket.handshake.auth.token (راجع frontend/src/api/socket.js). ======
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error('لازم توكن دخول صحيح'));

      const decoded = verifyToken(token);
      const user = await User.findById(decoded.sub);
      if (!user || !user.is_active) return next(new Error('حساب غير موجود أو غير مفعّل'));

      socket.user_id = user._id.toString();
      return next();
    } catch (err) {
      return next(new Error('توكن غير صالح أو منتهي'));
    }
  });

  io.on('connection', async (socket) => {
    socket.join(userRoom(socket.user_id));
    socket.join(GLOBAL_CHAT_ROOM);

    // ====== *** إضافة: تحديث عداد الحضور - أول اتصال لليوزر ده (عدّاده كان
    // صفر) بيخليه "أونلاين" فعليًا فنبثّ الحدث لكل الناس، ونبعتله هو بالذات
    // القائمة الحالية لكل المتصلين (snapshot) عشان الفرونت يقدر يبني حالة
    // "مين أونلاين" من غير ما يستنى event لكل واحد فيهم واحد واحد. ******
    const previousCount = onlineCounts.get(socket.user_id) || 0;
    onlineCounts.set(socket.user_id, previousCount + 1);
    if (previousCount === 0) {
      io.to(GLOBAL_CHAT_ROOM).emit('chat:user_online', { user_id: socket.user_id });
    }
    socket.emit('chat:online_snapshot', { user_ids: getOnlineUserIds() });

    const allianceId = await resolveAllianceRoomIdForUser(socket.user_id);
    if (allianceId) socket.join(allianceRoom(allianceId));

    // ====== لو اللاعب انضم لتحالف جديد (أو غيّره) وهو لسه متصل من غير ما
    // يعمل refresh - الفرونت إند بيبعت الحدث ده بعد أي عملية تحالف ناجحة
    // (انضمام/دعوة مقبولة) عشان نعيد حساب غرفة التحالف الصحيحة فورًا. ======
    socket.on('alliance:rejoin', async () => {
      const newAllianceId = await resolveAllianceRoomIdForUser(socket.user_id);
      if (newAllianceId) socket.join(allianceRoom(newAllianceId));
    });

    // ====== *** إضافة: أي عميل متصل (أي لاعب، مش بس صاحب القلعة أو حليفه)
    // يقدر يطلب متابعة معركة معينة لايف بمعرفة march_id بس - بينضم لغرفة
    // battleRoom(marchId) فيبدأ يستقبل castle:power_update/battle:live_started
    // /battle:ended الخاصين بيها. مفيش أي تحقق ملكية هنا عن قصد: المطلوب إن
    // أي حد من برا يقدر يشاهد لايف أي معركة، مش بس صاحبها. ******
    socket.on('battle:watch', (marchId) => {
      if (!marchId) return;
      socket.join(battleRoom(marchId));
    });

    socket.on('battle:unwatch', (marchId) => {
      if (!marchId) return;
      socket.leave(battleRoom(marchId));
    });

    // ====== *** إضافة: لما أي اتصال يتقفل (تاب اتقفل، نت قطع، refresh...)،
    // ننقص عداد الحضور بتاع اليوزر ده. بنبثّ chat:user_offline بس لو ده كان
    // آخر اتصال ليه (العداد وصل صفر فعليًا) - عشان لو لسه فاتح تاب تاني ميتبثش
    // إنه أوفلاين غلط. ******
    socket.on('disconnect', () => {
      const current = onlineCounts.get(socket.user_id) || 0;
      if (current <= 1) {
        onlineCounts.delete(socket.user_id);
        io.to(GLOBAL_CHAT_ROOM).emit('chat:user_offline', { user_id: socket.user_id });
      } else {
        onlineCounts.set(socket.user_id, current - 1);
      }
    });
  });

  return io;
}

function emitToUser(userId, event, payload) {
  if (!io || !userId) return;
  io.to(userRoom(userId.toString())).emit(event, payload);
}

function emitToAlliance(allianceId, event, payload) {
  if (!io || !allianceId) return;
  io.to(allianceRoom(allianceId.toString())).emit(event, payload);
}

// ====== *** إضافة: بث لأي عميل منضم لغرفة معركة معينة (سواء صاحب القلعة،
// حليفه، أو أي متفرّج تاني فاتح صفحة "متابعة المعركة" - راجع battle:watch
// فوق). ******
function emitToBattle(marchId, event, payload) {
  if (!io || !marchId) return;
  io.to(battleRoom(marchId.toString())).emit(event, payload);
}

// ====== *** إضافة: بث لكل اللاعبين المتصلين حاليًا - مستخدمة في الشات العام
// بس (chat.controller.js::postGlobalMessage). ******
function emitToGlobalChat(event, payload) {
  if (!io) return;
  io.to(GLOBAL_CHAT_ROOM).emit(event, payload);
}

function getIO() {
  return io;
}

module.exports = {
  initSocket,
  emitToUser,
  emitToAlliance,
  emitToBattle,
  emitToGlobalChat,
  getIO,
  userRoom,
  allianceRoom,
  battleRoom,
  isUserOnline,
  getOnlineUserIds,
};
