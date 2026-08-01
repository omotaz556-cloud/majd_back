# Battle System — Architecture & Status

This module implements a **real battle simulation system**, rendered inside the
defender's isometric city, instead of a simple attack-vs-defense number
comparison.

## General architecture (9 systems)

1. **Battle Preparation** ✅ *implemented in this step*
   Create a `Battle` instance the moment an attack starts, taking a full
   snapshot of both sides so later changes never affect a running battle.
2. **Battle Planner** ⏳ not implemented yet
   Will give real meaning to `snapshot.attacker.formation`,
   `snapshot.attacker.battle_plan`, `snapshot.defender.defense_plan`, and the
   defender's `reserved_army` / `garrisons` / `wall_layout` /
   `tower_positions` / `gate_positions` / `trap_positions` (currently
   free-form placeholders).
3. **Simulation Engine** ✅ *core implemented in this step* — `engines/simulationEngine.js`
   Tick-based engine (default 250ms) with its own state machine (`waiting →
   initializing → running ⇄ paused → finished`, or `cancelled`), a chronological
   `BattleTimeline`, an `ActionQueue` (scheduling only — `move`, `rotate`,
   `wait`, `capture_position`, `enter_gate`, `exit_gate`), live per-unit-group
   state (`UnitStateStore`), an internal pub/sub `SimulationEventBus`, and
   deterministic replay recording. **Still contains zero damage formulas,
   combat resolution, or AI decisions** — that is deliberately left for the
   Combat/Rule/AI systems below to plug into via `engine.on(...)`.
4. **Rule Engine** ✅ *core implemented in this step* — `engines/ruleEngine.js`
   Evaluates the player's own Battle Plan / Defense Plan conditions every tick
   (subscribed to the Simulation Event Bus) and publishes the exact action the
   player already configured. **Not an AI** — it never invents a strategy or
   overrides a player decision, it only checks conditions and republishes
   pre-configured actions. See below for details.
5. **Combat Engine** ✅ *finalized in this step* — `engines/combatEngine.js`
   Resolves individual engagements (unit vs unit, unit vs building/wall/tower/
   gate) triggered by Attack Unit / Attack Building / Defend Position / Hold
   Position orders, with configurable target selection, mandatory range
   checking, casualty tracking, morale, live battle statistics, and the full
   set of combat events (`DAMAGE_DEALT`, `UNIT_KILLED`, `BUILDING_DAMAGED`,
   `BUILDING_DESTROYED`, `CASUALTY_UPDATED`, `MORALE_CHANGED`,
   `COMMANDER_DEFEATED`) for Rule Engine / Replay System / Battle Report to
   consume later. See below for details.
6. **Building Interaction** ⏳ not implemented yet — `engines/buildingInteraction.js`
7. **Battle Renderer** 🚫 **not part of this backend at all** — rendering,
   animations, particles, camera, and every other visual concern belong
   entirely to the frontend. There is no `engines/battleRenderer.js` and no
   renderer-shaped code anywhere in this module; the backend's job stops at
   producing data (`snapshot`, `current_state`, `battle_events`, the eventual
   `Battle Report`) for the frontend to draw.
8. **Replay System** ⏳ not implemented yet — `engines/replaySystem.js`
9. **Battle Report** ⏳ not implemented yet — `engines/battleReport.js`

Every future step should build **on top of** the `Battle` document below,
without needing to change its shape.

### Backend scope (explicit)

This backend is responsible **only** for:

- Battle (lifecycle/state — `battle.service.js`, `battle.model.js`)
- Simulation (`engines/simulationEngine.js`)
- Rule Engine (`engines/ruleEngine.js`)
- Combat Engine (`engines/combatEngine.js`) — combat resolution only, no
  strategy invention and no simulation timing control
- Battle Planner (future — attacker/defender plans, formations, garrisons)
- Replay Data (`engines/replaySystem.js`, `battle_events`, `current_state.events`)
- Battle Report (`engines/battleReport.js`)

It never renders anything. Visual output (isometric scene, sprites,
animations, particles, camera movement, UI overlays) is entirely a frontend
responsibility, built on top of the data this backend exposes.

## What's in this step (Battle Foundation)

```
modules/battle/
  battle.config.js            statuses, lifecycle transitions, battleId settings
  battle.model.js              the Battle Instance schema + all snapshot sub-schemas
  battle.snapshot.service.js   builds frozen attacker/defender snapshots from live castle data
  battle.service.js            battle lifecycle: create / load / list / transition / update
  battle.controller.js         HTTP handlers
  battle.routes.js             mounted at /api/battles
  engines/                     backend-owned steps only. simulationEngine.js and ruleEngine.js are
                                implemented (see below); combat/building-interaction/replay/report
                                are still scaffolding and throw on use. No renderer lives here —
                                rendering is a frontend concern.
```

