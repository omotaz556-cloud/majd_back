// ====== بناء اللقطات (Snapshots) بتاعة المعركة - الملف ده هو المسؤول
// الوحيد عن تحويل "حالة حية" (قلعة، جيش، موارد...) لـ "لقطة مجمّدة" بتتخزن
// جوه المعركة وقت بدء الهجوم. أي تعديل بعد كده على القلعة الحقيقية (بناء،
// ترقية، تدريب، تعديل توازن TROOP_TYPES...) ما يأثرش على اللقطة دي خالص. ======
const { TROOP_TYPES } = require('../castle/castle.config');

// ====== بيحوّل قايمة كومات وحدات (زي army/troops في castle.model أو
// march.model: [{key, count}]) للقطة كاملة بالإحصائيات (stats/speed/
// carry_capacity) منسوخة فعليًا من TROOP_TYPES وقت الاستدعاء - مش reference. ======
// ====== ownerTag اختياري - {owner_user_id, is_reinforcement} - بيتحط على
// كل كومة وحدات عشان تقرير المعركة يقدر يميّز "جيش صاحب القلعة نفسه" عن
// "تعزيز حليف" (Phase 12: Alliance Reinforcements - "Battle Report must
// identify troop ownership"). null/false افتراضيًا (نفس السلوك القديم
// بالظبط لجيش المهاجم وجيش صاحب القلعة).
//
// ====== Phase 13: Alliance Rally - لو ownerTag العام مش موجود (زي
// buildAttackerSnapshot العادي)، بنرجع لـ owner_user_id/is_reinforcement
// المتحطين على الكومة نفسها لو موجودين (t.owner_user_id) - ده بيسمح
// لـ rally.service يبعت مصفوفة troops واحدة مدموجة من كذا عضو تحالف، كل
// كومة معلّمة بصاحبها هي بالذات، من غير ما يحتاج يبعت ownerTag واحد عام
// لكل المصفوفة (اللي مكانش هيقدر يميّز بين الأعضاء). السلوك القديم (مهاجم
// عادي بجيش واحد بس، من غير أي owner_user_id على الكومات) فاضل زي ما هو
// بالظبط - null. ======
function snapshotTroopStacks(troopStacks = [], ownerTag = null) {
  return troopStacks
    .filter((t) => t && t.key && Number(t.count) > 0)
    .map((t) => {
      const cfg = TROOP_TYPES[t.key] || {};
      return {
        key: t.key,
        count: Number(t.count),
        stats: {
          attack: cfg.stats?.attack ?? 0,
          defense: cfg.stats?.defense ?? 0,
          hp: cfg.stats?.hp ?? 0,
        },
        speed: cfg.speed ?? 0,
        carry_capacity: cfg.carry_capacity ?? 0,
        owner_user_id: ownerTag?.owner_user_id ?? t.owner_user_id ?? null,
        is_reinforcement: ownerTag ? Boolean(ownerTag.is_reinforcement) : Boolean(t.is_reinforcement),
      };
    });
}

// ====== لقطة كل تعزيزات الحلفاء الواقفة في قلعة الدافع وقت بدء الهجوم -
// كل مستند AllianceReinforcement بيتحول لكومات وحدات متعلّمة بمالكها
// (origin_user_id) عشان تنضم لمصفوفة troops العامة بتاعة الدافع مع باقي
// جيشه، من غير ما تفقد هويتها. ======
function snapshotReinforcementTroops(reinforcements = []) {
  return (reinforcements || []).flatMap((r) =>
    snapshotTroopStacks(r.troops, { owner_user_id: r.origin_user_id, is_reinforcement: true })
  );
}

