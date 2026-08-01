const mongoose = require('mongoose');

// ====== حالة "تغطية" منطقة من العالم - المفتاح لتوليد كسول بس مرة واحدة
// (fill-only) اللي طلبه العميل: أي منطقة اتعمّرت قبل كده (NPC + كائنات
// عالم) بيتسجل ليها مستند هنا، فأي نداء تاني على نفس المنطقة (سواء من
// استكشاف لاعب أو من سكريبت backfill) بيتأكد بـ findOne واحدة بس إنها
// مسجّلة ويرجع فورًا من غير ما يعيد التوليد أو يعمل أي استعلام إضافي -
// ده اللي بيحقق "Generation should happen once and be efficient / Do not
// introduce unnecessary database queries".
const worldRegionStateSchema = new mongoose.Schema(
  {
    region_x: { type: Number, required: true },
    region_y: { type: Number, required: true },
    seeded_at: { type: Date, default: Date.now },
    npc_castles_created: { type: Number, default: 0 },
    world_objects_created: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

worldRegionStateSchema.index({ region_x: 1, region_y: 1 }, { unique: true });

module.exports = mongoose.model('WorldRegionState', worldRegionStateSchema);