### The Battle Instance

Every battle has, at minimum:

- `battle_id` — unique, human-readable id (`BTL-100001`, generated the same
  way `kingdom_id` is generated for castles)
- `current_state` — opaque container for the live simulation (shape owned by
  the future Simulation Engine)
- `current_tick`
- `status` — `preparing → ready → running → (paused ⇄ running) → finished`,
  or `cancelled` at any point before `finished` (see `ALLOWED_TRANSITIONS` in
  `battle.config.js`)
- `start_time` / `finish_time`
- `winner` — `'attacker' | 'defender' | 'draw' | null`
- `statistics` — all zeroed defaults, to be filled in by the future Combat
  Engine / Battle Report

Battle metadata (added in this step, for the future Simulation/Combat/Replay
engines to build on):

- `random_seed` — generated once at creation time (`generateRandomSeed` in
  `battle.config.js`); the seed the future Simulation/Combat Engine must use
  for every random roll so the whole battle can be replayed deterministically
- `battle_version` — the engine version this battle was created under
  (`BATTLE_VERSION` in `battle.config.js`), so battles created under older
  engine logic can be told apart from newer ones
- `battle_events` — empty array at creation; a curated, high-level event log
  (walls breached, towers destroyed, commanders lost...) distinct from the
  raw tick-by-tick `current_state.events`, meant for the future Replay System
  and Battle Report
- `battle_mode` — one of `pvp | pve | alliance_rally | reinforcement |
  castle_defense | world_boss | event_battle` (`BATTLE_MODE` in
  `battle.config.js`); defaults to `pvp`, the only mode currently wired to a
  real gameplay path (via `march.service.js`)

### The snapshot

`snapshot.attacker` and `snapshot.defender` are captured **once**, at battle
creation time, and never re-read from the live castle again:

- Attacker: `troops` (with `stats`/`speed`/`carry_capacity` **copied** from
  `TROOP_TYPES` at that instant — not a live reference, so a later balance
  patch cannot retroactively change a running battle), `commanders`,
  `formation`, `battle_plan`.
- Defender: `buildings`, `walls`, `towers`, `gates`, `resources`,
  `city_layout`, its own standing `troops`, plus (added in this step):
  `defense_plan`, `reserved_army`, `garrisons`, `wall_layout`,
  `tower_positions`, `gate_positions`, `trap_positions`.

> `commanders`, `formation`, `battle_plan`, `walls`, `towers`, `gates`,
> `defense_plan`, `reserved_army`, `garrisons`, `wall_layout`,
> `tower_positions`, `gate_positions`, and `trap_positions` do not exist as
> real game systems yet (the current `Castle` model has no fortifications,
> defensive-planning, or commander system). Their schemas are intentionally
> generic placeholders so those future systems can populate them without any
> change to `battle.model.js`.
>
> `tower_positions` / `gate_positions` differ from `towers` / `gates`: the
> latter carry the full combat snapshot (`hp`, `damage`, `level`), while the
> former are lightweight `{x, y}` coordinates meant for a future defensive
> layout editor. `wall_layout` describes the wall line as a whole (segments
> on the grid), separate from the per-segment combat state in `walls`.
> `reserved_army` is troops the defender kept back instead of deploying, and
> `garrisons` are troop stacks assigned to specific defensive points, both
> distinct from the general standing `troops` list.

## What's in this step (Simulation Engine core)

`engines/simulationEngine.js` exports a `SimulationEngine` class (plus a
`createSimulationEngine(options)` factory) that is **completely standalone** —
it doesn't touch Mongoose, `battle.service.js`, or HTTP at all yet. It only
manages time, state, scheduling, and events:

- **Tick loop** — `tickRateMs` defaults to `250`; `setSpeed(multiplier)`
  rescales the real-time interval without changing what a tick represents.
  `advanceTick()` can also be called manually (headless/deterministic
  stepping, e.g. in tests) regardless of whether the internal timer is running.
- **Simulation state** — `waiting → initializing → running ⇄ paused →
  finished`, or `cancelled` from almost anywhere, enforced by an internal
  transition table (same pattern as `ALLOWED_TRANSITIONS` in
  `battle.config.js`). Public API: `startSimulation()`, `pauseSimulation()`,
  `resumeSimulation()`, `stopSimulation()`, `restartSimulation()`, and
  `advanceTick()`.
- **`BattleTimeline`** — every event (`tick`, `timestamp`, `type`, `source`,
  `target`, `payload`) in chronological order; read via `engine.getTimeline()`.
- **`ActionQueue`** — `engine.scheduleAction({ type, source, target, payload },
  targetTick)` for `move | rotate | wait | capture_position | enter_gate |
  exit_gate`. Scheduling only: at the target tick the engine dequeues and
  *publishes* the action as an event, it never executes what the action means.