// ====== لقطة القادة (Commanders) - نظام القادة نفسه مش موجود في اللعبة
// لسه، فبنكتفي بتمرير أي بيانات اتبعتت زي ما هي (شكل حر مقصود، راجع تعليق
// commanderSnapshotSchema في battle.model.js). ======
function snapshotCommanders(commanders = []) {
  if (!Array.isArray(commanders)) return [];
  return commanders.map((c) => ({
    commander_key: c?.commander_key ?? c?.key ?? null,
    name: c?.name ?? null,
    level: Number.isFinite(Number(c?.level)) ? Number(c.level) : 1,
    bonuses: c?.bonuses && typeof c.bonuses === 'object' ? c.bonuses : {},
  }));
}

// ====== لقطة التشكيل (Formation) - Battle Planner هيبنى فوق الشكل ده لاحقًا ======
function snapshotFormation(formation) {
  if (!formation || typeof formation !== 'object') {
    return { type: 'standard', slots: [] };
  }
  const slots = Array.isArray(formation.slots)
    ? formation.slots
        .filter((s) => s && s.troop_key)
        .map((s) => ({
          troop_key: s.troop_key,
          row: Number.isFinite(Number(s.row)) ? Number(s.row) : 0,
          column: Number.isFinite(Number(s.column)) ? Number(s.column) : 0,
        }))
    : [];
  return {
    type: typeof formation.type === 'string' ? formation.type : 'standard',
    slots,
  };
}

// ====== لقطة خطة المعركة (Battle Plan) - المهاجم بيقدر يبعت objective/orders
// حرة دلوقتي، والـ Battle Planner هو اللي هيدّي معنى حقيقي للأوامر دي لاحقًا. ======
function snapshotBattlePlan(battlePlan) {
  if (!battlePlan || typeof battlePlan !== 'object') {
    return { objective: 'loot', orders: [], notes: null };
  }
  const allowedObjectives = ['loot', 'raze', 'conquer', 'custom'];
  return {
    objective: allowedObjectives.includes(battlePlan.objective) ? battlePlan.objective : 'loot',
    orders: Array.isArray(battlePlan.orders) ? battlePlan.orders : [],
    notes: typeof battlePlan.notes === 'string' ? battlePlan.notes : null,
  };
}

// ====== لقطة كاملة لطرف المهاجم وقت بدء الهجوم ======
function buildAttackerSnapshot({ troops, commanders, formation, battlePlan }) {
  return {
    troops: snapshotTroopStacks(troops),
    commanders: snapshotCommanders(commanders),
    formation: snapshotFormation(formation),
    battle_plan: snapshotBattlePlan(battlePlan),
  };
}

// ====== لقطة مباني القلعة - نفس شكل building في castle.model بس منسوخة
// (key/level/position) - hp لسه null لحد ما "Building Interaction" يتبنى. ======
function snapshotBuildings(buildings = []) {
  return buildings.map((b) => ({
    key: b.key,
    level: b.level,
    position: { x: b.position?.x ?? 0, y: b.position?.y ?? 0 },
    hp: null,
  }));
}

// ====== لقطة تخطيط المدينة - شبكة الخانات المفتوحة وقت بدء الهجوم بالظبط ======
function snapshotCityLayout(castle, gridSize) {
  return {
    grid_size: gridSize ?? null,
    unlocked_tiles: (castle.unlocked_tiles || []).map((t) => ({ x: t.x, y: t.y })),
  };
}

