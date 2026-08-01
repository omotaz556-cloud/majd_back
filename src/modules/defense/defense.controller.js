const defenseService = require('./defense.service');
const {
  getStructureConfig,
  structureMaxLevel,
  structureUpgradeCost,
  structureUpgradeSeconds,
} = require('./defense.config');
const { speedupGemCost } = require('../castle/castle.config');

// ====== بيحوّل قطعة دفاعية من مستند الموديل لشكل جاهز للعرض - مفيش أي
// حساب إضافي هنا (كل الأرقام محسوبة ومخزّنة بالفعل وقت الإضافة/الترقية). ======
function formatStructure(s) {
  const cfg = getStructureConfig(s.type);
  const maxLevel = structureMaxLevel(s.type);
  const isMaxLevel = maxLevel != null && s.level >= maxLevel;
  const upgradeInProgress = Boolean(s.upgrade?.in_progress);

  let nextUpgrade = null;
  if (cfg && !isMaxLevel && !upgradeInProgress && s.repair?.state !== 'destroyed') {
    const targetLevel = s.level + 1;
    nextUpgrade = {
      target_level: targetLevel,
      cost: structureUpgradeCost(s.type, targetLevel),
      duration_seconds: structureUpgradeSeconds(s.type, targetLevel),
    };
  }

  return {
    id: s._id,
    type: s.type,
    name: cfg?.name || s.type,
    description: cfg?.description || '',
    category: s.category,
    level: s.level,
    max_level: maxLevel,
    is_max_level: isMaxLevel,
    hp: s.hp,
    max_hp: s.max_hp,
    position: s.position,
    rotation: s.rotation,
    next_upgrade: nextUpgrade,
    upgrade: upgradeInProgress
      ? {
          target_level: s.upgrade.target_level,
          completes_at: s.upgrade.completes_at,
          // جاهزة هنا (بنفس speedupGemCost في castle.config) عشان الفرونت
          // إند يعرض زرار "سرّع فورًا بـ X جوهرة" من غير ما يحسب بنفسه
          speedup_gem_cost: speedupGemCost((s.upgrade.completes_at.getTime() - Date.now()) / 1000),
        }
      : null,
    repair: s.repair,
    build: s.build,
    combat_stats: s.combat_stats,
    gate_state: s.type === 'gate' ? s.gate_state : undefined,
  };
}

function formatGarrison(g) {
  return {
    id: g._id,
    target_type: g.target_type,
    target_id: g.target_id,
    position: g.position,
    troops: g.troops,
    commander: g.commander,
    status: g.status,
  };
}

async function getDefenseOverview(req, res) {
  try {
    const { defense } = await defenseService.getOrCreateDefense(req.user._id);
    return res.json({
      structures: defense.structures.map(formatStructure),
      wall_layout: defense.wall_layout,
      layout: defenseService.getDefensiveLayout(defense),
      garrisons: defense.garrisons.map(formatGarrison),
      reserved_army: defense.reserved_army,
      defense_plan: defense.defense_plan,
    });
  } catch (err) {
    console.error('[Defense] getDefenseOverview error:', err.message);
    return res.status(500).json({ error: 'تعذر تحميل نظام الدفاع' });
  }
}

// ====== عرض القطع الدفاعية الحقيقية بتاعة أي قلعة (Read-only) - نفس
// فلسفة castle.controller.viewCastle بالظبط: بيرجّع نفس شكل formatStructure
// المستخدم بالفعل لقلعتك انت، بس لقلعة أي حد تاني، عشان أي مشهد عرض (City
// Scene الحالي أو صفحة المعركة المستقلة /battle/:battleId) يقدر يرسمها
// بنفس المكوّن بالظبط. لو القلعة دي لسه معملتش أي مستند دفاع خالص (نظام
// بناء الدفاعات لسه مش مفعّل من ناحية اللاعب)، بيرجّع مصفوفة فاضية - وضع
// طبيعي جدًا دلوقتي (مفيش نظام بناء دفاعات حقيقي في اللعبة لسه)، مش خطأ. ======
async function viewDefense(req, res) {
  try {
    const { castleId } = req.params;
    const defense = await defenseService.getDefenseByCastleId(castleId);
    return res.json({
      structures: defense ? defense.structures.map(formatStructure) : [],
      // ====== NEW: قائد دفاعي (لو موجود - معسكرات NPC بس حاليًا، شوف
      // npcCastle.generator.generateNpcCommander) + وضعية الذكاء الاصطناعي
      // الوصفية (ai_posture) - إضافي بحت، مفيش أي تعديل على شكل structures
      // الموجود فوق. ======
      commander: defense?.commander || null,
      ai_posture: defense?.ai_posture || null,
    });
  } catch (err) {
    console.error('[Defense] viewDefense error:', err.message);
    return res.status(400).json({ error: err.message || 'تعذر تحميل دفاع القلعة دي' });
  }
}

function listStructureTypes(req, res) {
  return res.json({ structure_types: defenseService.listStructureTypes() });
}

