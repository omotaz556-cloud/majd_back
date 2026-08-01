# Battle Resolution Core (Phase 1, extended in Phase 5)

A modular, **synchronous** battle resolution engine: give it a full
attacker army and a full defender army, and it returns one complete battle
result — no ticks, no live simulation, no persistence.

This is intentionally a **separate, standalone module** from
`modules/battle/` (the existing tick-based Simulation/Rule/Combat engine
system documented in `modules/battle/README.md`). Nothing here imports
from, is imported by, or otherwise touches that system, `battle.routes.js`,
any controller, or the frontend — per this phase's scope, integrating the
two is explicitly left for a later step.

## Entry point

```js
const { resolveBattle } = require('./battleResolutionEngine');
// or: const { resolveBattle } = require('./index');

const result = resolveBattle(attacker, defender);
```

`attacker`:
| field | shape |
|---|---|
| `troops` | `[{ key, type, count, stats: { attack, defense, hp }, carry_capacity }]` |
| `heroes` | `[{ bonuses: { attack_percent, defense_percent } }]` (optional) |
| `research` | array or flat object carrying `attack_percent`/`defense_percent` (optional) |
| `buffs` | `[{ attack_percent, defense_percent }]` (optional) |
| `battlePlan` | `{ objective: 'loot'\|'raze'\|'conquer'\|'custom', bonus_percent }` (optional) |

`defender`: same `troops`/`heroes`/`research`/`buffs` shape, plus:
| field | shape |
|---|---|
| `buildings` | `[{ key, hp, defense_power, defense_bonus_percent }]` |
| `wall` | single segment object or array of segments, same shape as a building |
| `towers` | same shape as a building, plus `damage` |
| `resources` | `{ gold, wood, stone, ... }` stored amounts |

None of Heroes/Research/Buffs/Buildings/Wall/Towers have a real game system
backing them yet in this codebase — the same "generic placeholder"
philosophy already used for commanders/formation in `modules/battle/` is
used here: missing/malformed fields default to zero bonus rather than
throwing.

## Modules

- **`battleResolution.config.js`** — pure constants/config: the ±3% random
  modifier bound, a private troop-type counter matrix, battle-plan objective
  defaults, and tuning knobs for the casualty/loot/structure-damage/duration
  models. No calculation logic.

