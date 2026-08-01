const Castle = require('./castle.model');
const CastleDefense = require('../defense/defense.model');
const WorldObject = require('../world/worldObject.model');
const WorldRegionState = require('../world/worldRegionState.model');
const { buildNpcCastleDoc, tierForRing, ringForMapSlot } = require('./npcCastle.generator');
const {
  mulberry32,
  generateCandidatePoints,
  filterByMinDistance,
  buildWorldObjectDoc,
} = require('../world/worldPopulation.generator');
const { VISION_RADIUS_SLOTS } = require('./castle.config');

// ====== توزيع القلاع على خريطة العالم المشتركة ======
// كل قلعة جديدة (لاعب أو NPC) بتاخد مكان تاني على خريطة لا نهائية نظريًا،
// عن طريق تحويل "ترتيب" القلعة (index) لإحداثيات x,y بخوارزمية اللف الحلزوني
// (square spiral) - نفس الفكرة المستخدمة في ألعاب القلاع عشان القلاع
// تتوزع بالتساوي حوالين المركز من غير تصادم وبدون الحاجة نخزن كل الشبكة.
//
// المسافة بين كل قلعة والتانية (SLOT_SPACING) بتحدد إحساس "الجيرة" على
// الخريطة - قيمة أعلى = مسافة أكبر بين القلاع.
const SLOT_SPACING = 40;

// ====== NEW (NPC World System rebuild) - حجم "المنطقة" (region) بعدد
// خانات الشبكة (SLOT_SPACING) على كل ضلع. العالم بقى مقسّم لمربعات
// REGION_SIZE_SLOTS x REGION_SIZE_SLOTS، كل مربع بيتحدد إذا كان "متعمّر"
// (seeded) قبل كده مرة واحدة بس (WorldRegionState) - ده اللي بيضمن:
//  - "Generation should happen once" - أي منطقة بعد أول مرة بترجع فورًا
//    باستعلام واحد بس (findOne) من غير ما تعيد أي حساب أو إدخال.
//  - "Ensure every region contains a balanced amount of NPCs" - كل منطقة
//    بتتعمّر بنفس القواعد (كثافة لاتيس + كثافة كائنات عالم) بغض النظر عن
//    ترتيب اكتشافها.
const REGION_SIZE_SLOTS = 8;
const REGION_SIZE_UNITS = REGION_SIZE_SLOTS * SLOT_SPACING;

// كام نقطة مرشحة لكائنات العالم (غير القلاع) لكل منطقة - جذر تربيعي يدي
// عدد خلايا فرعية (subCellsPerSide^2 نقطة مرشحة قبل فلترة المسافة الدنيا)
const WORLD_OBJECT_SUBCELLS_PER_SIDE = 6;

function spiralCoordinate(index) {
  if (index === 0) return { x: 0, y: 0 };

  let ring = 1;
  let ringStart = 1;
  while (ringStart + 8 * ring <= index) {
    ringStart += 8 * ring;
    ring += 1;
  }

  const offset = index - ringStart;
  const sideLength = 2 * ring;
  const side = Math.floor(offset / sideLength);
  const posInSide = offset % sideLength;

  let x;
  let y;

  switch (side) {
    case 0:
      x = ring - posInSide;
      y = ring;
      break;
    case 1:
      x = -ring;
      y = ring - posInSide;
      break;
    case 2:
      x = -ring + posInSide;
      y = -ring;
      break;
    default:
      x = ring;
      y = -ring + posInSide;
      break;
  }

  return { x: x * SLOT_SPACING, y: y * SLOT_SPACING };
}