async function addStructure(req, res) {
  try {
    const { type, position, rotation } = req.body;
    const structure = await defenseService.addStructure(req.user._id, { type, position, rotation });
    return res.status(201).json({ structure: formatStructure(structure) });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function upgradeStructure(req, res) {
  try {
    const structure = await defenseService.upgradeStructure(req.user._id, req.params.id);
    return res.json({ structure: formatStructure(structure) });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function speedupStructureUpgrade(req, res) {
  try {
    const structure = await defenseService.speedupStructureUpgrade(req.user._id, req.params.id);
    return res.json({ structure: formatStructure(structure) });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function repairStructure(req, res) {
  try {
    const structure = await defenseService.startRepair(req.user._id, req.params.id);
    return res.json({ structure: formatStructure(structure) });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function reportDamage(req, res) {
  try {
    const structure = await defenseService.reportDamage(req.user._id, req.params.id, req.body.hp_lost);
    return res.json({ structure: formatStructure(structure) });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function setGateState(req, res) {
  try {
    const structure = await defenseService.setGateOpenState(req.user._id, req.params.id, req.body.open);
    return res.json({ structure: formatStructure(structure) });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function removeStructure(req, res) {
  try {
    const result = await defenseService.removeStructure(req.user._id, req.params.id);
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function moveStructure(req, res) {
  try {
    const structure = await defenseService.moveStructure(req.user._id, req.params.id, req.body.position);
    return res.json({ structure: formatStructure(structure) });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function getLayout(req, res) {
  try {
    const { defense } = await defenseService.getOrCreateDefense(req.user._id);
    return res.json(defenseService.getDefensiveLayout(defense));
  } catch (err) {
    console.error('[Defense] getLayout error:', err.message);
    return res.status(500).json({ error: 'تعذر تحميل التخطيط الدفاعي' });
  }
}

async function getWallLayout(req, res) {
  try {
    const { defense } = await defenseService.getOrCreateDefense(req.user._id);
    return res.json({ wall_layout: defense.wall_layout });
  } catch (err) {
    console.error('[Defense] getWallLayout error:', err.message);
    return res.status(500).json({ error: 'تعذر تحميل تخطيط الأسوار' });
  }
}

async function setWallLayout(req, res) {
  try {
    const result = await defenseService.setWallLayout(req.user._id, req.body);
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function addWallSegment(req, res) {
  try {
    const wallLayout = await defenseService.addWallSegment(req.user._id, req.body);
    return res.status(201).json({ wall_layout: wallLayout });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function removeWallSegment(req, res) {
  try {
    const wallLayout = await defenseService.removeWallSegment(req.user._id, req.params.id);
    return res.json({ wall_layout: wallLayout });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function assignGarrison(req, res) {
  try {
    const garrison = await defenseService.assignGarrison(req.user._id, req.body);
    return res.status(201).json({ garrison: formatGarrison(garrison) });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function disbandGarrison(req, res) {
  try {
    const result = await defenseService.disbandGarrison(req.user._id, req.params.id);
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function listGarrisons(req, res) {
  try {
    const { defense } = await defenseService.getOrCreateDefense(req.user._id);
    return res.json({ garrisons: defense.garrisons.map(formatGarrison) });
  } catch (err) {
    console.error('[Defense] listGarrisons error:', err.message);
    return res.status(500).json({ error: 'تعذر تحميل الحاميات' });
  }
}

async function reserveArmy(req, res) {
  try {
    const reservedArmy = await defenseService.reserveArmy(req.user._id, req.body);
    return res.json({ reserved_army: reservedArmy });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function listReservedArmy(req, res) {
  try {
    const reservedArmy = await defenseService.listReservedArmy(req.user._id);
    return res.json({ reserved_army: reservedArmy });
  } catch (err) {
    console.error('[Defense] listReservedArmy error:', err.message);
    return res.status(500).json({ error: 'تعذر تحميل الجيش الاحتياطي' });
  }
}

async function getDefensePlan(req, res) {
  try {
    const plan = await defenseService.getDefensePlan(req.user._id);
    return res.json({ defense_plan: plan });
  } catch (err) {
    console.error('[Defense] getDefensePlan error:', err.message);
    return res.status(500).json({ error: 'تعذر تحميل خطة الدفاع' });
  }
}

async function setDefensePlan(req, res) {
  try {
    const plan = await defenseService.setDefensePlan(req.user._id, req.body);
    return res.json({ defense_plan: plan });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

module.exports = {
  getDefenseOverview,
  viewDefense,
  listStructureTypes,
  addStructure,
  upgradeStructure,
  speedupStructureUpgrade,
  repairStructure,
  reportDamage,
  setGateState,
  removeStructure,
  moveStructure,
  getLayout,
  getWallLayout,
  setWallLayout,
  addWallSegment,
  removeWallSegment,
  assignGarrison,
  disbandGarrison,
  listGarrisons,
  reserveArmy,
  listReservedArmy,
  getDefensePlan,
  setDefensePlan,
};