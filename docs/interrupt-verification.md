# Interrupts, committed actions and conditional combat effects

This is a bounded read-only audit of the installed executable, SHA-256 `B8C588E46EBADBE37FECA7BDF2DA0AE63A8538099D14A53EC0C2241B086E5FFA`. It distinguishes an action rejected before initialization from an already committed skill and from an alternate finalization callback. It does not claim that every enemy script or animation interruption has been reproduced. The supporting disassembly and derived vectors are retained locally under `artifacts/interrupt-native/`.

## Rejection before commitment

Ordinary skill initializer `0x144F65040` calls precheck `0x144F464E0` at `0x144F6509B`. Failure branches through `0x144F650A4–0x144F650AE`, runs source/timeline cleanup `0x144F5E3F0`, and returns false. Payment at `0x144F6519B` and skill-task initialization at `0x144F65594` are later, on the success path.

| Check | Native condition |
| --- | --- |
| Skill/source/target existence | Skill row must exist; source count and target count must both be nonzero at `0x144F46512–0x144F46529`; the selected source object must be valid at `0x144F4652F–0x144F46550`. |
| General incapacitation | `0x144F46556–0x144F46586` calls `0x1452420D0`, except for action byte +3A9 or battle phase 2. The helper enumerates current statuses, reads each status-detail row, and returns true when its `isActionDisabled` byte +15 is true (`0x145242128–0x14524212C`). A menu-specific restriction such as Overheat is not automatically general incapacitation. |
| Reaction prohibition | Reaction actions (+379) query effect-based suppression through `0x145243300` at `0x144F465AA`; the getter receives the action's +37A exception flag. |
| Current affordability | Party actions run `0x144F59C60` only when action+32A is true (`0x144F465CE–0x144F465FE`). Do not impose this optional check on every committed child, or remove it from checked reactions. |
| Dead source | Unless the native skill-row byte +F9 permits the exception, a dead source is rejected unless action+37A is true (`0x144F46604–0x144F4662F`). The reaction marker +379 by itself is no exception. |
| Living target requirement | For an applicable skill-row flag +86, outside battle phase 1, at least one selected target must survive the target loop (`0x144F46631–0x144F4667F`). Target object identity and current life state matter. |

These flags are not interchangeable. In particular, ordinary party counter packets set +32A=1 while keeping payment suppression +329 false (`0x145108075–0x1451080A2`). A later underfunded response is rejected. Unchecked ordinary nested commands can instead reach the native clamped payment path, as documented in [HP cost verification](hp-cost-verification.md).

After payment the skill-task initializer emits SkillBegin 17 at `0x144F82843–0x144F82863`. There is no second source-dead check between payment and that task creation. Therefore an ordinary HP-cost skill already committed at equality can finish at zero HP; a later queued skill performs its own precheck. This is not permission to bypass a genuinely triggered interrupt callback.

## Finalization and Boost lifetime

A rejected precheck has not reached task creation or its SkillBegin dispatch. Its cleanup function `0x144F5E3F0` checks whether another queued action still names the source (`0x144F579F0`), conditionally removes that source from the current actor collection through `0x144FC27E0`, and refreshes the timeline. The timeline broadcast is `Delegate.Battle.Timeline.Update` at `0x144F6BAD4`. This cleanup is not itself the SkillEnd lifetime dispatcher.

There is also a separate skill-job finalization callback at `0x144F41DA0`, installed in `CPP_BtlJobSkill` vtable `0x148642F00`, slot +2E8. It clears job+D1, marks job+60, invokes end bookkeeping, then calls `0x144F42300` only if job+3A8 is false; it finally sets +3A8 true. The ordinary updater uses the same guard at `0x144F6612F–0x144F6613A`. This establishes a distinct, guarded finalization route; the complete set of external interruption triggers and animation-notify callers is not established here.

The shared finalization routine handles SkillEnd 18 at `0x144F429AA–0x144F42A12`. Action+37E suppresses this block. Within it, +386 and a matching timing entry in action+280/+288 can separately suppress lifetime progression. These are explicit native exceptions, not grounds to globally exclude nested Boost combinations.

For an ordinary command that reaches this finalization with the usual flags, Magic Boost's damage effect advances at SkillEnd even if subsequent damage callbacks never arrive. Conversely, a leaf rejected before task creation must not be assigned an invented SkillBegin merely to expire its MP-cost effect. Which callback an arbitrary forced interruption takes remains a scenario-specific requirement. The normal successful nested sequence remains documented in [command verification](command-verification.md).

## Hit and Run is damage nullification, not an interrupt