- **`UnitStateStore`** — `registerUnitGroup(...)` / `updateUnitGroup(id,
  patch)` track `id`, `position`, `destination`, `current_action`,
  `formation`, a `morale` placeholder, `status`, and `alive` per unit group —
  no combat math anywhere near it.
- **`SimulationEventBus`** — `engine.on(eventType, handler)` /
  `engine.off(...)`. Future systems (Combat Engine, Rule Engine, Replay
  System, Battle Report) subscribe to `SIMULATION_EVENT.*` (e.g.
  `ACTION_DUE`, `TICK_COMPLETED`, `UNIT_UPDATED`) without the engine ever
  needing to know they exist.
- **Replay recording** — `engine.getReplayData()` returns the same
  deterministic event stream recorded during ticking (no visual/rendering
  data of any kind).
- A small helper, `buildUnitGroupsFromSnapshot(battle)`, maps
  `battle.snapshot.attacker/defender.troops` into initial unit-group configs
  for `initialize()`/`startSimulation()` — pure data mapping, not a combat
  calculation.

Not done yet, by design: wiring this engine into `battle.service.js` /
`battle.controller.js` (so a `Battle` document actually drives a live engine
instance keyed by `battle_id`) is left for a later step, alongside the
Combat/Rule Engines that will be the ones actually consuming `ACTION_DUE`.

## What's in this step (Rule Engine core)

`engines/ruleEngine.js` exports a `RuleEngine` class (plus a
`createRuleEngine(options)` factory). It is **not an AI** — every rule it
runs comes verbatim from the player's own Battle Plan / Defense Plan; the
engine only checks whether the player's conditions are true and republishes
the player's own configured action. It never invents, ranks, or overrides a
strategy.

- **Subscribes to the Simulation Event Bus** — `new RuleEngine({ eventBus:
  simulationEngine.eventBus, getContext: () => ({...}) })` auto-subscribes to
  `SIMULATION_EVENT.TICK_COMPLETED` and runs on every tick. `evaluateTick(context)`
  is also public for manual/deterministic use (e.g. tests).
- **Conditions read facts, they don't compute them** — `CONDITION_TYPE.*`
  covers `gate_destroyed | wall_destroyed | tower_destroyed | commander_dead |
  formation_destroyed | casualties_above_percent | morale_below |
  target_captured | timer_reached | enemy_entered_area |
  reinforcements_arrived`. A few (`morale_below`, `formation_destroyed`,
  `casualties_above_percent`, `enemy_entered_area`) read directly off the
  Simulation Engine's own unit state (`position`, `morale`, `alive`,
  `formation`) since that's already tracked there. The rest read from a
  `context.facts` bag that Building Interaction / Combat Engine will populate
  later (`facts.gates`, `facts.walls`, `facts.towers`,
  `facts.captured_targets`, `facts.reinforcements_arrived`,
  `facts.commanders`) — until then they simply evaluate to `false` rather than
  guessing.
- **`AND` / `OR` / nesting** — a condition node is either `{ operator: 'AND'
  | 'OR', conditions: [...] }` or a leaf `{ check: CONDITION_TYPE, params }`,
  validated recursively at `registerRule()` time so a malformed plan fails
  fast instead of silently never firing.
- **Actions are the player's plan vocabulary** — `PLAN_ACTION_TYPE.*`
  (`move_formation | hold_position | attack_gate | attack_wall | defend_gate |
  reinforce_wall | activate_reserve_army | retreat | open_gate | close_gate |
  protect_town_hall`), deliberately distinct from Simulation Engine's
  lower-level `ACTION_TYPE` (`move/rotate/wait/...`). The Rule Engine
  publishes `{ type, target, payload }` exactly as the player configured it;
  it's for the future Combat Engine / Building Interaction to decide what the
  action actually does.
- **Priorities** — rules are sorted by `priority` (higher first) before
  evaluation each tick, so if several become true on the same tick the
  higher-priority one's action is published first.
- **Cooldowns** — `cooldown_ticks` blocks a rule from re-triggering until
  enough ticks have passed since its last trigger.
- **Event logging** — every trigger is recorded into a `ruleLog`
  (`BattleTimeline`, reused from `simulationEngine.js` — same
  `tick/timestamp/type/source/target/payload` shape) and emitted on the event
  bus as `RULE_EVENT.RULE_TRIGGERED`, so Replay System, Battle Report, and
  Battle Timeline can all consume it the same way.
- **API** — `registerRule(rule)`, `unregisterRule(id)`, `enableRule(id)`,
  `disableRule(id)`, `evaluateTick(context)`, plus `getRule`, `getAllRules`,
  `getRuleLog`, `getReplayData`, `isRuleOnCooldown`, and `destroy()` to
  unsubscribe cleanly.
