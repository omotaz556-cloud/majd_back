const CastleDefense = require('./defense.model');
const castleService = require('../castle/castle.service');
const {
  DEFENSE_STRUCTURE_TYPES,
  STRUCTURE_CATEGORY,
  RESERVED_ARMY_CATEGORIES,
  DEFENSE_PLAN_RULE_TYPES,
  GARRISON_TARGET_TYPES,
  getStructureConfig,
  structureMaxLevel,
  structureMaxHp,
  structureUpgradeCost,
  structureUpgradeSeconds,
  structureCombatStatsPlaceholder,
} = require('./defense.config');
const { TROOP_TYPES, RESOURCE_TYPES, speedupGemCost } = require('../castle/castle.config');
const { isAdmin } = require('../common/adminAccess.service');
const walletService = require('../wallets/wallet.service');

// ====== بيرجّع مستند دفاع القلعة بتاعة اليوزر ده، وبيعمله واحد جديد فاضي
// أول مرة (lazy creation - نفس فلسفة getOrCreateCastle). القلعة نفسها
// لازم تكون موجودة الأول (بيستخدم loadCastleCommon عشان يستفيد من نفس
// منطق استكمال الترقيات/الموارد الموجود بالفعل). ======
async function getOrCreateDefense(userId) {
  const castle = await castleService.loadCastleCommon(userId);

  let defense = await CastleDefense.findOne({ castle_id: castle._id });
  if (!defense) {
    defense = await CastleDefense.create({ castle_id: castle._id });
  }

  const completedStructures = completeFinishedStructureUpgrades(defense);
  const completedRepairs = completeFinishedRepairs(defense);
  const completedBuilds = completeFinishedBuilds(defense);
  if (completedStructures.length || completedRepairs.length || completedBuilds.length) {
    await defense.save();
  }

  return { castle, defense };
}

// ====== استكمال أي ترقية قطعة دفاعية خلصت وقتها - نفس منطق
// completeFinishedUpgrades بتاع castle.service بالظبط لكن على structures[]. ======
function completeFinishedStructureUpgrades(defense) {
  const now = new Date();
  const completed = [];
  for (const s of defense.structures) {
    if (s.upgrade?.in_progress && s.upgrade.completes_at <= now) {
      s.level = s.upgrade.target_level;
      s.max_hp = structureMaxHp(s.type, s.level);
      s.hp = s.max_hp; // الترقية بتخلّص وهي مكتملة الصحة
      s.combat_stats = structureCombatStatsPlaceholder(s.type, s.level);
      s.upgrade.in_progress = false;
      s.upgrade.target_level = null;
      s.upgrade.started_at = null;
      s.upgrade.completes_at = null;
      completed.push({ id: s._id.toString(), type: s.type, level: s.level });
    }
  }
  return completed;
}

// ====== استكمال أي إصلاح شغال خلص وقته - بيرجّع الـ hp للـ max_hp
// وبيصفّر حالة الإصلاح لـ 'intact'. ======
function completeFinishedRepairs(defense) {
  const now = new Date();
  const completed = [];
  for (const s of defense.structures) {
    if (s.repair?.state === 'damaged' && s.repair.completes_at && s.repair.completes_at <= now) {
      s.hp = s.max_hp;
      s.repair.state = 'intact';
      s.repair.started_at = null;
      s.repair.completes_at = null;
      completed.push({ id: s._id.toString(), type: s.type });
    }
  }
  return completed;
}

// ====== استكمال أي بناء أول مرة (queued/building) خلص وقته - يتحول build
// state لـ 'complete'. ======
function completeFinishedBuilds(defense) {
  const now = new Date();
  const completed = [];
  for (const s of defense.structures) {
    if (s.build?.state === 'building' && s.build.completes_at && s.build.completes_at <= now) {
      s.build.state = 'complete';
      s.build.completes_at = null;
      completed.push({ id: s._id.toString(), type: s.type });
    }
  }
  return completed;
}

