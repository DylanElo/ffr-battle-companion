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
- Scion Sorceress scales both Skill Flow's history contribution and cap. Area Effect Adept bypasses the native flagged damage/stagger/recovery spread reduction. Their native getters and isolated execution fixtures are documented in [Scion and area verification](scion-area-verification.md).
- MP payments include verified cost multipliers and exact effect-ID cancellation, including Half MP Cost, Unlock Magic, Magic Boost and Reckless Abandonment. Auto MP Restore (S/M/L) applies at ordinary ActionBegin before fresh selection. See [MP costs](mp-cost-verification.md) and [MP recovery](mp-recovery-verification.md) for rounding, event scope and exclusions.
- Essence of Mundanity checks the original skill element for both HP and stagger modifiers, including non-elemental magic. Physical fallback imbues preserve those gates; Solar Pendant does not imbue magical damage. Verified forced-element precedence and native Mundanity contribution rounding are documented in [Mundanity and calculator comparison](essence-mundanity-verification.md).
- Healing/protection requirements mean a legal affordable option is included in the loadout, not that a free healing action occurs alongside its attack.
- Supported same-turn support actions replace the caster’s attack and affect only allies acting after the caster in each sampled native-priority order. The model does not grant unearned setup turns. Status-resistant debuffs and conditions that are not modeled are excluded.

## Search and objective

Equipment, character and Resonance choices share one inventory. Accessory pairs are evaluated together. A cost/slot surrogate seeds the joint search; complete passive/Spirit assignments are scored on actual gear and the modeled fight. Exact-recipe refinement compares additional source insertions and replacements. Candidate pruning, a party beam and finite evaluation/assignment budgets keep browser searches bounded; elapsed-time cutoffs have been removed. Results are the strongest candidates found, not a proven global optimum.

Both character and party results finish empty slots using available compatible inventory without reducing the member or party score or losing a required role. Unmodeled/deferred item effects are not treated as safely neutral filler. Each slot has a reason; reserved stock and other party allocations are respected. Gear and ability explanations remove one choice while holding the other gear and equipped abilities fixed, then reselect the best supported action. These comparisons describe local model sensitivity, not a proof that the item is globally optimal or an additive damage bonus.

Current-setup comparisons preserve all recorded equipped skills and their AP/slots. They do not optimize away unwanted passives or unused actions. A partial/invalid saved party is not used as a full-party baseline. Mastery absent from the save remains an explicit limitation.

The five-round simulation spends the selected command's modified MP cost. Verified ordinary ActionBegin recovery occurs before fresh command selection, with truncation and maximum-MP clamping per effect. When the chosen action remains unaffordable it contributes zero and that round is reported; no replacement attack is invented. Additional and Finish actions do not receive another ordinary ActionBegin recovery. Support actions replace the caster's attack and stagger, spend MP and cannot simultaneously use an LB. Same-turn support must remain affordable across the modeled horizon; partial-duration buff strategies are not simulated.

Damage maximizes expected HP damage; break maximizes expected stagger damage. Balanced adds an explicitly subjective durability term: per member `0.01 × HP + 0.5 × (DEF + MDEF)`, with optional healing/protection constraints. That score is not DPS. The default horizon is five rounds; each member repeats its selected turn when affordable, with modeled LB substitutions. Arms Akimbo (400650, 40 MP), Dualcast (400730, spells only) and Double Action (400710, nonmagic damage) support legal nested branches, up to four repeated attack leaves; Magic Boost (400660) adds its native +100% magic damage effect 12911 into the additive damage bucket and applies a 1.5× MP cost factor before other eligible cost modifiers or Unlock Magic cancellation (native float factor, nonzero minimum 1, truncated). Each hit is capped at 9999, or 99999 with a DamageLimitBreak effect: the native getter at file offset 0x5147360 returns `cond ? 9999 : 99999`. Decimating Attacks (DmgMulTargetlNum) adds its percentage per enemy on Group/All attacks, using the scenario's enemy count (1); Tip-Top Shape (DmgMulBuffNum) adds per buff, which is 0 at the start of a fight.

"Any fight" (`generalEnemy`) is a neutral boss at the party's average level with the median stats of the seven bosses nearest that level, no elemental weaknesses or resistances, and no passives or status resistances. With the Limit Burst goal ticked, a Limit Burst fires as soon as it is affordable.

Goals combine additively, each as a share of a bar per round: damage / enemy MaxHitPoint, stagger / enemy MaxBreakPoint, LB gauge gained / 100, and durability (0.5 × survivability per member) / enemy MaxHitPoint. The stagger-causing hit uses normal HP damage; later hits in that global turn use staggered damage. Recovery occurs at the next turn boundary, and already-staggered targets take no further BP damage.

