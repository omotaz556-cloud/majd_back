const mongoose = require('mongoose');

// كومة وحدات ماشية ضمن مسير معيّن - نفس شكل troopStackSchema في
// castle.model بس منفصلة هنا (المسير مستند مستقل عن القلعة).
const marchTroopStackSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    count: { type: Number, required: true },
  },
  { _id: false }
);

// ====== خسارة تعزيز حليف واحد جوه تقرير معركة - كومة وحدات مربوطة بمالكها
// (اللاعب اللي بعت التعزيز ده بالذات) عشان تقرير المعركة يقدر يميّز خسائر
// جيش صاحب القلعة عن خسائر كل حليف بعتله تعزيز على حدة. ======
const reinforcementLossSchema = new mongoose.Schema(
  {
    owner_user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    troops_lost: [marchTroopStackSchema],
  },
  { _id: false }
);

// تقرير نتيجة الغارة - بيتحسب وقت وصول مسير الهجوم لهدفه، وبيفضل متسجل على
// المستند حتى بعد ما يتحول لمسير عودة (تاريخ للعرض في الواجهة لاحقًا).
const marchReportSchema = new mongoose.Schema(
  {
    outcome: { type: String, enum: ['win', 'loss', 'recalled'] },
    loot: {
      gold: { type: Number, default: 0 },
      wood: { type: Number, default: 0 },
      stone: { type: Number, default: 0 },
    },
    troops_sent: [marchTroopStackSchema],
    troops_lost: [marchTroopStackSchema],
    troops_survived: [marchTroopStackSchema],
    // خسارة جيش الدفاع (لو كان عنده جيش واقف في القلعة) - موجودة بس لمسير
    // الهجوم، عشان المهاجم يشوف إيه الضرر اللي عمله في دفاع الهدف. دي جيش
    // صاحب القلعة نفسه بس - مش شاملة تعزيزات الحلفاء (راجع الحقل اللي تحت).
    defender_troops_lost: [marchTroopStackSchema],
    // ====== Phase 12: خسائر تعزيزات الحلفاء اللي كانت واقفة في قلعة الهدف
    // وقت المعركة - عنصر واحد لكل حليف بعت تعزيز، عشان "Battle Report must
    // identify troop ownership" تتحقق حتى مع أكتر من حليف بعت تعزيز لنفس القلعة. ======
    defender_reinforcements_lost: { type: [reinforcementLossSchema], default: [] },
  },
  { _id: false }
);

