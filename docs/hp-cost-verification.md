# HP-cost verification — 27 October 2026

Current Goal: replace blanket HP-cost exclusion with native affordability, payment and per-child HP state.

Latest Decision: Darkness (400490) pays its 5% maximum-HP override; Abyssal Blade (408070) pays an additional 10% maximum HP alongside its normal cost. Recompute HP-dependent damage after each payment. Never reinterpret zero MP as zero resource cost.

Executable SHA-256: `B8C588E46EBADBE37FECA7BDF2DA0AE63A8538099D14A53EC0C2241B086E5FFA`. Evidence is read-only control-flow inspection plus isolated execution of copied scalar arithmetic. No game process, executable or source save was modified. This is not a recorded in-game damage trace.

## Native amount and affordability are different calculations

The cost-list builder `0x145149E40` obtains the native/overridden cost, then appends matching additional-cost records. Payment `0x14513BEA0` iterates those records individually. Cost type 5 (HPRatio) takes this branch:

1. `0x14513C0B5` calls maximum-HP getter `0x14523C250`.
2. `0x14513C0BA` multiplies maximum HP by the integer record percentage.
3. `0x14513C0C9–0x14513C0D4` converts the product to float32, multiplies by native float32 0.01, then truncates to integer.
4. `0x14513C0D8–0x14513C0DA` negates the amount and calls the HP-delta virtual function.

There is no minimum-one rule in this branch. Maximum HP 19 with a 5% cost pays zero; maximum HP 99 pays four. This is not the MP-cost helper, which has its own nonzero minimum.

The usability checker `0x144F59C60` calls the same cost-list builder at `0x144F59CA2`. Its HPRatio branch `0x144F59E24–0x144F59E3F` instead compares:

```
float32(current HP / maximum HP) >= float32(integer percentage * float32(0.01))
```

Current HP includes the native pending amount: getter `0x144F50C14–0x144F50C38` reads fields +10C and +268 before dividing by `0x14523C250`. This test is not `current HP >= truncated payment`. At maximum HP 99, four current HP cannot pay a 5% cost even though the payment rounds down to four; five current HP can. Equality of the float32 ratios is accepted.

## HP setter, equality and child order

The concrete battle-unit vtable at `0x1486584D8` maps +2D8 to HP delta `0x145230340`, +2E0 to `0x144FC3C90 → 0x14524AAD0`, and +2F0 to `0x144FC3C40`. The delta helper handles native pending HP, then calls the ordinary HP setter. Setter `0x14524AB2A–0x14524AB39` clamps the new current HP into `[0, maximum HP]`; it does not leave one HP. The +2F0 callback records an HP snapshot at unit+434; it is not an additional payment or a survival clamp.

Affordability is conditional on the action packet, not a mandatory check before every queued child. `0x144F465D2–0x144F46604` tests action+32A: zero skips the entire generic cost checker `0x144F59C60`, including its HP and MP tests; nonzero invokes it at `0x144F465F7`. Ordinary committed queue packets carry +32A=0. Party counter packets set +32A=1: `0x145108075–0x145108092` derives that flag from unit type 1, then `0x1451080A2` copies the packed flags into action+328. These counters therefore repeat the checker, rejecting insufficient MP at `0x144F59D98` or insufficient HP ratio at `0x144F59E3F` (ratio equality remains allowed).

Both paths subsequently check source-dead state through virtual +2D0 at `0x144F4661E`, before payment, subject to the skill+F9 and action+37A exceptions. `0x144FB8570` implements that ordinary dead predicate; it considers current+pending HP at `0x144FB8582–0x144FB8590` and returns dead when nonpositive (subject to exceptional actor flags).

Mandatory runtime consumption `0x144F47340` has its party-unit and not-consume gates at `0x144F4747C–0x144F47491`, then calls `0x14513BEA0` at `0x144F47584`. Neither this path nor the HP payment branch adds an independent affordability check. An already queued ordinary alive child with +32A=0 can therefore pay more HP than it currently has and clamp to zero. The MP branch likewise clamps existing MP at `0x14513BF77–0x14513BF89`, subtracts the full cost at `0x14513BF8C`, then clamps the result into `[0, maximum MP]` and writes it at `0x14513BF93–0x14513BF9F`; insufficient MP is not a second mandatory runtime rejection for this unchecked queue packet. Fresh selection eligibility and checked counter packets must remain distinct from committed ordinary queue execution.

A planner may conservatively require enough resources when proposing a fresh command or a complete multi-action selection. Such an upfront budget is a planning eligibility restriction, not evidence that native runtime rechecks affordability before every child. Once an ordinary packet is committed, apply its actual flags, payment clamp and source-dead checks in queue order. Counter packets retain their checked-runtime behavior.