Limit Bursts are scored over a fight of `rounds` (default 5), members acting in sampled native randomized priority order. Each owns its 100-cost Limit Burst; higher ones only when listed in the saved activeSkillIdList. Power: native coefficient helper `0x14523E1D0` sums attacker effect vtable +0x5A8 into a scale starting at 1; for MulBaseSkillByLevel (`0x145149BA0`) that is `trunc(levelMultiplier × level) × 100 / p0`, p0 = 1500, so ×(1 + level/15). Gauge: a new stagger gives its attacker breakLBIncrease (25), or allBreakLBIncrease (50) when all living enemies are staggered, then the attacker's Fill LB on Stagger at action end, all × the strongest LB fill-rate passive (Double/Triple Charge); Recuperate LB refunds after use; the gauge holds 200 when a 200-cost Limit Burst is owned. Recovered event order and offsets are documented in timing-verification.md. LB from damage taken is simulated only with explicit incoming hits; support LB effects are not simulated; known support LBs still count toward gauge capacity. Single-character search uses only that character's hits and invents no allied stagger contribution.

## Evidence limits

Arithmetic and major native kernels were recovered statically from the installed executable and native tables; see [damage research](damage-research.md), [passive research](passive-research.md), and [stat research](stats-research.md). Recorded HP/stat-budget checks and browser/desktop parsing agree across the detected saves. No observed in-game damage trace has yet calibrated the full model.

Percentage-stat effects use the verified native pre-effect additive parameter as their basis, float32 epsilon and per-effect truncation. This includes the native rounding quirk where a 30% decrease on baseline 100 yields 71. Spirit packages derive their active/passive bundles from the source mastery rows and localized description; exact runtime expansion still needs confirmation.

Exceptional action restrictions, state-specific ultimate actions, enemy turn scripts, encounter overrides, probabilistic reactions, unverified identical-effect multi-copy stacking, unknown active artifacts and unsupported calculation types are not fabricated. Their absence can change the real best build. Fully automated battle strategy, on-hit/on-critical/on-stagger/on-kill MP restoration, walking-based MP recovery, summoned Espers and simultaneous finishers are outside this model.

## Damage passive search coverage

The character builder compares learned passive and Spirit sources in complete action recipes, subject to its finite evaluation and assignment budgets. Result details report which sources reached a completed trial for the selected recipe. A source reaching a trial does not mean every combination was searched or every effect on that source is supported.

The party builder uses the same joint gear/passive search and exact-recipe member refinement. Proposed member changes must preserve inventory quantities, distinct Resonances and required roles. A revised party is retained only after a full-party score comparison; a higher individual damage score alone is insufficient. Elapsed-time cutoffs and UI watchdog cancellation have been removed. Finite work limits remain, and expensive searches can take many minutes. Stop terminates the worker and retains its best completed legal party checkpoint. Unverified or rejected changes leave the last fully scored party intact.

Dark Rite/Latent Potential HP scaling, qualified Aggravation instance counts, Light-magic Divine selection, critical stagger bonuses, opening-effect expiry, Honing Sense and the verified Dual Spellblade layout are modeled with their native state boundaries. Improvement and Versatility remain incomplete; unknown bad-status state is deferred. See [remaining damage-passive verification](remaining-damage-passives-verification.md) for the 114-passive comparison inventory, native corrections and remaining limits. Scion Sorceress, Area Effect Adept, supported MP cost modifiers and ordinary ActionBegin MP restoration are modeled. Black Demon's effect 61000 remains deferred without explicit runtime command context: static skill membership and equipped Resonance do not prove the selected command. Unknown cost context and unsupported MP recovery events remain visible rather than receiving invented benefits.

## Validation and handoff

Current Goal: reliable, explainable owned-build recommendations using supported native damage and passive rules.

Latest Decision: preserve native per-hit HP/BP order, repeated nested leaves and normal-command expiry. Apply verified MP cost multiplication/cancellation, ordinary ActionBegin recovery, Skill Flow scaling and flagged area-reduction bypass. Keep unsupported command context and recovery triggers explicit.

Next Step: remaining conditional effects, encounter overrides and broader recorded battle comparisons remain separate work. Normal nested expiry, queue preservation and initiative arithmetic are documented in command-verification.md and initiative-verification.md.

Known Blockers: full encounter fidelity remains uncalibrated; encounter overrides and the specific unverified mechanics above prevent a claim of an exact global best party.


Command and initiative evidence: [nested commands](command-verification.md), [native priority](initiative-verification.md). Fixed samples estimate order-dependent outcomes; they are not a prediction of the game RNG seed. Mixed attacks use up to four shortlisted skills and four successfully evaluated candidate recipes per loadout; setup-first Bravery/Faith/Deprotect/Deshell recipes are also considered. Interruptions, unknown duration extensions, enemy action scripts and exceptional initiative effects remain outside this search.

