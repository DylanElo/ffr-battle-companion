# Forms, Focus and reaction verification — 27 October 2026

Current Goal: support stateful commands using the installed executable's event ordering and effect rules.

Latest Decision: treat Focus as an ordinary-actor-action effect, Witching Hour as a reversible parent/child form state, and reactions as conditional incoming-event responses. Do not credit counterattacks without their trigger.

Reference executable SHA-256: `B8C588E46EBADBE37FECA7BDF2DA0AE63A8538099D14A53EC0C2241B086E5FFA`. This audit used read-only disassembly, native enum tables and current catalog rows. The [sanitized state fixture](../tests/fixtures/native-state-actions.json) contains source rows, addresses and derived event vectors. It is not a battle recording.

## Focus lasts across nested selections

Focus (400460, 0 MP, 10 AP) installs two separate effects after its own calculation:

| Effect | Contribution | Lifetime |
| --- | --- | --- |
| 12907 | +100 percentage points in the additive damage bucket | 2 ordinary ActionBegin events |
| 1382 | -40% of the native Agility basis per instance | 2 BeginTurn events |

The native enum table at `0x148842AA0` distinguishes **ActionBegin = 2** from **ActionBeginWithEx = 3**, BeginTurn = 7, SkillBegin = 17 and SkillEnd = 18. Earlier timing notes cited the action-order preview's event 3 as ActionBegin; that label and its evidentiary scope need this correction.

The actual action entry `0x144FB6610` calls `0x144FA8010` at `0x144FB6643`. With its special-action flag `owner+AB` clear, the selected actor receives ordinary ActionBegin apply/proceed at `0x144FA819C–0x144FA81C5`. It then receives ActionBeginWithEx apply at `0x144FA81CB–0x144FA81DB` and proceed at `0x144FA82BA–0x144FA82CD`. The special flag bypasses event 2, not event 3. These actor-action events are distinct from each selected child's SkillBegin/SkillEnd.

Consequently, Focus added inside an ordinary Arms sequence is not consumed by each nested attack. All later children in that same actor action can see its damage effect. On the next ordinary action its damage lifetime advances from 2 to 1; on the following one it expires at 0. An intervening Limit Burst uses the active effect if it has not expired.

The order-preview function `0x144FB40A1` is not the proof of actual consumption: it restores action counters at `0x144FB436C–0x144FB4382` and restores effect state through `0x145235F00` at `0x144FB438F`.

### Recasting Focus has two different policies

Both effects have status None and go through same-ID/source handler `0x145249D40`. ID/source matching occurs at `0x145249DBD–0x145249DD4`. The duplicate exception at `0x145249E23–0x145249E7B` requires **both** an allowed effect type and an allowed apply timing.

- 12907 is DamageMultiplier with DamageCalculation timing. The type is allowed but the timing is not. Its previous matching instance is removed at `0x145249EA1–0x145249EBF`, then a fresh instance is installed. Recasting does not accumulate +200% damage.
- 1382 is ParameterContinuousVariation with apply timing None. Both are allowed. A new speed instance can coexist with an older one until each expires.

With one ordinary action per global turn and Focus recast every turn, the next turn's priority sees one surviving -40% speed instance. Recasting temporarily gives two speed instances during that actor's action; the older one expires at the next BeginTurn. An extra-action or mid-round scheduler must preserve those independent lifetimes rather than multiply current Agility by 0.6 repeatedly.

## Witching Hour is a reversible form

Witching Hour (408090) costs 8 MP and installs DemonForm effect 19015 indefinitely. End Witching Hour (408150) costs 0 MP and installs CancelDemonForm 19016.

Native effect enum 144 selects the DemonForm factory at `0x14513EE28`, class `0x144DC0030`, vtable `0x14869F1A8`. Its AddEffect override `0x1451388F0` reads parameter 0, adds child effect **16603**, and stores the child pointer at +B8. Its remove override `0x145141A80` removes that stored child through `0x1452493B0`. Cancel handler `0x1451384E0` removes active effects of type 144 through `0x145249500`; the parent removal cleans up the stat child.

The native lock jump table `0x144F45E94` maps DemonForm lock 4 to `0x144F45DA5` and NormalForm lock 5 to `0x144F45DB9`. They test DemonForm status 50 at `0x144F45DB5`/`0x144F45DC9`, with the NormalForm branch inverted. Activating while already transformed is forbidden; cancellation while normal is forbidden. A sequence must update this state before validating its later children.

### The stat bonus is primary stats, not every displayed bar

Child 16603 is AllParamUp with parameter 150. Handler `0x1451450A0` accepts native parameters **5–9 only**: STR, STA, INT, SPR and Agility. HP, MP, Divine and AP are not directly multiplied. Derived ATK/DEF/MAG/MDEF must be recomputed from those primary stats.

Its contribution is recovered float32 arithmetic:

```
delta = f32(f32(f32(base) * f32(f32(150 * 0.01) + EPS)) - f32(base))
```