// ====== لقطة القطع الدفاعية الحقيقية (defense.model CastleDefense.structures)
// وقت بدء الهجوم - مقسّمة حسب الفئة (category) لنفس شكل walls/towers/gates/
// trap_positions اللي battle.model.js بيتوقعه. كل رقم قتالي (hp/damage/range/
// defense_power/defense_bonus_percent) منسوخ فعليًا من combat_stats المحسوبة
// بالفعل جوه defense.config.js وقت إضافة/ترقية القطعة - مفيش أي رقم متخترع
// هنا. المتاريس (barricade) بتترص مع الأسوار (نفس الدور: عائق سلبي بيمتص
// ضربات ومعاه مساهمة دفاعية flat خفيفة).
//
// ====== defense_power/defense_bonus_percent هنا هي نفس الأسماء اللي
// defensePowerCalculator.calculateBuildingBonus/calculateWallBonus/
// calculateTowerBonus بيقروها فعليًا (raw defender.buildings/wall/towers) -
// من غيرها كانت كل مباني الدفاع بتترسم في المعركة كـ "أهداف hp" بس من غير
// أي مساهمة حقيقية في قوة الدفاع الكلية جنب الجنود. دلوقتي كل قطعة سور/برج/
// بوابة/فخ بتضيف رقمها الحقيقي. ======
function snapshotDefenseStructures(structures = []) {
  const walls = [];
  const towers = [];
  const gates = [];
  const traps = [];

  (structures || []).forEach((s) => {
    if (!s) return;
    // قطعة اتدمرت فعليًا قبل الهجوم (لسه ما اتصلحتش) - مش هدف/دفاع حقيقي في
    // المعركة دي (نفس فلسفة "مفيش hp حقيقي = مش هدف قتالي" في
    // battle.runner.js buildStructuresFromSnapshot)، فمش بتترسم أصلًا -
    // ولا بتضيف أي قوة دفاعية طالما مش واقفة فعليًا.
    if (s.repair?.state === 'destroyed' || !Number.isFinite(s.hp) || s.hp <= 0) return;

    const position = { x: s.position?.x ?? 0, y: s.position?.y ?? 0 };
    const armor = s.combat_stats?.defense ?? 0;
    const defensePower = s.combat_stats?.defense ?? 0;
    const defenseBonusPercent = s.combat_stats?.defense_bonus_percent ?? 0;

    // ====== `structure_id` - نفس الـ `_id` الحقيقي بتاع القطعة دي جوه
    // CastleDefense.structures (defense.model.js: `{ _id: true }`). من غير
    // الحقل ده، أي إشارة لقطعة بعينها في BattlePlan (target_priorities/
    // protection_rules بتاعة target_ref_id - نفس الـ _id ده بالظبط، راجع
    // battlePlanner.service.js: validateTargetReference) كانت بتضيع تمامًا
    // في اللقطة (اللي كانت بتحمل بس `key: s.type` - نوع القطعة، مش هويتها)
    // - يعني حتى لو خطة اللاعب استهدفت بوابة بعينها بالـ id بتاعتها، مفيش
    // أي مكان بعد كده (snapshot/simulation/combat) يقدر يتعرف عليها تاني.
    // بنسيب `key` زي ما هو (مستهلك في أماكن تانية زي buildingArt الفرونت
    // إند) ونضيف الحقل الجديد ده بس، من غير أي تغيير في الحقول الموجودة. ======
    const structureId = s._id ? String(s._id) : null;

    if (s.category === 'tower') {
      towers.push({
        key: s.type,
        structure_id: structureId,
        level: s.level,
        hp: s.hp,
        damage: s.combat_stats?.damage ?? 0,
        range: s.combat_stats?.range ?? 0,
        armor,
        defense_power: defensePower,
        defense_bonus_percent: defenseBonusPercent,
        position,
      });
    } else if (s.category === 'gate') {
      gates.push({
        key: s.type,
        structure_id: structureId,
        level: s.level,
        hp: s.gate_state?.destroyed ? 0 : s.hp,
        armor,
        // بوابة مكسورة/مفتوحة قسرًا مش بتديش مساهمتها الدفاعية الكاملة
        // (خط الدفاع مخروق من عندها بالظبط).
        defense_power: s.gate_state?.destroyed ? 0 : defensePower,
        defense_bonus_percent: s.gate_state?.destroyed ? 0 : defenseBonusPercent,
        position,
        facing: Number.isFinite(s.rotation) ? String(s.rotation) : null,
        open: s.gate_state?.open ?? true,
        destroyed: s.gate_state?.destroyed ?? false,
      });
    } else if (s.category === 'trap') {
      traps.push({
        key: s.type,
        structure_id: structureId,
        level: s.level,
        hp: s.hp,
        damage: s.combat_stats?.damage ?? 0,
        range: s.combat_stats?.range ?? 1,
        defense_power: defensePower,
        defense_bonus_percent: defenseBonusPercent,
        position,
      });
    } else {
      // wall أو barricade - عائق بس (مالوش نيران دفاعية)، بس بيضيف قوة
      // دفاعية حقيقية زي أي قطعة تانية.
      walls.push({
        key: s.type,
        structure_id: structureId,
        level: s.level,
        hp: s.hp,
        armor,
        defense_power: defensePower,
        defense_bonus_percent: defenseBonusPercent,
        position,
      });
    }
  });

  return { walls, towers, gates, traps };
}

