# Luck and Overclock state verification — 27 October 2026

Current Goal: replace resource-free estimates with the installed game's resource thresholds, payment order and activation lifetimes.

Evidence is read-only disassembly, native enum dispatch/vtables and current cooked data, not a live battle recording. Executable SHA-256: `B8C588E46EBADBE37FECA7BDF2DA0AE63A8538099D14A53EC0C2241B086E5FFA`. The [retained fixture](../tests/fixtures/native-resource-state.json) includes normalized data, native locations and derived state vectors.

## Good Luck starts at zero

The Good Luck effect constructor explicitly initializes its counter at +B8 to zero (`0x144DC7440`). Unit getter `0x14523AC20` starts from zero and takes the greatest virtual +4D0 value from active effects; Good Luck's getter `0x144DC9330` reads that counter. The effect's parameter 3 is **not starting luck**: it adds three critical-rate points per current stack.

Positive mutation `0x145230120` creates the Good Luck effect when absent, then calls its virtual +320. Handler `0x145136A60` limits upward additions to `maxGoodLuckLevel` (current native value 10), applies the signed delta, and removes the effect when the resulting count is nonpositive. `0x14524AA40` assigns a requested level by applying desired minus current.

| Source | Native transition |
| --- | --- |
| Lucky Time passive 1511 / effect 65005 | +8 at SpawnUnit. |
| Action-gain passive 1499 / effect 65004 | +1 at ActionBegin; not once per selected spell child. |
| Gale Strike 406080 / effect 63001 | +1 before its damage calculation, capped at 10. Its own critical calculation therefore sees the new stack. |
| Demolisher Rush 406050 | Requires at least 8 but consumes 5 before damage. Eight becomes three. |
| Blitzstrahl 406070 | Requires and consumes 3 before damage; its own luck-scaled stagger bonus sees what remains. |
| Energized Assault 406140 | Requires 9; applies its physical modifier and clears luck after its wrapper calculation. Its selected physical child is a separate queue step. |
| Glücksschmied 406040 | Uses current luck for its LB coefficient, then clears luck after damage. |

The availability branch at `0x144F59E44–0x144F59E4F` compares current luck against the configured check amount. Runtime payment at `0x14513C0FA–0x14513C10B` negates the configured additional cost and calls the mutation helper. Checks and payments are separate tables; they must not be conflated.

## Luck affects different numeric stages

- Good Luck 1195 returns `count × parameter0` from `0x145145690` through virtual +4F8. The critical-selection loop calls that slot at `0x145232A85`, adding it to the skill's native critical-rate field before the random comparison. With parameter0 3, four stacks add 12 critical-rate points.
- Gale Strike's `AddSkillBaseMag` effect 12918 uses `0x14511E900` at virtual +598. A non-default second parameter makes it conditional on the critical argument. It adds raw coefficient 7 only on critical hits.
- Glücksschmied's `AddSkillBaseMagGoodLuck` effect 12930 uses `0x14511E940`, also virtual +598, returning integer `3 × currentLuck`. The native coefficient helper multiplies the original coefficient by its scale **before adding** this integer (`0x14523E352–0x14523E36B`). At level 30 and luck 8, coefficient 33 becomes `33 × 3 + 24 = 123`, not `(33 + 24) × 3`.
- Calculation enum GoodLuck (15) dispatches through `0x14523812C[14]` to the ordinary physical branch `0x145237D2C → 0x14522F0F0(type 1)`. Its special power comes from the coefficient effect, not a separate unknown base-damage kernel.
- Blitzstrahl's misleadingly named `DmgMulGoodLuckNum` effect 15124 uses virtual +540 (`0x145144550`), adding `10% × currentLuck` to **stagger**, not HP damage. The native float operation is `f(f(integerProduct × f(.01)) + epsilon)`.

## Overclock counts selected Mechabo activations

| Action | MP | Active parent | Child coefficient effects | Native base scale |
| --- | ---: | --- | --- | ---: |
| Overclock 404130 | 12 | 19003 / OverClock | 12913, 15113 | 1 + 1.5 = 2.5 |
| Overclock Zero 404140 | 35 | 19004 / OverClockZero | 12914, 15114 | 1 + 3 = 4 |

Both parents have lifetime 3 proceeding only at `OverclockTgtSkillActivate` (44). The current target list is Mechabo Kick 404080, Mechabo Tackle 404110, Mecha Behemoth 404060 and Mecha Fat Chocobo 404070. The base coefficient and base stagger changes are skill-ID filtered; they are not an unrestricted outgoing damage bonus. Getter `0x1451133B0` matches the child effect's native skill-ID list and returns `f(f(parameter0 × f(.01)) + epsilon)` through virtual +5A8 (HP coefficient) or +5B0 (base stagger).