// ====== الطريقة الوحيدة اللي أي قلعة NPC بتتحفظ بيها في قاعدة البيانات -
// نفس بالظبط الكود اللي كان بيحفظ القلاع اللي بتتولّد يدويًا عن طريق
// worldAdmin.service.js (spawnNpcType) - وهو المسار اللي أنتج "Desert
// Settlement" الشغال فعليًا على الخريطة. بدل ما يبقى فيه مسارين مختلفين
// (bulk insertMany هنا في التوليد الإجرائي، و Castle.create()/CastleDefense.
// create() منفصلين هناك في التوليد اليدوي)، دلوقتي القلاع كلها - سواء
// اتولّدت تلقائيًا وهي بتعمّر منطقة جديدة أو اتولّدت يدويًا من أدوات
// الأدمن - بتتحفظ بنفس الدالة دي بالظبط. كل قلعة بتتحفظ لوحدها (Castle.
// create ثم CastleDefense.create)، فأي خطأ حقيقي (تحقق فاشل، تصادم مفتاح
// مكرر...إلخ) بيبان واضح لقلعته هي بس، بدل ما يختفي جوه رد bulk insertMany
// جماعي زي ما كان بيحصل قبل كده. ======
async function saveCastleDoc(doc) {
  const defenseStructures = doc._defenseStructures || [];
  const commander = doc._commander;
  const aiPosture = doc._aiPosture;
  // eslint-disable-next-line no-param-reassign
  delete doc._defenseStructures;
  // eslint-disable-next-line no-param-reassign
  delete doc._commander;
  // eslint-disable-next-line no-param-reassign
  delete doc._aiPosture;

  const saved = await Castle.create(doc);
  await CastleDefense.create({
    castle_id: saved._id,
    structures: defenseStructures,
    commander,
    ai_posture: aiPosture,
  });
  return saved;
}

const PLAYER_RING_SPREAD = 9;

async function assignNextSlot() {
  const realPlayerCount = await Castle.countDocuments({ is_npc: { $ne: true } });
  let index = realPlayerCount * PLAYER_RING_SPREAD;

  for (let attempts = 0; attempts < 50; attempts += 1) {
    const candidate = spiralCoordinate(index);
    // eslint-disable-next-line no-await-in-loop
    const taken = await Castle.exists({ 'map_slot.x': candidate.x, 'map_slot.y': candidate.y });
    if (!taken) return candidate;
    index += 1;
  }

  throw new Error('تعذر إيجاد مكان فاضي على الخريطة، حاول تاني');
}

async function getNearbySlots(mapSlot, radiusInSlots = VISION_RADIUS_SLOTS) {
  const radius = radiusInSlots * SLOT_SPACING;
  return Castle.find({
    'map_slot.x': { $gte: mapSlot.x - radius, $lte: mapSlot.x + radius },
    'map_slot.y': { $gte: mapSlot.y - radius, $lte: mapSlot.y + radius },
  }).select('user_id map_slot is_npc npc_name npc_tier npc_skin npc_faction npc_skin_variant reward_multiplier buildings');
}

function latticeNeighbors(mapSlot, radiusInSlots) {
  const neighbors = [];
  for (let dx = -radiusInSlots; dx <= radiusInSlots; dx += 1) {
    for (let dy = -radiusInSlots; dy <= radiusInSlots; dy += 1) {
      if (dx === 0 && dy === 0) continue;
      neighbors.push({
        x: mapSlot.x + dx * SLOT_SPACING,
        y: mapSlot.y + dy * SLOT_SPACING,
      });
    }
  }
  return neighbors;
}

// ====== NEW: بيحوّل إحداثية عالم (map_slot) لرقم المنطقة (region) اللي هي
// واقعة جواها - Math.floor بيشتغل صح مع الإحداثيات السالبة كمان (مربعات
// متساوية على الجهتين من المركز). ======
function regionForMapSlot(mapSlot) {
  return {
    regionX: Math.floor(mapSlot.x / REGION_SIZE_UNITS),
    regionY: Math.floor(mapSlot.y / REGION_SIZE_UNITS),
  };
}

function regionBounds(regionX, regionY) {
  const minX = regionX * REGION_SIZE_UNITS;
  const minY = regionY * REGION_SIZE_UNITS;
  return { minX, minY, maxX: minX + REGION_SIZE_UNITS - SLOT_SPACING, maxY: minY + REGION_SIZE_UNITS - SLOT_SPACING };
}

