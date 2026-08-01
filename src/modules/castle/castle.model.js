const mongoose = require('mongoose');

// مبنى واحد جوه القلعة - level حالي، مكانه على شبكة القلعة، وحالة الترقية
// الحالية لو في ترقية شغالة (target_level/completes_at)
const buildingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true }, // يطابق مفتاح في castle.config BUILDING_TYPES
    level: { type: Number, default: 1 },
    position: {
      x: { type: Number, required: true },
      y: { type: Number, required: true },
    },
    upgrade: {
      in_progress: { type: Boolean, default: false },
      target_level: { type: Number, default: null },
      started_at: { type: Date, default: null },
      completes_at: { type: Date, default: null },
      // ====== Rewarded Ads Gameplay (Speed Up Construction) ======
      // true لو اللاعب استخدم إعلان "تسريع البناء" على *الترقية الحالية دي
      // بالذات* بالفعل - بيتصفّر تلقائيًا كل مرة ترقية جديدة تبدأ (startUpgrade/
      // startNewBuilding بيحطوا upgrade كأوبچكت جديد كامل، فالحقل ده بيرجع
      // false افتراضيًا مع كل ترقية جديدة) - يعني إعلان واحد بس لكل ترقية،
      // مش مرة واحدة للمبنى طول عمره. راجع rewardKinds.config.js
      // (SPEEDUP_CONSTRUCTION_*) وrewardSession.service.js لمنطق التحقق/التنفيذ. ======
      ad_speedup_used: { type: Boolean, default: false },
    },
  },
  { _id: true }
);

const resourceStateSchema = new mongoose.Schema(
  {
    stored: { type: Number, default: 0 },
    last_synced_at: { type: Date, default: Date.now },
  },
  { _id: false }
);

// كومة وحدات من نوع واحد مدرَّبة فعلًا وجاهزة (خلصت تدريبها) - يطابق مفتاح
// في castle.config TROOP_TYPES
const troopStackSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    count: { type: Number, default: 0 },
  },
  { _id: false }
);

// أمر تدريب واحد شغال/مصفوف في طابور الثكنة - completes_at بيتحسب وقت
// إنشاء الأمر بناءً على وقت انتهاء آخر أمر في الطابور (تدريب متسلسل، مش
// متوازي) عشان مفيش حاجة تتحسب كل ثانية من غير داعي.
const trainingOrderSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    quantity: { type: Number, required: true },
    started_at: { type: Date, required: true },
    completes_at: { type: Date, required: true },
  },
  { _id: true }
);

