# Action, stagger and LB timing verification — 26 October 2026

Current Goal: replace combat timing guesses with rules recovered from the installed executable and cooked command assets.

Latest Decision: use per-hit HP/BP events, native next-turn recovery and source-only LB rewards. Exclude combined boosted multiple-action estimates while their nested effect expiry remains unresolved.

## Reference

Executable SHA256: `B8C588E46EBADBE37FECA7BDF2DA0AE63A8538099D14A53EC0C2241B086E5FFA`, image base `0x140000000`. Research used read-only disassembly, current cooked command/Blueprint data and isolated execution of scalar gauge arithmetic. No game process injection or battle measurements were used.

## Confirmed rules and corrections

| Rule | Recovered behavior | Builder correction |
| --- | --- | --- |
| Damage and stagger order | HP is calculated/applied before that hit changes BP or applies Break. | The breaking hit uses normal damage; subsequent hits can use staggered damage, including later hits within the same action. |
| Stagger recovery | Ordinary available enemies lose Break and regain full BP before the next global turn starts. | Removed the extra whole turn of staggered damage. |
| BP while staggered | Native break calculation exits when the target is already broken. | Such hits contribute no additional stagger damage. |
| Base stagger LB | Only the attacker gains 25, or 50 when all living enemies are broken. A single-enemy break is an all-break. | Removed free base gauge for other party members; single-enemy builds use 50. |
| Fill LB on Stagger | Active Break effects run on the attacker and actual attack targets at action end. Uninvolved allies are not recipients. | The attacker's own extra fill follows its base reward. |
| Recuperate LB | ActivateLimitBurst follows damage and Break/AllBreak events. | Refund follows the LB's damage and stagger events. |
| Charge stacking | Native gauge code chooses the strongest active fill multiplier, multiplies each increment as float, truncates, then clamps. | Retained strongest-only charge stacking; apply truncation and capacity to each increment. |
| Gauge capacity | Maximum cost of known skills with LB cost type, irrespective of damage or target type. | Known 200-cost support LBs count even when their effects are excluded from damage ranking. The UI's global 200 ceiling is not a per-character starting capacity. |
| Opening gauge | Battle setup assigns the sum of active InitialLimitBurstPoint effects directly, clamped to capacity. The default getter returns zero. | LB Charge Opener supplies 50 once. Charge multipliers do not multiply it, it is not counted as earned fill, and gauge is not carried from the previous fight. |
| Wrapper hierarchy | FoundSkillInHierarchy rejects candidates whose active wrapper ancestry matches a native lock. | Arms variants now pass the same eligibility checks as ordinary choices. |
| Self-target support | Magic Boost selects a magical damage child for its own caster; it is not a buff cast on another party member. | Prevented self-only effects from becoming free ally support plans. |

Critical-conditional passives are also recalculated for broken-target hits, LBs and supported party revisions. A hit becoming staggered no longer loses its critical-only effects in the cached damage inputs.

The character optimizer now counts that character's own hits. The earlier invented `4 × own stagger` party contribution has been removed. The party optimizer uses the actual recommended members' hits. The UI reports simulated stagger per round, excluding hits made while the enemy is already staggered.

## Native locations

