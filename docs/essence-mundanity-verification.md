# Essence of Mundanity and Solar Pendant verification

This pass compares identical fixed builds with [FF Resonance Codex](https://ffresonancecodex.com/calculator), then resolves disagreements against the installed executable. It does not assume another calculator is the native reference.

## Matched builds

The 32 cases use level-55 Rain (Attack, Flame Sword, Fire) and Sakura (Flare), their native learned character commands, Crimson Saber or White Roselia, no armor or equipped Vision, and maximum Camille/Terra mastery rewards. Essence of Mundanity and Solar Pendant are independently on/off. The level-55 target has 300 physical/magic defense and either neutral resistance or a Fire weakness. Both engines use one ordinary action, full HP/MP, zero initial LB, no critical guarantee, and no initial stagger.

The exact public optimizer module loaded by the Codex UI was downloaded and its unchanged fixed-loadout function executed locally with the same catalog inputs. No save was uploaded. Public source code remains a local research artifact; the repository stores numeric reference results and hashes only, in `tests/fixtures/codex-mundanity-comparison.json`.

After correction, all 32 cases agree on relevant combat stats, AP, MP cost and expected stagger. The largest HP preview difference is 0.816919: Codex documents an expectation before final per-hit truncation; our existing native float32 path truncates the normal/critical outcomes before weighting. These single-hit examples remain within one HP. This is not evidence that all other mechanics agree.

| Matched case | Previous companion HP / stagger | Corrected companion HP / stagger | Codex HP / stagger |
| --- | ---: | ---: | ---: |
| Rain Attack, Solar + Mundanity, neutral | 469.687 / 25.263 | 657.566 / 13.121 | 657.717 / 13.121 |
| Sakura Flare, Solar + Mundanity, Fire-weak target | 8166.056 / 120.002 | 7621.073 / 20.000 | 7621.889 / 20.000 |

The numbers are expected damage per action in these fixed scenarios, including each skill's critical chance. They are not observed live damage rolls.

## Installed native evidence

Executable SHA-256: `B8C588E46EBADBE37FECA7BDF2DA0AE63A8538099D14A53EC0C2241B086E5FFA`. Native handlers and scalar blocks were copied into isolated Unicorn memory. Table/environment services and private allocation were supplied explicitly; no game process, executable or save was modified.

Mundanity passive 1389 supplies DamageMultiplier 12944 and BreakDamageVariation 15126. Their gates resolve the current skill row through owner skill ID `+0x3F8` and read that row's original element byte `+0x7E`:

- HP handler `0x145115D00`, shared gate `0x14510BEF0`, element check `0x14510C215–0x14510C230` (parameter 14).
- Stagger handler `0x145114160`, shared gate `0x14510BC70`, element check `0x14510BE3B–0x14510BE4C` (parameter 11).
- Current damage-type parameters are zero, so neither handler imposes a physical-only restriction. Non-elemental magic qualifies despite the localized description. Imbuing a physical None-element skill does not remove either modifier; an intrinsically elemental skill does not qualify.

`tests/fixtures/native-mundanity.json` records 34 isolated handler cases, including base-element and sentinel controls. The fix changes these gates to the skill row's element while elemental damage bonuses continue to use the resolved element.

Solar Pendant supplies passive 1521 / AddElementWhenNoneElement 40202. Native collector `0x14523DD20` retains an intrinsic element and dispatches the fallback getter at virtual `+0x4C0` only for a None-element row. Getter `0x145143C20` requires:

- HP parameter byte `+0x79 = 1`;
- Decrease or RatioDecrease byte `+0x7A` in `{1, 3}`;
- physical damage byte `+0x7B = 1`;
- native calculation row `doCalcElement` byte `+0xA` enabled;
- no forced AddElement contribution from `0x1452395D0`.

The `doCalcElement` offset is independently established by reflected setter `0x1444AD650`. Generic forced AddElement uses distinct getter `0x145143D90`; Solar's physical restriction is not imposed on that decoder. `tests/fixtures/native-imbue.json` records 15 full native collector cases, including forced-element precedence, natural elements, magical damage, recovery, non-HP damage and disabled element calculation. Incomplete skill metadata is deferred rather than assumed to qualify.

## Native contribution rounding

The actual HP aggregator `0x14523E3E0` retains Mundanity's float32 contribution `0.40000009536743164`, producing factor `1.4000000953674316`. The stagger accumulator adds `-0.49999988079071045` at `0x145232186`, retaining factor `0.5000001192092896`. Neither normalizes away the epsilon.

`tests/fixtures/native-mundanity-rounding.json` records native aggregator/scalar execution and two boundary examples: HP 47,765 instead of 47,764 before the applicable cap, and stagger 1,776 instead of 1,775. The fix preserves this contribution for the two verified effects while keeping displayed percentages at +40% and -50%. It does not claim bit-exact arbitrary mixed-effect summation or extend this correction to unverified effect families.

## Coverage and limits

Shared passive analysis supplies surrogate ranking, completed character builds, live paid actions and party rescoring. Regressions cover the original-element gate, physical/magic behavior, effective-element damage bonuses, forced-element precedence, incomplete metadata, full fixed builds and a two-member party. Search budgets and save handling are unchanged.

This pass establishes the listed installed-native rules and the bounded 32-case calculator comparison. It is not a fresh live-battle calibration, an exhaustive optimizer comparison, or verification of every Codex feature. Their broader formula research retains its own [documented scope](https://ffresonancecodex.com/research).
