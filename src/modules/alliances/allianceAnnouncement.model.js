const mongoose = require('mongoose');

// إعلان تحالف واحد - القائد بس يقدر ينشره. كل نشر جديد بيبقى مستند جديد
// (تاريخ الإعلانات كامل محفوظ زي ما اتطلب)؛ "الإعلان المثبّت الحالي" هو
// أحدث مستند بترتيب created_at تنازليًا - مفيش داعي لعلم "is_active" منفصل
// عشان مفيش إلغاء تفعيل للقديم، الأحدث هو المثبّت دايمًا.
const allianceAnnouncementSchema = new mongoose.Schema(
  {
    alliance_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Alliance', required: true },
    author_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, trim: true, maxlength: 2000 },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: false },
  }
);

// أهم نمط استعلام: إعلانات تحالف معيّن مرتبة بالأحدث (أول واحد = المثبّت)
allianceAnnouncementSchema.index({ alliance_id: 1, created_at: -1 });

module.exports = mongoose.model('AllianceAnnouncement', allianceAnnouncementSchema);