// ====== عرض القطع الدفاعية الحقيقية بتاعة أي قلعة (مش بس قلعتك انت) -
// نفس فلسفة castleService.getCastleView بالظبط: بترجّع مستند الدفاع
// الحقيقي (لو موجود) بعد ما تكمّل أي ترقية/إصلاح/بناء خلص وقته، عشان أي
// مشهد عرض (City Scene الحالي أو صفحة المعركة المستقلة) يقدر يرسم نفس
// الحالة المحفوظة فعليًا في قاعدة البيانات - مش نسخة تقريبية. مفيش أي قيد
// ملكية هنا عمدًا (نفس getCastleView) - أي حد مسجّل دخول يقدر "يشوف" قطع
// دفاع أي قلعة، بالظبط زي ما يقدر يشوف مبانيها. لو القلعة دي لسه معملتش
// أي مستند دفاع خالص (نظام بناء الدفاعات لسه مش مفعّل من ناحية اللاعب)،
// بيرجّع null - حالة طبيعية تمامًا، مش خطأ - والـ controller هو اللي
// بيحوّلها لمصفوفة فاضية. عمدًا من غير getOrCreateDefense (اللي بتعمل
// مستند فاضي جديد) عشان "عرض" قلعة حد تاني ميعملش أي كتابة على بياناته. ======
async function getDefenseByCastleId(castleId) {
  const defense = await CastleDefense.findOne({ castle_id: castleId });
  if (!defense) return null;

  const completedStructures = completeFinishedStructureUpgrades(defense);
  const completedRepairs = completeFinishedRepairs(defense);
  const completedBuilds = completeFinishedBuilds(defense);
  if (completedStructures.length || completedRepairs.length || completedBuilds.length) {
    await defense.save();
  }

  return defense;
}

function assertValidType(type) {
  if (!DEFENSE_STRUCTURE_TYPES[type]) {
    throw new Error('نوع مبنى دفاعي غير معروف');
  }
}

function assertValidPosition(position) {
  const x = Number(position?.x);
  const y = Number(position?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isInteger(x) || !Number.isInteger(y)) {
    throw new Error('مكان غير صحيح على شبكة المدينة');
  }
  return { x, y };
}

function isPositionTaken(defense, x, y, excludeId = null) {
  return defense.structures.some(
    (s) => s.position.x === x && s.position.y === y && s._id.toString() !== String(excludeId)
  );
}

// ====== خصم تكلفة قطعة دفاعية (بناء جديد أو ترقية) من موارد القلعة - نفس
// منطق deductCost بتاع castle.service بالظبط (فحص الموارد كافية الأول لكل
// نوع، وبعدين خصم الكل مع بعض) بس مستنسخة هنا محليًا لأن castle.service
// مبيصدّرش deductCost أصلًا (داخلية بحتة هناك). ======
// ====== Admin privilege (Unlimited Resources) - نفس فكرة deductCost بتاع
// castle.service بالظبط: adminBypass=true بيخلي الدالة no-op تمامًا (مفيش
// فحص ولا خصم). القرار نفسه بييجي من adminAccess.service.isAdmin بس -
// مفيش أي فحص role مكرر هنا. ======
function deductStructureCost(castle, cost, adminBypass = false) {
  if (adminBypass) return;

  for (const resource of RESOURCE_TYPES) {
    if (castle.resources[resource].stored < cost[resource]) {
      throw new Error('الموارد مش كفاية لبناء القطعة الدفاعية دي');
    }
  }
  for (const resource of RESOURCE_TYPES) {
    castle.resources[resource].stored -= cost[resource];
  }
}

// ====== قايمة كل أنواع المباني الدفاعية المتاحة - للفرونت إند عشان يعرض
// كتالوج البناء (تكلفة/مدة/فئة) من غير ما يفترض أي رقم بنفسه. ======
function listStructureTypes() {
  return Object.values(DEFENSE_STRUCTURE_TYPES).map((cfg) => ({
    key: cfg.key,
    name: cfg.name,
    description: cfg.description,
    category: cfg.category,
    rotation_applicable: cfg.rotation_applicable,
    max_level: cfg.max_level,
    base_cost: cfg.base_cost,
    base_build_seconds: cfg.base_build_seconds,
  }));
}

