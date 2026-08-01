// ====== Battle Report (خطوة 9 من معمارية نظام المعارك) ======
// المفروض الملف ده يبني تقرير نهائي قابل للعرض من battle.statistics +
// battle.winner بعد ما المعركة توصل لحالة "finished" - شبيه بـ march.report
// الحالي في march.model بس أشمل بكتير (تفاصيل كل مبنى اتضرر، كل تحصين
// اتكسر، كل كومة وحدات اتخسرت من الطرفين...).
//
// لسه مش متنفذ - "Battle Foundation" بس هي المطلوبة في المرحلة دي.

/**
 * @param {import('../battle.model')} battle - معركة بحالة "finished"
 * @returns {object} تقرير جاهز للعرض في صندوق الوارد (Inbox) أو صفحة تفاصيل
 */
function buildBattleReport(battle) {
  throw new Error('Battle Report لسه مش متنفذ - هيتضاف في مرحلة لاحقة');
}

module.exports = { buildBattleReport };
