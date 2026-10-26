# Battle model and evidence

Arithmetic verification and exact native regression cases: [combat verification](combat-verification.md). Recovered action, stagger and LB rules: [timing verification](timing-verification.md). Remaining queue and scenario limits are identified separately.

## Mechanic brief

Load an inventory, select an encounter and battle state, compare legal owned party/loadout candidates, inspect why each was selected, then stage or export the one to try. Explicit Equip actions download an edited save copy and backup; searching itself never writes a save.

## Rules modeled

- Native experience uses per-level costs, subtracted in sequence. Stats combine native bases, reached growth rows, seed parameters, permanent sync grants from every owned Resonance, and legal equipment. Derived ATK/DEF/MAG/MDEF recurse through STR/STA/INT/SPI. Permanent sync bonuses are not added twice.
- Character availability, weapon/armor/sex restrictions, shared quantities, conservative distinct Resonance assignments, learned skills, recorded awakening/sync, slot counts and skill-cost budgets constrain the search.
- Supported passive effects use native numeric data and timing/condition gates: stat changes, additive damage bonuses, elemental boosts/imbues, critical bonuses and stagger bonuses. Counter and after-kill effects do not become unconditional damage boosts. Ambiguous/random effects are listed as excluded or deferred.
- Ordinary physical/magic HP damage uses the recovered piecewise ATK/DEF ratio and level kernel, raw skill coefficient, separate difficulty/element/critical/break/area/effect factors, per-hit ratios and integer rounding. Expected critical damage uses the native discrete critical roll. Stagger uses its own level-gap formula, elemental factors and nearest-integer rounding.
- The explicit `isApplyAllMag` flag, rather than a guessed target category, controls the native all-target penalty. Difficulty defaults to the save. Guaranteed-critical and already-broken scenarios are optional, not automatically assumed.
- Healing/protection requirements mean a legal affordable option is included in the loadout, not that a free healing action occurs alongside its attack.
- Supported same-turn support actions replace the caster’s attack and affect only allies acting after the caster in each sampled native-priority order. The model does not grant unearned setup turns. Status-resistant debuffs and conditions that are not modeled are excluded.

## Search and objective

Equipment, character and Resonance choices share one inventory. Accessory pairs are evaluated together. Passive/Spirit packages use a cost/slot knapsack surrogate and are then evaluated with native damage math. Candidate pruning, a party beam and a time/evaluation budget keep browser searches bounded. Results are the strongest candidates found, not a proven global optimum.

Both character and party results finish empty slots using available compatible inventory without reducing the member or party score or losing a required role. Unmodeled/deferred item effects are not treated as safely neutral filler. Each slot has a reason; reserved stock and other party allocations are respected. Gear and ability explanations remove one choice while holding the other gear and equipped abilities fixed, then reselect the best supported action. These comparisons describe local model sensitivity, not a proof that the item is globally optimal or an additive damage bonus.

Current-setup comparisons preserve all recorded equipped skills and their AP/slots. They do not optimize away unwanted passives or unused actions. A partial/invalid saved party is not used as a full-party baseline. Mastery absent from the save remains an explicit limitation.

The five-round simulation spends MP on every ordinary turn. When the selected action is unaffordable, it contributes zero and that round is reported; no replacement attack or MP recovery is assumed. Support actions replace the caster's attack and stagger, spend MP and cannot simultaneously use an LB. Same-turn support is recast each round only when affordable for the full horizon; partial-duration buff strategies are not simulated.

Damage maximizes expected HP damage; break maximizes expected stagger damage. Balanced adds an explicitly subjective durability term: per member `0.01 × HP + 0.5 × (DEF + MDEF)`, with optional healing/protection constraints. That score is not DPS. The default horizon is five rounds; each member repeats its selected turn when affordable, with modeled LB substitutions. Arms Akimbo (400650, 40 MP), Dualcast (400730, spells only) and Double Action (400710, nonmagic damage) support legal nested branches, up to four repeated attack leaves; Magic Boost (400660) adds its native +100% magic damage effect 12911 into the additive damage bucket and costs 1.5× MP (native float factor, nonzero minimum 1, truncated). Each hit is capped at 9999, or 99999 with a DamageLimitBreak effect: the native getter at file offset 0x5147360 returns `cond ? 9999 : 99999`. Decimating Attacks (DmgMulTargetlNum) adds its percentage per enemy on Group/All attacks, using the scenario's enemy count (1); Tip-Top Shape (DmgMulBuffNum) adds per buff, which is 0 at the start of a fight.

