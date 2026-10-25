# Native passive decoding, 2026-10-25

Current Goal: account for native passive modifiers without turning conditional, random or event-triggered effects into permanent bonuses.

Latest Decision: decode current native effect types/parameters and retain bundle target, timing and condition gates. Unknown mechanics stay visible as exclusions. No save or game modification is needed.

Next Step: integrate these terms with the native damage/stat calculations and validate representative battles. Identical-effect multi-copy stacking and several bespoke effects remain unresolved.

## Sources

- `data/source/rows/Skill/DT_SkillEffectData.json`: current native effect ID/type, parameters, activation probability, activation condition and apply/proceed timings.
- `data/source/rows/Skill/DT_PassiveSkillData.json`: current native passive effect bundles with recipient, relation, passive add timing and separate condition data.
- `data/companion-catalog.json`: normalized current rows, historical localization explicitly separate.
- `<FFR Vision Studio>/engine/data/mucha_enums.hpp`: native `eElement` at line1563, `eResistance` at2389, `eSkillAttributeType` at2426, damage types at2492, conditions at2499, `eSkillEffectType` at2524, parameter types at2938, parameter variations at2963.
- Native common multiplier helper `0x14523e3e0`: starts at1, sums factors from attacker effects at `DamageCalculation` and (when target is broken) `DamageCalculationOnBreak`, then adds elemental factor terms and clamps at0. Independently traced in the damage-mechanics workstream.
- Native critical multiplier helper `0x145238c00`: native critical base plus summed critical-factor terms. Independently traced in the damage-mechanics workstream.

## Examples that guard against incorrect build rankings

- Effect16001 (Physical Attack+10%) is `DamageMultiplier`, not a +10% ATK stat buff. Native `params[5]=1` selects physical damage. Effect16011 uses2 for magic damage. These go in the native additive damage bucket.
- Effect12928 is physical critical-only +40%; `params[10]=1`. It must not affect an ordinary hit.
- Passive1385 Power Stagger adds effect12126 during `BeginDmgCalc`, but that effect's native `applyTiming` is `DamageCalculationOnBreak`. It contributes only when the target is broken.
- Passive1408 Lustrous Shield adds light imbue40000 and break bonus15053 at `BeginCounter`. Neither is a permanent starting bonus.
- Passive1438 Momentum Shift adds15105 only at `OnDefeat`.
- Effect16301 HP+10% is `ParameterContinuousVariation [10,1,2,...]`: parameter1 is HP, variation2 is RatioIncrease. Effect16401 uses parameter2 (MP); speed passives use9 (Agility). Each effect contribution is truncated separately by the native stat getter; the combined percentage summary is not sufficient for exact rounding.
- Effect1147 is Fire `AddElementWhenNoneElement`. It can pair with fire effect12955 +20% only when its scope actually leaves the skill Fire. Conflicting imbues are deferred because precedence has not been verified.
- Element-specific break effect15141 has `applyTiming=BreakDmgCalculation`; it never increases normal HP damage just because its type is also `DmgMulElement`.
- Native elemental priority data ranks Absorb above Invalid above Halved above Weakness above None. These are categories, not additive resistance percentages.

## Public module contract

`CompanionPassives.analyze(catalog, passiveIds, context)` (UMD/CommonJS) returns:

- `modifiers`: native flat/percentage stat contributions, additive damage/element/break/critical terms, imbues, category resistances and utility flags;
- `terms`: supported decoded effects that matched supplied conditions;
- `applied`, `inactive`, `deferred`, `unsupported`: auditable coverage, retaining passive/effect IDs and exclusion reasons;
- `damageFactor` and `breakFactor`: supported additive contribution only, never a complete battle prediction;
- `complete`: false whenever context/unsupported effects prevent a complete passive evaluation;
- `damageStackingVerified`: true for the common native additive bucket; `identicalEffectStackingVerified`: false.

Context can include `skill: {id,dmgType,attr,element}`, HP/MP/LB percentages, command ID, broken/critical/extra-phase flags, self and target status IDs, analyzed flag, and explicit `eventTimings`. `activeEffectIds` may supply effects already applied to this subject by a legal action; the battle planner owns action/recipient/turn-duration legality. Those effects use the same native parameter decoder and additive damage bucket. Missing required inputs defer the term rather than pretending it is active. Skill IDs must be numeric native IDs. Native damage labels are `Physic` and `Magic`.

## Limits

The module does not model a complete battle event queue. Reaction chains, random repeats/counters, status infliction chances, temporary state accumulation, extra actions, skill-specific coefficient changes, race damage, and most bespoke unique passives stay explicit exclusions. It does not infer parameters from English prose or treat ownership as proof a passive is equipped. The caller must supply passives that are validly learned/equipped/free from the current loadout and enforce their equip-cost capacity.

The native common additive damage bucket is verified. Identical-effect duplicate stacking, cross-family defensive stacking and some skill/condition parameter interpretations still need further native/runtime evidence; they must remain visible in recommendation confidence.

## Current native skill-state and wrapper rules

`docs/skill-rules.json` contains freshly extracted `Skill/Other/DT_SkillGeneralData`, `DT_SkillDamageCalcData`, `DT_SkillRecoveryCalcData`, `DT_SkillAttributeDetailData`, and `DT_SkillTargetData`, with file hashes and comparison results. All five current table row sets exactly match the historical snapshot. Sources were independently re-extracted to `%TEMP%/ffrs-current-skill-rules-20261025/` from the installed game using the existing retoc and ffr-dt tools.

`skillEligibility(skill, context, rules)` returns `{eligible, reasons, deferred, nativeRulesUsed, additionalCosts, resourceChecks, costOverride}`. It checks native configured hierarchy exclusions, normal/demon-form locks, extra-phase locks, attribute status restrictions, LB checks and resource-check metadata. Ambiguous EventFlag/DivineRadiance gate direction is conservatively deferred unless `context.validatedUsableSkillIds` explicitly contains the action. This prevents story-only Last Resonance actions and transform/cancel actions in the wrong form from becoming normal damage recommendations.

For a normal battle, supply explicit `{demonForm:false,extraPhase:false,awakeningPower:false,hasEscaped:false,lbPercent:0}`. A selector can pass `selectorId` or a complete `hierarchySkills` chain. Arms Akimbo's native hierarchy forbids specific subactions, including Arms Akimbo itself; it does not directly forbid Dualcast, so the existence of that configuration must not be treated as proof of how many total spells a nested sequence executes. Dualcast's native Magic attribute and Double Action's non-Magic scope are enforced. MP and action-time costs remain the planner's responsibility.

Native calculation flags are important: Physic/Magic enable ordinary coefficient, element, hit, critical, break, variance, defense and effect calculations. Fixed damage disables those modifiers. The planner must honor the per-calc-type flags rather than applying every passive modifier to every damage formula.