// ====== إضافة قطعة دفاعية جديدة - بتتحط في حالة "قيد البناء" فورًا. التكلفة
// (defense.config DEFENSE_STRUCTURE_TYPES[type].base_cost) بتتخصم من موارد
// القلعة فورًا وقت بدء البناء - نفس فلسفة startNewBuilding بتاع
// castle.service بالظبط (deductCost قبل أي كتابة، عشان لو الموارد مش كفاية
// يترمي Error من غير أي أثر جزئي). التحقق هنا بيقتصر على: نوع معروف، مكان
// صحيح على الشبكة، مكان مش متشغول بقطعة تانية، ولو الخانة جوه شبكة القلعة
// فعلاً متاحة (نفس فحص isTileUnlocked المستخدم في بناء المباني العادية)،
// وبعد كده الموارد كافية. ======
async function addStructure(userId, { type, position, rotation }) {
  const adminBypass = await isAdmin(userId);
  assertValidType(type);
  const { x, y } = assertValidPosition(position);

  const { castle, defense } = await getOrCreateDefense(userId);

  if (!castleService.isTileUnlocked(castle, x, y)) {
    throw new Error('الخانة دي لسه مش مفتوحة في مدينتك - افتحها الأول أو اختار مكان تاني');
  }
  if (isPositionTaken(defense, x, y)) {
    throw new Error('المكان ده متشغول بقطعة دفاعية تانية بالفعل');
  }

  const cfg = getStructureConfig(type);
  const now = new Date();
  const buildSeconds = cfg.base_build_seconds;
  const maxHp = structureMaxHp(type, 1);

  // ====== خصم تكلفة البناء (نفس فلسفة startNewBuilding بتاع castle.service:
  // بيتخصم فورًا وقت بدء البناء، مش وقت اكتماله) - قبل أي كتابة على
  // defense.structures عشان لو الموارد مش كفاية، مفيش أي أثر جزئي. ======
  deductStructureCost(castle, cfg.base_cost, adminBypass);

  defense.structures.push({
    type,
    category: cfg.category,
    level: 1,
    hp: maxHp,
    max_hp: maxHp,
    position: { x, y },
    rotation: cfg.rotation_applicable ? Number(rotation) || 0 : 0,
    upgrade: {},
    repair: { state: 'intact' },
    // ====== Admin privilege (Instant Construction Timers) - build.state
    // بيتحط 'complete' فورًا من غير مؤقّت خالص لو adminBypass، بدل
    // 'building' + completes_at زي اللاعبين العاديين. ======
    build: adminBypass
      ? { state: 'complete', started_at: now, completes_at: null }
      : { state: 'building', started_at: now, completes_at: new Date(now.getTime() + buildSeconds * 1000) },
    combat_stats: structureCombatStatsPlaceholder(type, 1),
    gate_state: type === 'gate' ? { open: true, destroyed: false } : { open: true, destroyed: false },
  });

  await castle.save();
  await defense.save();
  return defense.structures[defense.structures.length - 1];
}

function findStructure(defense, structureId) {
  const structure = defense.structures.id(structureId);
  if (!structure) throw new Error('القطعة الدفاعية دي مش موجودة');
  return structure;
}

// ====== بدء ترقية قطعة دفاعية - نفس منطق startUpgrade بتاع المباني
// العادية (مفيش ترقيتين في نفس الوقت، مفيش تخطي أقصى مستوى). ======
// ====== بدء ترقية قطعة دفاعية - نفس منطق startUpgrade بتاع المباني
// العادية (مفيش ترقيتين في نفس الوقت، مفيش تخطي أقصى مستوى، وتكلفة الترقية
// (structureUpgradeCost) بتتخصم من موارد القلعة فورًا وقت بدء الترقية). ======
async function upgradeStructure(userId, structureId) {
  const adminBypass = await isAdmin(userId);
  const { castle, defense } = await getOrCreateDefense(userId);
  const structure = findStructure(defense, structureId);

  if (structure.upgrade?.in_progress) {
    throw new Error('في ترقية شغالة بالفعل لهذه القطعة - استنى لحد ما تخلص');
  }
  if (structure.repair?.state === 'destroyed') {
    throw new Error('القطعة دي متدمرة - لازم تتبنى تاني قبل ما تترقّى');
  }
  const maxLevel = structureMaxLevel(structure.type);
  if (structure.level >= maxLevel) {
    throw new Error('القطعة دي وصلت لأقصى مستوى');
  }

  const targetLevel = structure.level + 1;
  const cost = structureUpgradeCost(structure.type, targetLevel);
  deductStructureCost(castle, cost, adminBypass);

  if (adminBypass) {
    // ====== Admin privilege (Instant Construction Timers) - نفس أثر
    // completeFinishedStructureUpgrades لكن لحظيًا، مفيش upgrade.in_progress
    // ولا مؤقّت خالص. اللاعبين العاديين مش بيمروا من هنا خالص. ======
    structure.level = targetLevel;
    structure.max_hp = structureMaxHp(structure.type, structure.level);
    structure.hp = structure.max_hp;
    structure.combat_stats = structureCombatStatsPlaceholder(structure.type, structure.level);
  } else {
    const seconds = structureUpgradeSeconds(structure.type, targetLevel);
    const now = new Date();

    structure.upgrade = {
      in_progress: true,
      target_level: targetLevel,
      started_at: now,
      completes_at: new Date(now.getTime() + seconds * 1000),
    };
  }

  await castle.save();
  await defense.save();
  return structure;
}

