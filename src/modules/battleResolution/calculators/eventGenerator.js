// ====== Event Generator ======
// Single responsibility: turn already-computed results (winner, casualties,
// structure damage, loot) into a short, ordered list of key battle events —
// a curated high-level narrative, not a tick-by-tick log (that distinction
// already exists between battle_events and current_state.events in the
// existing battle module, and this module follows the same philosophy).
// Pure formatting/derivation — it never computes new numbers itself.

'use strict';

const { STRATEGY_EVENT_EFFECTIVENESS_THRESHOLD, TROOP_TYPE } = require('../battleResolution.config');
const { sumLeadershipBonus } = require('./bonusAggregator');

function pushEvent(events, type, message, data = {}) {
  events.push({ type, message, data });
}

/**
 * Phase 5 — strategy-based events, derived purely from the attack/defense
 * per-stack breakdowns (troop counters + formation + heroes already baked
 * into `effectiveness_multiplier`/bonus fields), structure damage, and
 * hero leadership. No new numbers computed here, same philosophy as the
 * events above — this only narrates what already happened.
 */
function generateStrategyEvents({ events, attackPerStack = [], defensePerStack = [], structureDamage, heroes }) {
  const findDecisiveStack = (perStack, type) =>
    perStack.find((s) => s.type === type && s.effectiveness_multiplier >= STRATEGY_EVENT_EFFECTIVENESS_THRESHOLD);

  const attackerCavalry = findDecisiveStack(attackPerStack, TROOP_TYPE.CAVALRY);
  if (attackerCavalry) {
    pushEvent(events, 'cavalry_flanked_enemy', 'الفرسان طوّقوا العدو من الجناح', {
      key: attackerCavalry.key,
      effectiveness_multiplier: attackerCavalry.effectiveness_multiplier,
    });
  }

  const decisiveArcher = findDecisiveStack(attackPerStack, TROOP_TYPE.ARCHER) || findDecisiveStack(defensePerStack, TROOP_TYPE.ARCHER);
  if (decisiveArcher) {
    pushEvent(events, 'archers_eliminated_siege', 'الرماة أبادوا آلات الحصار', {
      key: decisiveArcher.key,
      effectiveness_multiplier: decisiveArcher.effectiveness_multiplier,
    });
  }

  const defenderInfantry = findDecisiveStack(defensePerStack, TROOP_TYPE.INFANTRY);
  if (defenderInfantry) {
    pushEvent(events, 'infantry_held_the_line', 'المشاة صمدوا في خط الدفاع', {
      key: defenderInfantry.key,
      effectiveness_multiplier: defenderInfantry.effectiveness_multiplier,
    });
  }

  if (structureDamage && structureDamage.wall_segment_count > 0 && structureDamage.wall_segments_breached === 0) {
    pushEvent(events, 'wall_defended', 'الأسوار صمدت وتم صد الهجوم عنها', {
      segments: structureDamage.wall_segment_count,
    });
  }

  const attackerLeadership = sumLeadershipBonus(heroes?.attacker);
  const defenderLeadership = sumLeadershipBonus(heroes?.defender);
  if (attackerLeadership > 0 || defenderLeadership > 0) {
    pushEvent(events, 'hero_inspired_troops', 'القائد ألهم الجنود في ساحة المعركة', {
      attacker_leadership_percent: attackerLeadership,
      defender_leadership_percent: defenderLeadership,
    });
  }
}

function generateBattleEvents({
  winner,
  casualties,
  structureDamage,
  loot,
  powerRatio,
  attackPerStack,
  defensePerStack,
  heroes,
  defenderReinforcements = [],
}) {
  const events = [];

  pushEvent(events, 'battle_started', 'المعركة بدأت والجيشان اشتبكا');

  // Phase 14 — Alliance Defense: purely narrates the already-computed
  // participants list from defensePowerCalculator, no new numbers.
  if (Array.isArray(defenderReinforcements) && defenderReinforcements.length > 0) {
    pushEvent(events, 'alliance_reinforcements_joined_defense', 'تعزيزات الحلفاء شاركت في الدفاع عن القلعة', {
      reinforcement_count: defenderReinforcements.length,
      reinforcement_ids: defenderReinforcements.map((r) => r.id),
    });
  }

  generateStrategyEvents({ events, attackPerStack, defensePerStack, structureDamage, heroes });

  if (structureDamage?.wall_segments_breached > 0) {
    pushEvent(
      events,
      'wall_breached',
      `الأسوار اتخرقت (${structureDamage.wall_segments_breached} قطعة)`,
      { segments: structureDamage.wall_segments_breached }
    );
  }

  if (structureDamage?.towers_destroyed > 0) {
    pushEvent(events, 'towers_destroyed', `${structureDamage.towers_destroyed} برج اتدمر`, {
      count: structureDamage.towers_destroyed,
    });
  }

  if (structureDamage?.buildings_destroyed > 0) {
    pushEvent(events, 'buildings_destroyed', `${structureDamage.buildings_destroyed} مبنى اتدمر`, {
      count: structureDamage.buildings_destroyed,
    });
  }

  const attackerLostPercent = casualties?.attacker?.loss_percent_applied ?? 0;
  const defenderLostPercent = casualties?.defender?.loss_percent_applied ?? 0;

  if (attackerLostPercent >= 0.5) {
    pushEvent(events, 'heavy_attacker_losses', 'المهاجم خسر جزء كبير من جيشه', {
      loss_percent: attackerLostPercent,
    });
  }
  if (defenderLostPercent >= 0.5) {
    pushEvent(events, 'heavy_defender_losses', 'المدافع خسر جزء كبير من جيشه', {
      loss_percent: defenderLostPercent,
    });
  }

  if (loot?.total_value > 0) {
    pushEvent(events, 'resources_looted', `المهاجم نهب موارد بقيمة ${loot.total_value}`, {
      total_value: loot.total_value,
    });
  }
  if (loot?.capped_by_carry_capacity) {
    pushEvent(events, 'loot_capped', 'النهب اتحدد بسقف سعة الحمل بتاعة الجيش المهاجم');
  }

  if (winner === 'draw') {
    pushEvent(events, 'battle_ended_draw', 'المعركة انتهت بالتعادل');
  } else {
    pushEvent(events, 'battle_ended', `المعركة انتهت وفاز الـ${winner === 'attacker' ? 'مهاجم' : 'مدافع'}`, {
      winner,
      power_ratio: powerRatio,
    });
  }

  return events;
}

module.exports = {
  generateBattleEvents,
};
