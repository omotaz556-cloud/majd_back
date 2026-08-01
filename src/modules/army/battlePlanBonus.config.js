// ====== إعدادات ضبط "بونص خطة المعركة" (Battle Plan Combat Bonus) ======
// الملف ده بيحمل بس القيم/النسب القابلة للتعديل (التوازن) اللي
// battlePlanBonusCompiler.js بيقرا منها - نفس فلسفة الفصل بين
// damage.config.js وdamageEngine.js بالظبط: أي حد يوازن اللعبة (يغيّر رقم)
// محتاج يفتح الملف ده بس، مايحتاجش يفهم أو يلمس منطق التحويل نفسه.
//
// كل نسبة هنا معناها "نسبة مئوية إضافية" (0.05 = +5%) بتتحول لمودفير
// ATTACK_BONUS/DEFENSE_BONUS حقيقي (raw flat value، مش نسبة) وقت التسجيل -
// راجع battlePlanBonusCompiler.js لتفاصيل التحويل.

'use strict';

// ====== 1) بونص التشكيل التكتيكي (battle_formation fill) ======
// كل خانة معبّية فعليًا (troop_key مش null) في التشكيل التكتيكي بتضيف نسبة
// هجوم صغيرة - خطة مجهّزة بالكامل (كل الخانات معبّية) أقوى من خطة فاضية،
// بس النسبة الإجمالية محدودة بسقف (MAX) عشان "امتلاء التشكيل" مايبقاش
// بديل رخيص لعدد القوات الفعلي.
const FORMATION_SLOT_ATTACK_BONUS_PERCENT = 0.006; // +0.6% هجوم لكل خانة معبّاة
const FORMATION_FILL_MAX_ATTACK_BONUS_PERCENT = 0.06; // سقف إجمالي +6%

// ====== 2) بونص خط التشكيل (Front/Middle/Back Line) ======
// الخط اللي مجموعة القوات متحطة فيه بيأثر دفاعيًا: الصف الأمامي مصمم
// يمتص الضربة الأولى (دفاع أعلى شوية)، الخلفي بعيد عن الاشتباك المباشر
// (هجوم أعلى شوية لأنه بياخد وقت أطول يوصل بس أأمن)، الأوسط متوازن
// (بلا بونص). دي نسب صغيرة عمدًا - القرار التكتيكي الحقيقي (مين يتضرب
// الأول) لسه شغل Combat Engine نفسه (target selection/range).
const FORMATION_LINE_BONUS_PERCENT = {
  front_line: { defense_percent: 0.04, attack_percent: 0 },
  middle_line: { defense_percent: 0, attack_percent: 0 },
  back_line: { defense_percent: 0, attack_percent: 0.02 },
};

// ====== 3) بونص تفضيل القائد (commander_preferences.role_preference) ======
// نفس مفردات COMMANDER_ROLE_PREFERENCES (army.config.js) - تفضيل عام واحد
// لكل الجيش، مش لكل وحدة. نسب معتدلة عمدًا لأن نظام القادة الحقيقي نفسه
// لسه مش موجود (تفضيل بس، مش تعيين قائد فعلي بإحصائياته الخاصة).
const COMMANDER_ROLE_BONUS_PERCENT = {
  offensive: { attack_percent: 0.05, defense_percent: 0 },
  defensive: { attack_percent: 0, defense_percent: 0.05 },
  support: { attack_percent: 0.02, defense_percent: 0.02 },
  balanced: { attack_percent: 0.02, defense_percent: 0 },
};

// ====== 4) بونص الإعداد الاستراتيجي (strategy_config) ======
// وجود قواعد استراتيجية مسجّلة (مش قيمتها التفصيلية - القواعد نفسها بتتنفذ
// فعليًا عن طريق battlePlanRuleCompiler.js/rulePlanExecutor.js) بيدي بونص
// "تنظيم" بسيط: جيش عنده خطة انسحاب/حماية واضحة مؤهّل أحسن من جيش من غير
// أي استراتيجية مسجّلة خالص. never_retreat (STRATEGIC_RETREAT_RULE_TYPES)
// بيدّي بونص دفاع إضافي (الجيش قرر يقاتل لآخر نفس، مش يحسب حساب الهروب).
const STRATEGY_HAS_RETREAT_RULES_DEFENSE_PERCENT = 0.015;
const STRATEGY_HAS_PROTECTION_RULES_DEFENSE_PERCENT = 0.015;
const STRATEGY_NEVER_RETREAT_DEFENSE_PERCENT = 0.02;

// ====== السقف الإجمالي (Overall Cap) ======
// مجموع كل البونصات فوق (هجوم أو دفاع لوحده) محدود بالسقف ده - حماية ضد
// تراكم غير متوقع لو اتضافت مصادر بونص جديدة لاحقًا من غير ما حد يراجع
// التوازن الكلي.
const MAX_TOTAL_BONUS_PERCENT = 0.2; // +20% سقف مطلق لأي إحصائية واحدة

module.exports = {
  FORMATION_SLOT_ATTACK_BONUS_PERCENT,
  FORMATION_FILL_MAX_ATTACK_BONUS_PERCENT,
  FORMATION_LINE_BONUS_PERCENT,
  COMMANDER_ROLE_BONUS_PERCENT,
  STRATEGY_HAS_RETREAT_RULES_DEFENSE_PERCENT,
  STRATEGY_HAS_PROTECTION_RULES_DEFENSE_PERCENT,
  STRATEGY_NEVER_RETREAT_DEFENSE_PERCENT,
  MAX_TOTAL_BONUS_PERCENT,
};
