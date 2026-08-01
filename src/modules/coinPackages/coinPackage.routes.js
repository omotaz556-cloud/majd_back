const express = require('express');
const { listActive } = require('./coinPackage.controller');

const router = express.Router();

// عام - أي حد يقدر يشوف الباقات النشطة (مثلاً في صفحة الشحن) من غير تسجيل دخول
router.get('/', listActive);

module.exports = router;