// ====== تسريع فوري بالجواهر - ترقية قطعة دفاعية شغالة ======
// نفس فلسفة castleService.speedupBuildingUpgrade بالظبط: بنخصم من رصيد
// المحفظة أولًا (recordTransaction بترمي error لو الرصيد مش كفاية، فمفيش أي
// تعديل على القطعة لو الخصم فشل)، وبعدين بنطبّق نتيجة الترقية يدويًا على
// القطعة ده بس (بدل ما ننتظر الوقت الطبيعي). التكلفة بتتحسب على الثواني
// المتبقية *الفعلية* وقت الطلب (مش المدة الكلية الأصلية) - نفس
// speedupGemCost المستخدمة في المباني العادية، عشان سعر الدقيقة يفضل موحّد
// في اللعبة كلها بدل ما يبقى فيه معيارين مختلفين لتسريع البناء.
async function speedupStructureUpgrade(userId, structureId) {
  const { defense } = await getOrCreateDefense(userId);
  const structure = findStructure(defense, structureId);

  if (!structure.upgrade?.in_progress) {
    throw new Error('القطعة دي مفيهاش أي ترقية شغالة دلوقتي');
  }

  const now = new Date();
  const remainingSeconds = Math.max(
    0,
    (structure.upgrade.completes_at.getTime() - now.getTime()) / 1000
  );
  const gemCost = speedupGemCost(remainingSeconds);

  // ====== Admin privilege (Unlimited Gems) - نفس منطق speedupBuildingUpgrade
  // بتاع castle.service بالظبط: لو الأدمن، بيتخصمش رصيد خالص. ======
  const adminBypass = await isAdmin(userId);
  if (gemCost > 0 && !adminBypass) {
    await walletService.recordTransaction({
      userId,
      type: 'spend',
      amount: gemCost,
      taxMode: 'not_applicable',
      category: 'building_speedup',
    });
  }

  const targetLevel = structure.upgrade.target_level;
  structure.level = targetLevel;
  structure.max_hp = structureMaxHp(structure.type, structure.level);
  structure.hp = structure.max_hp;
  structure.combat_stats = structureCombatStatsPlaceholder(structure.type, structure.level);
  structure.upgrade.in_progress = false;
  structure.upgrade.target_level = null;
  structure.upgrade.started_at = null;
  structure.upgrade.completes_at = null;

  await defense.save();
  return structure;
}

// ====== بدء إصلاح قطعة دفاعية متضررة - مفيش محرك قتال حقيقي بينقص hp لسه،
// فده endpoint إداري بيسمح تحط القطعة يدويًا في حالة 'damaged' (simulateDamage)
// أو تبدأ إصلاحها لو أصلًا 'damaged'. مدة الإصلاح Placeholder بسيط: نص مدة
// الترقية لنفس المستوى الحالي. ======
async function startRepair(userId, structureId) {
  const { defense } = await getOrCreateDefense(userId);
  const structure = findStructure(defense, structureId);

  if (structure.repair?.state === 'intact') {
    throw new Error('القطعة دي سليمة أصلًا، مفيش داعي لإصلاحها');
  }
  if (structure.repair?.completes_at) {
    throw new Error('في إصلاح شغال بالفعل لهذه القطعة');
  }

  const seconds = Math.max(30, Math.round(structureUpgradeSeconds(structure.type, structure.level) / 2));
  const now = new Date();
  structure.repair.started_at = now;
  structure.repair.completes_at = new Date(now.getTime() + seconds * 1000);

  await defense.save();
  return structure;
}

// ====== وضع حالة ضرر يدوية على قطعة - أساس مؤقت لحد ما محرك القتال
// الحقيقي (Building Interaction) يبقى هو اللي بينقص الـ hp من واقع
// المعارك الفعلية. مش جزء من محاكاة قتال، مجرد تعديل حالة إداري. ======
async function reportDamage(userId, structureId, hpLost) {
  const { defense } = await getOrCreateDefense(userId);
  const structure = findStructure(defense, structureId);

  const loss = Number(hpLost);
  if (!Number.isFinite(loss) || loss <= 0) {
    throw new Error('قيمة الضرر غير صحيحة');
  }

  structure.hp = Math.max(0, structure.hp - loss);
  if (structure.hp === 0) {
    structure.repair.state = 'destroyed';
    if (structure.type === 'gate') structure.gate_state.destroyed = true;
  } else if (structure.hp < structure.max_hp) {
    structure.repair.state = 'damaged';
  }

  await defense.save();
  return structure;
}