// ====== NEW: القلب - بتعمّر منطقة واحدة (لاتيس قلاع NPC + كائنات عالم)
// أول مرة بس، وبترجع فورًا بعد كده (fill-only, idempotent, single query
// fast-path). أي قلعة لاعب حقيقي موجودة في المنطقة أصلًا بيتم تجاهلها
// تمامًا (مش بتتحرك ولا بتتلمس - "existing player castles must never be
// moved or modified"). ======
// ====== NEW (NPC Faction System rebuild) - نسبة تعمير خانات القلاع في كل
// منطقة اتزودت من 0.55 لـ 0.92 عشان "العالم يتملي بمعظمه بقلاع NPC حقيقية"
// (زي Rise of Kingdoms/Lords Mobile) بدل ما نص الخريطة تقريبًا تفضل فاضية.
// كائنات العالم (كائنات gatherable/exploration) لسه بتتولّد بمعدلها
// المنفصل زي ما هو (WORLD_OBJECT_SUBCELLS_PER_SIDE) - النظامين مستقلين عن
// بعض تمامًا. ======
async function ensureRegionPopulated(regionX, regionY, fillChance = 0.92) {
  const already = await WorldRegionState.findOne({ region_x: regionX, region_y: regionY });
  if (already) return { alreadySeeded: true, ...already.toObject() };

  const bounds = regionBounds(regionX, regionY);

  // استعلام واحد بس لكل نوع - كل القلاع وكل كائنات العالم الموجودة فعليًا
  // جوه حدود المنطقة دي (لاعبين حقيقيين أو NPC اتولّدوا قبل كده من منطقة
  // متجاورة بتتقاطع في الحافة، أو أي بقايا من نسخة أقدم من المولّد).
  const [existingCastles, existingObjects] = await Promise.all([
    Castle.find({
      'map_slot.x': { $gte: bounds.minX, $lte: bounds.maxX },
      'map_slot.y': { $gte: bounds.minY, $lte: bounds.maxY },
    }).select('map_slot is_npc'),
    WorldObject.find({
      'map_slot.x': { $gte: bounds.minX, $lte: bounds.maxX },
      'map_slot.y': { $gte: bounds.minY, $lte: bounds.maxY },
    }).select('map_slot'),
  ]);

  const takenCastleKeys = new Set(existingCastles.map((c) => `${c.map_slot.x},${c.map_slot.y}`));
  const castlePoints = existingCastles.map((c) => c.map_slot);
  const objectPoints = existingObjects.map((o) => o.map_slot);

  // ====== 1) قلاع NPC - على نفس شبكة اللاتيس (multiples of SLOT_SPACING)
  // زي أي قلعة لاعب، عشان تتوافق مع latticeNeighbors/getNearbySlots الحالية
  // من غير أي تعديل عليهم. rand مولّد من إحداثيات الخانة نفسها (deterministic)
  // عشان "regenerate missing" يرجع نفس النتيجة لو الخانة فضلت فاضية قبل كده. ======
  const toCreateCastles = [];
  for (let i = 0; i < REGION_SIZE_SLOTS; i += 1) {
    for (let j = 0; j < REGION_SIZE_SLOTS; j += 1) {
      const x = bounds.minX + i * SLOT_SPACING;
      const y = bounds.minY + j * SLOT_SPACING;
      const key = `${x},${y}`;
      if (takenCastleKeys.has(key)) continue;

      const cellSeed = Math.abs((x * 2654435761) ^ (y * 40503)) >>> 0;
      const cellRand = mulberry32(cellSeed || 1);
      if (cellRand() > fillChance) continue; // خانات فاضية عمدًا - "avoid empty regions" لكن مش كل خانة لازم تتملى

      const doc = buildNpcCastleDoc({ x, y }, SLOT_SPACING);
      toCreateCastles.push(doc);
      takenCastleKeys.add(key);
      castlePoints.push({ x, y });
    }
  }

  // ====== NEW: كل قلعة بتتحفظ بنداء saveCastleDoc منفصل (زي بالظبط قلعة
  // "Desert Settlement" اللي اتولّدت يدويًا وشغالة فعليًا على الخريطة) -
  // مفيش أي bulk insertMany تاني هنا. لو قلعة واحدة فشلت (مثلًا تصادم
  // نادر على map_slot مع قلعة لاعب اتحطت في نفس اللحظة)، بيتسجل خطأ واضح
  // ليها هي بس وباقي القلاع في نفس المنطقة بتكمل عادي - مفيش أي خطأ بيتبلع
  // بالكامل زي ما كان يحصل مع insertMany. ======
  let insertedCastleCount = 0;
  for (const doc of toCreateCastles) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await saveCastleDoc(doc);
      insertedCastleCount += 1;
    } catch (err) {
      console.error('[WorldMap] ensureRegionPopulated castle save error at', doc.map_slot, ':', err.message);
    }
  }

  // ====== 2) كائنات العالم - نقط "jittered" مش شبكة كاملة (عشان الخريطة
  // متبانش صناعية)، بمسافة دنيا عن أي قلعة/كائن موجود بالفعل (بما فيها
  // القلاع اللي اتضافت فوق للتو). ======
  const objectSeed = Math.abs((regionX * 374761393) ^ (regionY * 668265263)) >>> 0;
  const objectRand = mulberry32(objectSeed || 1);
  const candidates = generateCandidatePoints(regionX, regionY, REGION_SIZE_SLOTS, SLOT_SPACING, WORLD_OBJECT_SUBCELLS_PER_SIDE, objectRand);

  const decoratedCandidates = candidates.map((point) => ({ point, doc: buildWorldObjectDoc(point, objectRand) }));
  const decorative = decoratedCandidates.filter((c) => c.doc.type === 'decoration');
  const significant = decoratedCandidates.filter((c) => c.doc.type !== 'decoration');

  const acceptedSignificantPoints = filterByMinDistance(
    significant.map((c) => c.point),
    [...castlePoints, ...objectPoints],
    SLOT_SPACING * 0.5
  );
  const acceptedSignificantSet = new Set(acceptedSignificantPoints.map((p) => `${p.x},${p.y}`));

  const acceptedDecorativePoints = filterByMinDistance(
    decorative.map((c) => c.point),
    castlePoints, // الديكورات مسموح تتقارب من كائنات تانية، بس مش تتحط فوق قلعة
    SLOT_SPACING * 0.2
  );
  const acceptedDecorativeSet = new Set(acceptedDecorativePoints.map((p) => `${p.x},${p.y}`));

  const worldObjectDocs = decoratedCandidates
    .filter((c) => {
      const key = `${c.point.x},${c.point.y}`;
      return c.doc.type === 'decoration' ? acceptedDecorativeSet.has(key) : acceptedSignificantSet.has(key);
    })
    .map((c) => ({ ...c.doc, region_x: regionX, region_y: regionY }));

  let insertedObjectCount = 0;
  if (worldObjectDocs.length > 0) {
    try {
      const res = await WorldObject.insertMany(worldObjectDocs, { ordered: false });
      insertedObjectCount = res.length;
    } catch (err) {
      if (err.code !== 11000 && !err.writeErrors) {
        console.error('[WorldMap] ensureRegionPopulated world object insert error:', err.message);
      }
      insertedObjectCount = err.insertedDocs?.length ?? 0;
    }
  }

  try {
    await WorldRegionState.create({
      region_x: regionX,
      region_y: regionY,
      npc_castles_created: insertedCastleCount,
      world_objects_created: insertedObjectCount,
    });
  } catch (err) {
    // سباق نادر (طلبين بيعمّروا نفس المنطقة في نفس اللحظة) - المنطقة أصلًا
    // اتعمّرت من الطلب التاني، مفيش داعي نعتبره خطأ حقيقي
    if (err.code !== 11000) {
      console.error('[WorldMap] ensureRegionPopulated region-state error:', err.message);
    }
  }

  return { alreadySeeded: false, npc_castles_created: insertedCastleCount, world_objects_created: insertedObjectCount };
}

