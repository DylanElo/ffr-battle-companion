# Gamble Shot verification

Scope: native Gamble Shot 406060 and its CritOrMiss effect 13201. This is read-only executable/cooked-data verification, with an isolated copied-instruction comparison test. No game was opened or modified. Executable SHA-256: `b8c588e46ebadbe37feca7bdf2da0ae63a8538099d14a53ec0c2241b086e5ffa`.

## The shared Gamble roll

Effect type CritOrMiss is native enum 105. Factory `0x14513E060` resolves class `0x144DBECF0`, constructor `0x144DC2850` and vtable `0x14869A840`. Its BeginDmgCalc handler is virtual +658, `0x145109B00`. Current effect 13201 has parameters `[50, 1, 10]` and lifetime one DamageCalcEnd.

For an ordinary fresh, unstaggered target, the handler computes:

```
T = 50 + accuracyBonusFromOtherAttackerEffects + 10 * currentGoodLuck
R = 1 + min(99, trunc(f32(f32(rand() & 32767) * f32(100 / 32767))))
gambleSucceeded = R <= T
```

The exact float constant at `0x14788BC70` has little-endian bits `90 01 48 3b`. The instructions are `0x145109C6B–0x145109C9A`. Parameter1 being anything other than -1 enables the Good Luck term; its numeric value is not an additional multiplier. Parameter2 supplies the per-stack increment.

The other-effect accuracy sum at `0x145236E50` explicitly excludes this CritOrMiss instance and calls each remaining effect's virtual +3D0. AccuracyVariation enum 21 resolves through `0x14513C658 → 0x144DC0DE0 → 0x144DC1F40`, vtable `0x1486860A8`; its +3D0 getter `0x144DC3020` returns raw parameter0. Thus -20 accuracy lowers the Gamble threshold by 20, while the game's +10000 guaranteed-hit accuracy effect makes this initial roll succeed. Good Luck's separate +3 critical-rate points per stack do not enter this accuracy sum.

The result is stored in effect +B8. On success, getter `0x145115470` contributes `FLT_MAX` to the normal critical-rate sum, guaranteeing a critical when damage lands. On failure, getter `0x145111AD0` contributes -99999 to ordinary accuracy. With the current accuracy-effect magnitudes this forces a miss. This is a shared branch, not independent critical/miss choices for each displayed hit.

The selected task `0x144F7FAC0` emits source BeginDmgCalc event 14 once at `0x144F7FB1F–0x144F7FB2B`, before initializing its eight-part loop at `0x144F7FD17–0x144F7FD1F`. This establishes one shared Gamble draw per selection. The counter guard at `0x1451379F6` belongs to AddEffect timing 1 and is not proof of BeginDmgCalc multiplicity.

## Ordinary hit checks remain separate

Passing the Gamble roll does not remove normal target evasion. The ordinary hit kernel `0x145233AC0` evaluates this threshold for each damage ratio:

```
E = min(evasionLimit, sumOfTargetMatchingAvoidance)
A = clamp(skill.accuracy + sumOfAttackerAccuracyVariation - E, 0, 100)
H = trunc(f32(f32(A) * f32(f32(f32(100 - statusResistance) * f32(.01)) + 2^-23)))
hit = R <= H
```

The ordinary random roll uses the same integer mapping above, at `0x145233EC6–0x145233F14`. The current `evasionLimit` is 75. Skill accuracy is +94 in the native row; damage type is +7B. Target status resistance comes from `0x14523DAE0`, querying the target's virtual +320 resistance map with native skill statusCondition +9C. Gamble Shot has statusCondition None, so the ordinary neutral case supplies zero resistance. Do not substitute an unrelated elemental resistance.

Avoidance enum 64 resolves through `0x14513D35C → 0x144DC0460 → 0x144DC2450`, vtable `0x148691BF0`. Getter +4A8 (`0x145111A90`) returns raw parameter0 when parameter1 is zero or matches the actual damage type, otherwise zero. Physical is 1 and magic is 2. This validates using the physical-evasion total for Gamble Shot.

The selected skill has eight hit ratios. Native scheduler `0x144F7FAC0` loops the skill hitCount, and each DamageAndRecovery child (`0x144F7FF4E`, dispatch `0x144F8016D`) reaches `0x144F71520 → 0x145233AC0` once per selected target. Therefore a single-target Gamble Shot shares one Gamble outcome across eight ordinary hit checks. It does not receive eight independent chances to pass the initial Gamble roll.

## Luck is granted on an actual hit

The +5 effect 65006 is an AfterDamageCalculation Self bundle. Post-damage task `0x144F7F860` scans finished DamageAndRecovery children and dispatches that bundle only when at least one finished result is not a miss (`0x144F7FA02–0x144F7FA73`). The ordinary hit kernel's output miss byte +42 (`0x145233F14`) becomes result-record +5A through `0x144F7171C–0x144F71720` and result copy `0x144F6EC27–0x144F6EC2B`.

The five stacks are added once for the whole selection, capped at ten by the existing Good Luck setter. They are not added on each of the eight hits, on an all-miss selection, or merely for passing the shared Gamble check. They arrive after this selection's damage, so they do not improve its own initial roll.

With an unchanged ordinary per-ratio hit probability q, the chance to gain luck is `P(gamble success) * (1 - (1-q)^8)`. Preserve integer luck and sampled outcomes in a stateful sequence; replacing luck with its fractional expectation changes later thresholds and is not equivalent. Where target state changes between hits, evaluate the checks in their native order instead of using that shortcut.

## Native bypasses

The Gamble handler forces success without its random draw when any selected target is already staggered. `0x145109BD2` calls `0x1452421B0`, which queries active effects' +538; native Break enum 91 resolves to vtable `0x148692930`, whose +538 is the true-returning `0x140C8A800`. The ordinary hit kernel also bypasses a miss for an already-staggered receiver (`0x145233C4E–0x145233C58 → 0x145233F4B`). Do not spend random draws for these bypassed branches.

The Gamble handler also forces success if the battle controller's phase byte `[controller+40]+40` is nonzero (`0x145109BFE–0x145109C08`). This audit preserves that exact condition without assigning an unverified phase name. The ordinary kernel has additional nonstandard-skill and battle-context branches; the normal fresh-enemy calculation above does not claim to replace all of them.

## Verification and fixtures

`artifacts/gamble-native/verify.py` copies only scalar instructions `0x145109C71–0x145109C9A` into a local callable buffer, relocates their float constant, and compares them with the reference equation. It does not call the game, inject into a process, or invoke original game-object code. **1,081,344 comparisons passed**: all 32,768 possible 15-bit samples for 33 luck/accuracy thresholds. The fixture also records ordinary-hit golden cases and current cooked skill/effect rows.

With no other accuracy modifier, the exact success sample counts at luck 0 through 5 are 16,384; 19,661; 22,937; 26,214; 29,491; and 32,768 out of 32,768. Luck 5 or above passes the initial Gamble check, while subsequent target evasion still matters. These probabilities assume uniformly distributed 15-bit RNG output; they are not live battle measurements.

Current Goal: support the native shared roll, per-ratio ordinary hit checks and hit-gated integer luck gain. Latest Decision: no guaranteed +5 on a miss and no independent Gamble roll per displayed hit. Next Step: integrate the bounded mechanic into the optimizer with sampled state and visible uncertainty. Remaining boundary: exact phase naming and unrelated special target/context bypasses are outside this audit.