// ====== فتح/قفل بوابة - بس للقطع اللي type === 'gate' ومش متدمرة. ======
async function setGateOpenState(userId, structureId, open) {
  const { defense } = await getOrCreateDefense(userId);
  const structure = findStructure(defense, structureId);

  if (structure.type !== 'gate') {
    throw new Error('القطعة دي مش بوابة');
  }
  if (structure.gate_state.destroyed) {
    throw new Error('البوابة دي متدمرة، مينفعش تتفتح أو تتقفل');
  }

  structure.gate_state.open = Boolean(open);
  await defense.save();
  return structure;
}

// ====== حذف قطعة دفاعية - مسموح بس لو مش شغال عليها ترقية حاليًا (نفس
// منطق حماية بسيط، مش حماية اقتصادية حقيقية زي المباني العادية). ======
async function removeStructure(userId, structureId) {
  const { defense } = await getOrCreateDefense(userId);
  const structure = findStructure(defense, structureId);

  if (structure.upgrade?.in_progress) {
    throw new Error('متقدرش تشيل قطعة شغالة عليها ترقية حاليًا');
  }

  structure.deleteOne();
  await defense.save();
  return { removed: true };
}

// ====== نقل قطعة دفاعية موجودة بالفعل لخانة فاضية تانية على نفس شبكة
// المدينة - نفس فلسفة moveBuilding بتاع castle.service بالظبط (نقل مجاني
// وفوري، مفيش تكلفة ولا مدة انتظار)، بس مينفعش وهي لسه "قيد الإنشاء"
// (build.state !== 'complete') أو شغال عليها ترقية حاليًا، عشان منضمنش
// حالة نص-بناء في مكان جديد. ======
async function moveStructure(userId, structureId, position) {
  const { x, y } = assertValidPosition(position);
  const { castle, defense } = await getOrCreateDefense(userId);
  const structure = findStructure(defense, structureId);

  if (structure.build?.state && structure.build.state !== 'complete') {
    throw new Error('لسه القطعة دي قيد الإنشاء - استنى لحد ما البناء يخلص الأول');
  }
  if (structure.upgrade?.in_progress) {
    throw new Error('متقدرش تنقل قطعة شغال عليها ترقية حاليًا');
  }
  if (!castleService.isTileUnlocked(castle, x, y)) {
    throw new Error('الخانة دي لسه مش مفتوحة في مدينتك - افتحها الأول أو اختار مكان تاني');
  }
  if (structure.position.x === x && structure.position.y === y) {
    throw new Error('القطعة موجودة في المكان ده بالفعل');
  }
  if (isPositionTaken(defense, x, y, structureId)) {
    throw new Error('المكان ده متشغول بقطعة دفاعية تانية بالفعل');
  }

  structure.position = { x, y };
  await defense.save();
  return structure;
}

// ====== التخطيط الدفاعي (Defensive Layout) - بيرجّع مواقع كل فئة (أبراج/
// بوابات/فخاخ/مباني دفاعية) كل واحدة لوحدها، محسوبة من structures[] (مصدر
// الحقيقة الوحيد) - مفيش تخزين مكرر لنفس المواقع في مكان تاني. "مباني
// دفاعية" هنا معناها المتاريس (barricade) بالإضافة لأي فئة مش سور/برج/
// بوابة/فخ صراحة، عشان التصنيف يفضل مرن لو اتضافت فئات جديدة لاحقًا. ======
function getDefensiveLayout(defense) {
  const layout = { towers: [], gates: [], traps: [], defensive_buildings: [] };
  for (const s of defense.structures) {
    const entry = { id: s._id.toString(), type: s.type, position: { x: s.position.x, y: s.position.y } };
    if (s.category === STRUCTURE_CATEGORY.TOWER) layout.towers.push(entry);
    else if (s.category === STRUCTURE_CATEGORY.GATE) layout.gates.push(entry);
    else if (s.category === STRUCTURE_CATEGORY.TRAP) layout.traps.push(entry);
    else if (s.category === STRUCTURE_CATEGORY.BARRICADE) layout.defensive_buildings.push(entry);
    // ====== أسوار (category === 'wall') مش جزء من الـ layout ده - وجودها
    // الهندسي منفصل تمامًا في wall_layout.segments (شوف الوحدة الجاية). ======
  }
  return layout;
}