- **Independence** — the file only imports constants/classes from
  `simulationEngine.js` (the thing it observes). It has no reference to
  Combat Engine, AI, or Pathfinding anywhere, and contains no damage math or
  movement logic — only condition evaluation and action publishing.

## What's in this step (Combat Engine core)

`engines/combatEngine.js` exports a `CombatEngine` class (plus a
`createCombatEngine(options)` factory). Its only job is **combat
resolution** — it never invents a strategy and never touches simulation
timing; movement stays entirely with `engines/simulationEngine.js`.

- **Subscriptions** — `new CombatEngine({ eventBus: simulationEngine.eventBus })`
  subscribes to exactly three events on the Simulation Event Bus:
  `SIMULATION_EVENT.ACTION_DUE` (receives combat orders — either dispatched
  directly by the Simulation Engine's action queue or republished by the Rule
  Engine), `SIMULATION_EVENT.UNIT_UPDATED` (keeps its local combatant
  position/alive/status mirror in sync with the Simulation Engine's own
  `UnitStateStore`, without duplicating movement logic), and
  `SIMULATION_EVENT.TICK_COMPLETED` (the point where every standing combat
  order is actually resolved for that tick).
- **Combat actions** — `COMBAT_ACTION_TYPE.*`: `attack_unit`, `attack_building`,
  `defend_position`, `hold_position`. Deliberately separate vocabulary from
  Simulation Engine's `ACTION_TYPE` (movement) and Rule Engine's
  `PLAN_ACTION_TYPE` (player-plan wording) — `hold_position` is fully passive
  (no resolution attempt at all); `attack_unit`/`defend_position` pull targets
  from enemy units, `attack_building` from enemy structures.
