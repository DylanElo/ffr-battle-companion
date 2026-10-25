# Native damage research — 2026-10-25

Current Goal: recover the installed game's actual calculation kernels for owned-build recommendations.

Latest Decision: implement the statically recovered normal physical/magic kernel and EscapeNum specialization, reject other calculation types until their native paths are implemented. Call the result a native-formula estimate; it has not been calibrated against an observed battle trace.

Next Step: verify special action selection, passive effect conditions, and a representative in-game damage trace when gameplay evidence is available.

Known Blockers: no battle was run or automated. Enemy encounter overrides, active statuses, gauge state, conditional passive state, artifact effects, and complete special-action/AI scripts must be supplied or excluded explicitly.

## Evidence source

Installed executable: `<game folder>\FFRS\Binaries\Win64\FFRS-Win64-Shipping.exe`, image base `0x140000000`, SHA256 `B8C588E46EBADBE37FECA7BDF2DA0AE63A8538099D14A53EC0C2241B086E5FFA`. Addresses below are virtual addresses in this installed image. Read-only PE parsing and Capstone 5.0.9 disassembly used the already-installed research library at `%TEMP%/ffrs-native-research-libs`; neither binary nor saves were modified.

Current `Unit/DT_UnitParameterCalc` is preserved in `data/source/rows/Unit/DT_UnitParameterCalc.json`. Its inherited row layout starts the first float at +8: random amplitude +8, critical multiplier +0xC, break +0x10, extra phase +0x14, all-target +0x18, spread +0x1C, same-level +0x20, defense-ignore +0x24, throw-money constant +0x28, throw-money level scale +0x2C, escape cap +0x30.

## Verified normal damage kernel

Dispatcher `0x145237CD0`: skill calculation enum is native byte +0x7C. Physic 1 dispatches at `0x145237D2C` to `0x14522F0F0` with type 1; Magic 2 dispatches at `0x145237D41` with type 2. EscapeNum 8 dispatches at `0x145237E91` to the same physical kernel and applies the escape multiplier.

Helper `0x14522F0F0` selects attack and defense, then computes the following single-precision expression. Let epsilon = `2^-23` and `r = float(A / max(D, 1) + epsilon)`:

```
if r < .5: ratioFactor = float(.5*r + epsilon)
elif r < 1: ratioFactor = float(r*r)
else: ratioFactor = float(8 / float(1 + expf(float(1-r))) - 3)

base = ratioFactor * float(.6) * (attackerLevel + 2)
base *= variance * difficultyDamageGiven * difficultyDamageTaken
```

Piecewise instructions: `0x14522F1D4–0x14522F286`. Constants were read from native image addresses: 1.0 at `0x147777908`; epsilon at `0x14789AB74`; .5 at `0x14778D02C`; 8 at `0x147777988`; 3 at `0x147777970`; .6 at `0x14785C4F8`. The call at `0x14522F268` reaches thunk `0x1475831CA`, whose PE IAT resolves to `api-ms-win-crt-math-l1-1-0.dll!expf` at `0x147732BC8`.

Variance: `0x14522F2D4–0x14522F302` calls PE import `rand` at `0x147733140`, masks to 32767, and computes `1 - amplitude + rand * amplitude * (2/32767)`. Current amplitude .05 gives [.95, 1.05]. Difficulty factors are obtained only when the relevant combat unit has native relation/type 1; getters `0x145115620` (attacker) and `0x145115660` (target) read current difficulty row +0x1C and +0x18. Parent data preparation resolves the serialized field names to those factors.

This is **not** the FFBE `ATK² / DEF` formula.

## Computed combat stats

`0x14523F5E0` returns `clamp(base + additions + effectDeltas, 0, cap)`:

- Base helper `0x145238180` uses a native switch at `0x145238308`.
- PhysicalAttack 12 starts from *computed* Attack 5 (STR); PhysicalDefense 13 starts from computed Defence 6 (STA).
- MagicalAttack 14 starts from computed Intelligence 7 (INT); MagicalDefense 15 starts from computed Mind 8 (SPI).
- Divine 16 starts from computed Mind 8 plus native unit field +0x13C.
- Additions helper `0x14523A960` sums the runtime map, equipment/mastery lookup `0x1450169A0`, and saved parameter-array lookup `0x145113410`.
- Effect helper `0x14523E150` calls each active effect's vtable +0x358 getter, truncates *each returned delta* to integer, then sums those integers.

