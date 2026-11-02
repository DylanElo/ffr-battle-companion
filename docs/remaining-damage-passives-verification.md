# Remaining damage passives: calculator and native verification

This extends the [Mundanity comparison](essence-mundanity-verification.md) against [FF Resonance Codex](https://ffresonancecodex.com/calculator). Both builders use the corrected shared passive analysis and battle scoring. Agreement with another calculator is a cross-check; installed native execution resolves disagreements.

## Comparison scope

The inventory contains **114 damage-related passives**, including Mundanity as a prior verified control, across **477 fixed-loadout probes**. It covers outgoing HP/stagger damage, criticals, damage caps, area effects, higher-stat selection and casting effects, including conditional members. Sustain, survival-only and utility families are outside this inventory.

The probes use level 55, 26 Visions at mastery rank 9/awakening 4, native learned commands, and compatible recorded source equipment or required awakening grants. Transferred mastery passives are paid; free source grants and bundled co-grants remain intact. Relevant stats are checked separately from damage. The unchanged public fixed-loadout optimizer was executed locally with matching inputs; no save was uploaded. Public code remains a local research artifact, not a production dependency.

| Probe outcome | Count |
| --- | ---: |
| Damage-kernel agreement, allowing final per-hit HP rounding | 314 |
| Complete fixed-action repeat-sequence agreement | 4 |
| Native confirms Companion; reference differs | 8 |
| Reference model incomplete | 62 |
| Both models incomplete | 72 |
| No recorded native source provider | 11 |
| No source-compatible native action of the required attribute | 4 |
| Selected action unavailable | 2 |

At the passive level, 60 have active numeric agreement in the tested states, 6 have native-confirmed reference differences, 34 have incomplete coverage, 13 are partly or wholly blocked, and 1 has only inactive/partial-term controls. These categories cover all 114; inactive agreement does not validate an effect. There are no unexplained numeric/stat differences among the completed, supported probes. Differences in incomplete models remain unresolved.

Entered HP percentages and qualified status counts in scalar probes are controlled abstractions, not integer-resource or live-status transport proofs. The paid-action and native-handler tests below check those boundaries separately. Raw damage-kernel comparisons do not stand in for complete action sequences; Dual Spellblade has separate full fixed-action comparisons. Guaranteed-critical BP and already-staggered BP are excluded where the public API has no equivalent output.

## Corrections shared by both builders

| Rule | Corrected behavior and native evidence |
| --- | --- |
| Light magic | Magic calculation with an intrinsic Light element uses Divine/Sanctity, bypassing Dominant Power. An effective Light imbue does not select Divine. Physical calculation retains ATK/adaptive selection. Native selector `0x14522F0F0` calls Divine getter `0x145239500`. Equipment ordering follows the same attack stat. |
| Critical stagger | BP receives the same critical-damage bonus aggregator as HP. The caller now forwards CritMul bonuses; native `0x1452320FC` calls `0x145238C00`. |
| Staggering Spells | Effect 15116's trailing filter supports HP-decreasing actions and the native `doCalcSkillEffect` flag. It is not rejected as an unknown layout or confused with True Stagger effect 15125. Getter `0x14513BAB0`. |
| Dark Rite / Latent Potential | The missing-HP bonus uses native float32 ratio, integer lost-percentage steps and effect-specific HP/BP buckets. It reads post-payment current HP, preserves native overheal behavior, and filters skill attribute rather than damage type. Latent Potential uses the owner's actual normal-attack ID or configured general normal-attack list. Getter `0x145147FD0`; normal predicate `0x144FB8EC0`. |
| Aggravation | Counts eligible bad-status effect instances, not unique status IDs or arbitrary debuffs; applies the native cap/epsilon arithmetic. Unknown qualified instance counts remain deferred. Collector `0x145237BF0`, getter `0x145146020`. |
| Tenebrous Rites / Insult to Injury | Require an active bad status when their positive gate is enabled. Zero/-1 bypass the gate. This activation-qualified condition is separate from Aggravation's instance count. Predicate path `0x145240BF0` / `0x14523E890`. |
| Scan and Strike | Requires an analyzed target and an actual weakness, including supported resistance passives. A positive native gate enables both requirements. |
| Weakness Exploiter / Vital Strike | Add the native delta to both HP and BP weakness factors: approximately +0.2/+0.3, giving BP factors 3.2/3.3. The reference omits the BP addition. |
| Mana Overload | Its MP threshold reads MP cached before this action's payment. HP gates still read post-payment HP. Each paid child/repeat refreshes its own cache. Native action initialization `0x144F65177–0x144F6519B`; threshold read `0x14510C185–0x14510C1B5`. |
| Opening effects / Honing Sense | Fresh ordinary-battle duration-N opening effects apply in rounds 1 through N; Additional does not advance their global-turn lifetime. Honing Sense applies +40% damage and +20 critical-threshold points only to the nine native `meikyoIds`. Duplicate Honing status merging is not assumed additive. |
| Braver intrinsic | Its supported Self/BeforeDamageCalculation CritMul effect 13300 applies before that skill's HP and BP calculation, then expires at DamageCalcEnd. Strict recipient, condition and probability checks prevent generalizing arbitrary intrinsic effects. |
| Dual Spellblade | Passive 1414/effect 54212 adds one paid MagicSword clone per eligible original. Originals queue first: A,B,A,B. Each clone checks affordability independently; an affordable original remains valid if its clone cannot be paid. Clones do not recurse or consume an extra AP/ability slot. Passive 1415 supplies a different stagger effect and does not itself repeat. |

Default normal attacks come from installed `DT_BtlUnitAIParameter.fightSkillId`: characters 1001–1005 use 401010–405010, Archwitch Fina 1006 uses 408010, Jake 1007 uses 406010, and Sakura 1008 uses **407010**. This is a default table proof; arbitrary runtime overrides remain outside it.

Automatic repeats with setup rotations, luck policies or overlapping temporary command modifiers remain excluded with a warning; their state transport has not been proved. Other RepeatAction layouts, including Dual Guns, are not inferred from 54212.

## Intentional reference differences

Eight probes retain native-confirmed differences. Four Weakness Exploiter/Vital Strike probes receive the BP weakness-factor additions described above. Four Ultima Reactor co-grant probes at 50% HP have a tiny expected-BP difference: native critical BP rounds to **44**, while Codex yields **43**; the expected difference is one BP multiplied by critical probability. Companion keeps the native result. Small HP preview differences follow the final per-hit integer rounding boundary, rather than a different stat setup.

## Evidence and reproducibility

The installed executable SHA-256 is `B8C588E46EBADBE37FECA7BDF2DA0AE63A8538099D14A53EC0C2241B086E5FFA`. Original native handlers/selectors were copied into isolated Unicorn memory, with explicit synthetic table/environment services and private allocation where needed. Static traces establish call/event order where an oracle only executes a scalar handler. No game process, executable or save was modified. This is executable/static verification, **not fresh live combat calibration**.

The public optimizer snapshot is `_next/static/chunks/optimizer-BNvqSok5.js`, SHA-256 `fdb1d3ddcf0a798238dd1aed8ee668525a2ff47402ae168c22f15481cf4a7117`; `data/planner.json` is `1351761685a2c9417d4164c18b860fd7f4cebf52ae39a5f06d70bbb9577267a7`. The normal-attack table hash is `c2512906dcd478d7963e7abd6bb5e2a9bad3aff416f4e62fe1ece0160080d6a5`. These identify researched artifacts, not a promise that the remote calculator or game data will remain unchanged.

Regression fixtures retain numeric native outcomes in `tests/fixtures/native-hp-stepped.json`, `native-break-trailing.json`, `native-aggravation.json`, `native-honing.json` `native-mp-threshold.json`, `native-weakness-variation.json` and `native-ultima-reactor-bp.json`. The `tests/remaining-damage-*.test.cjs` files cover passive decoding, fixed builds, shared party scoring, post-payment HP, pre-payment MP, opening expiry, repeat queue/payment behavior and Braver's intrinsic effect. Those checks are distinct from the 477 public-calculator probes and from live runtime validation.

## Remaining limits and search behavior

Versatility needs the actual current-command ActiveSkill grants, not a count of all learned skills or Spirit IDs. Improvement needs a transported prior completed-normal-attack counter. The Hand That Heals, True Stagger, Heroic Nature, Trigger, Lone Lion, Thievery, Play Rough, Odin's Blessing, Dual Guns, Bastion and Perfect Serenity still have unmodeled state/effect families. Conditional command, steal, on-defeat, protection and random-effect context also remains incomplete for affected sources. Agreement while these effects are inactive is not evidence that they work. These omissions can change the best real damage build.

Elapsed-time cutoffs and automatic UI watchdog cancellation have been removed from both builders, shared evaluation, explanations, unlock recommendations and party comparison. Legacy time/deadline options do not reinstate them. Searches retain finite evaluation counts, candidate pruning, joint-assignment limits, a party beam and explicit Stop. A small finite seed-assignment allowance establishes a legal completed incumbent before the deeper passes. Stop terminates the worker and retains its last completed legal checkpoint; unfinished evaluations are discarded.

The UI currently allows up to 5,000 character candidate evaluations and 12,000 party candidate evaluations, with further finite per-loadout/assignment caps. These are work limits, not elapsed-time limits. Full searches can take substantially longer, including many minutes for expensive inventories. Removing the clock does not make the finite search exhaustive or prove a global optimum. Deferred/unsupported effects remain visible rather than receiving invented bonuses.

## Validation

The local CI command `node --test` passed with 827 tests and 14 existing skips. Populated browser checks kept both searches running beyond their former UI cutoffs. Stop retained a fully scored Sakura build with 8/8 abilities at 505/516 AP and a legal four-member party with 8/8 abilities per member. No browser errors or warnings were recorded. This checks progress and cancellation, not completion time for a full unrestricted production inventory search.

## Passive inventory and coverage

The final column names effect IDs without an active numeric agreement in these probes; it is not a claim that every listed effect is unsupported locally.


| ID | Passive | Probes | Coverage | Status counts | Effects without active agreement |
|---|---|---:|---|---|---|
| 1047 | Break the Limit | 4 | active numeric agreement in probed states | agreement_with_rounding:4 |  |
| 1099 | Weakness Exploiter | 4 | native confirms local; reference differs | agreement_with_rounding:2, native_confirmed_reference_error:2 | 1220 |
| 1103 | Magic Boost | 6 | active numeric agreement in probed states | agreement_with_rounding:6 |  |
| 1234 | Critical Boost | 4 | active numeric agreement in probed states | agreement_with_rounding:4 |  |
| 1247 | Critical Hit Rate +10% | 2 | active numeric agreement in probed states | agreement_with_rounding:2 |  |
| 1273 | Physical Attack +30% | 2 | active numeric agreement in probed states | agreement_with_rounding:2 |  |
| 1275 | Magic Attack +30% | 2 | active numeric agreement in probed states | agreement_with_rounding:2 |  |
| 1278 | Stagger Power +10% | 2 | active numeric agreement in probed states | agreement_with_rounding:2 |  |
| 1279 | Stagger Power +20% | 2 | active numeric agreement in probed states | agreement_with_rounding:2 |  |
| 1294 | Bravery Opener | 6 | active numeric agreement in probed states | agreement_with_rounding:6 |  |
| 1295 | Faith Opener | 6 | active numeric agreement in probed states | agreement_with_rounding:6 |  |
| 1304 | Auto-Faith | 2 | active numeric agreement in probed states | agreement_with_rounding:2 |  |
| 1308 | Physical Attack +10% | 2 | active numeric agreement in probed states | agreement_with_rounding:2 |  |
| 1309 | Physical Attack +20% | 2 | active numeric agreement in probed states | agreement_with_rounding:2 |  |
| 1310 | Magic Attack +10% | 2 | active numeric agreement in probed states | agreement_with_rounding:2 |  |
| 1311 | Magic Attack +20% | 2 | active numeric agreement in probed states | agreement_with_rounding:2 |  |
| 1321 | Critical Hit Rate +5% | 2 | active numeric agreement in probed states | agreement_with_rounding:2 |  |
| 1329 | Weak Element Stagger Power +30% | 4 | active numeric agreement in probed states | agreement_with_rounding:4 |  |
| 1332 | Sharp Mind | 6 | active numeric agreement in probed states | agreement_with_rounding:6 |  |
| 1335 | Bonus Damage | 4 | active numeric agreement in probed states | agreement_with_rounding:4 |  |
| 1337 | Decimating Attacks | 6 | incomplete model coverage | reference_model_incomplete:6 | 12917 |
| 1340 | Versatility | 2 | incomplete model coverage | both_model_incomplete:2 | 12939 |
| 1351 | Area Effect Adept | 6 | incomplete model coverage | reference_model_incomplete:6 | 19002 |
| 1357 | Leaping Cleave | 4 | active numeric agreement in probed states | agreement_with_rounding:4 |  |
| 1358 | Vigorous Attacks | 8 | active numeric agreement in probed states | agreement_with_rounding:8 |  |
| 1370 | Staggering Spells | 2 | active numeric agreement in probed states | agreement_with_rounding:2 |  |
| 1371 | Vigorous Staggerer | 8 | active numeric agreement in probed states | agreement_with_rounding:8 |  |
| 1373 | Weak Element Stagger Power +40% | 4 | active numeric agreement in probed states | agreement_with_rounding:4 |  |
| 1374 | Weak Element Stagger Power +50% | 1 | partially or wholly blocked | no_native_source:1 | 1433 |
| 1376 | Stagger Power +30% | 2 | active numeric agreement in probed states | agreement_with_rounding:2 |  |
| 1383 | Rearguard | 2 | incomplete model coverage | both_model_incomplete:2 | 16004,54222 |
| 1385 | Power Stagger | 8 | active numeric agreement in probed states | agreement_with_rounding:8 |  |
| 1388 | Critical Stagger | 4 | active numeric agreement in probed states | agreement_with_rounding:4 |  |
| 1389 | Essence of Mundanity | 2 | active numeric agreement in probed states | agreement_with_rounding:2 |  |
| 1393 | The Hand That Heals | 2 | incomplete model coverage | both_model_incomplete:2 | 12947,15130 |
| 1396 | Stealth Specialist | 2 | incomplete model coverage | reference_model_incomplete:2 | 12938 |
| 1398 | Vital Strike | 4 | native confirms local; reference differs | agreement_with_rounding:2, native_confirmed_reference_error:2 | 12979 |
| 1399 | Scan and Strike | 6 | active numeric agreement in probed states | agreement_with_rounding:6 |  |
| 1400 | Bonus Phase Stagger Boost | 4 | active numeric agreement in probed states | agreement_with_rounding:4 |  |
| 1404 | Pilebunker | 6 | incomplete model coverage | reference_model_incomplete:6 | 15150 |
| 1405 | Staggeringly Risky | 2 | active numeric agreement in probed states | agreement_with_rounding:2 |  |
| 1406 | True Stagger | 2 | incomplete model coverage | both_model_incomplete:2 | 15125 |
| 1408 | Lustrous Shield | 6 | incomplete model coverage | both_model_incomplete:6 | 15053,40000 |
| 1409 | Heroic Nature | 2 | incomplete model coverage | both_model_incomplete:2 | 12901 |
| 1410 | Job Change | 6 | incomplete model coverage | both_model_incomplete:6 | 19024 |
| 1411 | Late Bloomer | 6 | incomplete model coverage | reference_model_incomplete:2, both_model_incomplete:4 | 12902 |
| 1412 | Chuck | 4 | partially or wholly blocked | agreement_with_rounding:2, no_native_attribute_action:2 | 19001 |
| 1414 | Dual Spellblade | 4 | active numeric agreement in probed states | agreement_with_rounding:2, sequence_agreement_with_rounding:2 |  |
| 1415 | Spellblade Wielder | 10 | active numeric agreement in probed states | agreement_with_rounding:8, sequence_agreement_with_rounding:2 |  |
| 1418 | Signature Moves | 8 | partially or wholly blocked | agreement_with_rounding:6, unavailable_selected_action:2 |  |
| 1420 | Broadsword Mastery | 8 | incomplete model coverage | both_model_incomplete:8 | 13103 |
| 1421 | Improvement | 2 | incomplete model coverage | both_model_incomplete:2 | 12904,15102 |
| 1422 | Trigger | 2 | incomplete model coverage | both_model_incomplete:2 | 12906,15103 |
| 1423 | Lone Lion | 2 | incomplete model coverage | both_model_incomplete:2 | 16601 |
| 1424 | Latent Potential | 8 | active numeric agreement in probed states | agreement_with_rounding:8 |  |
| 1425 | Insult to Injury | 8 | active numeric agreement in probed states | agreement_with_rounding:8 |  |
| 1426 | Thievery | 6 | incomplete model coverage | both_model_incomplete:6 | 12905 |
| 1428 | Tip-Top Shape | 8 | active numeric agreement in probed states | agreement_with_rounding:8 |  |
| 1430 | Tenebrous Rites | 8 | active numeric agreement in probed states | agreement_with_rounding:8 |  |
| 1431 | Dark Rite | 8 | active numeric agreement in probed states | agreement_with_rounding:8 |  |
| 1433 | Play Rough | 2 | incomplete model coverage | both_model_incomplete:2 | 12926 |
| 1434 | Skyward Dreams | 2 | incomplete model coverage | both_model_incomplete:2 | 15104 |
| 1438 | Momentum Shift | 6 | incomplete model coverage | both_model_incomplete:6 | 15105 |
| 1439 | Odin’s Blessing | 2 | incomplete model coverage | both_model_incomplete:2 | 12927,15121 |
| 1440 | Fulminating Spells | 6 | incomplete model coverage | both_model_incomplete:6 | 15108 |
| 1441 | Scion Sorceress | 2 | incomplete model coverage | reference_model_incomplete:2 | 19012 |
| 1443 | Dual Guns | 4 | incomplete model coverage | both_model_incomplete:2, no_native_attribute_action:2 | 54220 |
| 1445 | Mana Overload | 8 | active numeric agreement in probed states | agreement_with_rounding:8 |  |
| 1447 | Screwdriver | 2 | incomplete model coverage | both_model_incomplete:2 | 15129 |
| 1454 | Bastion | 2 | incomplete model coverage | both_model_incomplete:2 | 15127 |
| 1464 | Skill Flow | 2 | incomplete model coverage | reference_model_incomplete:2 | 12909,15109 |
| 1468 | Aggravation | 8 | active numeric agreement in probed states | agreement_with_rounding:8 |  |
| 1471 | Radiant Light | 1 | partially or wholly blocked | no_native_source:1 | 16604,19017 |
| 1475 | The Power Within | 1 | partially or wholly blocked | no_native_source:1 | 16602 |
| 1480 | Critical Hit Rate +20% | 2 | active numeric agreement in probed states | agreement_with_rounding:2 |  |
| 1481 | Critical Hit Rate +30% | 2 | active numeric agreement in probed states | agreement_with_rounding:2 |  |
| 1482 | Costly Stagger (S) | 6 | incomplete model coverage | reference_model_incomplete:6 | 15001 |
| 1483 | Costly Stagger (M) | 6 | incomplete model coverage | reference_model_incomplete:6 | 15003 |
| 1484 | Costly Stagger (L) | 1 | partially or wholly blocked | no_native_source:1 | 15005 |
| 1485 | Costly Attack (S) | 6 | incomplete model coverage | reference_model_incomplete:6 | 12001 |
| 1486 | Costly Attack (M) | 6 | incomplete model coverage | reference_model_incomplete:6 | 12002 |
| 1487 | Costly Attack (L) | 6 | incomplete model coverage | reference_model_incomplete:6 | 12003 |
| 1488 | Costly Attack (XL) | 1 | partially or wholly blocked | no_native_source:1 | 12005 |
| 1489 | Auto-Bravery | 2 | active numeric agreement in probed states | agreement_with_rounding:2 |  |
| 1491 | Legendary SOLDIER | 6 | incomplete model coverage | reference_model_incomplete:6 | 19046,19065 |
| 1493 | Perfect Serenity | 2 | incomplete model coverage | both_model_incomplete:2 | 12973 |
| 1494 | Ultimate Aggression | 2 | inactive or partial term controls only | agreement_with_rounding:2 | 13306,13307 |
| 1495 | ダメージ+２０％ | 6 | active numeric agreement in probed states | agreement_with_rounding:6 |  |
| 1496 | クリティカルダメージ+３０％ | 4 | active numeric agreement in probed states | agreement_with_rounding:4 |  |
| 1497 | クリティカル時ブレイクダメージ+３０% | 4 | active numeric agreement in probed states | agreement_with_rounding:4 |  |
| 1500 | ダメージ+30％ | 6 | active numeric agreement in probed states | agreement_with_rounding:6 |  |
| 1506 | クリティカル50％アップ | 2 | active numeric agreement in probed states | agreement_with_rounding:2 |  |
| 1507 | いきなり研ぎ澄まし | 10 | active numeric agreement in probed states | agreement_with_rounding:10 |  |
| 1512 | いきなり精神集中 | 6 | active numeric agreement in probed states | agreement_with_rounding:6 |  |
| 1514 | いきなり明鏡止水 | 6 | active numeric agreement in probed states | agreement_with_rounding:6 |  |
| 1515 | いきなり賢者の目 | 8 | active numeric agreement in probed states | agreement_with_rounding:8 |  |
| 1516 | アルテマスキル1 | 8 | native confirms local; reference differs | agreement_with_rounding:7, native_confirmed_reference_error:1 |  |
| 1517 | アルテマスキル2 | 8 | native confirms local; reference differs | agreement_with_rounding:7, native_confirmed_reference_error:1 |  |
| 1518 | アルテマスキル3 | 8 | native confirms local; reference differs | agreement_with_rounding:7, native_confirmed_reference_error:1 |  |
| 1519 | アルテマスキル4 | 8 | native confirms local; reference differs | agreement_with_rounding:7, native_confirmed_reference_error:1 |  |
| 1532 | 火属性ダメージ20％アップ | 4 | active numeric agreement in probed states | agreement_with_rounding:4 |  |
| 1533 | 光属性ダメージ50％アップ | 4 | active numeric agreement in probed states | agreement_with_rounding:4 |  |
| 1534 | 氷属性ダメージ40％アップ | 4 | active numeric agreement in probed states | agreement_with_rounding:4 |  |
| 1535 | 水属性ダメージ30％アップ | 4 | active numeric agreement in probed states | agreement_with_rounding:4 |  |
| 1536 | 光属性強化 | 4 | active numeric agreement in probed states | agreement_with_rounding:4 |  |
| 1537 | 雷属性ブレイクダメージ30％アップ | 4 | active numeric agreement in probed states | agreement_with_rounding:4 |  |
| 1538 | 無属性強化 | 4 | active numeric agreement in probed states | agreement_with_rounding:4 |  |
| 1539 | クリティカル強化 | 4 | active numeric agreement in probed states | agreement_with_rounding:4 |  |
| 1541 | 闇属性ダメージ倍率+10% | 1 | partially or wholly blocked | no_native_source:1 | 12963 |
| 1542 | 闇属性ダメージ倍率+20% | 1 | partially or wholly blocked | no_native_source:1 | 12968 |
| 1543 | 闇属性ダメージ倍率+30% | 1 | partially or wholly blocked | no_native_source:1 | 12969 |
| 1544 | 闇属性ダメージ倍率+40% | 1 | partially or wholly blocked | no_native_source:1 | 12970 |
| 1545 | 闇属性ダメージ倍率+50% | 1 | partially or wholly blocked | no_native_source:1 | 12971 |
| 1546 | 闇属性ダメージ倍率+60% | 1 | partially or wholly blocked | no_native_source:1 | 12972 |

## Source hashes

- localPassivesSha: `cca155d507ce2a991f0efe00ad5ab1016aac648f047aabf6893d98be1f7dab35`
- localBattleSha: `fdd85f2e2b71fd07561037b834a118ea4e8d12281ec3f565e25b11cc78c08886`
- externalOptimizerSha: `fdb1d3ddcf0a798238dd1aed8ee668525a2ff47402ae168c22f15481cf4a7117`
- plannerSha: `1351761685a2c9417d4164c18b860fd7f4cebf52ae39a5f06d70bbb9577267a7`

## Handoff

Current goal: compare all direct damage families without treating the public calculator as native truth.
Latest decision: retain native-proven BP weakness additions; expose every unresolved condition and blocked source.
Next step: rerun this scratch matrix after integration and interpret remaining differences against native evidence.
Known limits: static entered-state projections do not prove live battle sequence behavior or repeated effect-instance lifetimes.
