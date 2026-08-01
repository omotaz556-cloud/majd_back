// ====== إعدادات "تجمّع التحالف" (Alliance Rally - Phase 13) ======
// نفس فلسفة alliance.config/allianceHelp.config: أرقام وenums ثابتة بس -
// مفيش أي منطق قتال هنا خالص (ده كله بيتعمل عن طريق battleResolutionEngine
// الموجود بالفعل - Rally مجرد "غلاف" بيجمّع جيوش كذا عضو قبل ما يستهلكه).

// ====== حالات التجمّع ======
// gathering : لسه بيقبل انضمام أعضاء جدد، العد التنازلي شغال
// resolved  : العد التنازلي خلص، اتعملت معركة واحدة، وطلع تقرير
// cancelled : اتلغى قبل ما يوصل لمرحلة المعركة (يدوي، أو تلقائي لو مفيش
//             مشاركين وقت انتهاء العد التنازلي، أو لو الهدف بقى حليف)
const RALLY_STATUS = {
  GATHERING: 'gathering',
  RESOLVED: 'resolved',
  CANCELLED: 'cancelled',
};

// ====== سبب الإلغاء (لو اتلغى) - بيتسجّل عشان تقدر تفرّق إلغاء القائد
// اليدوي عن إلغاء تلقائي حصل لظرف معيّن وقت الإطلاق. ======
const RALLY_CANCEL_REASON = {
  MANUAL: 'manual',
  NO_PARTICIPANTS: 'no_participants',
  TARGET_MISSING: 'target_missing',
  TARGET_NOW_ALLIED: 'target_now_allied',
};

// ====== الأدوار المسموح لها تعمل/تلغي تجمّع - نفس نمط
// allianceReinforcement/allianceMail: قائد أو ضابط بس، مش أي عضو. ======
const RALLY_MANAGE_ROLES = ['leader', 'officer'];

// ====== أي عضو في التحالف (بأي دور) يقدر ينضم/يسيب/يشوف حالة التجمّع. ======
const RALLY_ANY_MEMBER_ROLES = ['leader', 'officer', 'member'];

// ====== أقل/أكتر مدة عد تنازلي مسموحة (بالثواني) وقت إنشاء التجمّع. ======
const MIN_COUNTDOWN_SECONDS = 30;
const MAX_COUNTDOWN_SECONDS = 3600;

// ====== أقصى عدد تجمّعات "شغالة" (gathering) في نفس الوقت لكل تحالف -
// عشان تحالف واحد ميغرقش النظام بمية تجمّع فاضي شغالين مع بعض. ======
const MAX_ACTIVE_RALLIES_PER_ALLIANCE = 5;

// ====== Phase 15 - أقصى عدد عناصر Heroes/Buffs يقدر مشارك واحد يبعتهم مع
// مساهمته (research مش مصفوفة - كائن واحد بس، مفيش limit له). حماية بسيطة
// من payload ضخم أو مفتعَل، نفس فلسفة أي حد أقصى تاني في الملف ده. ======
const MAX_HEROES_PER_PARTICIPANT = 10;
const MAX_BUFFS_PER_PARTICIPANT = 20;

module.exports = {
  RALLY_STATUS,
  RALLY_CANCEL_REASON,
  RALLY_MANAGE_ROLES,
  RALLY_ANY_MEMBER_ROLES,
  MIN_COUNTDOWN_SECONDS,
  MAX_COUNTDOWN_SECONDS,
  MAX_ACTIVE_RALLIES_PER_ALLIANCE,
  MAX_HEROES_PER_PARTICIPANT,
  MAX_BUFFS_PER_PARTICIPANT,
};