const castleSchema = new mongoose.Schema(
  {
    // مطلوب للقلاع الحقيقية (لاعب حقيقي)، لكن اختياري لقلاع الـ NPC اللي
    // بيتولّدها محرك التوزيع الإجرائي - عشان كده sparse: true عشان الـ unique
    // index ميتأثرش بوجود أكتر من قلعة NPC من غير user_id (null/undefined).
    // ====== الهيرو اللي اللاعب اختاره قبل بداية اللعب فعليًا (وقت إنشاء
    // أول قلعة له - راجع castle.service.createCastle) - اختيار نهائي، مفيش
    // تغيير بعد كده (شوف castle.service.chooseHero). null لحد ما يختار،
    // وكمان null دايمًا لقلاع الـ NPC (مالهاش أبطال خالص). راجع
    // hero.config.js لقايمة الأبطال المتاحين وبونص كل واحد فيهم. ======
    hero_key: {
      type: String,
      default: null,
    },
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: function requiredForRealPlayers() {
        return !this.is_npc;
      },
      unique: true,
      sparse: true,
    },
    // ====== مُعرّف مملكة دائم وفريد (Kingdom ID) - رقم ثابت طول عمر القلعة،
    // بيتحدد مرة واحدة بس وقت إنشاء القلعة (castle.service.js createCastle)
    // عن طريق counter.service (عداد تسلسلي atomic). قلاع NPC مالهاش رقم
    // (تفضل null) لأنها مش لاعبين حقيقيين وغير قابلة للبحث عنها في نظام
    // "بحث العالم" - عشان كده sparse: true عشان الـ unique index ميتأثرش
    // بوجود أكتر من قلعة NPC من غير kingdom_id (null/undefined) زي نفس فكرة
    // user_id فوق بالظبط.
    kingdom_id: {
      type: Number,
      unique: true,
      sparse: true,
      index: true,
    },
    // اسم عرض ثابت لقلاع الـ NPC بس (زي "معسكر الغزاة")، القلاع الحقيقية
    // بتاخد اسم اللاعب من جدول User وقت العرض بدل ما تتخزن هنا كمان.
    npc_name: { type: String, default: null },
    // ====== NEW (NPC World System rebuild) - كل الحقول دي اختيارية ومالهاش
    // قيمة افتراضية إلا null/[]/false، فمستندات القلاع الحقيقية القديمة
    // ومنطق الـ API الحالي كله بيفضل شغال زي ما هو من غير أي تعديل. ======
    // درجة صعوبة معسكر الـ NPC (village|town|fortified_town|castle|
    // stronghold|elite_fortress) - راجع npcTiers.config.js
    npc_tier: { type: String, default: null },
    // اسم الشكل البصري (skin) اللي الفرونت إند بيستخدمه يرسم المدينة بيه
    npc_skin: { type: String, default: null },
    // ====== NEW (NPC Faction System) - الفصيل (المملكة) اللي القلعة دي
    // تابعة له (bandits|northern_kingdom|desert_empire|eastern_clan|
    // rebel_lords - راجع world/factions.config.js). بيحدد اسم القلعة/اسم
    // القائد/تركيبة الجيش/المكافأة وقت التوليد - القتال نفسه (Army/March/
    // Battle) مش بيتأثر بيه خالص، هو بس بيانات وصفية للعرض والتنويع. ======
    npc_faction: { type: String, default: null },
    // تنويع بصري إضافي حسب الفصيل (يتضاف لـ npc_skin عشان الفرونت إند يقدر
    // يلوّن/يزوّق نفس شكل القلعة حسب المملكة صاحبتها)
    npc_skin_variant: { type: String, default: null },
    // مضاعف مكافأة النهب/الخبرة عند هزيمة المعسكر - يزيد مع الـ tier
    reward_multiplier: { type: Number, default: 1 },
    // مباني ديكور بصرية بس (ثكنة/إسطبل/ميدان رماية/ورشة حصار/مخزن/مستشفى/
    // أكاديمية/دار تحالف) - بدون أي تأثير اقتصادي أو قتالي، الهدف بس إن
    // معسكر الـ NPC يبان مدينة كاملة مش أيقونة فاضية (راجع npcCastle.generator)
    city_decor: {
      type: [
        {
          key: { type: String, required: true },
          level: { type: Number, default: 1 },
          position: { x: Number, y: Number },
          _id: false,
        },
      ],
      default: [],
    },
    // إنارة المدينة (تفعيل بصري بس في الفرونت إند - مفيش أي منطق لعب وراها)
    city_lighting: { type: Boolean, default: false },
    buildings: [buildingSchema],
    resources: {
      gold: { type: resourceStateSchema, default: () => ({}) },
      wood: { type: resourceStateSchema, default: () => ({}) },
      stone: { type: resourceStateSchema, default: () => ({}) },
    },
    // إحداثيات القلعة على خريطة العالم المشتركة - بتتحدد مرة واحدة وقت
    // إنشاء القلعة عن طريق worldMap.service (توزيع إجرائي بيتفادى التصادم)
    map_slot: {
      x: { type: Number, required: true },
      y: { type: Number, required: true },
    },
    // true لو القلعة دي قلعة آلية (NPC) اتولّدت بمحرك التوزيع الإجرائي مش
    // مملوكة للاعب حقيقي - هتتفعل مع مرحلة الهجوم/الدفاع لاحقًا
    is_npc: { type: Boolean, default: false },
    // ====== "مساحة المدينة" - كل خانة أرض متاحة للبناء عليها حاليًا (بتبدأ
    // بشبكة ثابتة، وبتكبر تلقائيًا مع مستوى المبنى الرئيسي - مفيش شراء أرض
    // خالص) بتتخزن هنا صراحة في قاعدة البيانات (مش منطق فرونت إند بس) -
    // castle.service.js بيتأكد إن أي مبنى جديد أو نقل مبنى واقع جوه الخانات
    // دي بس، وexpandCityToLevelCap هي اللي بتضيف خانات جديدة تلقائيًا أول ما
    // ترقية المبنى الرئيسي تخلص. ======
    unlocked_tiles: {
      type: [
        {
          x: { type: Number, required: true },
          y: { type: Number, required: true },
          _id: false,
        },
      ],
      default: [],
    },
    // الوحدات المدرَّبة فعلًا وجاهزة في القلعة (جيشك الحالي)
    army: [troopStackSchema],
    // طابور أوامر التدريب الشغالة/المصفوفة حاليًا في الثكنة
    training_queue: [trainingOrderSchema],
    // ====== NEW (Attackable World Objects) - راجع
    // world/worldObjectCastleBridge.js لشرح كامل. القلعة دي "ظل" (shadow)
    // اتولّدت تلقائيًا عشان تمثّل كائن عالم معادي (Barbarian Camp/Military
    // Camp/Guard Tower/...إلخ) جوه نفس محرك القلاع الحقيقي - مش قلعة حقيقية
    // زي أي قلعة NPC تانية إلا في إنها مربوطة بمصدرها الأصلي (world_object_id)
    // عشان نتيجة أي معركة عليها تتزامن رجوع لمستند الـ WorldObject بعد
    // الحسم. sparse: true (زي user_id/kingdom_id فوق) عشان الفهرس ميتأثرش
    // بالقلاع العادية اللي القيمة دي null عندها. ======
    is_world_object: { type: Boolean, default: false },
    world_object_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WorldObject',
      default: null,
      index: true,
      sparse: true,
    },
    // ====== Rewarded Ads Gameplay (Castle Game) ======
    // حالة مؤثرات المكافآت المرتبطة بالإعلانات واللي بتتخزن على مستوى
    // القلعة نفسها (مش RewardSession/RewardEntitlement - دول تاريخ العمليات،
    // ده الحالة الحية الحالية). كل الحقول اختيارية وافتراضيها null/false
    // عشان مستندات القلاع الموجودة تفضل شغالة زي ما هي من غير أي migration.
    ads_state: {
      // ====== daily_double ======
      // آخر مرة اللاعب استخدم فيها daily_double بنجاح - عشان نحسب هل هو
      // مستحق تاني بعد الـ cooldown المحدد في rewardKinds.config.js ولا لأ.
      last_daily_double_at: { type: Date, default: null },
      // ====== hourly_gift ======
      // آخر مرة اللاعب استلم فيها هدية الساعة بنجاح - نفس فلسفة
      // last_daily_double_at بالظبط بس بكولداون أقصر (افتراضي ساعة واحدة).
      last_hourly_gift_at: { type: Date, default: null },
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

module.exports = mongoose.model('Castle', castleSchema);