"Any fight" (`generalEnemy`) is a neutral boss at the party's average level with the median stats of the seven bosses nearest that level, no elemental weaknesses or resistances, and no passives or status resistances. With the Limit Burst goal ticked, a Limit Burst fires as soon as it is affordable.

Goals combine additively, each as a share of a bar per round: damage / enemy MaxHitPoint, stagger / enemy MaxBreakPoint, LB gauge gained / 100, and durability (0.5 × survivability per member) / enemy MaxHitPoint. The stagger-causing hit uses normal HP damage; later hits in that global turn use staggered damage. Recovery occurs at the next turn boundary, and already-staggered targets take no further BP damage.

Limit Bursts are scored over a fight of `rounds` (default 5), members acting in sampled native randomized priority order. Each owns its 100-cost Limit Burst; higher ones only when listed in the saved activeSkillIdList. Power: native coefficient helper `0x14523E1D0` sums attacker effect vtable +0x5A8 into a scale starting at 1; for MulBaseSkillByLevel (`0x145149BA0`) that is `trunc(levelMultiplier × level) × 100 / p0`, p0 = 1500, so ×(1 + level/15). Gauge: a new stagger gives its attacker breakLBIncrease (25), or allBreakLBIncrease (50) when all living enemies are staggered, then the attacker's Fill LB on Stagger at action end, all × the strongest LB fill-rate passive (Double/Triple Charge); Recuperate LB refunds after use; the gauge holds 200 when a 200-cost Limit Burst is owned. Recovered event order and offsets are documented in timing-verification.md. LB from damage taken and support LB effects are not simulated; known support LBs still count toward gauge capacity. Single-character search uses only that character's hits and invents no allied stagger contribution.

## Evidence limits

Arithmetic and major native kernels were recovered statically from the installed executable and native tables; see [damage research](damage-research.md), [passive research](passive-research.md), and [stat research](stats-research.md). Recorded HP/stat-budget checks and browser/desktop parsing agree across the detected saves. No observed in-game damage trace has yet calibrated the full model.

Percentage-stat effects use the verified native pre-effect additive parameter as their basis, float32 epsilon and per-effect truncation. This includes the native rounding quirk where a 30% decrease on baseline 100 yields 71. Spirit packages derive their active/passive bundles from the source mastery rows and localized description; exact runtime expansion still needs confirmation.

Different attack-skill pairs, exceptional action restrictions, state-specific ultimate actions, enemy turn scripts, encounter overrides, probabilistic reactions, identical-effect multi-copy stacking, unknown active artifacts and unsupported calculation types are not fabricated. Their absence can change the real best build. Fully automated battle strategy, multi-turn MP regeneration, summoned Espers and simultaneous finishers are outside this model.

## Validation and handoff

Current Goal: reliable, explainable owned-build recommendations using supported native damage and passive rules.

Latest Decision: apply native per-hit HP/BP order, next-turn recovery, attacker-only LB rewards, refund order, support-LB capacity and hierarchy eligibility. Apply verified normal-command Boost expiry and preserve repeated nested action leaves. Sample native initiative instead of sorting by Agility.

Next Step: runtime Spirit expansion, special initiative/queue overrides and recorded battle comparisons remain separate work. Normal nested expiry, queue preservation and initiative arithmetic are documented in command-verification.md and initiative-verification.md.

Known Blockers: no recorded battle measurements; encounter overrides and the specific unverified mechanics above prevent a claim of an exact global best party.


Command and initiative evidence: [nested commands](command-verification.md), [native priority](initiative-verification.md). Fixed samples estimate order-dependent outcomes; they are not a prediction of the game RNG seed. Mixed attack skills, interruptions, duration extensions, enemy action scripts and exceptional initiative effects remain outside this search.

Search preserves each character’s saved setup before spending the time budget on alternative Resonances and gear. It does not run an unbounded all-Resonance sweep before the timed search.
