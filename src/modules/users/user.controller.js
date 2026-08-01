const Castle = require('../castle/castle.model');
const worldMapService = require('../castle/worldMap.service');
const allianceService = require('../alliances/alliance.service');
const User = require('./user.model');
const { hashPassword, comparePassword } = require('../auth/auth.service');

const MAX_SEARCH_RESULTS = 15;

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ====== بحث خفيف عن لاعبين بالاسم (جزئي) أو رقم اللاعب (تطابق تام) - مستخدم
// أساسًا من الشات الخاص عشان اللاعب يختار مين يبعتله رسالة. ======
async function searchUsers(req, res) {
  try {
    const { q } = req.query;
    const query = (q || '').trim();
    if (!query) return res.json([]);

    const isNumeric = /^\d+$/.test(query);
    let users;
    if (isNumeric) {
      users = await User.find({ player_id: Number(query), is_active: true }).select('name player_id').limit(1);
    } else {
      users = await User.find({ name: { $regex: escapeRegex(query), $options: 'i' }, is_active: true })
        .select('name player_id')
        .limit(MAX_SEARCH_RESULTS);
    }

    const results = users
      .filter((u) => u._id.toString() !== req.user._id.toString())
      .map((u) => ({ id: u._id, name: u.name, player_id: u.player_id ?? null }));

    return res.json(results);
  } catch (err) {
    console.error('[Users] searchUsers error:', err.message);
    return res.status(500).json({ error: 'تعذر البحث عن اللاعبين الآن' });
  }
}

// ====== ملف تعريف عام للاعب (Public Player Profile) - بيتعرض وقت زيارة
// قلعة لاعب حقيقي تاني (View Player Profile). بيانات محدودة ومقصودة (اسم/
// تحالف/مستوى المبنى الرئيسي/عدد المباني/تاريخ الانضمام/المسافة عن قلعتك) -
// مفيش موارد ولا جيش هنا، ده بتاع viewCastle/scoutCastle مش الملف الشخصي. ======
async function getPublicProfile(req, res) {
  try {
    const { id } = req.params;
    const targetUser = await User.findById(id).select('name created_at');
    if (!targetUser) {
      return res.status(404).json({ error: 'اللاعب ده مش موجود' });
    }

    const [targetCastle, viewerCastle, alliance] = await Promise.all([
      Castle.findOne({ user_id: id }),
      Castle.findOne({ user_id: req.user._id }),
      allianceService.getMyAlliance(id),
    ]);

    const townHall = targetCastle?.buildings.find((b) => b.key === 'town_hall');

    let distanceSlots = null;
    if (targetCastle && viewerCastle) {
      const dx = targetCastle.map_slot.x - viewerCastle.map_slot.x;
      const dy = targetCastle.map_slot.y - viewerCastle.map_slot.y;
      distanceSlots = Math.round(Math.max(Math.abs(dx), Math.abs(dy)) / worldMapService.SLOT_SPACING);
    }

    return res.json({
      id: targetUser._id,
      name: targetUser.name,
      member_since: targetUser.created_at,
      alliance_name: alliance?.name || null,
      alliance_tag: alliance?.tag || null,
      town_hall_level: townHall?.level || 1,
      building_count: targetCastle?.buildings.length || 0,
      distance_slots: distanceSlots,
    });
  } catch (err) {
    console.error('[Users] getPublicProfile error:', err.message);
    return res.status(500).json({ error: 'تعذر تحميل ملف اللاعب' });
  }
}

// ====== تغيير كلمة المرور (Change Password) - متاحة بس لحسابات
// auth_provider='local' (حساب بإيميل/باسورد محلي). حسابات 'majd_platform'
// مفيش عندها باسورد محلي أصلاً - بيانات الدخول بتاعتها كلها عند المنصة
// نفسها، فمفيش حاجة تتغيّر هنا (راجع user.model.js وmajdPlatform.provider.js). ======
async function changePassword(req, res) {
  try {
    const { current_password, new_password } = req.body || {};

    if (req.user.auth_provider !== 'local') {
      return res.status(400).json({
        error: 'حسابك متصل بمنصة مجد مباشرة - غيّر كلمة المرور من هناك',
      });
    }

    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'لازم تدخل كلمة المرور الحالية والجديدة' });
    }

    if (new_password.length < 8) {
      return res.status(400).json({ error: 'كلمة المرور الجديدة لازم تكون 8 أحرف على الأقل' });
    }

    if (new_password === current_password) {
      return res.status(400).json({ error: 'كلمة المرور الجديدة لازم تكون مختلفة عن الحالية' });
    }

    // لازم select('+password_hash') لأن الموديل بيخفيه بشكل افتراضي
    const user = await User.findById(req.user._id).select('+password_hash');
    if (!user || !user.password_hash) {
      return res.status(400).json({ error: 'تعذر تغيير كلمة المرور لهذا الحساب' });
    }

    const isMatch = await comparePassword(current_password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'كلمة المرور الحالية غير صحيحة' });
    }

    user.password_hash = await hashPassword(new_password);
    await user.save();

    return res.json({ success: true });
  } catch (err) {
    console.error('[Users] changePassword error:', err.message);
    return res.status(500).json({ error: 'تعذر تغيير كلمة المرور الآن' });
  }
}

module.exports = { getPublicProfile, searchUsers, changePassword };