The percentage basis was subsequently resolved via native class registration: `UCPP_ContFxContinueParamVariation` static getter `0x144DC16A0` reaches constructor `0x144DC26D0`, which installs vtable `0x1486972C0`. Its +0x358 handler is `0x145145150`. It searches the first two parameter triples and returns the first triple matching the requested parameter. Increase0 returns the flat value; Decrease1 returns its negative. RatioIncrease2 returns `baseline*(value*.01+epsilon)`; RatioDecrease3 returns `baseline*(epsilon-value*.01)`. Baseline getter `0x145238350` is `clamp(base + additions,0,cap)` and deliberately excludes effects for the same parameter. Derived PhysicalAttack12 still starts from **current** STR5, so STR effects propagate into the physical-attack baseline before PhysicalAttack-specific percentages apply. Multiple percentage effects for one parameter use the same baseline and their separately truncated deltas add; they do not compound each other.

`0x145113410` finds the character's native saved record and returns `baseParameterList[parameterIndex]`. Thus seed boosters are separate from stat growth and equipment, not final stats to be substituted for them.

Equipment helper includes weapon, armor, accessories and equipped Vision item ID. Vision IDs enter a dedicated mastery lookup at `0x145019FE0–0x14501A278`; adding the Vision's entire source unit stats to a PC would be unsupported. Per-character synchro BaseParameter grants are also distinct from save seed boosts; the growth investigation cross-checks HP against all current character records.

## Skill coefficients and multipliers

Caller `0x145232AFA` obtains base. Coefficient helper `0x14523E1D0` starts from skill native integer +0x8C (`magnification`), applies coefficient-specific effect modifiers and additive coefficients, and returns the **raw coefficient**, not coefficient/100. Caller `0x145232B5E` multiplies base × coefficient × absolute elemental factor.

- Element helper `0x145239F60` selects native resistance factors and adds applicable elemental factor deltas. Native table factors are neutral 1, weakness 1.5, halved .5, invalid 0, absorb -1. Absorb changes the result category to healing; it must not be ranked as positive damage.
- Critical helper `0x145238C00` returns current critical multiplier .01 × 150 plus applicable critical-factor effect deltas. Caller applies it only for a critical result.
- Break and extra phase factors read current row +0x10 and +0x14; current factors are 1.5 and 1.0. Break applies only to skills enabled for it and an actually broken target, not merely a party with a Breaker role.
- All-target helper `0x145237420` tests skill byte +0xBD, then returns current allDamageMagnification .01 × 40 unless a passive vtable +0x580 overrides it. The property **isApplyAllMag** is definitively mapped to +0xBD: its native reflected bool setter `0x144C3B0D0` writes byte `[rcx+0xBD] = 1`. It is not inferred from the target label.
- Outgoing-factor helper `0x14523E3E0` starts at 1, adds applicable DamageCalculation (47) / DamageCalculationOnBreak (48) effect factors, adds a second applicable effect-factor sum, and clamps the combined bucket to at least zero. Two ordinary +10% damage effects are additive in this bucket (1.2), not 1.1×1.1.
- The main caller also handles native action-specific multiplier, per-hit ratio, minimum damage, caps, damage absorption, invulnerability, defensive effects and special action result categories. The pure module exposes known inputs; it does not pretend they are always neutral in a live fight.

### Incoming Deffence reductions

Class `UCPP_ContFxDeffence` resolves through static getter `0x144DBFCB0`, constructor `0x144DC2A50`, and vtable `0x14869E458`. Vtable +0x3E8 calls `0x1451468A0`; +0x3F0 calls `0x14514B500`. Each applicable effect checks parameter0 (0=all damage,1=physical,2=magic), then returns `clamp(100-parameter1,0,100)*.01+epsilon`. Parameter2 positive selects the second factor stage; absent/nonpositive selects the first. Native active-condition helper `0x14514F560` must pass. The first stage also allows a separate effect-potency adjustment through target helper `0x145238DF0`; that modifier needs its own evidence before applying nonneutral values.

Main HP caller loops multiply each applicable target effect factor at `0x145232CBA` and `0x145232D73`. A plain30% Protect/Shell reduction therefore leaves .7 damage; two applicable distinct30% effects leave .49, subject to the game's duplicate-effect rules. They are **not** summed into a single60% reduction. Do not apply a Protect/Shell factor merely because a character knows the skill; it must actually be active in the modeled scenario.

## Critical probability

