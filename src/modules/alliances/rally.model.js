const mongoose = require('mongoose');
const { RALLY_STATUS, RALLY_CANCEL_REASON } = require('./rally.config');

// ====== كومة وحدات - نفس شكل marchTroopStackSchema/allianceReinforcement
// troopStackSchema بالظبط (key/count)، منسوخة هنا عشان Rally مستند مستقل. ======
const troopStackSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    count: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

// ====== مشارك واحد في التجمّع - عضو تحالف بعت جزء من جيشه للتجمّع ده.
// الجنود بتتخصم من castle.army بتاعه فورًا وقت الانضمام (نفس فلسفة
// startMarch/sendReinforcement: "الجيش الماشي/المرسَل مش موجود في قلعتك
// لحد ما يرجع")، فتفضل "واقفة" هنا (جوه مستند التجمّع) لحد ما التجمّع
// يتنفّذ (تدخل معركة) أو يتلغي/يسيبه صاحبها (بترجع فورًا). ======
const rallyParticipantSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    castle_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Castle', required: true },
    troops: { type: [troopStackSchema], default: [] },
    // ====== Phase 15 - باقي مساهمة المشارك غير الجنود. نفس فلسفة "generic
    // placeholder" المستخدمة أصلًا مع commander_snapshot/battleResolution
    // (heroes/research/buffs - مفيش نظام حقيقي وراهم لسه، بس شكلهم متوافق
    // 100% مع اللي battleResolutionEngine.resolveBattle بيتوقعه في
    // attacker.heroes/attacker.research/attacker.buffs - راجع
    // rallyContributionCalculator.mergeContributions اللي بتجمّعهم من كل
    // مشارك وقت الإطلاق). ======
    heroes: { type: [mongoose.Schema.Types.Mixed], default: [] },
    research: { type: mongoose.Schema.Types.Mixed, default: null },
    buffs: { type: [mongoose.Schema.Types.Mixed], default: [] },
    // ====== خطة معركة شخصية اختيارية للمشارك - "Battle Plan modifiers" في
    // السبك. Battle Planner 2.0 مالوش رقم % قابل للجمع (خطة = قواعد
    // تشكيل/استهداف/انسحاب، مش bonus_percent)، فمساهمة الخطة الشخصية دي
    // بتتسجّل للشفافية بس في تقرير المشارك (had_battle_plan) - أما
    // التشكيل/الهدف الرسمي اللي فعليًا بيتحسب بيه الجيش المدموج كله فبييجي
    // من rally.battle_plan_id (خطة القائد وقت الإنشاء). ======
    battle_plan_id: { type: mongoose.Schema.Types.ObjectId, ref: 'BattlePlan', default: null },
    joined_at: { type: Date, default: Date.now },
  },
  { _id: false }
);

// ====== نتيجة توزيع معركة التجمّع لمشارك واحد - جزء من "تقرير المعركة"
// الخاص بالتجمّع (منفصل عن Battle.battle_result العام - ده تكسير
// contribution-aware لنفس النتيجة، مين بعت إيه وخسر/كسب/كسب غنيمة إيه). ======
const rallyParticipantReportSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    troops_sent: { type: [troopStackSchema], default: [] },
    troops_lost: { type: [troopStackSchema], default: [] },
    troops_survived: { type: [troopStackSchema], default: [] },
    loot_share: {
      gold: { type: Number, default: 0 },
      wood: { type: Number, default: 0 },
      stone: { type: Number, default: 0 },
    },
    // نسبة مساهمته من إجمالي قوة هجوم التجمّع (0-100) - الأساس اللي عليه
    // اتوزّعت الغنيمة (راجع rallyLootDistributor.distributeLossesAndLoot).
    contribution_percent: { type: Number, default: 0 },
    // ====== Phase 15 - كام % ضاف الجيوش/الأبطال/الأبحاث/التعزيزات بتاعته
    // للمعركة (شفافية بس - مش بيغيّر توزيع الخسائر/الغنيمة، لأن ده متبني على
    // قوة الجيش المُرسَل زي ما هو). ======
    had_heroes: { type: Boolean, default: false },
    had_research: { type: Boolean, default: false },
    had_buffs: { type: Boolean, default: false },
    had_battle_plan: { type: Boolean, default: false },
  },
  { _id: false }
);