- **Target selection** — `TARGET_SELECTION_STRATEGY.*`: `nearest`,
  `lowest_hp`, `highest_threat`, `building_priority` (gate > tower > wall >
  building, ties broken by distance), `commander_priority` (prefers units
  flagged `commander: true`), `manual_target` (a specific id — no automatic
  fallback if it's missing or dead, by design). Selection and range checking
  are independent steps: a strategy can pick a target that then fails the
  range check, in which case the attack simply doesn't happen that tick.
- **Range checking (Requirement 5)** — every registered combatant/structure
  carries a `range`; `isInRange()` is a plain Euclidean distance check against
  it. Units and buildings cannot attack outside their range — an out-of-range
  attempt produces no event and is retried on the next tick if the order is
  still standing.
- **Independent local state** — `CombatUnitStore` and `StructureStore` hold
  combat-only stats (`attack`/`defense`/`hp`/`range`/`threat`/`commander`)
  that don't exist on Simulation Engine's `UnitStateStore`. Combatants and
  structures must be registered explicitly via `registerCombatant()` /
  `registerStructure()` by whoever wires the engine up (a future step for
  `battle.service.js`, from `battle.snapshot`) — the Combat Engine itself has
  no Mongoose/`battle.model` dependency, same as Simulation/Rule Engine.
- **Publishes** — `COMBAT_EVENT.DAMAGE_DEALT` (every landed hit),
  `COMBAT_EVENT.UNIT_KILLED` (when a unit's hp reaches 0), and
  `COMBAT_EVENT.BUILDING_DAMAGED` (every landed hit on a structure, not just
  destruction — Building Interaction will read `remaining_hp`/`destroyed` off
  this event to decide what a destroyed gate/wall/tower actually means).
  Logged into a `combatLog` (`BattleTimeline`, same shape reused from
  `simulationEngine.js`) and readable via `getCombatLog()`/`getReplayData()`.
- **Independence** — the file only imports `SIMULATION_EVENT`/
  `BattleTimeline`/`SimulationEventBus` from `simulationEngine.js` (the same
  shared vocabulary Rule Engine reuses). It has no reference to AI, the
  Replay System, the frontend, or Battle Report anywhere.

## What's in this step (Damage System)

`engines/damage.config.js` (pure config/data, no calculation) and
`engines/damageEngine.js` (pure calculation pipeline, no Event Bus/order/tick
knowledge) extend the Combat Engine's damage formula from a flat
`attack - defense * 0.5` placeholder into a fully configurable, deterministic
pipeline. `combatEngine.js` is the only place that wires the two together —
both are also re-exported from `combatEngine.js` so existing consumers only
need one import.

- **Inputs (Requirement 1)** — a registered combatant now carries
  `stats.attack`, `stats.defense`, `stats.armor` (defaults to `0`),
  `stats.hp`, `stats.attack_speed` (defaults to `1`/sec), and `troop_type`.
  Structures gained matching `armor`/`defense` fields so they can go through
  the exact same pipeline (Requirement 4) instead of a special case.
- **Troop types & counters (Requirement 2)** — `TROOP_TYPE.*`:
  `infantry`/`archer`/`cavalry`/`siege`. `TROOP_COUNTER_MATRIX` in
  `damage.config.js` is the **only** place the rock-paper-scissors multipliers
  live (infantry > siege, archer > infantry, cavalry > archer, siege weaker
  head-on vs troops) — any unlisted pair or unknown `troop_type` falls back to
  a neutral `1.0`, so partially-tagged data never throws.
- **Damage types (Requirement 3)** — `DAMAGE_TYPE.*`: `melee`, `ranged`,
  `siege`, `fire`, `magic`, `true_damage`. Each has its own
  `DAMAGE_TYPE_MITIGATION_PROFILE` (how much of the target's `armor` vs
  `defense` actually applies — e.g. `magic`/`true_damage` mostly or entirely
  ignore both). An attacker's `damage_type` defaults from its `troop_type`
  (`TROOP_TYPE_DEFAULT_DAMAGE_TYPE`) but any order can override it per attack
  (`order.damage_type`) — this is the hook a future fire/magic skill or siege
  technology plugs into without touching the engine itself.
- **Attack speed (Requirement 1)** — `attack_speed` (attacks/sec) is converted
  to a cooldown in *ticks* (`computeCooldownTicks`, using the Combat Engine's
  own `tickRateMs`) rather than multiplying per-hit damage. `_resolveOrder`
  now checks `isAttackReady()` before resolving a standing order — same
  silent-failure-and-retry-next-tick style as the existing range check — so a
  fast unit lands more hits over time instead of one inflated hit per tick.
- **Deterministic pipeline (`damageEngine.computeDamage`)** — no randomness
  anywhere: `base_attack → troop counter (or structure damage-type modifier)
  → armor/defense mitigation (diminishing-returns curve, capped at
  `MAX_MITIGATION_FRACTION`) → MIN_DAMAGE_FLOOR`. Returns both the final
  `damage` and a full `breakdown` object (every intermediate value), which now
  rides along on `COMBAT_EVENT.DAMAGE_DEALT`/`BUILDING_DAMAGED` payloads for
  the future Battle Report/Replay System to explain a hit without
  recomputing it.
- **Modularity for future skills/technology** — both units and structures can
  carry a `modifiers` array (`{ stage, kind: 'multiplier'|'flat', value }`,
  plus an `armor_penetration` stage). `damageEngine.js` applies them at three
  fixed pipeline stages (`base_attack`, `pre_mitigation`, `post_mitigation`)
  without knowing what produced them — a future buff/debuff/tech system adds
  entries to this array; it never edits `damageEngine.js` or
  `combatEngine.js`.
- **Balance changes belong in `damage.config.js` only** — counters, mitigation
  profiles, the mitigation scaling constant, and the structure damage-type
  modifiers are all plain data there; `damageEngine.js` and `combatEngine.js`
  never hardcode a balance number.

## What's in this step (Modifier System)

`engines/modifierSystem.js` is a new, fully generic module for temporary and
permanent combat modifiers — commander buffs, technology bonuses, alliance
buffs, equipment, or temporary skills. **The Combat Engine does not know
about any of those callers individually** — it only ever sees a `source`
string and a flat `{ id, source, type, value, duration_ticks, remaining_ticks,
stackable }` record, and re-exports everything from `combatEngine.js` so
existing consumers keep a single import.

- **Built-in modifier types (`MODIFIER_TYPE.*`)** — `attack_bonus`,
  `defense_bonus`, `damage_reduction`, `movement_penalty`, `morale_bonus`.
  The list isn't closed — any external system can pass another `type` string
  and the store/lifecycle APIs work identically; only the two types that feed
  the damage pipeline (`attack_bonus`, `defense_bonus`, `damage_reduction`)
  are actually consumed by `combatEngine.js` today. `movement_penalty` and
  `morale_bonus` are tracked and queryable but deliberately **not** applied by
  the Combat Engine itself — movement stays Simulation Engine's job and
  morale has no combat formula yet; a future system reads them directly via
  `getAggregatedValue(targetId, type)`.
- **Required fields per modifier (Requirement 3)** — every modifier gets a
  unique `id` (auto-generated if not supplied), a `source` (who granted it —
  any string, e.g. `commander:khalid`, `tech:blacksmithing`,
  `alliance:iron_pact`, `equipment:tower_shield`, `skill:battle_cry`), a
  `type`, a numeric `value`, `duration_ticks` (`null` = permanent until
  explicitly removed), a `remaining_ticks` counter that starts equal to
  `duration_ticks`, and `stackable` (defaults to `true`).
- **Multiple simultaneous modifiers (Requirement 4)** — any number of
  modifiers from any number of sources can be active on the same unit or
  structure at once; `getActiveModifiers(targetId, type?)` returns every raw
  record still in effect.
- **Configurable stacking rules (Requirement 4)** — `STACKING_MODE.*`:
  `stack` (values sum — the default for `attack_bonus`/`defense_bonus`/
  `morale_bonus`), `highest_only` (only the strongest value counts, but
  weaker ones stay registered in case the strongest expires — the default
  for `damage_reduction`/`movement_penalty`), `latest_only` (newest modifier
  of that type replaces any older one outright), and `unique_per_source`
  (a given source can only have one active effect of a type; a new one from
  the *same* source replaces its own old one, but different sources still
  stack). Defaults live in `DEFAULT_STACKING_RULES` and can be overridden per
  type via `configureModifierStacking(type, mode)`, or per-modifier via
  `stackable: false` (which forces a same-source replace regardless of the
  type's configured mode). `getAggregatedValue(targetId, type)` is the single
  place this rule is actually applied — callers never re-implement it.
- **Automatic expiration (Requirement 5)** — `updateModifiers(ticksElapsed)`
  decrements `remaining_ticks` on every temporary modifier and removes (and
  emits `MODIFIER_EVENT.EXPIRED` for) any that reach zero. `CombatEngine`
  calls this once per `TICK_COMPLETED`, independently of standing orders, so
  a buff on an idle unit still expires on schedule. Permanent modifiers
  (`duration_ticks: null`) are untouched until `removeModifier()` is called
  explicitly. A unit's/structure's modifiers are also cleared in bulk the
  moment it dies or is destroyed.
- **Exposed APIs (Requirement 6)**, all on both `ModifierStore` directly and
  as pass-through methods on `CombatEngine`: `addModifier(targetId, modifier)`,
  `removeModifier(targetId, modifierId)`, `removeModifiersBySource(source,
  targetId?)`, `getActiveModifiers(targetId, type?)`,
  `getAggregatedModifierValue(targetId, type)`, and
  `updateModifiers(ticksElapsed)`.
- **Damage pipeline integration** — `applyModifiersToAttacker`/
  `applyModifiersToTarget` build an *effective* attacker/target snapshot
  (aggregated `attack_bonus` added to `stats.attack`, `defense_bonus` added
  to defense, `damage_reduction` folded in as a `post_mitigation` multiplier
  using the same `{ stage, kind, value }` shape `damageEngine.js` already
  understood) right before `_resolveOrder` calls `computeDamagePipeline` —
  `damageEngine.js` itself needed zero changes.
- **Optional events** — if a `ModifierStore` is given an `eventBus` (Combat
  Engine passes its own), `MODIFIER_EVENT.ADDED`/`REMOVED`/`EXPIRED` publish
  on it, so any other system (Simulation Engine for movement penalties, a UI
  buff tracker, Battle Report) can subscribe without knowing anything about
  modifier storage internals.

## What's in this step (Casualty Tracking + Morale System)

- **Casualty tracking** — every registered combat unit now represents a
  *troop group* of `troop_count` individual troops (default `1`, so any
  existing caller that doesn't pass it behaves exactly as before). At
  registration, `hp_per_troop = stats.hp / troop_count` is fixed once; every
  `applyDamage()` call derives `troops_killed`/`troops_wounded`/
  `troops_remaining` from the hp lost in that hit against that fixed
  per-troop value (a deliberately simple model — all troops in one group are
  treated as equal, there's no per-soldier tracking). `CombatEngine.
  getCasualties(unitId)` exposes the running totals; `COMBAT_EVENT.
  CASUALTY_UPDATED` publishes on the combat log/event bus whenever a hit
  actually changes them (not on every hit that deals 0 casualties).
- **`engines/moraleSystem.js`** is a new, fully generic, standalone module
  (same philosophy as `modifierSystem.js`) that tracks a single morale value
  per target with a configurable minimum/maximum (`MoraleStore` constructor
  options `min`/`max`/`initial`/`rules`, defaulting to `DEFAULT_MORALE_MIN`/
  `DEFAULT_MORALE_MAX`/`DEFAULT_MORALE_INITIAL`/`DEFAULT_MORALE_RULES`). It
  knows nothing about Combat/Simulation/AI/Replay/Frontend.
- **Four supported change reasons (`MORALE_CHANGE_REASON.*`)**, each a thin
  convenience method over one shared, clamped `applyDelta()`:
  `heavy_losses` (penalty proportional to the fraction of the group's troops
  killed in that hit), `commander_death` (flat penalty applied to every
  still-alive allied unit the instant a `commander: true` unit dies —
  the dead commander itself is dropped from morale tracking),
  `successful_attack` (flat bonus to the attacker on any hit that deals
  damage), and `nearby_allies` (bonus per living ally within
  `nearbyAlliesRadius`, recomputed once per `TICK_COMPLETED` for every alive
  unit, capped at `nearby_allies_max_counted` allies).
- **The Combat Engine only calculates and exposes morale** — `getMorale(id)`,
  `getAllMorale()`, and `getMoraleConfig()` are read-only; there is no branch
  anywhere that changes behavior based on a morale value. Any tactical
  decision (retreat, surrender, rally) is left entirely to whatever consumes
  these numbers later (Rule Engine, AI) — by design, not yet implemented here.
- **Events** — `COMBAT_EVENT.MORALE_CHANGED` publishes on the same combat
  log/event bus as `DAMAGE_DEALT`/`UNIT_KILLED` (not directly from
  `MoraleStore`, which stays event-bus-agnostic by default) whenever a
  change actually moves the clamped value — a delta that would push past an
  already-saturated min/max produces no event.

## What's in this step (Combat Engine finalization — Statistics + Final Events)

- **`engines/statisticsSystem.js`** is a new, fully generic, standalone
  module (same philosophy as `moraleSystem.js`/`modifierSystem.js`) that
  aggregates live battle statistics: `total_damage`, `units_killed`,
  `units_lost`, `buildings_destroyed`, `damage_by_type`, `damage_by_unit`.
  It has no knowledge of Combat/Simulation/Replay/Frontend, no event-bus
  dependency, and is deterministic (same recorded inputs → same
  `getStatistics()` output every time). `units_killed`/`units_lost`/
  `buildings_destroyed` are each reported as `{ total, by_owner }` — grouped
  by whatever free-form `owner` string the combatant/structure was
  registered with, so the same tracker works for any number of sides (not
  just a hardcoded attacker/defender pair).
- **Continuous updates (Requirement 1)** — `CombatEngine` calls
  `recordDamage()` at the exact same moment it publishes
  `COMBAT_EVENT.DAMAGE_DEALT` (both for unit and structure targets — same
  pipeline, no special-casing), `recordUnitKilled()` at the same moment as
  `UNIT_KILLED`, and `recordBuildingDestroyed()` at the same moment as the
  new `BUILDING_DESTROYED` (below) — so `engine.getStatistics()` always
  reflects the live state of the battle, not just a snapshot computed at the
  end. `CombatEngine.getStatistics()` exposes the current totals; nothing
  else (Rule Engine, Replay System, Battle Report) needs to replay the
  combat log itself just to get a running total.
- **Two new final combat events (Requirement 2)** — added to
  `COMBAT_EVENT.*` alongside the existing `DAMAGE_DEALT`/`UNIT_KILLED`/
  `BUILDING_DAMAGED`/`CASUALTY_UPDATED`/`MORALE_CHANGED`:
  - `BUILDING_DESTROYED` — publishes exactly once, the instant a structure's
    `hp` reaches zero (`result.destroyed`), distinct from `BUILDING_DAMAGED`
    (which fires on every landed hit, destroyed or not). Building
    Interaction/Replay System/Battle Report can subscribe to this directly
    instead of filtering `BUILDING_DAMAGED` payloads for `destroyed: true`
    themselves.
  - `COMMANDER_DEFEATED` — publishes exactly once, immediately after
    `UNIT_KILLED`, only when the unit that died was registered with
    `commander: true`. It's additive, not a replacement for `UNIT_KILLED` —
    a consumer that only cares about commanders can subscribe to this one
    event instead of checking `commander` on every kill itself.
- **No new tactical/strategic logic** — same boundary as everything else in
  this file: statistics are computed and exposed only (`getStatistics()`),
  and the two new events are pure notifications of something that already
  happened (a structure hit zero hp, a commander unit died) — nothing here
  decides *when* to attack a building or *whether* losing a commander should
  change behavior. That stays entirely with Rule Engine / a future AI.
- **Scope respected** — this step touches `engines/combatEngine.js` and adds
  `engines/statisticsSystem.js` only. `engines/buildingInteraction.js`,
  `engines/replaySystem.js`, and `engines/battleReport.js` are untouched and
  still throw `"لسه مش متنفذ"` — Requirement 2 explicitly says these new
  events are meant to be *consumed later* by Rule Engine, Replay System, and
  Battle Report, not that those systems are implemented here.



`castle/march.service.js` calls `battleService.createBattleFromAttack(...)`
right after a new attack march is created — this is "create a Battle Instance
whenever an attack starts." The call is wrapped in try/catch so a failure to
record the battle foundation never blocks the existing march flow. The
legacy `resolveAttackArrival` combat math in `march.service.js` is left
untouched for now; it will be replaced by the Combat/Rule/Simulation Engines
in a later step.

## API

All routes require `protect` (Bearer token) and are mounted at `/api/battles`.

| Method | Path                      | Description                                   |
|--------|---------------------------|------------------------------------------------|
| GET    | `/api/battles`            | List battles for the current user (`?role=attacker\|defender`, `?status=`) |
| POST   | `/api/battles`            | Create a battle directly (`defenderCastleId`, `troops[]`, optional `commanders`, `formation`, `battlePlan`, `battleMode`) — a standalone/testing path, **not** used by the real march-attack flow (see below) |
| GET    | `/api/battles/by-march/:marchId` | Look up the battle already created for a given `march_id` (returns `{ battle: null }` if none exists yet). This is the **only** way the frontend recovers a march's battle — it never creates one itself, so a page refresh never loses the mapping. |
| GET    | `/api/battles/:battleId`  | Load one battle (must be attacker, defender, or admin) |
| POST   | `/api/battles/:battleId/start` | Start the battle's Simulation/Rule/Combat Engines (idempotent — safe to call more than once for the same battle). This is the entry point the frontend calls once a march arrives. |
| POST   | `/api/battles/:battleId/status` | Transition status (`{ status: 'ready' }`) |
| POST   | `/api/battles/:battleId/state`  | Update `current_state`/`current_tick` (plumbing for the future Simulation Engine) |
| POST   | `/api/battles/:battleId/cancel` | Cancel a battle that hasn't started yet |

### One Battle per attack march (frontend integration note)

`march.service.js` is the **only** place a `Battle` is created for a real
attack march — it calls `battleService.createBattleFromAttack(...)` right
after the march itself is created, and that call sets `march_id` on the
resulting `Battle` document. The frontend never calls `POST /api/battles`
for a real march; it only ever *recovers* the already-created battle via
`GET /api/battles/by-march/:marchId` (see `frontend/src/pages/WorldMapPage.jsx`,
`resolveBattleForMarch`). This guarantees exactly one `Battle` document per
attack march. `POST /api/battles` still exists as a direct/testing path
(e.g. for creating a battle without going through the march system at all),
but it is intentionally disconnected from the march-arrival flow.

### Statistics — single source

The frontend (`BattleModal.jsx`) reads live battle statistics from
`current_state.statistics` only — the object produced by
`CombatStatisticsTracker` (`engines/statisticsSystem.js`) and written into
`current_state` by `battle.runner.summarizeEngines()`. The `statistics`
field on the `Battle` document itself (`battle.model.js`'s `statisticsSchema`)
uses different, incompatible field shapes (e.g. `buildings_destroyed` as a
plain `Number` instead of `{ total, by_owner }`) and is not read by the
frontend as a fallback — treating the two as interchangeable was a real bug,
now removed. Once `Battle Report` (`engines/battleReport.js`) is actually
implemented, it should be the one place that reconciles/rolls the live
`current_state.statistics` into the persisted `statistics` field — that step
is still future work and is *not* implemented here.

### Structures (walls/towers/gates/buildings) — currently always empty

`current_state.structures` will be an empty array in every battle today,
by design, not by omission: `battle.snapshot.service.buildDefenderSnapshot`
always returns `walls: []`, `towers: []`, `gates: []`, and `buildings` with
`hp: null`, because `castle.model` has no real fortification/building-HP
system yet. `battle.runner.buildStructuresFromSnapshot` correctly refuses to
register anything without a real numeric `hp`, so nothing ever reaches the
Combat Engine's `StructureStore`. The frontend renders whatever
`current_state.structures` contains and nothing else — it does not invent
placeholder walls, towers, or gates. This will start populating naturally,
with no frontend changes required, once a real fortification/building-HP
system exists on the `Castle` side.

`battle.service.js` itself is still pure lifecycle/state management — no
combat is computed there. `engines/simulationEngine.js` (tick loop, state
machine, timeline, action queue, unit state, event bus, replay recording),
`engines/ruleEngine.js` (condition evaluation + action publishing over the
player's own plan — not an AI), and `engines/combatEngine.js` (combat
resolution: target selection, range checking, damage, casualties, morale,
live statistics, and the full `COMBAT_EVENT.*` set — `DAMAGE_DEALT`,
`UNIT_KILLED`, `BUILDING_DAMAGED`, `BUILDING_DESTROYED`, `CASUALTY_UPDATED`,
`MORALE_CHANGED`, `COMMANDER_DEFEATED`) are now all implemented.
`engines/buildingInteraction.js`, `engines/replaySystem.js`, and
`engines/battleReport.js` still throw `"لسه مش متنفذ"` ("not implemented
yet") if called, by design — Building Interaction in particular is meant to
consume `COMBAT_EVENT.BUILDING_DAMAGED`/`BUILDING_DESTROYED` from the Combat
Engine once it's built, not duplicate its damage math.