- HP before BP: action operation `0x144F71520`, physical HP call `0x144F717ED → 0x144F7A920`, break calculation `0x144F718B7 → 0x145231D60`, BP write `0x144F7191B`. Already-broken BP exit: `0x145231E1F–0x145231E26`.
- Global recovery: `0x144FB73C0 → 0x144F603D0 → 0x144FC2860 → 0x144FC2C90`. Break status 89 is removed at `0x144FC2E59`, full BP restored at `0x144FC2E84`, before the global turn counter increments. Special excluded actors with flag `unit+0x554` remain outside the ordinary living-party scenario.
- Base gauge: acting source restored at `0x144F7193C`; select row offsets `+0x1C0/+0x1C4` at `0x144F71A46–0x144F71A4E`; increment source via `0x145230430` at `0x144F71A57`. All-break predicate: `0x144FB8190`.
- Fill arithmetic: strongest factor `0x14523056A–0x14523058A`; multiply/truncate/clamp `0x1452305B9–0x1452305E0`.
- Runtime capacity: `0x145251F70`, cost-type lookup `0x1451498A0`, maximum raw skill cost `0x145252036–0x145252041`, capacity store `0x145252073`.
- Opening gauge: effect factory `0x14513C40C`, InitialLimitBurstPoint getter `0x144DC3020`, sum aggregator `0x14523ADE0`, battle setup `0x144FB5A88–0x144FB5A95`, direct setter `0x14524AE80`. The base effect getter `0x1444AC080` returns zero. Setup uses the direct setter, bypassing the earned-gauge multiplier path.
- Active Break/AllBreak events: `0x144F423D1`, `0x144F4244F`, `0x144F424DC`. The recipient vector is populated from actual selected skill targets at `0x144F6094F–0x144F60956`; it is not the allied party. Passive-bundle addition callbacks are a separate mechanism and were not used to infer active fill recipients.
- LB refund trigger: `0x144F42812–0x144F4282D`, ActivateLimitBurst event 43.
- Hierarchy rejection: `0x144F456B0`, FoundSkillInHierarchy branch `0x144F45D3C–0x144F45D88`.

## Command recipes and the remaining Boost boundary

Current `DT_BtlCmdUniqueActionBehavior` defines sequential recipes:

- Arms Akimbo: one SelfCast, then two Root choices. The wrapper's raw 40 MP cost is paid once; child skills retain their individual costs.
- Dualcast: one SelfCast, then two Magic choices.
- Magic Boost: one SelfCast, then one magical-damage choice.

The Magic list requires the native Magic attribute; the magical-damage list requires a damage skill with Magic damage type. Each builds its own candidate list without consulting prior sibling selections. The optimizer repeats one compatible attack; mixed choices are not searched.

Magic Boost cannot directly select Dualcast, and Dualcast cannot select Magic Boost. Arms can select two separate nested Boost/spell recipes where the command hierarchy permits. Those recipes are legal selections, but their full numeric estimates remain excluded: native effect duration depends on SkillBegin/SkillEnd dispatch, and execution-owner flags can suppress those events. A duration of two does not prove that one boost affects both casts.

The remaining concrete expiry boundary is the execution-owner flag copied by action builder `0x144F40CB0` from `[owner+0x28]+0x34` to action `+0x37E` at `0x144F40F64–0x144F40FA7`; it suppresses SkillEnd at `0x144F429AA`. Event-list suppression flag `+0x386` also exists. Their full nested-owner semantics are not inferred.

## Retained regression evidence

`tests/fixtures/native-commands.json` records the source asset-pair hashes and normalized recipes/filter facts. `tests/fixtures/native-gauge.json` retains eight independently executed gauge arithmetic cases. Native field `+0x284` records the full truncated increment before overflow; its wider gameplay use is unverified. The optimizer deliberately scores gauge actually retained within capacity.

Run `node --test tests/timing.test.cjs tests/battle-reliability.test.cjs tests/search.test.cjs`. Tests cover reward recipients, overflow, recovery, within-action hit order, wrapper eligibility, support-LB capacity, critical effects after stagger, unmultiplied opening gauge, Opener ability selection and removal of invented allied contribution. A search-budget regression also preserves completed saved-loadout seeds when the deeper timing evaluations exhaust the time budget.

Next Step: resolve nested execution-owner expiry flags and final duplicate-action queue preservation before enabling more complex boosted/mixed recipes.

Known Blockers: dynamic initiative and upstream animation hit-notify routing are not fully traced. The planning scenario orders members by Agility, omits enemy actions and damage-taken gauge, and uses a five-turn horizon. Damage effects dependent on changing gauge/status within a turn are not fully reevaluated at every event. Encounter overrides, probabilistic reactions and Spirit expansion remain separate limitations. This is not a claim that every battle script has been reproduced.
