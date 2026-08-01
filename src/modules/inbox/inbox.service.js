const InboxMessage = require('./inboxMessage.model');
const InboxRead = require('./inboxRead.model');
const InboxDeleted = require('./inboxDeleted.model');
const User = require('../users/user.model');

// ====== فلتر أساسي: أي رسالة تظهر للاعب ده - رسائله الشخصية، زائد أي رسالة
// جماعية (broadcast) اتبعتت بعد ما هو عمل حساب فعلاً - عشان مايشوفش إعلانات
// كانت اتبعتت قبل ما ينضم للمنصة أصلاً ======
async function visibleMessagesFilter(userId) {
  const user = await User.findById(userId).select('created_at');
  const accountCreatedAt = user ? user.created_at : new Date(0);

  return {
    $or: [{ user_id: userId }, { user_id: null, created_at: { $gte: accountCreatedAt } }],
  };
}

// ====== رسالة نظام شخصية للاعب - بتتبعت من موديولات تانية (castle, challenges...)
// وقت ما حدث معين يحصل، زي خلاص ترقية مبنى أو كسب جايزة تحدي ======
async function createSystemMessage({ userId, type, title, body = '', metadata = {} }) {
  return InboxMessage.create({
    user_id: userId,
    category: 'system',
    type,
    title,
    body,
    metadata,
  });
}

// ====== بث رسالة أدمن لكل اللاعبين دفعة واحدة (إعلان عام) - مستند واحد بس
// بيتشارك بين الكل، مش نسخة لكل لاعب ======
async function createBroadcast({ adminId, title, body = '', metadata = {} }) {
  return InboxMessage.create({
    user_id: null,
    category: 'admin',
    type: 'admin_broadcast',
    title,
    body,
    metadata,
    created_by: adminId,
  });
}

// ====== رسالة خاصة من لاعب لتاني (Message Player) - بتتبعت وقت زيارة مملكة
// لاعب حقيقي (مش NPC). اسم المرسِل بيتحفظ في العنوان وmetadata وقت الإنشاء
// عشان عرض الرسالة في صندوق الوارد ميحتاجش يعمل populate إضافي لجدول
// المستخدمين. ======
async function sendPrivateMessage({ senderId, recipientId, body }) {
  if (senderId.toString() === recipientId.toString()) {
    throw new Error('متقدرش تبعت رسالة لنفسك');
  }

  const trimmedBody = (body || '').trim();
  if (!trimmedBody) {
    throw new Error('لازم تكتب نص الرسالة');
  }
  if (trimmedBody.length > 1000) {
    throw new Error('الرسالة طويلة جدًا');
  }

  const recipient = await User.findById(recipientId).select('_id');
  if (!recipient) {
    throw new Error('اللاعب ده مش موجود');
  }
  const sender = await User.findById(senderId).select('name');

  return InboxMessage.create({
    user_id: recipientId,
    category: 'player',
    type: 'private_message',
    title: `رسالة من ${sender?.name || 'لاعب'}`,
    body: trimmedBody,
    metadata: { sender_id: senderId, sender_name: sender?.name || null },
    sender_id: senderId,
  });
}

// ====== قائمة رسائل صندوق وارد اللاعب، من الأحدث للأقدم، مع حالة القراءة لكل رسالة ======
async function listInbox(userId, { limit = 30, skip = 0 } = {}) {
  const baseFilter = await visibleMessagesFilter(userId);

  // نستبعد أي رسالة اللاعب ده حذفها من عنده - نفس فكرة "الحذف الشخصي" اللي
  // موضحة فوق جوّه InboxDeleted، بنجيب الـ ids المحذوفة بتاعته الأول وبعدين
  // نستبعدها من فلتر البحث الرئيسي عن طريق $nin
  const deletedIds = await InboxDeleted.find({ user_id: userId }).distinct('message_id');
  const filter =
    deletedIds.length > 0 ? { $and: [baseFilter, { _id: { $nin: deletedIds } }] } : baseFilter;

  const [messages, total] = await Promise.all([
    InboxMessage.find(filter).sort({ created_at: -1 }).skip(skip).limit(limit),
    InboxMessage.countDocuments(filter),
  ]);

  const messageIds = messages.map((m) => m._id);
  const readIds = new Set(
    (await InboxRead.find({ user_id: userId, message_id: { $in: messageIds } }).distinct('message_id')).map((id) =>
      id.toString()
    )
  );

  const items = messages.map((m) => ({
    id: m._id,
    category: m.category,
    type: m.type,
    title: m.title,
    body: m.body,
    metadata: m.metadata,
    created_at: m.created_at,
    is_read: readIds.has(m._id.toString()),
  }));

  return { messages: items, total, limit, skip };
}

