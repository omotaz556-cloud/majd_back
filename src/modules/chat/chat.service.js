const mongoose = require('mongoose');
const ChatMessage = require('./chat.model');
const User = require('../users/user.model');
const { isUserOnline } = require('../../realtime/socket');

const GLOBAL_HISTORY_LIMIT = 50;
const PRIVATE_HISTORY_LIMIT = 50;
const MAX_CONVERSATIONS_PREVIEW = 30;

// ====== الشات العام - آخر N رسالة، بترجع بترتيب تصاعدي (الأقدم أولاً) عشان
// تتعرض زي أي شات عادي من فوق لتحت. ======
async function getGlobalHistory() {
  const messages = await ChatMessage.find({ channel: 'global' })
    .sort({ created_at: -1 })
    .limit(GLOBAL_HISTORY_LIMIT)
    .lean();
  return messages.reverse();
}

async function sendGlobalMessage(senderId, senderName, body) {
  const trimmed = (body || '').trim();
  if (!trimmed) {
    const err = new Error('لا يمكن إرسال رسالة فارغة');
    err.status = 400;
    throw err;
  }

  const message = await ChatMessage.create({
    channel: 'global',
    sender_id: senderId,
    sender_name: senderName,
    body: trimmed,
  });

  return message.toObject();
}

// ====== الشات الخاص بين لاعبين - محادثة واحدة بالاتجاهين ($or) ======
async function getPrivateHistory(userId, otherUserId) {
  const otherUser = await User.findById(otherUserId).select('name is_active');
  if (!otherUser || !otherUser.is_active) {
    const err = new Error('اللاعب غير موجود');
    err.status = 404;
    throw err;
  }

  const messages = await ChatMessage.find({
    channel: 'private',
    $or: [
      { sender_id: userId, recipient_id: otherUserId },
      { sender_id: otherUserId, recipient_id: userId },
    ],
  })
    .sort({ created_at: -1 })
    .limit(PRIVATE_HISTORY_LIMIT)
    .lean();

  return { other_user: { _id: otherUser._id, name: otherUser.name }, messages: messages.reverse() };
}

async function sendPrivateMessage(senderId, senderName, recipientId, body) {
  const trimmed = (body || '').trim();
  if (!trimmed) {
    const err = new Error('لا يمكن إرسال رسالة فارغة');
    err.status = 400;
    throw err;
  }

  if (recipientId.toString() === senderId.toString()) {
    const err = new Error('لا يمكنك مراسلة نفسك');
    err.status = 400;
    throw err;
  }

  const recipient = await User.findById(recipientId).select('is_active');
  if (!recipient || !recipient.is_active) {
    const err = new Error('اللاعب غير موجود');
    err.status = 404;
    throw err;
  }

  // ====== *** إضافة: الرسائل الخاصة مسموحة بس لو المستقبِل أونلاين فعليًا
  // دلوقتي (متصل بويب سوكيت) - مختلف عن is_active اللي بيعني بس "الحساب
  // مفعّل" مش "متصل دلوقتي". لو أوفلاين، بنرفض الإرسال من الأساس (مش بنخزّن
  // الرسالة عشان يلاقيها بعدين) - نفس فلسفة "لازم الطرفين أونلاين وقت
  // الإرسال" المطلوبة في نظام الشات الموحّد. ******
  if (!isUserOnline(recipientId)) {
    const err = new Error('اللاعب ده أوفلاين دلوقتي - متقدرش تبعتله رسالة خاصة');
    err.status = 409;
    throw err;
  }

  const message = await ChatMessage.create({
    channel: 'private',
    sender_id: senderId,
    sender_name: senderName,
    recipient_id: recipientId,
    body: trimmed,
  });

  return message.toObject();
}

// ====== قائمة آخر محادثات خاصة للاعب الحالي - بتتجمّع من ChatMessage نفسها
// (من غير موديل منفصل للمحادثات) عن طريق تحديد "الطرف التاني" لكل رسالة
// وأخذ آخر رسالة لكل طرف تاني بس، مرتبة بالأحدث. مفيد لعرض قائمة "محادثاتي"
// في الفرونت إند من غير ما اللاعب يحتاج يعرف مع مين اتكلم قبل كده. ======
async function listPrivateConversations(userId) {
  const userObjectId = new mongoose.Types.ObjectId(userId);

  const results = await ChatMessage.aggregate([
    {
      $match: {
        channel: 'private',
        $or: [{ sender_id: userObjectId }, { recipient_id: userObjectId }],
      },
    },
    {
      $addFields: {
        other_id: {
          $cond: [{ $eq: ['$sender_id', userObjectId] }, '$recipient_id', '$sender_id'],
        },
      },
    },
    { $sort: { created_at: -1 } },
    {
      $group: {
        _id: '$other_id',
        last_message: { $first: '$body' },
        last_sender_id: { $first: '$sender_id' },
        created_at: { $first: '$created_at' },
      },
    },
    { $sort: { created_at: -1 } },
    { $limit: MAX_CONVERSATIONS_PREVIEW },
  ]);

  const otherIds = results.map((r) => r._id);
  const users = await User.find({ _id: { $in: otherIds } }).select('name');
  const nameById = new Map(users.map((u) => [u._id.toString(), u.name]));

  return results.map((r) => ({
    other_user_id: r._id,
    other_user_name: nameById.get(r._id.toString()) || 'لاعب',
    last_message: r.last_message,
    last_message_is_mine: r.last_sender_id.toString() === userId.toString(),
    created_at: r.created_at,
  }));
}

module.exports = {
  getGlobalHistory,
  sendGlobalMessage,
  getPrivateHistory,
  sendPrivateMessage,
  listPrivateConversations,
};