// ====== لقطة كاملة لطرف الدافع وقت بدء الهجوم - المدينة كلها كما هي فعليًا
// (مبانيها، جيشها الواقف، مواردها، شبكتها، وقطعها الدفاعية الحقيقية لو
// عندها مستند دفاع - defenseStructures بييجي من CastleDefense.structures،
// راجع defenseService.getDefenseByCastleId). لو القلعة دي لسه معملتش أي
// قطعة دفاعية خالص (وضع طبيعي جدًا لسه)، الأربع مصفوفات دي بترجع فاضية -
// نفس سلوك المعركة قبل التكامل ده تمامًا. ======
function buildDefenderSnapshot(castle, { gridSize, defenseStructures, reinforcements, commanders } = {}) {
  const { walls, towers, gates, traps } = snapshotDefenseStructures(defenseStructures);

  return {
    // ====== جيش صاحب القلعة (owner_user_id: null/is_reinforcement: false)
    // + جنود أي تعزيز حليف واقف فيها (owner_user_id: مين بعته/is_reinforcement:
    // true) - نفس مصفوفة troops الواحدة، الملكية بس بتتفرّق عن طريق التاج. ======
    troops: [...snapshotTroopStacks(castle.army), ...snapshotReinforcementTroops(reinforcements)],
    // ====== هيرو صاحب القلعة (لو اختار واحد - راجع hero.config.js) بنفس
    // شكل commanderSnapshotSchema العام؛ مصفوفة فاضية لو لسه معندوش (قلاع
    // NPC مثلًا). بيتبعت جاهز من createBattle (heroToBattleInput) بدل ما
    // يتحسب هنا - الملف ده بيبقى بس مسؤول عن التقاط اللقطة. ======
    commanders: snapshotCommanders(commanders),
    buildings: snapshotBuildings(castle.buildings),
    walls,
    towers,
    gates,
    resources: {
      gold: castle.resources?.gold?.stored ?? 0,
      wood: castle.resources?.wood?.stored ?? 0,
      stone: castle.resources?.stone?.stored ?? 0,
    },
    city_layout: snapshotCityLayout(castle, gridSize),

    // ====== إضافات الأساس - defense_plan/reserved_army/garrisons/wall_layout
    // لسه Placeholder (Battle Planner من ناحية الدافع لسه مش موجود)، بس
    // trap_positions دلوقتي بيحمل الفخاخ الحقيقية (شكل قتالي كامل يستخدمه
    // battle.runner.js مباشرة - الاسم "trap_positions" اتسابه زي ما هو عشان
    // مايتلمسش battle.model.js تاني من غير داعي). ======
    defense_plan: { strategy: null, orders: [], notes: null },
    reserved_army: [],
    garrisons: [],
    wall_layout: { grid_size: gridSize ?? null, segments: [] },
    tower_positions: [],
    gate_positions: [],
    trap_positions: traps,
  };
}

module.exports = {
  buildAttackerSnapshot,
  buildDefenderSnapshot,
  snapshotTroopStacks,
  snapshotDefenseStructures,
};