// ====== عدد الرسائل الغير مقروءة - بيتنادى عليه كتير (شارة الجرس في الـ navbar)
// فلازم يفضل خفيف: بنجيب الـ ids بس مش المستندات كاملة ======
async function getUnreadCount(userId) {
  const filter = await visibleMessagesFilter(userId);
  const allIds = await InboxMessage.find(filter).distinct('_id');

  if (allIds.length === 0) return 0;

  const [readIds, deletedIds] = await Promise.all([
    InboxRead.find({ user_id: userId, message_id: { $in: allIds } }).distinct('message_id'),
    InboxDeleted.find({ user_id: userId, message_id: { $in: allIds } }).distinct('message_id'),
  ]);
  const excluded = new Set([...readIds, ...deletedIds].map((id) => id.toString()));
  return allIds.filter((id) => !excluded.has(id.toString())).length;
}

// ====== تعليم رسالة واحدة كمقروءة - upsert عشان تتحمل تتنادى أكتر من مرة من غير error ======
async function markAsRead(userId, messageId) {
  const message = await InboxMessage.findById(messageId);
  if (!message) {
    throw new Error('الرسالة دي مش موجودة');
  }
  if (message.user_id && message.user_id.toString() !== userId.toString()) {
    throw new Error('الرسالة دي مش ليك');
  }

  await InboxRead.updateOne(
    { user_id: userId, message_id: messageId },
    { $setOnInsert: { user_id: userId, message_id: messageId, read_at: new Date() } },
    { upsert: true }
  );

  return { message_id: messageId, is_read: true };
}

// ====== تعليم كل الرسائل الظاهرة للاعب كمقروءة دفعة واحدة ======
async function markAllAsRead(userId) {
  const filter = await visibleMessagesFilter(userId);
  const allIds = await InboxMessage.find(filter).distinct('_id');

  if (allIds.length === 0) return { marked: 0 };

  const readIds = new Set(
    (await InboxRead.find({ user_id: userId, message_id: { $in: allIds } }).distinct('message_id')).map((id) =>
      id.toString()
    )
  );
  const unreadIds = allIds.filter((id) => !readIds.has(id.toString()));

  if (unreadIds.length === 0) return { marked: 0 };

  const ops = unreadIds.map((messageId) => ({
    updateOne: {
      filter: { user_id: userId, message_id: messageId },
      update: { $setOnInsert: { user_id: userId, message_id: messageId, read_at: new Date() } },
      upsert: true,
    },
  }));

  await InboxRead.bulkWrite(ops);
  return { marked: unreadIds.length };
}

// ====== حذف رسالة من صندوق وارد اللاعب (حذف شخصي - الرسالة بتفضل موجودة
// للمستخدمين التانيين لو كانت جماعية). مسموح بس للرسائل المقروءة already -
// الشرط ده بنفرضه هنا في السيرفس نفسه مش بس مخفي في الفرونت إند، عشان محدّش
// يقدر يمسح رسالة لسه مطلعهاش (مثلاً عن طريق نداء مباشر للـ API). ======
async function deleteMessage(userId, messageId) {
  const message = await InboxMessage.findById(messageId);
  if (!message) {
    throw new Error('الرسالة دي مش موجودة');
  }
  if (message.user_id && message.user_id.toString() !== userId.toString()) {
    throw new Error('الرسالة دي مش ليك');
  }

  const isRead = await InboxRead.exists({ user_id: userId, message_id: messageId });
  if (!isRead) {
    throw new Error('لازم تقرا الرسالة الأول قبل ما تحذفها');
  }

  await InboxDeleted.updateOne(
    { user_id: userId, message_id: messageId },
    { $setOnInsert: { user_id: userId, message_id: messageId, deleted_at: new Date() } },
    { upsert: true }
  );

  return { message_id: messageId, deleted: true };
}

// ====== حذف كل الرسائل المقروءة دفعة واحدة (حذف شخصي زي deleteMessage) -
// بنجيب كل الرسائل الظاهرة للاعب، بعدين نستبعد المحذوفة already، وبعدين
// نفلتر بس اللي مقروءة (نفس شرط deleteMessage: مينفعش تتحذف رسالة لسه
// مطلعهاش) وبعدين نعمل insert جماعي في InboxDeleted. ======
async function deleteAllRead(userId) {
  const baseFilter = await visibleMessagesFilter(userId);

  const deletedIds = await InboxDeleted.find({ user_id: userId }).distinct('message_id');
  const filter =
    deletedIds.length > 0 ? { $and: [baseFilter, { _id: { $nin: deletedIds } }] } : baseFilter;

  const allIds = await InboxMessage.find(filter).distinct('_id');
  if (allIds.length === 0) return { deleted: 0 };

  const readIds = await InboxRead.find({ user_id: userId, message_id: { $in: allIds } }).distinct(
    'message_id'
  );
  if (readIds.length === 0) return { deleted: 0 };

  const ops = readIds.map((messageId) => ({
    updateOne: {
      filter: { user_id: userId, message_id: messageId },
      update: { $setOnInsert: { user_id: userId, message_id: messageId, deleted_at: new Date() } },
      upsert: true,
    },
  }));

  await InboxDeleted.bulkWrite(ops);
  return { deleted: readIds.length };
}

module.exports = {
  createSystemMessage,
  createBroadcast,
  sendPrivateMessage,
  listInbox,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteMessage,
  deleteAllRead,
};