Search preserves each character’s saved setup before exploring alternative Resonances and gear under finite work budgets. A finite seed-assignment allowance establishes a completed legal incumbent before deeper combination passes. Neither stage has an elapsed-time cutoff.


Mixed command evidence: [mixed skills and status refresh](mixed-command-verification.md), [special actions](special-action-verification.md). Each leaf uses its own skill and native damage inputs. Bravery/Faith target the caster; Deprotect/Deshell affect its chosen enemy. Setup benefits to other party members are not projected by these nested recipes. An active setup effect also affects the character’s later LB while its native lifetime remains. Recasting these statuses refreshes duration without stacking potency. Magic Barrage pays the spell cost once per four-copy branch, with additive damage/stagger penalties; random target allocation limits numeric Barrage plans to one enemy.

## Resource and state commands

Paid opening and rotation plans track current HP/MP, luck, independently charged Overclock states, Overheat, Demon Form and Focus. HP-dependent bonuses use post-payment HP; Mana Overload’s native MP threshold uses the MP cached before each paid action. Other supported resource state is recomputed at its verified event boundary. Luck policies generate until the selected command is affordable, then spend; unverified same-selection resource gains are not credited. Ordinary queued attacks retain native queue semantics when Overclock expires; fresh selections remain subject to Overheat.

An optional incoming-hit scenario applies one fixed post-defense hit per character after its action each round, with physical/magical type selected explicitly. Mirror reduction, received-damage LB, counter costs and source survival are evaluated. It defaults to zero and does not predict enemy targeting or multi-hit reaction multiplicity. Initial combined counter-selection MP reservation remains unproven, so generated recommendations require a fully affordable response pair for each fresh stance. Bespoke reactions and encounter-specific Finish overrides remain outside this model.

Evidence: [HP payment](hp-cost-verification.md), [luck and Overclock](resource-state-verification.md), [forms, reactions and Focus](state-action-verification.md).

Gamble Shot is supported through sampled integer luck states: one shared Gamble roll, separate per-part accuracy checks, critical hits on success and a single +5 luck grant only if a part lands. Staggered targets bypass these failure checks. Forecasts average 32 reproducible paths; the displayed trace is one representative path, not a prediction of the game RNG. See [Gamble verification](gamble-verification.md).

## Additional phases and conditional passives

A new stagger grants normal-phase participation to its attacker; staggering all living enemies also grants the living party. Grants are unique per actor and cannot chain during Additional. Pending actors act in grant order, paying ordinary MP/HP/LB costs. Focus and luck do not receive another normal ActionBegin. The resource forecast distinguishes normal and paid additional actions.

Noctis and Vaan phase grants use native additive percentage-point passives, current-action landed criticals, and action-end Break timing. Call to Action costs its actual 10 AP and 40 MP and targets another living ally. Bonus Damage is evaluated only in the additional phase. Pilebunker adds stagger at the actual full LB capacity before damage; paid LBs consume gauge first. Hit and Run uses the explicitly configured incoming physical attack and committed attack history; it nullifies HP damage rather than cancelling the queue. Random outcomes are sampled, and the displayed resource trace is representative.

See [phase evidence](phase-verification.md) and [interrupt and conditional-passive evidence](interrupt-verification.md). Ordinary Finish selection is supported; arbitrary external interruption remains unmodeled; this is executable verification, not a live combat calibration.

## Finish attacks and healing

After an entered Additional phase and an all-enemies-staggered state, the party may choose one equipped Resonance finisher. The builder compares supported Finish options using current owner stats and effects. Physical/magic damage uses ATK/MAG, with intrinsic Light magic using Divine; friendly recovery uses Divine and a separately verified recovery kernel. There is no equipped ability slot or AP charge, and the current rows have zero base MP cost. Ordinary skill payment and source survival still apply; normal actor-start effects do not retrigger. Readiness has no demonstrated once-per-battle charge.

Tidus contributes nine single-target parts plus one group append, with no second payment or level boost. Firion/Shantotto's Finish LB gain uses20 base points with ordinary charge and actual capacity. Leah OverHeal can exceed maximum HP; Ayaka/Charlotte's base recovery clamps ordinary recipients. Durability uses final HP and configured incoming hits, including earned recovery. Secondary effects and unsupported recovery modifiers are reported explicitly. See [Finish verification](finish-verification.md).

Queued-child rejection preserves prior committed actions and does not imply SkillEnd or payment for the rejected child. Stagger removes future normal selections rather than proving a blanket cancellation of committed children. The traced delayed finalizer is tied to sequencer spawn handling. No random interruption frequency is invented for the optimizer.

Wilhelm and Cecil also supply their verified next-incoming-skill party barriers. These reduce physical or magical hits, expire after that selected incoming skill (including a Hit and Run nullification), and share the Finish's payment/cast count. Durability compares actual final HP; shield-only Finish selection requires a future configured incoming hit to gain protection value.
