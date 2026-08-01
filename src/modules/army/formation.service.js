const Formation = require('./formation.model');
const castleService = require('../castle/castle.service');
const { nextSequence } = require('../common/counter.service');
const { TROOP_TYPES } = require('../castle/castle.config');
const {
  FORMATION_TYPES,
  MARCH_TYPES,
  FORMATION_ID_PREFIX,
  FORMATION_ID_COUNTER_NAME,
  FORMATION_ID_OFFSET,
  MAX_FORMATIONS_PER_PLAYER,
  isValidFormationType,
  isValidMarchType,
} = require('./army.config');

// ====== توليد formation_id فريد وقابل للعرض (زي BTL-100001 في battle.config) ======
async function generateFormationId() {
  const seq = await nextSequence(FORMATION_ID_COUNTER_NAME, FORMATION_ID_OFFSET);
  return `${FORMATION_ID_PREFIX}-${seq}`;
}

// ====== بيتأكد إن كل عنصر في troops بيشاور على مفتاح وحدة حقيقي موجود في
// castle.config TROOP_TYPES، وإن العدد رقم صحيح >= 0. مفيش أي فحص إن
// اللاعب فعليًا عنده العدد ده في جيشه - ده مقصود: التشكيلة هنا "خطة/قالب"
// (Formation Template) منفصلة عن الجيش الفعلي المتاح في castle.army، مش
// حجز فعلي للجنود (زي ما reserved_army في defense.model بيعمل). الربط
// الفعلي بين التشكيلة والجيش المتاح هيحصل وقت إرسال مسير هجوم حقيقي في
// خطوة لاحقة. ======
function assertValidTroops(troops) {
  if (troops === undefined) return [];
  if (!Array.isArray(troops)) {
    throw new Error('تشكيلة الوحدات (troops) لازم تكون مصفوفة');
  }
  const seenKeys = new Set();
  for (const stack of troops) {
    if (!stack || typeof stack.key !== 'string' || !TROOP_TYPES[stack.key]) {
      throw new Error(`نوع وحدة غير معروف: ${stack && stack.key}`);
    }
    if (seenKeys.has(stack.key)) {
      throw new Error(`نوع الوحدة (${stack.key}) مكرر في نفس التشكيلة`);
    }
    seenKeys.add(stack.key);
    const count = Number(stack.count);
    if (!Number.isFinite(count) || count < 0) {
      throw new Error(`عدد غير صالح للوحدة ${stack.key}`);
    }
  }
  return troops.map((stack) => ({ key: stack.key, count: Number(stack.count) }));
}

function assertValidCommanderAssignment(assignment) {
  if (assignment === undefined || assignment === null) return null;
  return {
    commander_key: assignment.commander_key ?? null,
    name: assignment.name ?? null,
    level: Number.isFinite(Number(assignment.level)) ? Number(assignment.level) : 1,
    skills: Array.isArray(assignment.skills) ? assignment.skills : [],
  };
}

function assertValidCommanders(commanders) {
  if (commanders === undefined) return undefined;
  const primary = assertValidCommanderAssignment(commanders.primary);
  const secondary = assertValidCommanderAssignment(commanders.secondary);
  if (
    primary &&
    secondary &&
    primary.commander_key !== null &&
    secondary.commander_key !== null &&
    primary.commander_key === secondary.commander_key
  ) {
    throw new Error('مينفعش نفس القائد يتعيّن أساسي وثانوي في نفس التشكيلة');
  }
  return { primary, secondary };
}

// ====== جيب كل تشكيلات اللاعب الحالي (على قلعته) ======
async function listFormations(userId) {
  const castle = await castleService.getOrCreateCastle(userId);
  const formations = await Formation.find({ user_id: userId, castle_id: castle._id }).sort({ created_at: 1 });
  return formations;
}

async function getFormationById(userId, formationId) {
  const formation = await Formation.findOne({ _id: formationId, user_id: userId });
  if (!formation) {
    throw new Error('التشكيلة دي مش موجودة');
  }
  return formation;
}