// ====== تقرير معركة التجمّع الكامل - بيتسجّل مرة واحدة بس لحظة الحسم
// (Rally ينتج معركة واحدة بالظبط - "Execute one battle / Generate one
// Battle Report"). battle_id فوق بيشاور على Battle Instance الرسمية
// (نفس شكل/راوت أي معركة تانية)، والحقل ده بس بيضيف تكسير حصص الأعضاء. ======
const rallyReportSchema = new mongoose.Schema(
  {
    winner: { type: String, enum: ['attacker', 'defender', 'draw', null], default: null },
    total_loot: {
      gold: { type: Number, default: 0 },
      wood: { type: Number, default: 0 },
      stone: { type: Number, default: 0 },
    },
    participants: { type: [rallyParticipantReportSchema], default: [] },
    resolved_at: { type: Date, default: null },
  },
  { _id: false }
);

// ====== تجمّع تحالف واحد (Alliance Rally) - قائد/ضابط بيحدد هدف ومدة عد
// تنازلي، أعضاء التحالف بينضموا بجيوشهم لحد ما العد التنازلي يخلص، وبعدين
// الجيوش كلها بتتدمج في معركة واحدة بس ضد الهدف - نفس فلسفة march واحد،
// بس بمشاركين كتير بدل واحد. ======
const rallySchema = new mongoose.Schema(
  {
    alliance_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Alliance', required: true, index: true },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    target_castle_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Castle', required: true, index: true },
    // اسم الهدف وقت إنشاء التجمّع - نفس فلسفة target_name في march.model
    // (عرض من غير populate إضافي، مهم خصوصًا لو الهدف NPC).
    target_name: { type: String, default: null },
    target_is_npc: { type: Boolean, default: false },

    // ====== خطة معركة التجمّع الرسمية - بتتحدد وقت الإنشاء (Leader/Officer)
    // زي ما الـ spec بيطلب ("Choose: Target City, Rally Duration, Battle
    // Plan"). دي اللي بتحدد التشكيل/الهدف (objective) بتاع الجيش المدموج
    // كله وقت الإطلاق - نفس resolveBattlePlanForAttack المستخدمة في هجوم
    // عادي (march.service)، بس هنا القائد هو اللي مالكها. ======
    battle_plan_id: { type: mongoose.Schema.Types.ObjectId, ref: 'BattlePlan', default: null },

    countdown_seconds: { type: Number, required: true },
    // لحظة انتهاء العد التنازلي - بيتحسم (lazy) وقت أي قراءة/كتابة على
    // التجمّع ده بعد اللحظة دي، نفس فلسفة arrives_at في march.model.
    launch_at: { type: Date, required: true },

    status: { type: String, enum: Object.values(RALLY_STATUS), default: RALLY_STATUS.GATHERING, index: true },
    cancelled_reason: { type: String, enum: [null, ...Object.values(RALLY_CANCEL_REASON)], default: null },

    participants: { type: [rallyParticipantSchema], default: [] },

    // مرجع بس - المعركة الرسمية الواحدة اللي التجمّع ده أنتجها (لو اتحسم
    // فعليًا). نفس Battle Instance اللي أي معركة تانية بتتخزن فيها
    // (GET /api/battles/:battleId بيشتغل عليها من غير أي راوت إضافي).
    battle_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Battle', default: null },
    report: { type: rallyReportSchema, default: null },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

rallySchema.index({ alliance_id: 1, status: 1 });
rallySchema.index({ status: 1, launch_at: 1 });

module.exports = mongoose.model('Rally', rallySchema);