Runtime initializer `0x144F65040` calls payment at `0x144F6519B`, then proceeds to the skill-task initializer at `0x144F65594`. There is no second source-HP/dead check between those calls. Task `0x144F826D0` validates the source object and target count, then emits SkillBegin at `0x144F82843–0x144F82863`; it does not repeat the source-HP affordability test. The ordinary damage operation `0x144F71520` validates its attacker object and dispatches hit resolution, without an attacker-HP-zero cancellation branch. Thus the already committed ordinary attack can finish after an exact-cost or underfunded unchecked payment reaches zero HP. The following ordinary child/turn is rejected by its own source-dead precheck. This conclusion covers these audited ordinary action paths, not arbitrary animation interruption or reactive scripts.

Per-child HP-dependent passives must therefore use HP **after** that child's payment, including the zero-HP boundary of a committed attack. A following child cannot reuse the full-HP analysis from before the first cost.

## Payment suppression

Magic Barrage children 2–4 carry action+329, the native not-consume flag. Runtime consumption exits at `0x144F4748A–0x144F47491`, before iterating any cost records. This suppresses all payment records for that action, not only MP. Wrapper costs remain separate from their children. See [special action verification](special-action-verification.md).

## Independent arithmetic checks

The [sanitized fixture](../tests/fixtures/native-hp-costs.json) retains 20 independently executed cases. The local arithmetic oracle executes copied cost blocks `0x14513C0BA–0x14513C0D8` and affordability blocks `0x144F50C14–0x144F50C3F`, `0x144F59E2C–0x144F59E42`, with explicit fake scalar inputs and original constants. The JavaScript helpers matched all 5000 seeded cost/affordability cases with zero mismatches.

`skillHpCost` validates integer inputs and a non-overflowing signed 32-bit product; ordinary native HP values fit this range. It deliberately rejects out-of-range modded inputs rather than relying on a negative integer overflow. `canPayHpCost` implements only the ratio threshold for selection eligibility and packets which enable the optional cost checker. It must not be imposed on every committed ordinary child; the battle planner separately enforces whether the caster is alive.

Next Step: keep HP, MP and conditional effect state per selected action in the fight model. Separate enemy damage, healing, pending overheal and special death-prevention effects require their own state handling; this audit does not grant them implicitly.

## Gauge earned by receiving HP damage

The ordinary HP-damage path `0x144F7A920` applies the target HP delta through `0x144FA8310` at `0x144F7AB27`, then checks that the receiver is a party unit (`virtual +2E8 == 1`) at `0x144F7AB5A–0x144F7AB62`. It passes that **receiver** into the LB increment helper, not the attacker or all allies.

At `0x144F7AB8D–0x144F7ABA0`, native code chooses the smaller of the computed HP-damage record (`result+1C`) and pre-hit HP (`result+20`). The record copier `0x144F6F3B0` and earlier before/after-HP calculation establish those fields. The code converts the minimum to float32, divides by the receiver's derived maximum HP (`0x144F7ABAD–0x144F7ABBC`), multiplies by the current `damagedLBIncrease` field (`0x144F7ABC0`, current value 50), truncates (`0x144F7ABC8`), then calls `0x145230430` at `0x144F7ABCC`.

```
base received gauge = trunc(float32(float32(min(computed HP damage, pre-hit HP) / max HP) * 50))
```

Thus taking 99 damage at maximum HP 1000 grants **4 base gauge**, not a flat 50. Taking 500 damage with only 100 pre-hit HP and maximum HP 1000 grants 5 base gauge. Each hit computes its own base increment. The ordinary fill helper subsequently applies the strongest active charge multiplier, truncates again and clamps capacity; Double Charge on the first example yields 8, not a single combined calculation yielding 9.

There is no extra receiver-alive gate between applying this HP damage and adding its LB gauge; a lethal hit can still produce retained gauge. The fill helper has its separate native effect prohibitions at `0x145230474–0x14523047F` and `0x1452304C4–0x1452304CF`, followed by charge and capacity handling at `0x1452305B9–0x1452305E0`. This finding does not mean the knocked-out unit can immediately act or spend that gauge.

The numerator is the recorded computed damage capped by pre-hit HP, not a reconstruction of observed HP difference after arbitrary death prevention, HP locks or pending-overheal behavior. The controlled incoming-hit scenario supplies ordinary post-mitigation damage; those exceptional effects are not inferred.

The [retained incoming-LB fixture](../tests/fixtures/native-incoming-lb.json) contains ten independently executed native scalar cases. The pure `damageTakenLb` helper matched 5000 additional seeded copied-instruction cases with zero mismatches. No enemy attack rate or targeting frequency is inferred from this per-hit arithmetic.
