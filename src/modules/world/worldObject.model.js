const mongoose = require('mongoose');

const troopStackSchema = new mongoose.Schema(
  { key: { type: String, required: true }, count: { type: Number, default: 0 } },
  { _id: false }
);

// ====== مستند واحد لأي "كائن عالم" منفصل عن القلاع - راجع
// worldObject.config.js لشرح كل نوع. مستقل تمامًا عن Castle/CastleDefense
// (موديول جديد بالكامل: world/) عشان معرفتش نلمس أي منطق قلاع/قتال موجود. ======
const worldObjectSchema = new mongoose.Schema(
  {
    type: { type: String, required: true, index: true }, // راجع WORLD_OBJECT_TYPES
    subtype: { type: String, default: null }, // مستخدم بس للديكورات (tree_cluster... إلخ)
    level: { type: Number, default: 1 },
    map_slot: {
      x: { type: Number, required: true },
      y: { type: Number, required: true },
    },
    // منطقة العالم اللي الكائن ده اتولّد جواها - نفس region_x/region_y في
    // WorldRegionState، مخزّنة هنا كمان عشان استعلامات "كل حاجة في منطقة
    // معينة" (للتحقق/العرض) تفضل بفهرس بسيط من غير حساب هندسي كل مرة.
    region_x: { type: Number, required: true, index: true },
    region_y: { type: Number, required: true, index: true },
    garrison: { type: [troopStackSchema], default: [] },
    loot: {
      gold: { type: Number, default: 0 },
      wood: { type: Number, default: 0 },
      stone: { type: Number, default: 0 },
    },
    respawns: { type: Boolean, default: false },
    // لو الكائن اتهزم/اتنهب - بيتسجل هنا عشان نعرف نرجّعه (respawn) بعد
    // مدة، من غير ما نحتاج نمسحه ونعمل تاني (idempotent restock)
    depleted_at: { type: Date, default: null },
    // ====== NEW (Attackable World Objects) - راجع
    // world/worldObjectCastleBridge.js. مرجع لمستند Castle "ظل" اتولّد أول
    // مرة حد هاجم/استكشف الكائن ده - بيتحدد مرة واحدة بس (idempotent) وبيفضل
    // ثابت طول عمر الكائن، عشان محرك الهجوم/المعركة الحقيقي (march/battle)
    // يقدر يتعامل مع الكائن ده زي أي قلعة NPC تانية بالظبط من غير أي نظام
    // قتال موازي. null لحد أول هجوم/استكشاف - كل الكائنات غير المعادية
    // (موارد/ديكور/معالم) بتفضل null للأبد لأن محدش بيهاجمها أصلًا. ======
    shadow_castle_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Castle', default: null, index: true },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

// منع تكرار كائنين في نفس الخانة بالظبط (احتياطي - المولّد أصلًا بيتجنب
// التصادم بفحص مسافة أدنى قبل الإدخال، الفهرس ده خط دفاع تاني بس)
worldObjectSchema.index({ 'map_slot.x': 1, 'map_slot.y': 1 }, { unique: true });

module.exports = mongoose.model('WorldObject', worldObjectSchema);
