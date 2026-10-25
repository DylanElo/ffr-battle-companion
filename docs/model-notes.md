# Battle model and evidence

## Mechanic brief

Load an inventory, select an encounter and battle state, compare legal owned party/loadout candidates, inspect why each was selected, then stage or export the one to try. No save writes or battle automation occur.

## Rules modeled

- Native experience uses per-level costs, subtracted in sequence. Stats combine native bases, reached growth rows, seed parameters, permanent sync grants from every owned Resonance, and legal equipment. Derived ATK/DEF/MAG/MDEF recurse through STR/STA/INT/SPI. Permanent sync bonuses are not added twice.
- Character availability, weapon/armor/sex restrictions, shared quantities, conservative distinct Resonance assignments, learned skills, recorded awakening/sync, slot counts and skill-cost budgets constrain the search.
- Supported passive effects use native numeric data and timing/condition gates: stat changes, additive damage bonuses, elemental boosts/imbues, critical bonuses and stagger bonuses. Counter and after-kill effects do not become unconditional damage boosts. Ambiguous/random effects are listed as excluded or deferred.
- Ordinary physical/magic HP damage uses the recovered piecewise ATK/DEF ratio and level kernel, raw skill coefficient, separate difficulty/element/critical/break/area/effect factors, per-hit ratios and integer rounding. Expected critical damage uses the native discrete critical roll. Stagger uses its own level-gap formula, elemental factors and nearest-integer rounding.
- The explicit `isApplyAllMag` flag, rather than a guessed target category, controls the native all-target penalty. Difficulty defaults to the save. Guaranteed-critical and already-broken scenarios are optional, not automatically assumed.
- Healing/protection requirements mean a legal affordable option is included in the loadout, not that a free healing action occurs alongside its attack.
- Supported same-turn support actions replace the caster’s attack and affect only allies acting later by Agility. The model does not grant unearned setup turns. Status-resistant debuffs and conditions that are not modeled are excluded.

## Search and objective

Equipment, character and Resonance choices share one inventory. Accessory pairs are evaluated together. Passive/Spirit packages use a cost/slot knapsack surrogate and are then evaluated with native damage math. Candidate pruning, a party beam and a time/evaluation budget keep browser searches bounded. Results are the strongest candidates found, not a proven global optimum.

Damage maximizes expected HP damage; break maximizes expected stagger damage. Balanced adds an explicitly subjective durability term: per member `0.01 × HP + 0.5 × (DEF + MDEF)`, with optional healing/protection constraints. That score is not DPS. The scenario is one turn per member, not a sustained fight simulation. Arms Akimbo (400650, 40 MP) and Dualcast (400730, spells only) repeat the chosen attack once; Magic Boost (400660) adds its native +100% magic damage effect 12911 into the additive damage bucket and costs 1.5× MP (rounded up, assumed). Each hit is capped at 9999, or 99999 with a DamageLimitBreak effect: the native getter at file offset 0x5147360 returns `cond ? 9999 : 99999`. Decimating Attacks (DmgMulTargetlNum) adds its percentage per enemy on Group/All attacks, using the scenario's enemy count (1); Tip-Top Shape (DmgMulBuffNum) adds per buff, which is 0 at the start of a fight.

Goals combine additively, each as a share of a bar per round: damage / enemy MaxHitPoint, stagger / enemy MaxBreakPoint, LB gauge gained / 100, and durability (0.5 × survivability per member) / enemy MaxHitPoint. Hits from a stagger through the following round use staggered damage (native breakDamageMagnification and on-break effects).

Limit Bursts are scored over a fight of `rounds` (default 5), members acting in Agility order. Each owns its 100-cost Limit Burst; higher ones only when listed in the saved activeSkillIdList. Power: native coefficient helper `0x14523E1D0` sums attacker effect vtable +0x5A8 into a scale starting at 1; for MulBaseSkillByLevel (`0x145149BA0`) that is `trunc(levelMultiplier × level) × 100 / p0`, p0 = 1500, so ×(1 + level/15). Gauge: a stagger (party break reaching MaxBreakPoint) gives every member breakLBIncrease (25) and its dealer Fill LB on Stagger, all × the strongest LB fill-rate passive (Double/Triple Charge); Recuperate LB refunds after use; the gauge holds 200 when a 200-cost Limit Burst is owned. Assumed, not traced: the enemy recovers one round after a stagger; who gets the base 25; LB from damage taken (damagedLBIncrease) and support Limit Bursts are not simulated. Single-character search assumes the party staggers at 4× that character's break.

## Evidence limits

Arithmetic and major native kernels were recovered statically from the installed executable and native tables; see [damage research](damage-research.md), [passive research](passive-research.md), and [stat research](stats-research.md). Recorded HP/stat-budget checks and browser/desktop parsing agree across the detected saves. No observed in-game damage trace has yet calibrated the full model.

Percentage-stat effects use the verified native pre-effect additive parameter as their basis, float32 epsilon and per-effect truncation. This includes the native rounding quirk where a 30% decrease on baseline 100 yields 71. Spirit packages derive their active/passive bundles from the source mastery rows and localized description; exact runtime expansion still needs confirmation.

Mixed Arms Akimbo/Dualcast pairs, native limits on repeating an action, state-specific ultimate actions, enemy turn scripts, encounter overrides, probabilistic reactions, identical-effect multi-copy stacking, unknown active artifacts and unsupported calculation types are not fabricated. Their absence can change the real best build. Fully automated battle strategy, multi-turn MP regeneration, summoned Espers and simultaneous finishers are outside this model.

## Validation and handoff

Current Goal: encounter-specific owned-party recommendations using supported native damage and passive rules.

Latest Decision: keep arithmetic/effects, loadout legality and bounded search separate, with unsupported mechanics visible.

Next Step: compare representative predicted hits and ability loadouts against in-game screens/combat, then confirm percentage bases, Spirit expansion and special multi-action queues before extending sustained battle simulation.

Known Blockers: no live damage calibration; the specific unverified mechanics above prevent a claim of an exact global best party.
