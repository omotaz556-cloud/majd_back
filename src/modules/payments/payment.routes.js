const express = require('express');
const { protect } = require('../../middleware/auth.middleware');
const {
  initiateDeposit,
  getDepositStatus,
  moyasarWebhook,
  mockCompleteDeposit,
} = require('./payment.controller');

// ====== Endpoints بتاعة اللاعب - محتاجة توكن ======
const walletDepositRouter = express.Router();
walletDepositRouter.post('/deposit/initiate', protect, initiateDeposit);
walletDepositRouter.get('/deposit/:paymentId/status', protect, getDepositStatus);
// متاحة فقط لما PAYMENT_PROVIDER=mock (بترفض تلقائياً في أي وضع تاني - راجع payment.service.js)
walletDepositRouter.post('/deposit/:paymentId/mock-complete', protect, mockCompleteDeposit);

// ====== Webhook - عام، بيتحقق بنفسه بالـ secret_token جوا الـ body ======
// من غير `protect` عشان Moyasar سيرفر مش هيبعت Bearer token بتاعنا
// (بترفض تلقائياً لو PAYMENT_PROVIDER != moyasar)
const webhookRouter = express.Router();
webhookRouter.post('/moyasar', moyasarWebhook);

module.exports = { walletDepositRouter, webhookRouter };
