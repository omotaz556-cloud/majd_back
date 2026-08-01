const inboxService = require('./inbox.service');

async function listInbox(req, res) {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
    const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);

    const result = await inboxService.listInbox(req.user._id, { limit, skip });
    return res.json(result);
  } catch (err) {
    console.error('[Inbox] listInbox error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch inbox' });
  }
}

async function getUnreadCount(req, res) {
  try {
    const count = await inboxService.getUnreadCount(req.user._id);
    return res.json({ unread_count: count });
  } catch (err) {
    console.error('[Inbox] getUnreadCount error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch unread count' });
  }
}

async function markAsRead(req, res) {
  try {
    const result = await inboxService.markAsRead(req.user._id, req.params.messageId);
    return res.json(result);
  } catch (err) {
    console.error('[Inbox] markAsRead error:', err.message);
    return res.status(400).json({ error: err.message });
  }
}

async function markAllAsRead(req, res) {
  try {
    const result = await inboxService.markAllAsRead(req.user._id);
    return res.json(result);
  } catch (err) {
    console.error('[Inbox] markAllAsRead error:', err.message);
    return res.status(500).json({ error: 'Failed to mark all as read' });
  }
}

async function deleteMessage(req, res) {
  try {
    const result = await inboxService.deleteMessage(req.user._id, req.params.messageId);
    return res.json(result);
  } catch (err) {
    console.error('[Inbox] deleteMessage error:', err.message);
    return res.status(400).json({ error: err.message });
  }
}

async function deleteAllRead(req, res) {
  try {
    const result = await inboxService.deleteAllRead(req.user._id);
    return res.json(result);
  } catch (err) {
    console.error('[Inbox] deleteAllRead error:', err.message);
    return res.status(500).json({ error: 'Failed to delete read messages' });
  }
}

// ====== رسالة خاصة من لاعب لتاني (Message Player) - وقت زيارة مملكة لاعب
// حقيقي (مش NPC) من صفحة خريطة العالم. ======
async function sendMessage(req, res) {
  try {
    const { recipient_id: recipientId, body } = req.body || {};
    if (!recipientId) {
      return res.status(400).json({ error: 'لازم تحدد المستقبِل' });
    }

    const message = await inboxService.sendPrivateMessage({
      senderId: req.user._id,
      recipientId,
      body,
    });

    return res.status(201).json({ message });
  } catch (err) {
    console.error('[Inbox] sendMessage error:', err.message);
    return res.status(400).json({ error: err.message || 'تعذر إرسال الرسالة' });
  }
}

async function broadcast(req, res) {
  try {
    const { title, body, metadata } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'title is required' });
    }

    const message = await inboxService.createBroadcast({
      adminId: req.user._id,
      title: title.trim(),
      body: body || '',
      metadata: metadata || {},
    });

    return res.status(201).json({ message });
  } catch (err) {
    console.error('[Inbox] broadcast error:', err.message);
    return res.status(400).json({ error: err.message });
  }
}

module.exports = {
  listInbox,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteMessage,
  deleteAllRead,
  sendMessage,
  broadcast,
};