// ====== ensureNpcNeighbors - نفس التوقيع القديم بالظبط (مستخدمة فعليًا في
// castle.service.js من غير أي تعديل مطلوب هناك) - بس دلوقتي بتوجّه الشغل
// لـ ensureRegionPopulated بدل ما تعمل حساب/عشوائية مباشرة بنفسها. أي
// منطقة اتعمّرت قبل كده (من استكشاف لاعب تاني أو من سكريبت backfill)
// بترجع فورًا بلا أي تأثير - فالكسول (lazy) والفعلي (eager backfill)
// بيستخدموا نفس المسار بالظبط، ومفيش تكرار توليد أبدًا. ======
async function ensureNpcNeighbors(mapSlot, radiusInSlots = VISION_RADIUS_SLOTS, fillChance = 0.92) {
  const radiusUnits = radiusInSlots * SLOT_SPACING;
  const minRegion = regionForMapSlot({ x: mapSlot.x - radiusUnits, y: mapSlot.y - radiusUnits });
  const maxRegion = regionForMapSlot({ x: mapSlot.x + radiusUnits, y: mapSlot.y + radiusUnits });

  const jobs = [];
  for (let rx = minRegion.regionX; rx <= maxRegion.regionX; rx += 1) {
    for (let ry = minRegion.regionY; ry <= maxRegion.regionY; ry += 1) {
      jobs.push(ensureRegionPopulated(rx, ry, fillChance));
    }
  }
  await Promise.all(jobs);
}

module.exports = {
  spiralCoordinate,
  assignNextSlot,
  getNearbySlots,
  latticeNeighbors,
  ensureNpcNeighbors,
  ensureRegionPopulated,
  regionForMapSlot,
  saveCastleDoc,
  SLOT_SPACING,
  REGION_SIZE_SLOTS,
  REGION_SIZE_UNITS,
};