Hit and Run (passive1334, effect19034) uses native effect `HitAndWay`, enum172. Factory `0x14513F8E0` selects class `0x144DC5740`, constructor `0x144DC7490`, vtable `0x1486B12C8`. Its event handler +658 is `0x145138F60`, and its +408 getter `0x144DC33A0` returns the stored byte +B8.

The handler resets that byte, makes its configured 35% native random check, and requires the current incoming skill's DamageType to be Physic (`0x14513904B`). It then scans the owner's committed-skill history +410/+418. A prior skill qualifies if its effect type is DamageAndRecovery (1) and parameter variation is Decrease (1) or RatioDecrease (3), checked at `0x145139100–0x14513911B`.

This history has concrete writers and lifetime. The skill initializer records its selected skill ID at `0x144F65316`, after payment and before task creation. Append helper `0x144FC4470` records it in the current-turn +410 array at `0x144FC44DA–0x144FC4503`. Global-turn transition archives the array and clears its count at `0x144FC29FD–0x144FC2A24`. A committed damaging skill can qualify even if it subsequently misses; a magical attack can qualify the history predicate. Merely planning an attack cannot.

The incoming task applies BeginDmgCalcWhenTargeted 16 before its damage-part loop (`0x144F7FB60–0x144F7FB7F`, loop begins `0x144F7FD1F`). Therefore the stored defensive roll is shared across that incoming selected skill's parts. It is not an independent 35% roll for each animation ratio.

During damage calculation, a true target effect +408 getter at `0x145232EEA` branches to `0x145232F0E`: HP damage becomes zero and the critical flag is cleared. This is not a failed accuracy roll or cancellation of the attack queue. Interaction with reactions should preserve the incoming result event instead of assuming that zero HP damage means no event existed.

## Pilebunker / Crusher uses current full LB

Pilebunker (passive1404, effect15150) uses native Crusher enum168. Factory `0x14513F758` selects class `0x144DBEEB0`, constructor `0x144DC28B0`, vtable `0x14869AEE8`. Its break modifier getter +540 is `0x145114310`.

The getter requires **current gauge +118 >= actual capacity +2A0** (`0x14511431D–0x145114329`), then the evaluated skill's native TargetType Single (row+7F=1) and DamageType Physic (row+7B=1). Capacity is computed from the maximum raw cost of the unit's known LB-cost skills by `0x145251F70`, with the maximum at `0x145252036–0x145252041` and store at `0x145252073`. It is not a hardcoded100 threshold: 100/200 is not full when capacity is200.

The getter has **no explicit LimitBurst attribute exclusion**. Ordinary positive-cost LBs spend gauge before calculation, which makes the current gauge fall below capacity; that payment is the reason they normally fail the condition. Do not replace this with an invented attribute ban.

It returns float32 `p0 * 0.01 + EPS`, with p0=50. Break calculation starts an outgoing multiplier at1 (`0x145232110`) and adds this contribution at `0x145232183–0x145232186`, then multiplies it into the break result at `0x14523226E`. Thus Crusher adds 50 percentage points to the outgoing break multiplier, **not 50 base BP**, and combines additively with that same bucket. Critical/element/level factors remain separate. Its lifetime is indefinite with proceed timing None, and its condition is queried against current state for each calculated part.

For the current bounded model, the only modeled within-leaf gauge gain is a newly caused stagger. Because Crusher requires a single target, later BP in that leaf is already zero after that stagger. Passing the actual current/capacity state at each leaf and after LB payment therefore preserves scored BP under those modeled gauge sources. Other on-hit gauge effects require their own supported event handling.

## Take Initiative needs the target's real action state

TakeInitiative effect12943 checks its actual current target vector, rejects more than one target and grants its +30% only when target counter +4E0 has not advanced (`0x1451465A6–0x14514660B`). The familiar preview increment at `0x144FB42A0` is subsequently restored and is not the complete runtime proof. Actual actor processing increments the current actor's counter at `0x144FAF929`, with the native `0x145242420` exception; generic phase increment helper `0x144FA6210` updates the selected counter at `0x144FA622C`.

This does not justify assuming that an enemy has or has not acted in a forecast that omits its actions. A skipped attack, zero damage or stagger does not by itself substitute for the native action-counter event.

## Recommended implementation boundary

The smallest proven additions are current-gauge Crusher and Hit and Run under one explicitly configured incoming physical skill event, using actual committed own-skill history. Preserve native source/target/status checks separately from optional affordability flags. Keep before-commit rejection separate from already-committed skill finalization and advance Boost lifetimes only at the proven event boundary.

General enemy AI, arbitrary extra-phase scripts, the external callers of the alternate finalization callback, and arbitrary interrupted animation-notify sequences remain unverified. No extra damage, extra turns or reactive trigger frequency should be invented for them.
