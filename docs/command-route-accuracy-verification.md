# Command routes and ordinary accuracy

This follow-up qualifies ordinary menu routes and models native hit checks in the shared character/party evaluator. It enables supported low-accuracy actions, including Amelia's Rapid Fire and Disorder, without assigning every available skill to the equipped Vision's command. It extends the [stateful passive verification](new-native-passives-verification.md); the earlier public-calculator comparison is not rerun or reclassified here.

## Native command identity

Command identity has three separate inputs: the initial selected global command, a leaf's immediate parent menu/wrapper key, and its wrapper ancestry. A skill ID or equipped Vision alone is not a substitute for those inputs. Native action initialization copies action `+0x33C` into owner executing-command `+0x430`; each selected child can update it.

| Selected source | Supported route |
| --- | --- |
| Reached Awakening ActiveSkill of the equipped Vision | That Vision's offered command; e.g. Amelia 202. Unreached grants do not qualify. |
| Paid physical active slot, physical Spirit expansion, saved native/growth active, equipped-Vision reached Sync active | Generic command 1 only when the skill is actually available in this pool and its native `belongCommandList` includes 1. Ownership alone does not create a menu entry. |
| Sequential wrapper | Retains its actual wrapper parent; the native factory remaps a reached equipped-Vision Awakening leaf where the verified predicate permits it. Sync-only or merely paid/Spirit availability does not satisfy that predicate. |
| Arms Akimbo child | Opens another root menu. An eligible Awakening child can select its Vision menu while a paid/Spirit/Sync child selects generic 1. Children preserve their separate immediate parents and wrapper ancestry. |

For example, a generic Arms root can contain an explicitly selected Amelia 202 child. Its initial global command remains 1 while that child's parent is 202 and executing command becomes 202. Another generic child in the same recipe remains command 1. Magic Barrage's wrapper ancestry remains present even if its reached-Awakening spell is remapped. A command remap does not bypass repeat exclusions or resource/target eligibility.

Native root builder `0x14514D5D0` uses the owner's offered command list. The freshly extracted eight-character `DT_UnitBattleCmd` table supplies generic 1 and the equipped-Vision sentinel 899; conditional extra roots still need their actual conditions. Child-list builder `0x145240060` uses reached Awakening grants for Vision commands and the qualified owner active pool plus raw command membership for generic commands. Root getter `0x145167CC0` takes the first eligible selected command; tree/flatten writers preserve the immediate parent separately. Factory `0x144F40CB0` performs the remap rather than guessing from skill names.

The source proof contains **112 native checks**: 24 offered-source cases, 36 child-list cases, 35 Awakening-qualification cases, 10 global-root cases and 7 tree-parent/flatten checks. These counts are distinct bounded assertions, not 112 live menu selections. Compact provenance and route controls are retained in `tests/fixtures/native-command-route-sources.json`.

## Ordinary hit checks

Ordinary HP-decreasing Physic/Magic actions use native accuracy, matching physical/magic evasion and the target's resistance to the skill's status-condition key. `None` is a real queried key: an absent map entry gives zero, while an explicit None resistance of 100 forces a miss. Magic damage does not bypass accuracy, and guaranteed critical does not turn a miss into a hit.

The native integer hit threshold clamps base accuracy plus source accuracy variation minus matching capped evasion, then applies the status-resistance factor. It compares a discrete roll derived from the 15-bit native random value. It does not simply multiply damage by the displayed accuracy percentage.

| Controlled native case | Exact hit probability |
| --- | ---: |
| Rapid Fire/Disorder, accuracy 85, neutral target | 27852 / 32768 = 0.8499755859375 |
| Same Magic action, physical evasion 50 | Unchanged |
| Same Magic action, magic evasion 50 | 11469 / 32768 = 0.350006103515625 |
| Deathblow, accuracy 50, neutral target | 16384 / 32768 = 0.5 |
| Deathblow, physical evasion 50 | 0 |

Native ordinary kernel `0x145233AC0` is called per ratio/target by `0x144F71520`. Status resistance >=100 is checked before already-staggered, Additional and Finish hit bypasses. Those bypasses skip ordinary accuracy/evasion draws; they do not guarantee critical hits. On a landed part, HP calculation performs the critical check and BP shares that result. Halved and Absorb elemental results suppress ordinary critical flags.

Live scoring processes parts in order. Once a landed part causes stagger, later parts use the staggered state and skip further ordinary hit draws. A miss contributes zero HP and BP, cannot cause stagger, and cannot supply a landed critical or prior-attacker result. It still pays the action's normal HP/MP costs, completes its qualifying normal-skill counter and remains in skill history. Post-damage bundles require a landed result: missed Crystal Braver/Cecil Finish does not grant its Protect/guard benefit. These event-specific rules do not imply that every event is cancelled by a miss.

