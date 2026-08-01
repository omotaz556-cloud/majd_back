const express = require('express');
const { protect } = require('../../middleware/auth.middleware');
const {
  getMyCastle,
  getHeroes,
  chooseHero,
  upgradeBuilding,
  speedupBuilding,
  buildNewBuilding,
  moveBuilding,
  listBuildingTypes,
  getNearbyCastles,
  getNearbyWorldObjects,
  trainTroops,
  trainPremiumTroops,
  cancelTrainingOrder,
  speedupTrainingOrder,
  listTroopTypes,
  viewCastle,
  scoutCastle,
  sendResources,
  searchWorld,
  gatherWorldObject,
} = require('./castle.controller');
const {
  sendMarch,
  listMarches,
  listNearbyMarches,
  recallMarch,
  listIncomingAttacks,
  listLiveBattles,
  getPublicBattleView,
} = require('./march.controller');

const router = express.Router();

router.get('/me', protect, getMyCastle);
// ====== اختيار الهيرو (Heroes) - راوتات حرفية (literal) زي /me بالظبط،
// لازم تتحط قبل أي راوت فيه :id لنفس سبب /nearby و/search تحت. ======
router.get('/heroes', protect, getHeroes);
router.post('/choose-hero', protect, chooseHero);
router.get('/nearby', protect, getNearbyCastles);
// ====== NEW (World Manager fix) - كائنات العالم القريبة (معسكرات بربر/أبراج
// حراسة/آثار/قرى ومدن وحصون محايدة/عقد موارد/ديكور...إلخ) - راوت حرفي
// (literal) زي /nearby بالظبط، لازم يتحط قبل /:id/view لنفس السبب. بيستخدم
// getNearbyWorldObjects اللي كان متضاف بالفعل في castle.controller/service
// من غير أي راوت يرجّعه للفرونت إند - الراوت ده هو المفقود بس. ======
router.get('/nearby-world-objects', protect, getNearbyWorldObjects);
// ====== FIX (Gather action for gatherable world objects) - راوت حرفي زي
// /nearby-world-objects بالظبط، لازم يتحط قبل /:id/view لنفس السبب. حصاد
// فوري لكائن عالم gatherable (resource_node) - مفيش جيش/مسير، نفس فلسفة
// /:id/scout (فعل فوري وانت واقف قدام الهدف). ======
router.post('/world-objects/:id/gather', protect, gatherWorldObject);
// ====== بحث العالم (World Search) - راوت حرفي (literal) زي /me و/nearby،
// لازم يتحط قبل /:id/view برضه عشان مفيش أي احتمال تصادم مستقبلي. ======
router.get('/search', protect, searchWorld);
router.get('/building-types', protect, listBuildingTypes);
router.post('/buildings/:key/upgrade', protect, upgradeBuilding);
// ====== تسريع فوري بالجواهر - لازم يتحط بعد /buildings/:key/upgrade مباشرة
// (نفس منطق راوتات التدريب تحت: upgrade أول حاجة بتشتغل، speedup إضافة
// اختيارية فوقها). ======
router.post('/buildings/:key/speedup', protect, speedupBuilding);
router.post('/buildings/:key/build', protect, buildNewBuilding);
router.post('/buildings/:id/move', protect, moveBuilding);
// ====== مفيش راوت شراء أرض هنا خالص - مساحة المدينة بتكبر تلقائيًا كل ما
// المبنى الرئيسي يترقّى (شوف expandCityToLevelCap في castle.service). ======

router.get('/troop-types', protect, listTroopTypes);
router.post('/army/train/:key', protect, trainTroops);
router.post('/army/train-premium/:key', protect, trainPremiumTroops);
router.post('/army/training/:id/cancel', protect, cancelTrainingOrder);
router.post('/army/training/:id/speedup', protect, speedupTrainingOrder);

router.get('/army/marches', protect, listMarches);
// ====== مسايرات ظاهرة على خريطة العالم (بتاعتك + بتاعة لاعبين تانيين جوه
// نطاق رؤيتك) - منفصلة عن /army/marches اللي بترجّع مسايراتك انت بس (مستخدمة
// في بانل "جيوشي"). لازم تتحط قبل أي راوت فيه :id عشان "nearby" ماتتفسرش
// كـ id غلط - هنا مفيش تعارض أصلًا لأن كل الراوتات التانية بتاعة marches إما
// POST أو فيها segment زيادة (/:id/recall). ======
router.get('/army/marches/nearby', protect, listNearbyMarches);
// ====== ميزة جديدة: تنبيه "أنت تحت هجوم" + عداد المعركة اللايف - راوتات
// حرفية (literal) زي /nearby فوق، لازم تتحط قبل أي راوت فيه :id لنفس السبب. ======
router.get('/army/marches/incoming-attacks', protect, listIncomingAttacks);
router.get('/army/marches/live', protect, listLiveBattles);
router.post('/army/march', protect, sendMarch);
router.post('/army/marches/:id/recall', protect, recallMarch);
// ====== *** إضافة: مشاهدة معركة معيّنة لايف بمعرفة march_id بس - متاحة لأي
// مستخدم مسجّل دخول (مش لازم يكون صاحب القلعة المهاجَمة ولا حليفه ولا حتى
// المهاجم نفسه)، عشان أي حد من برا يقدر يفتح صفحة "متابعة المعركة" ويشوف
// اللايف. راوت حرفي غير متداخل مع /:id/view (ده جوّه /castle/battles مش
// /castle مباشرة) فمفيش أي مشكلة ترتيب هنا. ======
router.get('/battles/:marchId/live', protect, getPublicBattleView);

// ====== "دخول مملكة" لاعب/معسكر تاني - بيرجّع القلعة الحقيقية كاملة
// (مش نسخة معاينة مصغّرة) عشان تتعرض بنفس مشهد القلعة (Castle Scene)
// المستخدم لقلعة اللاعب نفسه. لازم تتحط بعد أي راوت حرفي زي /me أو /nearby
// عشان مش تتصادم معاهم (لو حطيناها الأول هتاخد أي مسار من segment واحد على
// إنه "id"، بس هنا الشكل segment-ين (/:id/view) فمش هيحصل تصادم أصلًا). ======
router.get('/:id/view', protect, viewCastle);

// ====== أفعال إضافية من جوه "زيارة مملكة" لاعب/معسكر تاني - استكشاف فوري
// (مفيش جيش بيتحرك)، وإرسال موارد لحليف في نفس التحالف. نفس منطق ترتيب
// /:id/view: لازم تتحط بعد أي راوت حرفي عشان مفيش تصادم. ======
router.post('/:id/scout', protect, scoutCastle);
router.post('/:id/send-resources', protect, sendResources);

module.exports = router;
