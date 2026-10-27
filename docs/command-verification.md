# Command sequencing verification

Evidence comes from the installed executable and cooked command UI assets. This is static verification of execution paths, not an observed combat recording. Executable SHA-256: `B8C588E46EBADBE37FECA7BDF2DA0AE63A8538099D14A53EC0C2241B086E5FFA`.

## Valid nested commands

The cooked `DT_BtlCmdUniqueActionBehavior` defines sequential recipes:

| Command | Steps |
| --- | --- |
| Arms Akimbo (400650) | SelfCast, Root, Root |
| Dualcast (400730) | SelfCast, Magic, Magic |
| Double Action (400710) | SelfCast, NonMagic, NonMagic |
| Magic Boost (400660) | SelfCast, MagicalAttack |

The SelfCast Blueprint copies the selected action key and targets the caster. Magic lists require attribute Magic. MagicalAttack requires a damage skill with magic damage type. NonMagic requires a damage skill whose attribute is not Magic. Each child list is independent; it does not remove an ordinary skill merely because a sibling selected it.

Arms can therefore contain separately boosted spells or Dualcast children when all skills are available and the hierarchy rules allow them. Magic Boost cannot directly contain Dualcast: its child must deal magical damage. Dualcast cannot contain Magic Boost: its child must have the Magic attribute.

Native usability checks enforce hierarchy restrictions at `0x144F45D3C–0x144F45D88`; the matching rejection is `0x144F45E53`. The full ancestry matters when checking nested choices.

## The final queue preserves repeated selections

This is verified beyond the choice menus. `DecideActionKey` reaches `0x14516D0D0`, pushes the selected stack through `0x14518CAA0`, finalizes at `0x14516C3D0` and passes the resulting list directly to UI executor `0x145141130` at `0x14518CDBD`.

The recursive flatten function `0x14515AB30` appends an Execute node before visiting its children, in stored sibling order (`0x14515ABE9–0x14515AC23`). Append function `0x145165310` increases the output count and stores each occurrence's ActionKey at `0x1451653D8–0x1451653E7`; it does not deduplicate by skill ID. The UI copies all records, and native command dispatch iterates every 0x38-byte record at `0x144F5CF30–0x144F5D15B`. Factory `0x144F40CB0` appends each generated action at `0x144F40FE3–0x144F4101F`.

Selecting the same eligible spell in two sibling stages therefore preserves both selections and their order. Two legal Dualcast children under Arms can preserve four spell leaves. This applies to the audited Sequential recipes; arbitrary PerParameter commands and interruption behavior are separate cases.

## Magic Boost expires after its selected spell

Effect 12911 grants the damage modifier for two SkillEnd events. Effect 61004 changes MP cost for one SkillBegin event. Ordinary targeted commands emit these events:

1. Boost SelfCast pays its zero cost and begins.
2. After its damage calculation, it adds 12911 with lifetime 2 and 61004 with lifetime 1.
3. Boost SelfCast ends: 12911 goes from 2 to 1.
4. The selected spell pays its modified cost while 61004 is active.
5. The spell begins: 61004 expires.
6. Its damage receives 12911; its SkillEnd expires 12911.

A plain following sibling is unboosted. A following sibling with its own Boost installs fresh effects; it does not retain the first sibling's effects.

This sequence applies to normal targeted UI commands without duration extensions, interruptions or special event suppression. Structural execute roots without targets fail the action's target check before payment or task initialization; the targeted SelfCast performs the wrapper action.

The current catalog's duration passives do not alter these two Boost effects. General extension filters require a nonzero status ID (`0x1451478ED`/`0x145147943`); both Boost effects have status None. Current ID-specific extensions list other effects. LifetimeAcceleration effect 19039 also requires a nonzero status (`0x145147D48–0x145147D9D`). This does not prove that arbitrary future effects or mods cannot change the lifetime.

## Native evidence

| Claim | Executable path |
| --- | --- |
| Ordinary UI commands permit SkillEnd | Delegate-value constructor `0x144D8880C` sets internal byte +34 to zero; UI emitter `0x1451412FD` changes only +31/+32. Factory `0x144F40F64–0x144F40FA7` copies +34 to action +37E. |
| Runtime payment precedes SkillBegin | Action initializer calls payment helper at `0x144F6519B`; task initialization follows at `0x144F65594`. Payment uses the actual skill ID at `0x144F4754A–0x144F47584`, then computes/subtracts MP at `0x14513BF65–0x14513BF9F`. |
| SkillBegin expires the cost effect after payment | Task `0x144F826D0` emits SkillBegin apply/lifetime at `0x144F82843–0x144F82863`; lifetime helper `0x144F5F230` calls unit virtual +360. |
| Boost effects are installed after damage calculation | `0x144F7F838` calls the post-damage stage; `0x144F7FA6E–0x144F7FA73` dispatches bundle timing 1, checked at `0x144F7E5D7`. |
| SkillEnd advances finite lifetimes | Normal action end `0x144F429AA–0x144F42A12`; generic lifetime matching/decrement `0x145152CD1–0x145152D75`. |
| No-target roots do not pay or initialize a skill task | Target count check `0x144F46525` precedes runtime payment and task creation. |
| MP rounds down after multiplying | `0x145149DF2` preserves zero base cost; `0x145149DFD–0x145149E09` multiplies float32, clamps a nonzero cost to at least 1, then truncates. |

The separate UI command-stack callback snapshots and adjusts resources for the latest selected ActionKey. It is not an additional runtime payment: callback `0x144F5CB40`, helper `0x144F41DF0`, event tag `Delegate.UI.Battle.Command.Stack.Update`.

## Regression expectations

The sanitized [event fixture](../tests/fixtures/native-command-lifetime.json) uses a synthetic compatible spell costing 19 MP:

| Recipe | MP | Boost factors for damage leaves |
| --- | --- | --- |
| Boost(spell) | 28 | 2 |
| Arms(Boost(spell), Boost(spell)) | 96 | 2, 2 |
| Arms(Boost(spell), spell) | 87 | 2, 1 |

These vectors derive from native control flow and source parameters. They do not establish that every skill animation, interruption, duration modifier or enemy interaction has been tested in a live battle.


Follow-up: [mixed skill selections and setup effects](mixed-command-verification.md), and [Reckless Abandonment / Magic Barrage](special-action-verification.md), are now supported under the documented conditions. Each child keeps its own damage inputs; status refresh does not accumulate potency.
