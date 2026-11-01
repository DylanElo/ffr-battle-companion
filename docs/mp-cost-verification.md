# Native MP cost verification

Read-only static tracing of the installed executable using the existing `artifacts/calibration-timing/probe.py` PE/Capstone tool. No game calls, injection, process writes or save changes were used. The fixture in `tests/fixtures/mp-cost-native.json` records native arithmetic deductions, not observed combat measurements.

## Cost arithmetic and cancellation

Native skill cost `0x145149D10` loads the raw cost at skill-data `+0x88`. `0x1452388E0` visits live continuous effects and multiplies the factors returned through virtual slot `+0x468` in their stored order (`mulss` at `0x145238963`). CostVariation's implementation is `0x145115270`, vtable `0x148698048`.

Its percentage factor is float32(float32(p1 * float32(0.01)) + 2^-23), at `0x1451153FD–0x145115414`. Multiplication between factors and the raw cost uses float32. Raw zero stays zero; otherwise the final float is clamped to at least 1 and truncated toward zero (`0x145149DEC–0x145149E09`). Existing `NativeDamage.skillMpCost` implements this arithmetic.

IgnoreCostChange is a precise ID filter. Factory type 136 at `0x14513EB18` reaches reflected class getter `0x144DC5C80`, constructor `0x144DC7520`, and vtable `0x1486B26C0`. Its slot `+0x5C8` is the leaf `0x145122C80`, which compares the queried effect ID to its first parameter. CostVariation first queries `0x145243110`, which visits this slot on live effects, at `0x14511529D`. A match returns neutral factor 1 before all remaining cost filters.

Consequently Unlock Magic's effect 64000, `[61004, ...]`, cancels effect 61004 specifically. It does not cancel Half MP's 61011, Reckless Abandonment's 61003, or the older CostVariation effect 1228. Effect 1228 is an effect ID, not a passive ID.

## Verified CostVariation parameter gates

| Parameter | Native behavior |
| --- | --- |
| p0 | Matches resource type; ordinary MP caller supplies 2. |
| p1 | Percentage factor, using the arithmetic above. |
| p2 | 0 is unrestricted; otherwise matches skill attribute. Native enum records identify Magic as 4 and MagicSword as 15. |
| p3 | Minimum current LB points. The comparison uses unit parameter `+0x118`; reflected GetLimitBurstPoint `0x144EC1DF0–0x144EC1E0E` independently reads that field. |
| p4 | -1 is unrestricted; otherwise matches current command ID at battle state `+0x430`, when that state exists. The helper requires explicit command context for a restricted row. |
| p5 | -1 is unrestricted; otherwise the native selected-command boolean must be true. |
| p6 | 0 is unrestricted; otherwise matches damage type, Physic 1 or Magic 2. |
| p7 | -1 is unrestricted; 0 invokes offensive HP-action filtering; 1 invokes recovery HP-action filtering (`0x14513BAB0–0x14513BB9B`). |
| p8 | When 1, requires native target type Group/Spread/All (2–4), or the selected-command boolean. Target helper is `0x14514E6D0–0x14514E70C`. |

The arithmetic helper handles native layout rows including 61000, 61001, 61003, 61004, 61006, 61007, 61009 and 61011. Missing required context or unsupported conditions are returned in `deferred`; no multiplier is guessed.

The selected-command boolean travels from command-tree node `+0x50` (`0x1451653B2`) to flattened record `+0x29` (`0x145165405`), through dispatcher `0x144F4B66C–0x144F4B670` and factory `0x144F40F57–0x144F40F5E` to action `+0x37C`. Payment reads it at `0x144F4757A` and passes it through `0x14513BEA0` to `0x145149D10`. Fresh-menu affordability supplies a corresponding incoming flag at `0x144F458EC`.

The node field is reflected as `bIsAllTarget`: property record `0x14861D920`, name `0x14861DAA0`, setter `0x144CB09D0` writes byte `+0x50`. A true flag causes the tree builder to replace the skill ID with the skill-data `+0xC0` variant (`0x14515A2D5–0x14515A301`); this is an explicit target-conversion request, rather than a test of an ordinary spell's natural target type.

Fresh-node false initialization is independently proved by BtlCmdNode StructParams `0x149B3E940`, operations factory `0x144D84790`, and operations vtable `0x14861D998`. Its constructor slots `+0x10/+0x18` point to `0x144D847D0`, which clears the node's byte `+0x50` at `0x144D847F4`. The reflected struct size is `0x68`. Missing-node paths also clear it at `0x145171BA8` and `0x14517733D`.

The final UI toggle setter-to-selected-node path remains outside this audit. The cost flag must not be inferred from a natural Group/All target or equated to skill-data `isApplyAllMag` merely because both concern area spells. `CompanionMpCosts` requires explicit `context.areaEffect` and reports missing context. An optimizer recipe explicitly representing an ordinary, unconverted command supplies false; a future explicit all-target-conversion recipe must supply true. Damage spread and area-cost applicability are separate evidence boundaries.

## ActionBegin recovery and fresh selection

The ordinary manual command task entry `0x144FB6610` calls `0x144FA8010` at `0x144FB6643`. With its special-action flag clear, ActionBegin event 2 is applied and proceeded at `0x144FA819C–0x144FA81C5`.

Only afterward does the entry invoke `0x144FAF6E0` at `0x144FB67EC`. That function emits `Delegate.Battle.Cmd.Begin` (literal at `0x148941D28`) at `0x144FAF891`. Ordinary ActionBegin effects thus precede opening fresh manual command selection, whose affordability path invokes `0x144F59C60` at `0x144F458FA`. Runtime payment later occurs before each child's separate SkillBegin event, as documented in [command verification](command-verification.md).

This proves ordinary manual ordering. Additional/Finish and special flags do not acquire an invented extra ActionBegin. Dead, incapacitated and otherwise skipped actors require their existing native eligibility guards; this trace does not establish a new regeneration entitlement for skipped actions.

## Modeled scope and remaining command context

The battle model uses this cost helper for fresh affordability and actual paid steps. Magic Barrage dynamically prices the first selected spell in each four-copy branch; its other copies remain payment-suppressed. Supported modifiers multiply, and Unlock Magic does not cancel Reckless Abandonment's distinct 61003 effect. HP-cost overrides retain their separate payment rules.

Black Demon's 61000 requires both at least 50 raw LB points and command 123. The current-command value is not derived from an equipped Resonance or a unique `skill.commandIds` entry. Exported `commandIds` are native `belongCommandList` membership (`prepare_catalog.py`), whereas the action factory can replace an incoming command through dynamic accessibility checks at `0x144F40D9F–0x144F40E03`. Action command `+0x33C` is copied to unit parameter `+0x430` at `0x144F6532F`; payment occurs earlier at `0x144F6519B`. Without explicit verified runtime command context, 61000 remains deferred. Neither a missing context nor another unsupported cost condition silently grants a discount.