The basis getter is `0x145238350`. `0x14523E150` truncates **each individual effect's** float result to an integer at `0x14523E1A6`, then adds that integer at `0x14523E1AA`. Two 150% contributions on an odd basis 7 therefore add 3 and 3, giving 13, rather than compounding to 15 or rounding the combined halves to 14.

### Healing restrictions are real

DemonForm parameter 1 names **1165 as a blocked effect**, not an extra Regen to install. Getter `0x14514EAF0` checks this effect ID. Getter `0x14514FEF0` checks the incoming skill against General.whiteMagicSkills. The recovery path invokes the target's effect getter at `0x1452347EA`; a true result zeroes healing at `0x1452347FF`.

This is a restriction on the healing recipient. A transformed caster can still heal other eligible allies and can satisfy a party healer role. White healing directed at the transformed unit restores zero; this does not remove all healing or all skill effects.

## Moiety's Mirror needs an incoming damage event

Moiety's Mirror (400790) installs Counter effects 30022/30023 and damage reduction 16143, each lasting one BeginTurn. It selects a physical and magical counter skill. The wrapper's 0 MP does not make the selected counter skills free.

Counter activation is context-dependent. `0x145122DD0` checks incoming skill, relation, immunity/suppression and reaction flags. Its parameter 0 value 20 is native **eSkillEffectActivationCondition::ReceiveDamage**, from table `0x14883F500`. Handler `0x14514FE27–0x14514FE62` searches actual incoming result records (stride 0x70), matches the affected unit at `0x14514FE40–0x14514FE4B`, and accepts the relevant result byte +19 values 1 or 3. Unrelated, absent or nonmatching records do not trigger it.

Counter effect parameter 6 values 1 and 2 select the corresponding stored counter skill from unit +510/+518 at `0x145107D73–0x145107E1E`. The created action is marked as a reaction at `0x145107FDA` (action+379) and queued at `0x1451080B1`. The activation function also rejects a dead source at `0x14514F74E–0x14514F77C` unless the HadDead exception is set. Moiety uses ReceiveDamage, not HadDead, so an incoming knockout does not grant its ordinary counters. The incoming reaction flag is separately tested at `0x145122E7A–0x145122E8A`, preventing ordinary recursive counter chains unless an explicit exception permits them.

For ordinary party reactions, packed payment-suppression byte action+329 remains false in the packet initialized at `0x14510808B–0x1451080A2`. Runtime payment skips only when that byte is true (`0x144F4748A–0x144F47491`). A selected reaction skill therefore retains its own cost unless a separately verified override applies.

Each queued response also checks whether its source is still alive. The check at `0x144F4661E–0x144F4662F` permits a dead source only when action+37A is set. Counter construction copies that byte from effect+B9 at `0x145107FC2–0x145107FCA`; Moiety's ReceiveDamage condition has no HadDead exception. If the first selected response spends enough HP to knock out its caster, the second queued response fails this check. The reaction marker +379 does not bypass it.

The cooked physical TwinCounter list rejects Jump (400240), Limit Burst attribute 5, non-damage skills and non-physical damage. The magical list rejects Limit Burst attribute 5, non-damage skills and non-magical damage. These are damage-type selectors: a physical spell can satisfy the physical branch, and a magical ability can satisfy the magical branch. Their Blueprint `CheckAdd` functions contain no cost exemption. Combined MP reservation during initial UI selection remains distinct from the verified runtime payment; an initially underfunded pair must not be called selectable on this evidence alone.

The builder's default scenario omits enemy actions and targeting. There is no honest guaranteed counter damage to award in that scenario. A conditional reaction plan can report its selected responses and requirements; numerical reaction forecasts need explicit incoming events, their targets and resource payments. Multiple-hit trigger multiplicity and bespoke enemy scripts are not inferred from the wrapper description.

Implemented: paid form/Focus phases, live resource transitions and controlled incoming events. Incoming damage defaults to zero; the optional scenario specifies one fixed post-defense hit on each character after its action each round. Counter recommendations require enough current MP for the whole response pair at each fresh stance, while subsequent runtime payments and source survival are checked individually. This conservative selection rule does not assert that an underfunded pair is forbidden by the native menu.

Known limits: no live battle recording, no general enemy AI/target-selection model, and no blanket proof of arbitrary interrupt or extra-action scripts. No source save, executable or live game process was modified.

### Counter payment rechecks differ from ordinary queues

For party-controlled counters, factory `0x145108075` sees unit type 1, then `0x145108092` writes that value to packed byte +4A; `0x145108096–0x1451080A2` copies the packet into action+328. Counter action+32A is therefore 1, enabling `0x144F59C60` through `0x144F465D2–0x144F465F7`. The MP branch rejects current MP below the required cost at `0x144F59D98`. The HP-ratio branch rejects only when cost fraction exceeds the current HP ratio at `0x144F59E3F`; equality passes. These counters can skip an underfunded later response even though ordinary already-queued commands with +32A=0 bypass that optional checker.