- **`calculators/unitEffectivenessCalculator.js`** — Unit Effectiveness:
  troop-type counter multipliers (a stack's effectiveness averaged against
  the opposing army's composition).

- **`calculators/bonusAggregator.js`** — shared helper that normalizes the
  free-form Heroes/Research/Buffs inputs into flat percentage bonuses (Hero
  Bonus, Research Bonus) for either `attack_percent` or `defense_percent`.

- **`calculators/attackPowerCalculator.js`** — Attack Power: base power
  (troops × unit effectiveness) + Hero/Research/Buff bonuses + Battle Plan
  Bonus.

- **`calculators/defensePowerCalculator.js`** — Defense Power: base power
  (troops × unit effectiveness) + Hero/Research/Buff bonuses + Building
  Bonus + Wall Bonus (towers contribute to defense power too).

- **`battleCalculator.js`** (`BattleCalculator`) — orchestrates Attack Power
  + Defense Power, applies the shared ±3% random modifier once, and decides
  the Winner + Final Scores. No casualty/loot/structure/event logic.

- **`calculators/casualtyCalculator.js`** (`CasualtyCalculator`) — Casualties
  + Remaining Troops for both sides, scaled by how lopsided the final power
  scores were.

- **`calculators/lootCalculator.js`** (`LootCalculator`) — Loot: only the
  winning attacker loots, capped by its surviving troops' total
  `carry_capacity`.

- **`calculators/structureDamageCalculator.js`** — Building Damage + Wall
  Damage (and tower damage): skips any structure without a real numeric
  `hp`, same "no invented hp" rule `modules/battle/` follows.

- **`calculators/durationCalculator.js`** — Battle Duration: a
  presentational estimate (seconds) derived from the two final power
  scores — not a real tick count.

- **`calculators/eventGenerator.js`** (`EventGenerator`) — Key Battle
  Events: a short, ordered narrative (wall breached, heavy losses, resources
  looted, battle ended...) derived purely from the already-computed results
  above. Adds no new numbers.

- **`resultBuilder.js`** (`ResultBuilder`) — assembles every piece above into
  one consistently-shaped result object. Pure assembly, no calculation.

- **`battleResolutionEngine.js`** — the public `resolveBattle(attacker,
  defender)` entry point; calls the modules above in order and returns the
  final result.

Every module above is independent: each only imports the config file and,
where needed, one calculator it directly composes with (e.g.
`battleCalculator.js` imports the two power calculators) — none of them
know about casualties, loot, or events unless that's their own job.

## Result shape

```js
{
  winner: 'attacker' | 'defender' | 'draw',
  final_scores: { attacker: Number, defender: Number },
  power_breakdown: { random_modifier, attack_power: {...}, defense_power: {...} },
  casualties: { attacker: { lost, remaining }, defender: { lost, remaining } },
  remaining_troops: { attacker: [{ key, type, count }], defender: [...] },
  loot: { looted: { gold, wood, stone }, total_value, capped_by_carry_capacity },
  building_damage: [{ key, starting_hp, damage, remaining_hp, destroyed }],
  wall_damage: [...same shape...],
  tower_damage: [...same shape...],
  battle_duration_seconds: Number,
  key_battle_events: [{ type, message, data }],
}
```

## Explicitly out of scope for this phase

- No Battle Report UI.
- No replay (that's `modules/battle/engines/replaySystem.js`'s job, in the
  existing system, and is separate/unrelated to this one).
- No changes to any existing API, route, or model.
- No persistence — `resolveBattle` is a pure function that returns its
  result; whoever calls it decides whether/how to store it.

## Phase 5 — Advanced Battle Strategy

Additive only — every field below is new; nothing from Phase 1's result
shape or inputs was renamed or removed, and this module is still not wired
into any route/controller/API/UI.

- **Troop counters** — `battleResolution.config.js`'s `TROOP_COUNTER_MATRIX`
  is now a full 4-type matrix (`infantry`/`archer`/`cavalry`/`siege`), each
  type with one clear strength and one clear weakness. Still consumed the
  same way by `unitEffectivenessCalculator.js` — unlisted matchups stay
  neutral (1.0).

- **Formations** — new `calculators/formationCalculator.js` resolves an
  optional `attacker.formation`/`defender.formation` string (`balanced`,
  `frontline`, `defensive`, `aggressive`, `archer_focus`, `cavalry_charge`)
  into a flat army-wide attack/defense percent plus an optional per-troop-type
  override, both defined in `battleResolution.config.js`'s
  `FORMATION_MODIFIERS`. An unrecognized/missing formation falls back to
  `balanced` (all zeros).

- **Heroes** — `heroes[].bonuses` now recognizes, on top of the existing
  flat `attack_percent`/`defense_percent`: `infantry_attack_percent`,
  `cavalry_defense_percent`, `archer_damage_percent` (each applied only to
  that troop type's stack), `siege_speed_percent` (shortens the
  presentational battle duration), and `leadership_percent` (a flat,
  army-wide bonus that also powers the "Hero Inspired Troops" event).

- **Research** — `research` now also recognizes `hp_percent` (mitigates a
  side's own casualty loss percent, capped), `march_capacity_percent`
  (scales the attacker's total carry capacity for looting), and
  `siege_efficiency_percent` (boosts the extra structure-damage bonus siege
  troops already grant by their presence in the attacking army).

- **New battle events** — `calculators/eventGenerator.js` gained
  `generateStrategyEvents`, sourced only from data the rest of the engine
  already computed (per-stack effectiveness multipliers, structure damage,
  hero leadership): `cavalry_flanked_enemy`, `archers_eliminated_siege`,
  `infantry_held_the_line`, `wall_defended`, `hero_inspired_troops`. Each
  fires only when the underlying numbers actually earn it (e.g.
  `cavalry_flanked_enemy` only fires when the attacker's cavalry stack's
  weighted counter multiplier crosses `STRATEGY_EVENT_EFFECTIVENESS_THRESHOLD`
  against the real opposing army composition, not unconditionally).

- Every calculator new/changed in this phase still only imports the config
  file and, where needed, one sibling calculator — same modularity rule as
  Phase 1.

## Phase 14 — Alliance Defense

Additive only — every field below is new; nothing from Phase 1/5's result
shape or inputs was renamed or removed, and this module is still not wired
into any route/controller/API/UI.

- **Automatic inclusion** — `defender.reinforcements` (an array of alliance
  reinforcement armies stationed in the defending city) is now folded into
  defense power and casualties automatically; the caller doesn't need to
  merge troops together beforehand.
- **`defensePowerCalculator.js`** — each reinforcement is run through the
  same single-army defense power calculation as the defending city's own
  troops (own heroes/research/buffs/formation, no structures of its own),
  then summed into the total. `breakdown.reinforcements` and
  `breakdown.participants` list each army separately.
- **`casualtyCalculator.js`** — the same lopsidedness-driven defender loss
  percent is applied independently to the defending city's own troops and to
  each reinforcement's troops (mirroring
  `alliances/allianceReinforcement.service.js::applyBattleLossesToStationedTroops`
  in the existing tick-based engine), each mitigated by its own `research`.
  `casualties.defender.totals`/`.stacks` stay a combined aggregate for
  existing consumers; `.participants` is the new per-army breakdown.
- **`resultBuilder.js`** — new top-level `defender_participants`: every
  participant (the defending city + each reinforcement) with its own
  starting troops, casualties, and remaining troops, for the Battle Report
  to display separately.
- **`eventGenerator.js`** — new `alliance_reinforcements_joined_defense`
  event when one or more reinforcement armies took part.
- Multiple reinforcement armies are supported natively (it's an array); no
  cap imposed by this module.
