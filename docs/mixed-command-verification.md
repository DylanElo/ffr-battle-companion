# Mixed commands and setup-effect verification

Current Goal: replace the repeated-one-skill search restriction with supported mixed commands, while preserving native target, cost, hierarchy and effect-lifetime rules.

Latest Decision: ordinary eligible mixed attack leaves are legal. The four deterministic setup spells below can precede a compatible attack in Arms or Dualcast; their effect begins after the setup action, not before it.

## Evidence boundary

This is read-only static executable and cooked-data verification. Executable SHA-256: `B8C588E46EBADBE37FECA7BDF2DA0AE63A8538099D14A53EC0C2241B086E5FFA`. Derived vectors are retained in [native-mixed-commands.json](../tests/fixtures/native-mixed-commands.json). They are not captured battle damage measurements.

## Different skills can occupy sibling choices

The previously traced queue appends each selected occurrence and preserves depth-first sibling order. It neither requires siblings to have the same ID nor normalizes their damage type. Root initialization `0x14514D5D0` reads the current active/vision skill list and local availability. Its local deduplication prevents duplicate menu entries; it does not equate the two selections or require the same attack.

| Wrapper | Native child filter | Consequence |
| --- | --- | --- |
| Arms Akimbo | Root: eligible available actions, without a damage/attribute predicate | A physical attack and a magic attack can share one recipe; support actions may also be chosen where hierarchy permits. |
| Dualcast | Magic attribute, without a damage predicate | Different elements and support magic followed by damage magic are legal choices. |
| Double Action | Damage skill and non-Magic attribute | Different eligible nonmagic damage actions are legal; Faith and other nondamaging support choices are excluded by the native filter. |
| Magic Boost | Damage skill and Magic damage type | The selected child may differ from the following Arms sibling. Its modifier still expires after its own selected damage action. |

The full native hierarchy must be checked for every child, including enclosing Arms. Ordinary cost and AP/slot checks still apply to each distinct ability. See [command verification](command-verification.md) for the complete flatten/delegate/queue trace and individual cost payment order.

## Setup magic applies before the following child

The current skill/effect rows define:

| Skill | MP | Installed effect | Scope |
| --- | ---: | --- | --- |
| Bravery 230100 | 6 | 19049, +50% physical damage in the native additive bucket | Selected friendly, including the caster |
| Faith 230110 | 6 | 19050, +50% magic damage in the native additive bucket | Selected friendly, including the caster |
| Deprotect 230080 | 6 | 19054, -30% Defence | Selected enemy, subject to status resistance |
| Deshell 230090 | 6 | 19055, -30% Mind | Selected enemy, subject to status resistance |

All four are Magic-attribute actions with unconditional `AfterDamageCalculation` bundles, 100% base probability/activation probability, and duration 5 proceeding at `BeginTurn`. They do not lose duration at a sibling's `SkillBegin` or `SkillEnd`.

Native post-damage processing dispatches bundle timing 1 at `0x144F7FA6E–0x144F7FA73`; dispatcher `0x144F7E590` checks that timing at `0x144F7E5D7` and routes the effect. `SkillTarget` copies the actual selected target list at `0x144F7E6F3–0x144F7E751`; `Self` uses the caster at `0x144F7E6A7–0x144F7E6E7`. The native relation enumerator `0x144FB23A0` filters actors by relation/alive/availability and appends every matching actor (`0x144FB2450–0x144FB24C6`); it has no source-actor exclusion. A living available caster is a valid friendly target.

Thus `Dualcast(Faith on self, Fire)` has the Faith effect for Fire, costs 11 MP, and pays both ability costs when they are not supplied free. `Dualcast(Fire, Faith on self)` does not boost that first Fire in a fresh fight. An effect remaining from an earlier turn is a separate active-state input. Similarly, Deshell's reduction applies to the chosen enemy before a later magic child, not retroactively to earlier damage. Status resistance/opposing status conditions must be handled before assuming success.

## Recasting does not stack these status effects

The current `DT_StatusConditionDetailData` rows for AttackUp, IntelligenceUp, DeffenceDown and MindDown all have:

- `isExtendLifeTurn: true`
- `isAllowDuplicate: false`
- `shouldOverwrite: false`

These names are tied to native byte offsets by generated bool setters: `0x1445794E0` writes +10, `0x144D2B4D0` writes +11, and `0x144D2B4E0` writes +12.

The add-effect routine `0x14522FC70` branches on the incoming effect's status at `0x14522FD13`. A nonzero status calls `0x145249EF0` at `0x14522FD30`. That handler searches active effects for the same status, handles a configured opposing status, then reads `shouldOverwrite` at `0x14524A0ED`. With the flags above it reaches the extension branch `0x14524A146–0x14524A154`.

The branch keeps the existing effect instance and potency. It compares remaining lifetime with the incoming duration plus source extension at `0x14524A1B0–0x14524A1C7`. It extends only when the incoming duration is greater; the setter `0x145154F50` caps the written duration to the native maximum 10 at `0x145154FA0–0x145154FA5`. An existing indefinite lifetime -1 remains indefinite. The handler returns false, so the caller skips creation of another instance at `0x14522FD42–0x14522FD44`.

For the same Faith effect, remaining 4 becomes 5, with one +50% effect, not two effects or +100%. A shorter recast does not shorten a longer remaining duration. Different effect IDs sharing this status also retain existing potency under these particular flags; this is not a generic strongest-effect replacement rule. Opposing statuses are handled by a separate branch and must not be silently summed.

## Separate action boundaries

Focus 400460 is not another Magic Boost. Its damage effect 12907 has duration 2 proceeding at `ActionBegin`, while its speed effect 1382 proceeds at `BeginTurn`. Native unit scheduling dispatches `ActionBegin` at `0x144FB4269–0x144FB4283` after selecting the actor; selected child tasks emit the distinct `SkillBegin` event. Do not expire Focus after every nested spell by substituting one timing for the other, or assume its speed effect cannot alter a later round's initiative. Full Focus/extra-turn state handling is a separate supported implementation requirement.

Next Step: use the retained selector/effect/refresh facts in sequence evaluation; verify model regressions for mixed IDs, reversed setup order, cumulative MP/AP, and one-instance status refresh.

Known Blockers: no live battle recording, no arbitrary reactive/interrupted command proof, and no blanket support for every special action. Native `nonRepeatSkillsIds` is a separate caller audit; its name alone does not prove a same-turn sibling ban.
