const express = require('express');
const { protect, authorize } = require('../../middleware/auth.middleware');
const {
  listInbox,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteMessage,
  deleteAllRead,
  sendMessage,
  broadcast,
} = require('./inbox.controller');

// ====== راوتر اللاعب (صندوق الوارد بتاعه) ======
const playerRouter = express.Router();
playerRouter.use(protect);
playerRouter.get('/', listInbox);
playerRouter.get('/unread-count', getUnreadCount);
playerRouter.post('/read-all', markAllAsRead);
playerRouter.post('/message', sendMessage);
// ملحوظة: لازم يفضل الراوت الثابت ده قبل '/:messageId' تحت، وإلا إكسبريس
// هيتعامل مع 'delete-read' كإنه قيمة messageId
playerRouter.delete('/delete-read', deleteAllRead);
playerRouter.post('/:messageId/read', markAsRead);
playerRouter.delete('/:messageId', deleteMessage);

// ====== راوتر الأدمن (بث إعلان لكل اللاعبين) ======
const adminRouter = express.Router();
adminRouter.use(protect, authorize('admin'));
adminRouter.post('/broadcast', broadcast);

module.exports = { playerRouter, adminRouter };