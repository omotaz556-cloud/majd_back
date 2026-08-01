// ====== Replay System (خطوة 8 من معمارية نظام المعارك) ======
// المفروض الملف ده يسجّل سجل الأحداث لحظة بلحظة أثناء المعركة (زي
// battle.current_state.events اللي متجهّز شكله كـ placeholder فاضي في
// battle.config.createInitialCurrentState) عشان يسمح بإعادة تشغيل المعركة
// بصريًا بعد ما تخلص، تيك بتيك، من غير ما يحتاج يعيد حسابها تاني.
//
// لسه مش متنفذ - "Battle Foundation" بس هي المطلوبة في المرحلة دي.

/**
 * @param {import('../battle.model')} battle
 * @returns {Array<object>} سجل الأحداث الكامل الجاهز للعرض
 */
function buildReplay(battle) {
  throw new Error('Replay System لسه مش متنفذ - هيتضاف في مرحلة لاحقة');
}

module.exports = { buildReplay };