Conditional repeat admissions are rolled while the queue is built, before original hit rolls. An all-miss original can therefore still have an admitted Dual Guns clone. Each admitted clone checks and pays its own resources when reached; selection does not precharge both casts. Amelia's native free Awakening Rapid Fire uses four 85-accuracy parts per paid cast, and native free Dual Guns supplies its separate 25% admission roll.

## Evidence and verification

All native evidence uses installed executable SHA-256 `b8c588e46ebadbe37feca7bdf2da0ae63a8538099d14a53ec0c2241b086e5ffa`. Original instructions ran in isolated Unicorn memory with explicit synthetic tables, object state and RNG services. Static callers establish queue/event order separately. No game process, executable or save was modified. The fresh command-table conversion SHA-256 is `E0CB7D3DF2EC749B09DF1B812805F5B1649DC2D3F1C6F304D0B0B5AAF43ADB87`.

Accuracy evidence comprises **15 original-kernel scenarios**, **8 status-map/caller cases**, and **5 caller sequencing/phase cases**. Separately, every raw RNG value 0–32767 was executed through the original scalar comparison at thresholds 0, 35, 85 and 100: **131,072 scalar checks**. These are numeric/helper and call-order proofs, not a complete game encounter or a measured live RNG distribution. Numeric outcomes/provenance are retained in `tests/fixtures/native-ordinary-accuracy.json`.

`tests/command-route-sources.test.cjs` covers paid/Awakening/Spirit/Sync routes, nested parents, command-sensitive costs, missing-source rejection and fixed/joint party paths. `tests/ordinary-accuracy.test.cjs` covers native boundaries, source legality, matching evasion and all eight characters in controlled fixtures, including two legal four-character parties. `tests/ordinary-accuracy-state.test.cjs` covers payments/history on misses, repeat admission/payment order, immunity before phase bypass, per-part stagger ordering and missed post-damage rewards.

After the learned-active physical-filler correction and its new regression, the complete `node --test` run passed: **902 passed, 14 skipped, 0 failed** out of 916 tests. The populated post-correction browser verification is recorded below.

Combat forecasts use up to **32 reproducible sampled paths** for hit, critical, repeat and conditional combat outcomes. The displayed trace is a representative path. This is not a replay of the game's live RNG seed or a guarantee that one actual battle follows that trace. Finite search/assignment budgets remain; no elapsed-time cutoff has been restored.

## Populated browser walkthrough and physical filler correction

The read-only save-copy walkthrough exercised Lid with Amelia, Rapid Fire pinned and gear/Resonance pins retained. Stop kept a legal completed best build with 8 ability slots and 410/516 AP. Pinning every ability then bounded the candidate space and Build finished at its search limit. The party builder produced a legal, fully scored four-member checkpoint, which Stop retained. These observations recorded no console warnings/errors; the unrestricted whole-inventory party search was not run to completion.

This walkthrough also found an Awakening-only free Fire action being physically selected as a Versatility filler. The current manual-equip contract admits learned active skills, so filler candidates now use that same learned-active pool. Free Awakening casting and the UI remain separate from physical filler admission. This conservative correction does not claim that the native equip menu was replayed or proved to enforce the same restriction. The earlier release's Fire-slot benefit is historical evidence, not proof of a legal physical equip route.

After the correction, a fresh page/worker run with the same real save copy completed the Rapid Fire search at its finite search limit, preserving five gear/Resonance pins and seven ability pins. The selected build had 8/8 slots, 380/516 AP, native hit probability 0.8499755859375 and 32 combat samples. Fire remained available as a free action without being physically selected. No unknown ability label, unavailable-ability warning or console warning/error remained. This is browser/model verification, not fresh live-game calibration; the final whole-inventory party search was not run to completion.

## Remaining boundaries

Special Mimic/item/forced-enemy/debug routes, skill-only stacks without a qualified root and exceptional Vision-beneficiary/Finish fastpaths are not inferred from ordinary character menu rules. Unsupported setup/rotation/luck/Magic Barrage/temporary-modifier automatic-repeat combinations remain excluded rather than receiving guessed commands or extra casts. Direct Finish has its separate verified selection/payment rules.

The scalar accuracy proof does not model every target force-miss/nullification class (including the native virtual `+0x4B0` gate), special calculation branch, scripted interruption or live status-map producer. Existing supported nullification effects retain their own scope. Encounter scripts, variance-RNG consumption and arbitrary effect ordering are not exhaustively reproduced. These limits can change a real best build; the work is not fresh live-game calibration or proof of a global optimum.
