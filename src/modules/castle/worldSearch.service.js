const Castle = require('./castle.model');
const User = require('../users/user.model');
const Alliance = require('../alliances/alliance.model');
const worldMapService = require('./worldMap.service');
const { computeCastlePower } = require('./castle.config');

// أقصى عدد نتائج بيرجعها البحث في المرة الواحدة - عشان مش نرجّع آلاف
// النتايج لبحث عام زي "ا" مثلاً.
const MAX_RESULTS = 20;

// بيهرب أي حرف خاص في regex عشان البحث بالاسم يكون آمن (مايتفسرش كـ regex
// pattern لو اللاعب كتب حروف زي . أو * أو ( في نص البحث).
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ====== خريطة user_id -> {name, tag} تحالف - نفس فكرة buildAllianceMap في
// castle.service بالظبط، بس منسوخة هنا عشان worldSearch منفصل تمامًا عن أي
// "viewer" معيّن (بحث عالمي، مش من منظور لاعب واحد بيشوف حواليه بس). ======
async function buildAllianceInfoMap(userIds) {
  const map = new Map();
  if (userIds.length === 0) return map;

  const alliances = await Alliance.find({ 'members.user_id': { $in: userIds } }).select('name tag members.user_id');
  for (const alliance of alliances) {
    for (const member of alliance.members) {
      map.set(member.user_id.toString(), { name: alliance.name, tag: alliance.tag });
    }
  }
  return map;
}

// ====== بيحوّل قلعة + صاحبها لشكل نتيجة بحث جاهز للعرض - بيانات محدودة جدًا
// عمدًا (اسم/أرقام/تحالف/قوة/إحداثيات) مش تفاصيل القلعة الكاملة (مباني/جيش/
// موارد) - دي لسه محمية بضباب الحرب عادي لو اللاعب حاول "يدخل" القلعة فعليًا
// (viewCastle). الإحداثيات بترجع بشكلين: "coordinates" بوحدة الخانة (slot)
// المختصرة والمقروءة (زي ما هتتعرض وتتكتب في "اذهب للإحداثيات")، و"map_slot"
// الخام (نفس وحدة الباك إند الداخلية) عشان الفرونت إند يقدر يحرّك الكاميرا
// بدقة كاملة من غير ما يحتاج يعرف SLOT_SPACING بتاع الباك إند. ======
function formatSearchResult(castle, owner, allianceInfo) {
  const townHall = castle.buildings.find((b) => b.key === 'town_hall');
  return {
    castle_id: castle._id,
    player_id: owner.player_id ?? null,
    player_name: owner.name,
    kingdom_id: castle.kingdom_id ?? null,
    alliance_name: allianceInfo?.name || null,
    alliance_tag: allianceInfo?.tag || null,
    power: computeCastlePower(castle),
    town_hall_level: townHall?.level || 1,
    coordinates: {
      x: Math.round(castle.map_slot.x / worldMapService.SLOT_SPACING),
      y: Math.round(castle.map_slot.y / worldMapService.SLOT_SPACING),
    },
    map_slot: castle.map_slot,
  };
}

// ====== البحث الرئيسي في "العالم" - بيقبل اسم لاعب (بحث جزئي، مش حساس
// لحالة الحروف)، رقم لاعب (Player ID)، أو رقم مملكة (Kingdom ID) تطابق تام -
// أي نص المستخدم بيكتبه بيتفحص على الثلاثة مع بعض تلقائيًا (type='auto')
// إلا لو type اتحدد صراحة (مفيد لو الفرونت إند عايز يقصر البحث على نوع
// واحد بس). البحث ده مقصود إنه يتخطى ضباب الحرب تمامًا (عكس /castle/nearby)
// - زي أي نظام بحث عالمي حقيقي في ألعاب الاستراتيجية الكبيرة، لكن البيانات
// الراجعة محدودة (شوف formatSearchResult) مش تفاصيل كاملة. ======
async function searchWorld(rawQuery, type = 'auto') {
  const query = (rawQuery || '').trim();
  if (!query) return [];

  const isNumeric = /^\d+$/.test(query);
  const numericValue = isNumeric ? Number(query) : null;

  // castle._id (نص) -> مستند القلعة - Map عشان نفس القلعة ميتكررش في النتيجة
  // لو اتطابقت من أكتر من طريق بحث في نفس الوقت (مثلاً اسم اللاعب وكمان
  // رقمه لو كتب الاتنين بالصدفة في استدعاءات مختلفة).
  const matchedCastles = new Map();

  // ====== بحث بالاسم (جزئي) ======
  if (type === 'name' || (type === 'auto' && !isNumeric)) {
    const users = await User.find({ name: { $regex: escapeRegex(query), $options: 'i' } })
      .select('_id')
      .limit(MAX_RESULTS);
    if (users.length > 0) {
      const castles = await Castle.find({ user_id: { $in: users.map((u) => u._id) }, is_npc: false });
      for (const c of castles) matchedCastles.set(c._id.toString(), c);
    }
  }

  // ====== بحث برقم اللاعب (Player ID) - تطابق تام ======
  if (isNumeric && (type === 'auto' || type === 'player_id')) {
    const matchedUser = await User.findOne({ player_id: numericValue }).select('_id');
    if (matchedUser) {
      const c = await Castle.findOne({ user_id: matchedUser._id, is_npc: false });
      if (c) matchedCastles.set(c._id.toString(), c);
    }
  }

  // ====== بحث برقم المملكة (Kingdom ID) - تطابق تام ======
  if (isNumeric && (type === 'auto' || type === 'kingdom_id')) {
    const c = await Castle.findOne({ kingdom_id: numericValue, is_npc: false });
    if (c) matchedCastles.set(c._id.toString(), c);
  }

  const castles = [...matchedCastles.values()].slice(0, MAX_RESULTS);
  if (castles.length === 0) return [];

  const ownerIds = castles.map((c) => c.user_id).filter(Boolean);
  const [owners, allianceInfoMap] = await Promise.all([
    User.find({ _id: { $in: ownerIds } }).select('name player_id'),
    buildAllianceInfoMap(ownerIds),
  ]);
  const ownerMap = new Map(owners.map((u) => [u._id.toString(), u]));

  return castles
    .map((c) => {
      const owner = c.user_id ? ownerMap.get(c.user_id.toString()) : null;
      if (!owner) return null; // احتياطًا (سباق نادر: القلعة اتلاقت بس صاحبها اتشال في نفس اللحظة)
      return formatSearchResult(c, owner, allianceInfoMap.get(owner._id.toString()));
    })
    .filter(Boolean);
}

module.exports = { searchWorld, MAX_RESULTS };
