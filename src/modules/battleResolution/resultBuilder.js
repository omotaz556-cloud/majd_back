// ====== Result Builder ======
// Single responsibility: assemble the already-computed pieces (battle
// calculation, casualties, loot, structure damage, duration, events) into
// one final, consistently-shaped result object. It performs no calculation
// of its own — pure assembly/shaping only.

'use strict';

// ====== Phase 14 — Alliance Defense ======
// Shapes casualtyCalculator's per-participant defender breakdown (the
// defending city's own army plus every stationed reinforcement army) into
// the flat, Battle-Report-friendly form: each participant listed on its own
// with its starting troops, casualties, and remaining troops. Pure
// shaping/relabeling only — every number already comes from casualties.
function buildDefenderParticipants(defenderCasualties) {
  return (defenderCasualties.participants || []).map((p) => ({
    id: p.id,
    label: p.label,
    is_reinforcement: p.is_reinforcement,
    loss_percent_applied: p.loss_percent_applied,
    starting_troops: p.stacks.map((s) => ({ key: s.key, type: s.type, count: s.starting_count })),
    casualties: p.totals,
    remaining_troops: p.stacks.map((s) => ({ key: s.key, type: s.type, count: s.remaining })),
  }));
}

function buildBattleResult({
  battle,
  casualties,
  loot,
  structureDamage,
  durationSeconds,
  events,
}) {
  return {
    winner: battle.winner,
    final_scores: {
      attacker: battle.attack_power.final,
      defender: battle.defense_power.final,
    },
    power_breakdown: {
      random_modifier: battle.random_modifier,
      attack_power: battle.attack_power.breakdown,
      defense_power: battle.defense_power.breakdown,
    },
    casualties: {
      attacker: casualties.attacker.totals,
      defender: casualties.defender.totals,
    },
    remaining_troops: {
      attacker: casualties.attacker.stacks.map((s) => ({
        key: s.key,
        type: s.type,
        count: s.remaining,
      })),
      defender: casualties.defender.stacks.map((s) => ({
        key: s.key,
        type: s.type,
        count: s.remaining,
      })),
    },
    // Phase 14 — every defense participant (the defending city + each
    // alliance reinforcement army) shown separately, alongside the combined
    // `casualties`/`remaining_troops` above kept unchanged for existing
    // consumers.
    defender_participants: buildDefenderParticipants(casualties.defender),
    loot,
    building_damage: structureDamage.buildings,
    wall_damage: structureDamage.wall,
    tower_damage: structureDamage.towers,
    battle_duration_seconds: durationSeconds,
    key_battle_events: events,
  };
}

module.exports = {
  buildBattleResult,
};