// ====== محرر الأسوار (Wall Editor) - تخزين شكل خط الأسوار بس (إضافة/شيل
// قطعة segment)، من غير أي واجهة مستخدم (مطلوب صراحة نأجّلها). segments
// مخزّنة مستقلة تمامًا عن structures[] (حتى لو فعليًا كل segment هيتقابله
// قطعة سور مبنية فعلية لاحقًا) عشان اللاعب يقدر "يخطط" شكل سوره الكامل قبل
// ما يبني كل قطعة فيه واحدة واحدة. ======
async function setWallLayout(userId, { grid_size: gridSize, segments }) {
  if (!Array.isArray(segments)) {
    throw new Error('شكل تخطيط الأسوار غير صحيح');
  }

  const cleanSegments = segments.map((seg) => {
    const from = assertValidPosition(seg?.from);
    const to = assertValidPosition(seg?.to);
    return { from, to };
  });

  const { defense } = await getOrCreateDefense(userId);
  defense.wall_layout = {
    grid_size: Number.isFinite(Number(gridSize)) ? Number(gridSize) : defense.wall_layout?.grid_size ?? null,
    segments: cleanSegments,
  };

  // ====== مفيش أي تحقق فعلي هنا لسه (حلقة مقفولة/تجاور بوابة صحيح) - دي
  // "future validation" مذكورة صراحة كمطلوب مستقبلي بس. القيمة المرجّعة
  // بتوضّح إن التحقق مش نافذ حاليًا عشان الفرونت إند ميفترضش إن أي رفض
  // (validation error) هيحصل من الباك إند دلوقتي. ======
  await defense.save();
  return { wall_layout: defense.wall_layout, validated: false };
}

async function addWallSegment(userId, segment) {
  const from = assertValidPosition(segment?.from);
  const to = assertValidPosition(segment?.to);
  const { defense } = await getOrCreateDefense(userId);
  defense.wall_layout.segments.push({ from, to });
  await defense.save();
  return defense.wall_layout;
}

async function removeWallSegment(userId, segmentId) {
  const { defense } = await getOrCreateDefense(userId);
  const segment = defense.wall_layout.segments.id(segmentId);
  if (!segment) throw new Error('قطعة السور دي مش موجودة في التخطيط');
  segment.deleteOne();
  await defense.save();
  return defense.wall_layout;
}

// ====== الحاميات (Garrisons) - تعيين جزء من جيش القلعة الواقف لموقع دفاعي
// بعينه. الجنود هنا "منقولين" فعليًا من castle.army لـ garrison.troops (مش
// نسخة) - نفس فلسفة الجيش الواحد اللي بيتحرك بين حالات مختلفة (واقف/ماشي/
// محجوز/متمركز في حامية) من غير ما يتضاعف من مكان لمكان. ======
async function assignGarrison(userId, { target_type: targetType, target_id: targetId, position, troops, commander }) {
  if (!GARRISON_TARGET_TYPES.includes(targetType)) {
    throw new Error('نوع هدف الحامية غير معروف');
  }
  if (!targetId) {
    throw new Error('لازم تحدد هدف الحامية');
  }
  if (!Array.isArray(troops) || troops.length === 0) {
    throw new Error('لازم تختار وحدات تحطها في الحامية');
  }

  const { castle, defense } = await getOrCreateDefense(userId);

  const requested = [];
  for (const item of troops) {
    const key = item?.key;
    const qty = Number(item?.quantity ?? item?.count);
    if (!TROOP_TYPES[key]) throw new Error('نوع وحدة غير معروف');
    if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty < 1) {
      throw new Error('عدد الوحدات غير صحيح');
    }
    requested.push({ key, count: qty });
  }

  const reserved = getReservedCounts(defense);
  for (const t of requested) {
    const stack = castle.army.find((a) => a.key === t.key);
    const alreadyReserved = reserved.get(t.key) || 0;
    const available = (stack?.count || 0) - alreadyReserved;
    if (available < t.count) {
      throw new Error('معندكش وحدات كفاية متاحة (غير محجوزة) من هذا النوع في قلعتك');
    }
  }

  for (const t of requested) {
    const stack = castle.army.find((a) => a.key === t.key);
    stack.count -= t.count;
  }
  castle.army = castle.army.filter((a) => a.count > 0);

  const status = requested.length > 0 ? 'active' : 'empty';
  defense.garrisons.push({
    target_type: targetType,
    target_id: String(targetId),
    position: position ? assertValidPosition(position) : { x: 0, y: 0 },
    troops: requested,
    commander: commander?.commander_key ? commander : null,
    status,
  });

  await castle.save();
  await defense.save();
  return defense.garrisons[defense.garrisons.length - 1];
}

