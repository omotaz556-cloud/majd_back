const Counter = require('./counter.model');

// ====== بيرجع الرقم التسلسلي الجاي لعداد معيّن، وبيعمل upsert لو ده أول
// استخدام للعداد ده (لسه مفيش مستند ليه). findOneAndUpdate بـ $inc هنا
// عملية atomic واحدة على مستوى قاعدة البيانات - يعني حتى لو طلبين اتنين
// جم في نفس اللحظة بالظبط (مثلاً لاعبين بيسجّلوا حساب جديد في نفس الثانية)،
// كل واحد فيهم هياخد رقم مختلف ومفيش تكرار ممكن يحصل.
//
// offset: بيتضاف على الرقم النهائي بس عشان الشكل يبان أحسن (زي "Player ID"
// يبدأ من 100000 بدل 1 زي أرقام تعريف حقيقية في ألعاب الاستراتيجية الكبيرة)
// - مالوش أي تأثير على التفرد نفسه (seq لوحده كافي إن كل رقم يطلع مرة واحدة
// بس)، فأي offset تختاره هيفضل الأرقام كلها فريدة برضه.
async function nextSequence(name, offset = 0) {
  const counter = await Counter.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return offset + counter.seq;
}

module.exports = { nextSequence };
