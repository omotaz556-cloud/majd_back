const chatService = require('./chat.service');
const { emitToUser, emitToGlobalChat, getOnlineUserIds } = require('../../realtime/socket');

// GET /api/chat/online - قائمة معرّفات اللاعبين المتصلين (أونلاين) حاليًا -
// fallback لو الفرونت إند فتح الصفحة قبل ما يستقبل chat:online_snapshot من
// السوكيت، أو عايز يتأكد قبل ما يفتح صندوق كتابة رسالة خاصة.
async function getOnlineUsers(req, res) {
  return res.json({ user_ids: getOnlineUserIds() });
}

// GET /api/chat/global - آخر رسائل الشات العام
async function getGlobalMessages(req, res) {
  try {
    const messages = await chatService.getGlobalHistory();
    return res.json(messages);
  } catch (err) {
    console.error('[Chat] getGlobalMessages error:', err.message);
    return res.status(500).json({ error: 'تعذر تحميل الشات العام الآن' });
  }
}

// POST /api/chat/global - إرسال رسالة في الشات العام (كل اللاعبين تشوفها فورًا)
async function postGlobalMessage(req, res) {
  try {
    const { body } = req.body;
    const message = await chatService.sendGlobalMessage(req.user._id, req.user.name, body);
    emitToGlobalChat('chat:global_message', message);
    return res.status(201).json(message);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[Chat] postGlobalMessage error:', err.message);
    return res.status(500).json({ error: 'تعذر إرسال الرسالة الآن' });
  }
}

// GET /api/chat/conversations - قائمة آخر المحادثات الخاصة للاعب الحالي
async function getConversations(req, res) {
  try {
    const conversations = await chatService.listPrivateConversations(req.user._id);
    return res.json(conversations);
  } catch (err) {
    console.error('[Chat] getConversations error:', err.message);
    return res.status(500).json({ error: 'تعذر تحميل المحادثات الآن' });
  }
}

// GET /api/chat/private/:userId - تاريخ محادثة خاصة مع لاعب معين
async function getPrivateMessages(req, res) {
  try {
    const { userId } = req.params;
    const result = await chatService.getPrivateHistory(req.user._id, userId);
    return res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[Chat] getPrivateMessages error:', err.message);
    return res.status(500).json({ error: 'تعذر تحميل المحادثة الآن' });
  }
}

// POST /api/chat/private/:userId - إرسال رسالة خاصة للاعب معين
async function postPrivateMessage(req, res) {
  try {
    const { userId } = req.params;
    const { body } = req.body;
    const message = await chatService.sendPrivateMessage(req.user._id, req.user.name, userId, body);

    // بيوصل بس للمرسِل والمستقبِل (مش لكل الناس زي الشات العام)
    emitToUser(userId, 'chat:private_message', message);
    emitToUser(req.user._id, 'chat:private_message', message);

    return res.status(201).json(message);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[Chat] postPrivateMessage error:', err.message);
    return res.status(500).json({ error: 'تعذر إرسال الرسالة الآن' });
  }
}

module.exports = {
  getGlobalMessages,
  postGlobalMessage,
  getConversations,
  getPrivateMessages,
  postPrivateMessage,
  getOnlineUsers,
};
