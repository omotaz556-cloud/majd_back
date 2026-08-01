// ====== Phase 6: Battle Consequences - Configuration ======
// نفس فلسفة castle.config.js/defense.config.js/battleResolution.config.js:
// كل الأرقام الثابتة هنا بس، مفيش أي منطق حساب في الملف ده خالص.

'use strict';

// ====== "كفاءة" المبنى المتضرر - Buildings لسه مفيهاش نظام hp حقيقي في
// اللعبة (راجع castle.model.js/battle.snapshot.service.js - hp دايمًا null)،
// فمفيش "ضرر" حقيقي بيتطبق على مبنى بعينه دلوقتي. الرقم هنا Placeholder
// جاهز لليوم اللي نظام الـ Building HP يتبنى فعليًا (مفيش استخدام له في
// الكود دلوقتي - موجود بس عشان الشكل يكون واضح). ======
const DAMAGED_BUILDING_EFFICIENCY_PERCENT = 0.5; // 50% كفاءة وهو متضرر، لحد ما يتصلح

// ====== نسبة الـ hp المتبقية للسور/الأبراج اللي تحتها بيتحسب إن الدفاع
// "متضرر بشدة" (heavily damaged) - تحت النسبة دي، بونص دفاع المدينة (city
// defense bonus) بينزل. ======
const WALL_HEAVILY_DAMAGED_THRESHOLD_PERCENT = 0.3; // أقل من 30% من الـ max_hp

// ====== أقصى بونص دفاع ممكن يديه سور/أبراج المدينة سليمة 100% - نفس الفكرة
// اللي defensePowerCalculator.js بيستخدمها في battleResolution (wall_bonus/
// building_bonus) بس هنا للاستخدام العرضي بعد المعركة (تقرير الحالة الدفاعية
// الحالية) مش لحساب نتيجة معركة جديدة. ======
const MAX_CITY_DEFENSE_BONUS_PERCENT = 0.25; // 25% لو كل القطع سليمة 100%

// ====== النسبة اللي بونص الدفاع بينزلها لكل قطعة "متضررة بشدة" (تحت العتبة
// فوق) - تراكمية بس بحد أقصى الصفر (البونص ميبقاش سالب). ======
const HEAVILY_DAMAGED_STRUCTURE_PENALTY_PERCENT = 0.05;

module.exports = {
  DAMAGED_BUILDING_EFFICIENCY_PERCENT,
  WALL_HEAVILY_DAMAGED_THRESHOLD_PERCENT,
  MAX_CITY_DEFENSE_BONUS_PERCENT,
  HEAVILY_DAMAGED_STRUCTURE_PENALTY_PERCENT,
};
