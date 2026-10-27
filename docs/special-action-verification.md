# Special action verification — 27 October 2026

Current Goal: support executable-backed special command combinations while making unresolved state requirements explicit.

Latest Decision: add Reckless Abandonment and Magic Barrage through their actual command filters, event lifetimes and payment rules. Do not treat every hierarchical skill as a generic repeated attack.

Evidence is read-only disassembly of the installed executable and current cooked command Blueprints, not observed combat measurements. Executable SHA-256: `B8C588E46EBADBE37FECA7BDF2DA0AE63A8538099D14A53EC0C2241B086E5FFA`. The [sanitized fixture](../tests/fixtures/native-special-actions.json) retains asset hashes, source parameters, addresses and derived regression cases.

## Reckless Abandonment

Skill 400700 defines `Execute / Sequential`, followed by SelfCast and `List.PhysicalAttak` (the native tag's spelling). Its current Blueprint `BP_BtlCmdList_PhysicalAttak.Initialize` obtains the caster's active skills with Vision, then accepts only `IsDamageSkill && damageType == 1 (Physic)`. This is a damage-type condition, independent of the skill's Magic attribute or physical/magical calculation formula.

The SelfCast adds effect 15112 (+100 percentage points in the native stagger bucket, lifetime 2 SkillEnd) and cost effect 61003 (150% MP, lifetime 1 SkillBegin). Runtime payment happens before SkillBegin expiry: `0x144F6519B` calls the payment path before task initialization `0x144F65594`, whose SkillBegin operations run at `0x144F82843–0x144F82863`. The wrapper's own SkillEnd reduces 15112 from 2 to 1; the selected attack's SkillEnd removes it. A plain sibling receives neither benefit nor increased cost. The detailed generic lifetime path is `0x145152CD1–0x145152D75`.

No current additional resource cost, cost override or special usability lock names 400700. Ordinary ownership, AP, slot, status and ancestor checks still apply. Arms Akimbo can contain separate Reckless branches; Dualcast's Magic-only and Double Action's damage-only child filters do not automatically accept a non-damaging wrapper.

## Magic Barrage is a Batch command, not four free selections

Skill 400360 defines `Execute / Batch` with **one** Magic-list selection. `General.quadraMagicSkillId` names 400360; `General.quadraMagicNum` is 4. It selects one spell, then the native dispatcher repeats that selected spell four times with fresh random targets. Two Arms branches may select different Barrage spells, but one Barrage does not independently choose four spells.

The dispatcher compares the current skill to General+188 at `0x144F3EF37`, then calls `0x144F4C420` at `0x144F3EF4D`. That helper reads the selected spell from the command's parameter list (`0x144F4C444–0x144F4C454`), creates the Barrage parent once (`0x144F4C51E`), then creates four child actions at `0x144F4C605`. Loop bounds at `0x144F4C56B` and `0x144F4C632` read General+160. `0x144F4C59D` chooses targets again on each iteration.

**Payment is 20 MP plus the selected spell's cost once.** Children 2–4 are marked not to consume resources. `0x144F4C5A6–0x144F4C5B6` sets the flag when the incoming command is already exempt or the repetition index is nonzero. Factory `0x144F40F92` copies this argument into the packed data stored at action+329 via `0x144F40FB0`. Runtime payment explicitly exits at `0x144F4748A–0x144F47491` when that byte is set. Thus counting the child spell's MP four times is incorrect.

The parent installs damage effect 12945 (-50 percentage points), stagger effect 15128 (-50 percentage points), and recovery effect 19073 (50% recovery rate), each with lifetime 5 SkillEnd. For normal targeted commands the parent consumes one lifetime, then its four children consume the remainder. The damage and stagger adjustments enter their native **additive buckets**. They are not a final 0.5 multiplier applied after all passive bonuses. The builder's offensive leaves use 12945 and 15128; this does not establish a healing optimizer.

Arms' current ancestor bans do not name 400360. Two Barrage branches can therefore yield eight spell leaves, with 40 Arms MP plus two payments of (20 + selected spell MP). The numeric forecast restricts Barrage to a single-enemy scenario; redistributing random casts among multiple enemies requires a target-state model.

## Derived regression cases

For an ordinary compatible child costing 19 MP:

| Command | Total MP | Offensive leaves |
| --- | ---: | --- |
| Reckless(physical) | 28 | One, with +100 stagger points |
| Arms(Reckless(physical), plain physical) | 87 | One boosted stagger leaf, then one plain leaf |
| Magic Barrage(spell) | 39 | Four, each with -50 damage and stagger points |
| Arms(Barrage(spell), Barrage(spell)) | 118 | Eight, with fresh Barrage effects for each branch |

These assume normal targeted commands, sufficient resources, no interruptions and no special event suppression. They are expectations derived from native control flow and data, not battle recordings.

## Remaining special rules

- **HP costs:** Darkness 400490 overrides its cost to 5% HP; Abyssal Blade 408070 adds 10% HP. The native payment path `0x14513C0B2–0x14513C0DA` uses derived maximum HP getter `0x14523C250`, integer percent multiplication followed by float32 `0.01` and truncation, then subtracts the result. Current HP is stored separately. These skills require updating HP and HP-dependent passives after each payment; they must not become zero-cost attacks merely because their MP field is zero.
- **Jake's resources:** Demolisher Rush checks Good Luck 8 but consumes 5; Energized Assault checks 9 and resets luck through its own effect. Threshold and cost are distinct. Good Luck/Overclock state generation, consumption and subsequent leaf availability need a dedicated state model.
- **Forms and flags:** demon/normal form, Divine Radiance, event flags and phase locks remain explicit eligibility requirements. Ownership does not prove that an action is currently usable.
- **Reactive wrappers:** Moiety's Mirror selects physical and magical counterattacks, not two guaranteed immediate attacks. It requires incoming enemy actions; it cannot be credited as an ordinary repeat turn.
- **Repeat restrictions:** `nonRepeatSkillsIds` is a separate native list. This audit has not certified its caller as a prohibition on selecting the same sibling twice; it must not override the confirmed duplicate-preserving command queue merely because its field name says repeat.
- **Exceptional initiative:** Rearguard, Gentleman’s Gambit, extra actions and changing agility/wait offsets need their specific scheduler branches. Preemptive Strike depends on a target's scheduled-action counter, not merely whether it dealt damage. The ordinary random-priority arithmetic is documented separately.

Next Step: add resource and encounter-state simulation before enabling HP payments, luck engines, reactive turns or form-changing sequences. No executable, source save or live game process was modified for this audit.
