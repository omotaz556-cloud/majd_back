const Castle = require('../castle/castle.model');
const User = require('../users/user.model');
const Alliance = require('../alliances/alliance.model');
const { computeCastlePower } = require('../castle/castle.config');

// ====== تصنيف VIP - ترتيب واحد بس لكل اللاعبين الحقيقيين حسب "القوة
// الكلية" (Total Power = قوة القلعة + قوة الجيش)، محسوبة بنفس الدالة
// المستخدمة أصلاً في بحث العالم (computeCastlePower - castle.config.js)
// عشان الرقم يكون موحّد في كل اللعبة. مفيش أي تخزين منفصل لأي "Castle
// Power" أو "Army Power" هنا - الدالة نفسها بترجع المجموع مباشرة. ======

const TOP_LIMIT = 100;
const MAX_SEARCH_RESULTS = 30;

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ====== خريطة user_id (نص) -> اسم التحالف - نفس فكرة buildAllianceInfoMap
// في worldSearch.service.js، بس هنا محتاجين الاسم بس (مفيش تاب مطلوب في
// تصنيف الـ VIP حسب الطلب). ======
async function buildAllianceNameMap(userIds) {
  const map = new Map();
  if (userIds.length === 0) return map;
  const alliances = await Alliance.find({ 'members.user_id': { $in: userIds } }).select('name members.user_id');
  for (const alliance of alliances) {
    for (const member of alliance.members) {
      map.set(member.user_id.toString(), alliance.name);
    }
  }
  return map;
}

// ====== بيحسب ترتيب كل اللاعبين الحقيقيين (مش NPC) تنازليًا حسب القوة
// الكلية - مرة واحدة في الذاكرة عشان نقدر نحدد مركز أي لاعب بدقة كاملة حتى
// لو خارج أفضل 100 (زي ما مطلوب). عدد اللاعبين في لعبة زي دي محدود فمفيش
// داعي لـ aggregation pipeline معقدة - نفس فلسفة worldSearch.service.js. ======
async function computeRankedPlayers() {
  const castles = await Castle.find({ is_npc: false, user_id: { $ne: null } }).select('user_id buildings army');

  const ranked = castles.map((c) => ({
    user_id: c.user_id,
    user_id_str: c.user_id.toString(),
    power: computeCastlePower(c),
  }));

  ranked.sort((a, b) => b.power - a.power);
  ranked.forEach((row, i) => {
    row.rank = i + 1;
  });

  return ranked;
}

// ====== بيحوّل صفوف {user_id, power, rank} لشكل جاهز للعرض (اسم اللاعب +
// اسم التحالف) - بيستقبل أي مجموعة صفوف (أفضل 100، أو نتايج بحث، أو صف
// اللاعب الحالي لوحده لو خارج أفضل 100). ======
async function formatRows(rows) {
  if (rows.length === 0) return [];

  const userIds = rows.map((r) => r.user_id);
  const [users, allianceMap] = await Promise.all([
    User.find({ _id: { $in: userIds } }).select('name'),
    buildAllianceNameMap(userIds),
  ]);
  const userMap = new Map(users.map((u) => [u._id.toString(), u.name]));

  return rows.map((r) => ({
    rank: r.rank,
    player_id: r.user_id_str,
    player_name: userMap.get(r.user_id_str) || 'لاعب محذوف',
    alliance_name: allianceMap.get(r.user_id_str) || null,
    total_power: r.power,
  }));
}

// ====== تصنيف VIP الكامل - أفضل 100 لاعب + مركز اللاعب الحالي حتى لو مش
// ظاهر ضمنهم (me.rank بيفضل موجود دايمًا لو اللاعب عنده قلعة حقيقية، حتى لو
// me نفسه مش موجود جوه leaderboard array). ======
async function getVipRanking(currentUserId) {
  const ranked = await computeRankedPlayers();
  const currentIdStr = currentUserId.toString();

  const top = ranked.slice(0, TOP_LIMIT);
  const meRow = ranked.find((r) => r.user_id_str === currentIdStr);

  const rowsToFormat = meRow && meRow.rank > TOP_LIMIT ? [...top, meRow] : top;
  const formatted = await formatRows(rowsToFormat);

  const leaderboard = formatted.filter((f) => f.rank <= TOP_LIMIT);
  const me = meRow ? formatted.find((f) => f.rank === meRow.rank) : null;

  return {
    leaderboard,
    total_players: ranked.length,
    me,
  };
}

// ====== بحث بالاسم داخل تصنيف الـ VIP كامل (مش مقصور على أفضل 100) -
// بيرجّع مركز حقيقي (rank) لأي لاعب اتطابق اسمه، حتى لو خارج أفضل 100. ======
async function searchVipRanking(rawQuery) {
  const query = (rawQuery || '').trim();
  if (!query) return { results: [] };

  const ranked = await computeRankedPlayers();
  if (ranked.length === 0) return { results: [] };

  const userIds = ranked.map((r) => r.user_id);
  const matchedUsers = await User.find({
    _id: { $in: userIds },
    name: { $regex: escapeRegex(query), $options: 'i' },
  }).select('_id');
  const matchedIds = new Set(matchedUsers.map((u) => u._id.toString()));

  const matchedRows = ranked.filter((r) => matchedIds.has(r.user_id_str)).slice(0, MAX_SEARCH_RESULTS);
  const results = await formatRows(matchedRows);

  return { results };
}

module.exports = { getVipRanking, searchVipRanking, TOP_LIMIT };
