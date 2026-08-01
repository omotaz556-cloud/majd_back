const mongoose = require('mongoose');

// عضو واحد في التحالف - الدور بيحدد صلاحياته (leader بيقدر يعمل أي حاجة،
// officer بيقدر يدعو/يطرد أعضاء عاديين بس، member مفيوش صلاحيات إدارية).
// leader دايمًا عضو واحد بس في نفس الوقت (بيتغيّر مع transferLeadership).
const memberSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['leader', 'officer', 'member'], default: 'member' },
    joined_at: { type: Date, default: Date.now },
  },
  { _id: false }
);

// تحالف واحد - اسم وحرفين/تلاتة "tag" مميزين بيظهروا جنب اسم اللاعب على
// خريطة العالم (زي أغلب ألعاب الاستراتيجية). العضوية نفسها متخزنة هنا في
// array واحد بدل مستند مستقل لكل عضوية - عدد الأعضاء محدود (MAX_MEMBERS في
// alliance.config) فمفيش داعي لتعقيد إضافي.
const allianceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 3, maxlength: 40 },
    // tag فريد على مستوى اللعبة كلها (زي username) - بيتخزن uppercase دايمًا
    // عشان "abc" و"ABC" ميتعتبروش تحالفين مختلفين.
    tag: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      minlength: 2,
      maxlength: 5,
      unique: true,
    },
    description: { type: String, trim: true, maxlength: 500, default: '' },
    // مين اللي أنشأ التحالف أساسًا - بيفضل ثابت حتى لو القيادة اتنقلت لعضو
    // تاني بعد كده (تاريخي بس، مش بيستخدم في أي فحص صلاحيات).
    founder_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    members: [memberSchema],
    max_members: { type: Number, default: 30 },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

allianceSchema.index({ 'members.user_id': 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Alliance', allianceSchema);
