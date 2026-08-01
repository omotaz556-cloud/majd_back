const express = require('express');
const { protect, authorize } = require('../../middleware/auth.middleware');
const { listInbox, getUnreadCount, markAsRead, markAllAsRead, sendMessage, broadcast } = require('./inbox.controller');

// ====== راوتر اللاعب (صندوق الوارد بتاعه) ======
const playerRouter = express.Router();
playerRouter.use(protect);
playerRouter.get('/', listInbox);
playerRouter.get('/unread-count', getUnreadCount);
playerRouter.post('/read-all', markAllAsRead);
playerRouter.post('/message', sendMessage);
playerRouter.post('/:messageId/read', markAsRead);

// ====== راوتر الأدمن (بث إعلان لكل اللاعبين) ======
const adminRouter = express.Router();
adminRouter.use(protect, authorize('admin'));
adminRouter.post('/broadcast', broadcast);

module.exports = { playerRouter, adminRouter };