// ====== إنشاء تشكيلة جديدة - name مطلوب، الباقي كله اختياري وبيتحط له
// قيمة افتراضية منطقية. ======
async function createFormation(userId, payload = {}) {
  const castle = await castleService.getOrCreateCastle(userId);

  const existingCount = await Formation.countDocuments({ user_id: userId, castle_id: castle._id });
  if (existingCount >= MAX_FORMATIONS_PER_PLAYER) {
    throw new Error(`تعذيت الحد الأقصى لعدد التشكيلات (${MAX_FORMATIONS_PER_PLAYER})`);
  }

  const name = (payload.name || '').trim();
  if (!name) {
    throw new Error('اسم التشكيلة مطلوب');
  }

  const formationType = payload.formation_type || FORMATION_TYPES.BALANCED;
  if (!isValidFormationType(formationType)) {
    throw new Error(`نوع تشكيلة غير معروف: ${formationType}`);
  }

  const marchType = payload.march_type || MARCH_TYPES.NORMAL;
  if (!isValidMarchType(marchType)) {
    throw new Error(`نوع مسير غير معروف: ${marchType}`);
  }

  const troops = assertValidTroops(payload.troops);
  const commanders = assertValidCommanders(payload.commanders) || { primary: null, secondary: null };

  const formation_id = await generateFormationId();

  const formation = await Formation.create({
    user_id: userId,
    castle_id: castle._id,
    formation_id,
    name,
    troops,
    commanders,
    march_type: marchType,
    movement_speed: payload.movement_speed ?? null,
    load_capacity: payload.load_capacity ?? null,
    formation_type: formationType,
    active_skills: Array.isArray(payload.active_skills) ? payload.active_skills : [],
    notes: payload.notes ?? null,
  });

  return formation;
}

// ====== تعديل تشكيلة موجودة - بيحدّث بس الحقول المبعوتة فعليًا. ======
async function updateFormation(userId, formationId, payload = {}) {
  const formation = await getFormationById(userId, formationId);

  if (payload.name !== undefined) {
    const name = String(payload.name).trim();
    if (!name) throw new Error('اسم التشكيلة مطلوب');
    formation.name = name;
  }

  if (payload.formation_type !== undefined) {
    if (!isValidFormationType(payload.formation_type)) {
      throw new Error(`نوع تشكيلة غير معروف: ${payload.formation_type}`);
    }
    formation.formation_type = payload.formation_type;
  }

  if (payload.march_type !== undefined) {
    if (!isValidMarchType(payload.march_type)) {
      throw new Error(`نوع مسير غير معروف: ${payload.march_type}`);
    }
    formation.march_type = payload.march_type;
  }

  if (payload.troops !== undefined) {
    formation.troops = assertValidTroops(payload.troops);
  }

  if (payload.commanders !== undefined) {
    formation.commanders = assertValidCommanders(payload.commanders);
  }

  if (payload.movement_speed !== undefined) {
    formation.movement_speed = payload.movement_speed;
  }

  if (payload.load_capacity !== undefined) {
    formation.load_capacity = payload.load_capacity;
  }

  if (payload.active_skills !== undefined) {
    if (!Array.isArray(payload.active_skills)) {
      throw new Error('active_skills لازم تكون مصفوفة');
    }
    formation.active_skills = payload.active_skills;
  }

  if (payload.notes !== undefined) {
    formation.notes = payload.notes;
  }

  await formation.save();
  return formation;
}

async function deleteFormation(userId, formationId) {
  const formation = await getFormationById(userId, formationId);

  // ====== لو التشكيلة دي متعيّنة جوه أي مرحلة في أي خطة معركة، منمنعش
  // الحذف دلوقتي (مفيش cascade/تنظيف مراحل تلقائي في الأساس ده) - بس
  // بنسيبها مسؤولية battlePlanner.service.validatePlan إنها تكتشف المرجع
  // البايظ ده لو حصل، بدل ما نمنع حذف تشكيلات بشكل صارم هنا. ======
  await Formation.deleteOne({ _id: formation._id });
  return { deleted: true, formation_id: formation.formation_id };
}

// ====== اختيار تشكيلة كـ"التشكيلة النشطة" حاليًا - بيلغي تحديد أي تشكيلة
// تانية كانت مختارة قبل كده (حصرية: تشكيلة واحدة مختارة بس في نفس الوقت). ======
async function selectFormation(userId, formationId) {
  const formation = await getFormationById(userId, formationId);

  await Formation.updateMany(
    { user_id: userId, castle_id: formation.castle_id, _id: { $ne: formation._id } },
    { $set: { is_selected: false } }
  );

  formation.is_selected = true;
  await formation.save();
  return formation;
}

async function unselectFormation(userId, formationId) {
  const formation = await getFormationById(userId, formationId);
  formation.is_selected = false;
  await formation.save();
  return formation;
}

// ====== تعيين قادة التشكيلة بس (بدون لمس باقي حقولها) - endpoint مخصص
// عشان واجهة "تعيين قائد" تقدر تنادي على حاجة أخف من update كامل. ======
async function assignCommanders(userId, formationId, { primary, secondary } = {}) {
  const formation = await getFormationById(userId, formationId);
  formation.commanders = assertValidCommanders({ primary, secondary }) || { primary: null, secondary: null };
  await formation.save();
  return formation;
}

module.exports = {
  listFormations,
  getFormationById,
  createFormation,
  updateFormation,
  deleteFormation,
  selectFormation,
  unselectFormation,
  assignCommanders,
};
