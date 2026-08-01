const express = require('express');
const { protect } = require('../../middleware/auth.middleware');
const {
  getGlobalMessages,
  postGlobalMessage,
  getConversations,
  getPrivateMessages,
  postPrivateMessage,
  getOnlineUsers,
} = require('./chat.controller');

const router = express.Router();
router.use(protect);

// ====== قائمة اللاعبين المتصلين (أونلاين) حاليًا ======
router.get('/online', getOnlineUsers);

// ====== الشات العام - كل اللاعبين تشوفه ======
router.get('/global', getGlobalMessages);
router.post('/global', postGlobalMessage);

// ====== الشات الخاص - بين لاعبين محددين بس ======
router.get('/conversations', getConversations);
router.get('/private/:userId', getPrivateMessages);
router.post('/private/:userId', postPrivateMessage);

module.exports = router;