// ====== سحب حامية بالكامل - الجنود بترجع لجيش القلعة الواقف تاني. ======
async function disbandGarrison(userId, garrisonId) {
  const { castle, defense } = await getOrCreateDefense(userId);
  const garrison = defense.garrisons.id(garrisonId);
  if (!garrison) throw new Error('الحامية دي مش موجودة');

  for (const t of garrison.troops) {
    const stack = castle.army.find((a) => a.key === t.key);
    if (stack) stack.count += t.count;
    else castle.army.push({ key: t.key, count: t.count });
  }

  garrison.deleteOne();
  await castle.save();
  await defense.save();
  return { disbanded: true };
}

// ====== إجمالي الجنود المحجوزين للدفاع حاليًا (كل الفئات مع بعض) - مستخدمة
// هنا لمنع تكرار حجز نفس الجنود في حامية، ومستخدمة برضه من march.service
// عشان تستثنيهم من الجيش المتاح لمسير هجوم (شوف تعليق reserveArmy تحت). ======
function getReservedCounts(defense) {
  const totals = new Map();
  for (const entry of defense.reserved_army) {
    for (const t of entry.troops) {
      totals.set(t.key, (totals.get(t.key) || 0) + t.count);
    }
  }
  return totals;
}

// ====== نفس الفكرة فوق، بس هيلبر عام بيتصدّر لموديولات تانية (march.service)
// - بيحمّل مستند الدفاع من castle_id مباشرة من غير ما يحتاج userId (march
// بيشتغل على origin castle اللي ممكن يكون مش نفس اليوزر الحالي في بعض
// المسارات المستقبلية، فالاعتماد على castle._id أضمن). بيرجّع Map فاضي لو
// مفيش مستند دفاع خالص للقلعة دي لسه (يعني مفيش جنود محجوزين). ======
async function getReservedCountsByCastleId(castleId) {
  const defense = await CastleDefense.findOne({ castle_id: castleId });
  if (!defense) return new Map();
  return getReservedCounts(defense);
}

// ====== تخصيص/تحديث فئة كاملة من الجيش الاحتياطي المخصص للدفاع - upsert
// بالفئة (مفيش أكتر من عنصر واحد لكل فئة). الجنود المحجوزين هنا بيتخصموا
// فعليًا من الجيش الواقف (castle.army) - "الجيش الاحتياطي" هو تصنيف/حجز
// لجزء من الجيش الواقف، مش جيش إضافي منفصل. ======
async function reserveArmy(userId, { category, troops }) {
  if (!RESERVED_ARMY_CATEGORIES.includes(category)) {
    throw new Error('فئة جيش احتياطي غير معروفة');
  }
  if (!Array.isArray(troops)) {
    throw new Error('شكل الوحدات غير صحيح');
  }

  const requested = [];
  for (const item of troops) {
    const key = item?.key;
    const qty = Number(item?.quantity ?? item?.count);
    if (!TROOP_TYPES[key]) throw new Error('نوع وحدة غير معروف');
    if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty < 0) {
      throw new Error('عدد الوحدات غير صحيح');
    }
    if (qty > 0) requested.push({ key, count: qty });
  }

  const { castle, defense } = await getOrCreateDefense(userId);

  // ====== لازم نرجّع أي حجز قديم لنفس الفئة للجيش الواقف الأول قبل ما
  // نحسب التوفر الجديد - عشان "تعديل" فئة موجودة (زيادة/نقصان) يشتغل صح
  // من غير ما يعتبر الكمية القديمة "متاحة" وفي نفس الوقت "محجوزة". ======
  const existingIndex = defense.reserved_army.findIndex((e) => e.category === category);
  if (existingIndex >= 0) {
    for (const t of defense.reserved_army[existingIndex].troops) {
      const stack = castle.army.find((a) => a.key === t.key);
      if (stack) stack.count += t.count;
      else castle.army.push({ key: t.key, count: t.count });
    }
    defense.reserved_army.splice(existingIndex, 1);
  }

  for (const t of requested) {
    const stack = castle.army.find((a) => a.key === t.key);
    if (!stack || stack.count < t.count) {
      throw new Error('معندكش وحدات كفاية جاهزة من هذا النوع عشان تحجزها للدفاع');
    }
  }
  for (const t of requested) {
    const stack = castle.army.find((a) => a.key === t.key);
    stack.count -= t.count;
  }
  castle.army = castle.army.filter((a) => a.count > 0);

  if (requested.length > 0) {
    defense.reserved_army.push({ category, troops: requested });
  }

  await castle.save();
  await defense.save();
  return defense.reserved_army;
}

async function listReservedArmy(userId) {
  const { defense } = await getOrCreateDefense(userId);
  return defense.reserved_army;
}

