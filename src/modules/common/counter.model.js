const mongoose = require('mongoose');

// ====== عدّاد تسلسلي عام (Sequential Counter) - مستند واحد لكل "اسم عداد"
// (_id هو اسم العداد نفسه، زي 'player_id' أو 'kingdom_id')، وseq هو آخر رقم
// اتوزّع فعليًا. مستخدم عشان نولّد أرقام تعريف دائمة وفريدة (Player ID،
// Kingdom ID...) بعملية atomic واحدة ($inc في counter.service) - مفيش
// احتمال تكرار حتى لو أكتر من طلب بيحصل في نفس اللحظة بالظبط. ======
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

module.exports = mongoose.model('Counter', counterSchema);