At action end, `0x144F42781–0x144F4280C` compares the actual skill ID against the target list, applies event 44, then advances its lifetime. Thus the third listed attack still receives the modifier; it expires afterward. Other attacks and global turn boundaries do not consume charges.

Overclock Zero's cost-check amount zero means **an active effect of type OverClock is required**. The native check at `0x144F59E54–0x144F59E5E` queries effect type 119 and negates the presence result; it is not a numeric comparison against a zero resource balance.

## Upgrade, recast, coexistence and overheating

Initializer `0x14514C680` installs the two child modifiers and keeps their pointers. If parameter0 is not -1 (Zero uses 1), it removes prior OverClock-type parents at `0x14514C7E9–0x14514C838`. Forced removal before expiry does not add Overheat.

The current status policies for OverClock and OverClockZero both disable duration extension, duplicates and overwrites. Recasting the same status spends its ordinary MP but does not refresh charges. They are different statuses with no opposing-status relationship, however:

- Overclock I → Zero replaces I with a fresh Zero parent.
- Zero → Overclock I can retain **both** parents: I's parameter0 is -1, so its initializer does not remove Zero.
- Their distinct child IDs add in the native coefficient/base-stagger sums: `1 + 1.5 + 3 = 5.5`, not `2.5 × 4`. Each parent keeps its own activation counter and removes its own child pointers when it ends.

Normal parent expiry calls virtual +660 (`0x145141C00`). It removes recorded child modifiers. Only if lifetime is actually zero (`0x144DC3360`) does it add parameter3: Overheat 19005 or 19006. Both block native attribute 8 (Mechabo), including the two Overclock setup skills, and have duration 2 proceeding at BeginTurn. This means **two applicable BeginTurn lifetime events**, not two invented additional skipped future turns. If applied during global turn R and ordinary BeginTurn decrements precede actions, R+1 remains blocked and R+2 removes the effect.

## Already queued actions versus fresh selection

Ordinary UI-generated actions do **not** repeat the generic skill-availability/cost check before each queued child. Factory `0x144F40F69` writes zero to the third byte of its packed action flags, and `0x144F40F9C–0x144F40FB0` copies those flags to action +328: action +32A is therefore zero. Runtime initializer `0x144F6509B` calls validator `0x144F464E0`, whose call to generic check `0x144F59C60` at `0x144F465F7` requires +32A to be nonzero. The ordinary factory does not enable that optional check.

The separate attribute restriction query `0x145243300` at `0x144F465AA` likewise requires action +379. The constructor clears +379/+37A through its dword write at `0x144D96EF0`, and the ordinary factory leaves them unchanged. The always-applicable status cancellation path `0x1452420D0` checks status-detail `isActionDisabled`; OverHeat's cooked row sets that field false. This distinction preserves ordinary incapacitation checks without converting OverHeat's narrower Mechabo menu restriction into a blanket action cancellation.

Consequently, if four qualifying Mechabo attacks are already queued while legal, the third consumes the final Overclock charge and applies OverHeat; the fourth still executes, with that expired parent's modifier removed. A fresh Mechabo selection during OverHeat is blocked. Reactions or externally overridden action flags are separate paths and must not inherit this conclusion automatically.

The same optional-check distinction applies to Good Luck thresholds: runtime payment still consumes luck, but ordinary queued children do not rerun the menu's threshold test. This does not prove that the native command-selection preview permits every repeated costly recipe. Until that preview's cumulative accounting is independently traced, construct plans with sufficient resources for each selection rather than exploiting a skipped execution-time threshold.

## Supported boundaries

Gale Strike provides a deterministic luck engine. Gamble Shot 406060 instead installs `CritOrMiss` effect 13201 and adds five luck after calculation; its random damage branch and post-miss gain require a stochastic event model. It must not be silently scored as an always-hit ordinary attack or a guaranteed generator.

Luck and Overclock still obey ownership, AP, slots, MP, status and ancestry restrictions. Model payments and gains at each child, distinguish fresh-selection eligibility from queued execution, and retain the unproven cumulative-preview boundary above.

Implemented: the live sequence evaluator applies these transitions and the build details show resource changes. Luck policies wait for a constructible command budget before spending. No save, executable or live game process was modified by this audit.