// مسير واحد لجيش - إما "طالع" لهدف (attack) أو "راجع" لقلعة صاحبه (return)
// بعد ما الغارة اتحسمت. كل مسير بيتحسب وقت وصوله (arrives_at) وقت إنشائه
// بناءً على المسافة/سرعة الجيش - نفس فلسفة completes_at في upgrade/training
// (lazy resolution وقت القراءة، مفيش cron شغال كل ثانية).
const marchSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    origin_castle_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Castle', required: true },
    target_castle_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Castle', required: true },

    // لقطة (snapshot) من إحداثيات القلعتين وقت إنشاء المسير - عشان لو قلعة
    // اتنقلت (مش متوقع حاليًا) يفضل المسير الحالي متسق بصريًا لحد ما يوصل.
    origin_map_slot: { x: Number, y: Number },
    target_map_slot: { x: Number, y: Number },

    // اسم الهدف وقت إنشاء المسير - عشان الواجهة تقدر تعرضه من غير ما تحتاج
    // populate إضافي (خصوصًا مهم لو الهدف NPC مالوش مستخدم حقيقي أصلاً).
    target_name: { type: String, default: null },
    target_is_npc: { type: Boolean, default: false },

    // ====== ملحوظة: 'reinforcement' (تعزيز جيش لقلعة حليف) و'gathering'
    // (تجميع موارد من نقطة على الخريطة) مضافين للـ enum عشان طبقة العرض
    // (الخريطة) تقدر ترسمهم زي أي مسير تاني من غير ما تحتاج تتعدّل يوم ما
    // منطق اللعبة بتاعهم يتضاف - لسه محتاجين خدمة/resolve منطق خاص بيهم
    // (مش موجود في march.service.js دلوقتي، بس attack/return). ======
    direction: { type: String, enum: ['attack', 'return', 'reinforcement', 'gathering'], required: true },

    // ====== *** فيكس (Reinforcements must march, not teleport) *** لو
    // المسير ده أصلًا "تعزيز" لمسير هجوم "شغال" بتاع نفس المهاجم (مش تعزيز
    // حليف - ده direction: 'reinforcement' منفصل تمامًا، شوف فوق) - بيماشي
    // زي أي مسير هجوم عادي بالظبط (direction: 'attack'، نفس السبرايت/اللون
    // "هجومي" على الخريطة)، والفرق الوحيد إن وصوله (arrival) مش بيبدأ معركة
    // جديدة - بيدمج جيشه جوه المسير/المعركة الأصلية اللي reinforces_march_id
    // بيشاور عليها (راجع mergeReinforcementIntoBattle في march.service.js).
    // null يعني "مسير هجوم عادي" (السلوك الافتراضي زي ما كان). ======
    reinforces_march_id: { type: mongoose.Schema.Types.ObjectId, ref: 'March', default: null },

    // ====== Phase 1 (Reinforcement & Battle System): 'battling' حالة جديدة
    // بتتحط للمسير لحظة ما يوصل هدفه (arrives_at) لو كان direction: 'attack' -
    // بدل ما يتحسم فورًا، المعركة دلوقتي "شغالة" لمدة حقيقية (battle_ends_at
    // تحت) قبل ما نطلع نتيجتها النهائية (march.report) ونحوّل الحالة لـ
    // 'resolved'. باقي الاتجاهات (return/reinforcement/gathering) لسه بتتحول
    // مباشرة من 'traveling' لـ 'resolved' زي ما كانت (مفيش "معركة" حقيقية
    // لأي مسير غير الهجوم). ======
    // ====== *** فيكس Bug 4 (تعزيزات/جيوش بترجع بعدد أكبر من المفروض -
    // Race Condition) *** 'processing' حالة مؤقتة إضافية (راجع march.service
    // .js::resolveDueMarches للتفاصيل الكاملة) - بتتحط لحظة "حجز" مسير وصل
    // وقته قبل ما نبدأ نعالجه، عشان لو نداءين متوازيين (زي load() وloadMarches()
    // في WorldMapPage.jsx اللي بيتصلوا في نفس اللحظة تقريبًا) حاولوا يعالجوا
    // نفس المسير في نفس الوقت، التاني يلاقيه اتحجز فعلًا ومايعالجوش تاني. ======
    status: { type: String, enum: ['traveling', 'battling', 'processing', 'resolved'], default: 'traveling' },

    // ====== لحظة نهاية المعركة الفعلية (بعد ما المسير يوصل ويدخل حالة
    // 'battling') - null لحد ما المعركة تبدأ فعليًا. بتتحسب مرة واحدة بس
    // وقت البدء (battleDurationSeconds في castle.config) وبتفضل ثابتة -
    // تعزيزات توصل بعدها وقبل ما تخلص المعركة بتشارك في نتيجتها (بتتحسب
    // وقت الحسم النهائي مش وقت البدء) بس مبتغيّرش مدة المعركة نفسها. ======
    battle_ends_at: { type: Date, default: null },

    // ====== Phase 1 (Reinforcement & Battle System) - لحظة بداية المعركة
    // بالظبط (نفس لحظة battle_ends_at فوق بتتحسب فيها) - محتاجينها منفصلة
    // عشان نقدر نحسب "نسبة تقدّم" المعركة (progress = elapsed/total) بدل ما
    // نفترض إنها بدأت وقت الإنشاء - أساس شريط "باور القلعة الحي" اللي بيقل
    // تدريجيًا مع الوقت (راجع computeLiveCastlePowerPct تحت). null لحد ما
    // المعركة تبدأ فعليًا (beginBattle)، ومعارك قديمة اتسجّلت قبل الحقل ده
    // بتفضل null (computeLiveCastlePowerPct بيتعامل معاها كـ "بدأت دلوقتي"). ======
    battle_started_at: { type: Date, default: null },

    troops: [marchTroopStackSchema],

    // ====== خطة المعركة (Battle Plan) اللي المهاجم اختارها وقت إرسال
    // الغارة دي - مرجع بس (Battle Planner 2.0 مستقل تمامًا، شوف
    // army/battlePlan.model.js). null يعني "من غير خطة محددة" (سلوك المسير
    // القديم قبل تكامل مخطط المعارك مع واجهة الهجوم - لسه مدعوم بالكامل). ======
    battle_plan_id: { type: mongoose.Schema.Types.ObjectId, ref: 'BattlePlan', default: null },

    departed_at: { type: Date, required: true },
    arrives_at: { type: Date, required: true },

    // موجود بس لمسير العودة (الغنيمة الراجعة فعليًا مع الناجيين)
    loot: {
      gold: { type: Number, default: 0 },
      wood: { type: Number, default: 0 },
      stone: { type: Number, default: 0 },
    },

    // موجود بس لمسير الهجوم بعد ما يتحسم (تقرير المعركة)
    report: { type: marchReportSchema, default: null },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

marchSchema.index({ user_id: 1, status: 1 });

module.exports = mongoose.model('March', marchSchema);
