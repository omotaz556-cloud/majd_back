// ====== مولّد "سكان العالم" الإجرائي - نقط عشوائية متحكم فيها (jittered
// grid) بدل شبكة مصفوفة تمامًا، عشان الخريطة تحس طبيعية ومش متكررة الشكل
// (متطلب "Avoid perfect grid placement / controlled randomness"). كل
// منطقة (region) بتتقسم لخلايا فرعية صغيرة، وكل خلية فرعية بتاخد نقطة
// واحدة مرشحة بإزاحة عشوائية جواها - أي مرشح قريب جدًا من قلعة/كائن موجود
// (أو من مرشح تاني اتقبل في نفس الدفعة) بيترفض، فبنضمن "حد أدنى للمسافة"
// من غير ما نحتاج خوارزمية Poisson-disc كاملة.

const { WORLD_OBJECT_TYPES, pickWeightedType } = require('./worldObject.config');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ====== نقط مرشحة داخل منطقة واحدة - subCellsPerSide^2 خلية فرعية، كل
// وحدة بتاخد نقطة واحدة بإزاحة عشوائية (jitter) لغاية 45% من حجم الخلية
// (مش لحد الحافة عشان منمنعش تداخل مع المنطقة اللي جنبها). ======
function generateCandidatePoints(regionX, regionY, regionSizeSlots, slotSpacing, subCellsPerSide, rand) {
  const regionSizeUnits = regionSizeSlots * slotSpacing;
  const originX = regionX * regionSizeUnits;
  const originY = regionY * regionSizeUnits;
  const cellSize = regionSizeUnits / subCellsPerSide;

  const points = [];
  for (let cx = 0; cx < subCellsPerSide; cx += 1) {
    for (let cy = 0; cy < subCellsPerSide; cy += 1) {
      const jitterX = (rand() * 2 - 1) * cellSize * 0.45;
      const jitterY = (rand() * 2 - 1) * cellSize * 0.45;
      const x = Math.round(originX + cx * cellSize + cellSize / 2 + jitterX);
      const y = Math.round(originY + cy * cellSize + cellSize / 2 + jitterY);
      points.push({ x, y });
    }
  }
  return points;
}

// ====== يفلتر المرشحين بحيث يفضل بينهم وبين أي نقطة موجودة فعلًا (قلاع أو
// كائنات عالم اتحطت قبل كده) مسافة >= minDistanceUnits - المرشحين المقبولين
// بيتضافوا هما نفسهم لقائمة "الموجود" تباعًا، فمفيش اتنين مرشحين يتقبلوا
// قريبين من بعض في نفس الدفعة. ======
function filterByMinDistance(candidates, existingPoints, minDistanceUnits) {
  const accepted = [];
  const occupied = [...existingPoints];
  for (const candidate of candidates) {
    const tooClose = occupied.some((p) => distance(candidate, p) < minDistanceUnits);
    if (tooClose) continue;
    accepted.push(candidate);
    occupied.push(candidate);
  }
  return accepted;
}

// ====== يبني مستند WorldObject جاهز للحفظ (لسه من غير region_x/region_y -
// دول بيتضافوا في worldMap.service وقت الاستدعاء لأنه هو اللي عارف رقم
// المنطقة الحالية). ======
function buildWorldObjectDoc(point, rand) {
  const typeKey = pickWeightedType(rand);
  const cfg = WORLD_OBJECT_TYPES[typeKey];

  const level = cfg.level_range
    ? cfg.level_range[0] + Math.floor(rand() * (cfg.level_range[1] - cfg.level_range[0] + 1))
    : null;

  const doc = {
    type: typeKey,
    subtype: cfg.subtypes ? cfg.subtypes[Math.floor(rand() * cfg.subtypes.length)] : null,
    level: level || 1,
    map_slot: point,
    respawns: cfg.respawns,
    garrison: [],
    loot: { gold: 0, wood: 0, stone: 0 },
  };

  if (cfg.has_garrison) {
    const budget = Math.round(10 + (level || 1) * 6);
    doc.garrison = [{ key: 'swordsman', count: Math.round(budget * 0.5) }, { key: 'archer', count: Math.round(budget * 0.5) }];
  }
  if (cfg.category === 'gatherable' || cfg.category === 'hostile') {
    const richness = 50 + (level || 1) * 25;
    doc.loot = {
      gold: Math.round(richness * (0.6 + rand() * 0.6)),
      wood: Math.round(richness * (0.6 + rand() * 0.6)),
      stone: Math.round(richness * (0.6 + rand() * 0.6)),
    };
  }

  return doc;
}

module.exports = {
  mulberry32,
  distance,
  generateCandidatePoints,
  filterByMinDistance,
  buildWorldObjectDoc,
};