// ====== خطة الدفاع (Defense Plan) - تخزين إعدادات بس، مفيش تنفيذ آلي لسه
// (لا AI ولا محرك قواعد بيقرأها وقت معركة حقيقية - ده مذكور صراحة كمطلوب
// مستقبلي). كل استدعاء بيستبدل الخطة كاملة (استراتيجية + قواعد) بدل تعديل
// جزئي، أبسط لواجهة "محرر خطة دفاع" مستقبلية. ======
async function setDefensePlan(userId, { strategy, rules, notes }) {
  const cleanRules = Array.isArray(rules)
    ? rules.map((r) => {
        if (!DEFENSE_PLAN_RULE_TYPES.includes(r?.rule_type)) {
          throw new Error('نوع قاعدة خطة دفاع غير معروف');
        }
        return {
          rule_type: r.rule_type,
          target_id: r.target_id ? String(r.target_id) : null,
          priority: Number.isFinite(Number(r.priority)) ? Number(r.priority) : 0,
          notes: typeof r.notes === 'string' ? r.notes : null,
        };
      })
    : [];

  const { defense } = await getOrCreateDefense(userId);
  defense.defense_plan = {
    strategy: typeof strategy === 'string' ? strategy : defense.defense_plan?.strategy ?? null,
    rules: cleanRules,
    notes: typeof notes === 'string' ? notes : null,
  };

  await defense.save();
  return defense.defense_plan;
}

async function getDefensePlan(userId) {
  const { defense } = await getOrCreateDefense(userId);
  return defense.defense_plan;
}

// ====== مجموع القوة الدفاعية الفعلية بتاعة كل القطع الدفاعية الحقيقية
// (سور/بوابة/برج/فخ/متراس) الواقفة فعليًا في القلعة دي - نفس combat_stats.
// defense اللي أي قطعة بتحمله (defense.config.js base_defense_power، عبر
// structureCombatStatsPlaceholder) بعد ما بقى رقم حقيقي مش صفر. رقم flat
// بسيط (مجموع بس، من غير أي نسبة/تراكم) عشان يتجمع بنفس فلسفة
// armyStatTotal/stationedDefensePower المستخدمين في نفس مسار التقدير السريع
// (Scout Report وMarch Duration Estimate) - الحساب الكامل بالنسب
// (defense_bonus_percent + formation + hero...) موجود بالفعل ومنفصل في
// battleResolution/calculators/defensePowerCalculator.js وقت حسم المعركة
// الحقيقية، مش هنا.
//
// قطعة اتدمرت (repair.state === 'destroyed') أو بوابة مكسورة (gate_state.
// destroyed) مساهمتها بتتحسب صفر - نفس منطق "خط الدفاع مخروق من عندها"
// المستخدم في battle.snapshot.service.js::snapshotDefenseStructures. ======
function structuresDefensePower(structures = []) {
  return (structures || []).reduce((sum, s) => {
    if (!s) return sum;
    if (s.repair?.state === 'destroyed') return sum;
    if (s.category === 'gate' && s.gate_state?.destroyed) return sum;
    return sum + Number(s.combat_stats?.defense ?? 0);
  }, 0);
}

// ====== نفس فكرة structuresDefensePower فوق، بس بتاخد castleId مباشرة
// وبترجّع صفر بهدوء لو القلعة دي لسه معملتش أي مستند دفاع خالص - مناسبة
// للاستخدام في مسارات "قراءة بس" (Scout Report/Battle Duration Estimate)
// اللي مش المفروض تفشل أو تنشئ مستند دفاع فاضي جديد لمجرد قراءة تقدير. ======
async function getStructuresDefensePowerByCastleId(castleId) {
  try {
    const defense = await getDefenseByCastleId(castleId);
    return structuresDefensePower(defense ? defense.structures : []);
  } catch (err) {
    console.error('[Defense] failed to compute structures defense power:', err.message);
    return 0;
  }
}

module.exports = {
  getOrCreateDefense,
  getDefenseByCastleId,
  listStructureTypes,
  addStructure,
  upgradeStructure,
  speedupStructureUpgrade,
  startRepair,
  reportDamage,
  setGateOpenState,
  removeStructure,
  moveStructure,
  getDefensiveLayout,
  setWallLayout,
  addWallSegment,
  removeWallSegment,
  assignGarrison,
  disbandGarrison,
  reserveArmy,
  listReservedArmy,
  setDefensePlan,
  getDefensePlan,
  getReservedCounts,
  getReservedCountsByCastleId,
  structuresDefensePower,
  getStructuresDefensePowerByCastleId,
};