Native code `0x145232A98–0x145232AC6` compares the skill criticalHitRate plus effect deltas against `1 + float(rand&32767) * float(99/32767)`. The helper reproduces that discrete probability; rate 50 is approximately 49.5%, not exactly 50%. Critical chance and critical damage bonus are separate buckets.

## EscapeNum specialization

Native `0x145237E91–0x145237ECF` applies `min(1 + successfulEscapes / 128, 3)` to the physical base. Counter getter is `0x1451172F0`; divisor constant at `0x147B5A1E8` is .0078125. Current cap comes from native row +0x30. 128 escapes means 2×; 256 and higher means 3×. Missing counter data is rejected rather than assuming the cap.

## XP to level

Reflected `GetLevelReachWithExp` at `0x1486048A0` is bound to exec wrapper `0x144D6A0E0`, which calls `0x14523BC00`. Starting at level 1, loop `0x14523BD00–0x14523BD17` subtracts each growth row's RequiredExperience (native +0xC), stops when negative, and otherwise sets the row's Level (+8). Therefore RequiredExperience values are **per-level costs**, not cumulative thresholds. Applying a maximum-threshold lookup would overstate the player's level.

## Module and regression evidence

`docs/damage.js` is a pure UMD module. `tests/damage.test.cjs` has nine passing tests. Fixed fixtures from the recovered algebra, for A=100, D=100, level=30, raw coefficient=100:

| Situation | Damage |
|---|---:|
| Normal variance mean | 1920 |
| Native variance boundaries | 1824–2016 |
| Critical only | 2880 |
| Critical + weakness + broken | 6480 |
| Difficulty given .8 | 1536 |
| isApplyAllMag true | 768 |
| EscapeNum at 128 escapes | 3840 |
| EscapeNum at 256 escapes | 5760 |

These fixtures validate translation of the static native path. They are **not observed in-game damage samples**. Unsupported calculation types return `supported:false` and must be excluded or visibly marked incomplete in a ranking.

## Break-point damage, separate from HP damage

Recovered native path `0x145231F02–0x1452322F7` does not use attack/defense:

```
raw = (skill.breakDamageValue * (1 + attackerBreakCoefficientDeltas + targetBreakCoefficientDeltas)
       + flatBreakAdditions)
raw *= allTargetFactor * criticalFactor * breakElementFactor
raw *= outgoingBreakFactor * targetBreakFactor * hitRatio * levelFactor
breakPoints = trunc(raw + .5)
```

The source coefficient is native skill +0x90. At same levels, levelFactor=1. If attacker level is higher, it is `1 + .1*powf(levelDifference,.6)`. If lower, `max(.1,1-.1*powf(levelDifference,.6))`. Both branches include the native floating epsilon. The code calls math thunk `0x147583122` for the power. Integer rounding is nearest positive, distinct from HP-damage truncation.

Attacker and target coefficient deltas are accumulated additively at vtable +0x5B0 and +0x5C0. Flat additions come from attacker vtable +0x5A0. BreakDmgCalculation timing50 effects add into a separate outgoing bucket at vtable +0x540. Defensive break factors multiply via target effect vtable +0x3F8. These must not be replaced by HP DamageMultiplier passive effects.

Weakness uses the **break** elemental table multiplier3, not HP weakness1.5. Critical reuses the critical-factor helper. All-target penalty reuses isApplyAllMag (40%) and its passive override. One native per-hit ratio is applied before rounding. Break-point damage does not inherit the normal HP-damage ±5% variance or attacker/defender stat ratio.

Fixed tests: breakDamageValue100 at equal levels ->100; critical+weakness ->450; all-target+weakness ->120; +20% break coefficient and flat10 ->130; level advantage1 ->110; disadvantage1 ->90; large disadvantage floors multiplier at.1 ->10.

## Multi-action investigation status

Current source descriptions explicitly say Arms Akimbo400650 gives2actions in one turn (MP40, equipCost60); Double Action400710 gives2non-black/white attack skills (MP0,equipCost50); Dualcast400730 gives2black/white spells (MP0,equipCost50). They are all Ability wrapper entries with no direct effects, so their zero-effect rows are not evidence that they do nothing.

Native row constructor `0x144D97E20` initializes configured `wActionSkillId` at +0x17C to400710 and `wArmsSkillId` at+0x180 to400650, plus mimic/quadramagic/twincounter configured IDs. Native `eSkillAttributeType::Dualcast`=13 exists. The exact action-queue selection, excluded skills, and MP charge routing remain under investigation; a full multi-turn simulator must not silently assume that every action can be doubled without restriction.
