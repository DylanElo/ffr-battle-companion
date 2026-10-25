# Native growth and saved battle inputs

Scope: catalog growth/skill metadata and read-only save imports. No game assets or saves were changed.

## Data contract

Both `docs/data/catalog.json` and local `data/companion-catalog.json` now include:

- `statGrowth`: 43 native tables indexed by `levelParamId`; `rows` contain `level`, `requiredExperience`, `adds`, and `skillIds`. Character rows end at level 99; Vision rows end at level 100.
- Character `nativeLevel`, `levelParamId`, `levelTable`, native `passiveIds`, `baseSkillEquipCost` (100), `nativeSkillEquipCost`, race and traits. Source base stats include Divine.
- Vision level references and `innatePassiveIds`; these are source metadata, **not** a claim that the Vision's full source stats are added to its equipped character.
- `battleRules`: native `DT_UnitParameterCalc` row, including cap/skill-cost constants and resistance multipliers.
- `difficultyRules`: three native difficulty rows. Expert outgoing damage multiplier is 0.8, incoming 1.4, enemy HP/break 1.6 and enemy Agility 1.4. Latest inspected save records `Player.GameDifficulty = Expert`.
- `artifacts`: 19 native IDs, native item tags, effect values and default activation. Effect values alone do not establish behavior; code still determines how an artifact applies.
- Skill `isApplyAllMag`, `criticalHitRate`, `parameterVariationType`, `parameterType`, status/target state and removability flags. A positive-magnitude Magic/HP/Increase action such as Cure is healing, not an attack. Area reduction must use `isApplyAllMag`, not a guess from target type.
- `parameterTypes`: native enum indices. Base-seed save arrays are retained by index rather than relabeled as final character stats.
- `masterSkills`: native Spirit skill cost/ownership references; `masterSkillGrants` bundles the linked Vision's synchro active/passive grants. It excludes the permanent BaseParameter bonuses (already applied independently) and excludes Awakening grants. Native English descriptions say these activate all Mastery Rank abilities; exact runtime expansion is being checked separately. The Ozetta Spirit has no native playable Vision row and is excluded with an explicit warning.

Both the C# importer and browser `readSave` now expose the same additive fields:

- Character `baseParameters`, `equippedSkillIds`, `activeSkillIds`, `rawFields`.
- Resonance `rawFields`, preserving unknown future data.
- Snapshot `player`, including recorded difficulty.
- `artifactOverrides: [{id, active}]` contains explicit saved activation overrides only. An effective native artifact is owned in inventory and uses its explicit override or catalog `initialActive` default. Unknown IDs must stay unknown.

## Verified experience semantics

The native `GetLevelReachWithExp` path resolves to helper `0x14523bc00`. The loop at `0x14523bd00..0x14523bd17` subtracts each growth row's `RequiredExperience` from remaining experience. A negative result stops the loop; otherwise level becomes that row's `Level`. Therefore requirements are **per-level costs**, not cumulative level thresholds.

The `Add*` values are incremental level gains. Rain's source base HP 200 plus gains through level 30 is 2088. His 119338 saved experience reaches level 30 with the native subtractive algorithm; treating raw RequiredExperience as cumulative would produce the wrong level and stats.

## Observed independent stat check

Inspected save SHA256: `61CD19F6E4262A62E40D27B03A42C50915F49A5C5144582A8A11C4DBADD03C4D`.

For all eight records in this snapshot, saved HP exactly equals source base + cumulative native level gains + equipped item flat HP + permanent HP sync grants across **all owned Resonances**. Saved HP is current HP, so this equality is evidence from this particular full-health snapshot, not a universal invariant for arbitrary in-battle saves.

| Character | Level | Base + growth HP | Gear HP | All reached sync HP | Saved HP |
|---|---:|---:|---:|---:|---:|
| Rain | 30 | 2088 | 70 | 300 | 2458 |
| Lasswell | 30 | 1778 | 70 | 210 | 2058 |
| Fina | 30 | 1483 | 120 | 210 | 1813 |
| Lid | 30 | 1602 | 0 | 210 | 1812 |
| Nichol | 27 | 1241 | 0 | 210 | 1451 |
| Archwitch Fina | 30 | 1424 | 0 | 210 | 1634 |
| Jake | 27 | 1513 | 0 | 210 | 1723 |
| Sakura | 33 | 1433 | 0 | 210 | 1643 |

The `baseParameters` seed arrays do not already contain these sync gains: HP index 1 is zero for all eight. The only nonzero saved seeds are Rain Attack +3, Fina/Archwitch Fina Mind +3, Lid Defence +3 and Nichol Agility +3. Therefore adding all reached sync base grants does not double-count the seed arrays in this snapshot.

Reached sync `BaseParameter` grants for EquipCost index 11 total Rain/Lasswell/Lid 136, Fina 128 and the others 120. With native base cost 100 this explains existing loadouts whose equipped skill costs exceed 100. Rain's growth table adds no EquipCost by level.

## Native parameter construction evidence from the parallel damage investigation

Native current-parameter helper `0x14523f5e0` composes base (`0x145238180`), equipment/etc (`0x14523a960`) and truncated effect contributions (`0x14523e150`), then clamps to caps. Base parameter 12 delegates to STR index 5, 13 to STA/Defence index 6, 14 to INT index 7, and 15 to SPI/Mind index 8. Equipment fields use PhysicalAttack/PhysicalDefense/MagicalAttack/MagicalDefense. Native code and raw enums—not English descriptions—supply these mappings.

The exact ordering of recursive attribute modifiers, equipped Vision awakening grants, global sync grants and conditional passive rounding is owned by the damage/passive investigations. This data change does not invent that ordering.

## Coverage limits

Latest save includes an active artifact-map override for ID 29500 and ownership of 29500/29510, absent from the native artifact table. Preserve them as unknown coverage, not recognized harmless effects. Owned native artifacts in that snapshot have default inactive state and no explicit overrides. Some historical English artifact labels are `[TEMP]`; native tags are retained.

Source Vision `nativeLevel` is not proof of actual summon level. Command membership is not proof of learned/equipped skill availability. Saved equipped skills are retained independently of mastery-derived learnable candidates; passive/skill selection must obey cost and slots.

## Validation

`dotnet build importer/BattleCompanionImporter.csproj -c Release`: zero warnings/errors.

`node --test tests/save-import-schema.test.mjs`: browser and desktop battle inputs agree for all 11 detected saves, each source SHA256 unchanged; growth/difficulty checks pass.

`node --test tests/stats.test.cjs`: five tests cover growth/seed/sync/equipment arithmetic, per-effect truncation, source immutability and new-loadout cache behavior, native parameter caps, learned pools and the recorded eight-character HP/cost-budget checks. Local-only save checks explicitly skip when the importer/evidence snapshot is unavailable.

`docs/stats.js` caches immutable catalog and imported-snapshot contexts. The observed local benchmark computed 100,000 native character-stat loadouts in 603 ms after index caching. Equipment and passive terms remain per-call inputs; changing a proposed loadout does not retain the prior loadout's stats.

Percentage-stat basis is now verified in native code. `UCPP_ContFxContinueParamVariation` vtable `0x1486972c0`, handler `0x145145150`, calls baseline getter `0x145238350`, which clamps native base + additions while excluding that parameter's own continuous effects. Derived PhysicalAttack baseline includes **current** STR, so attribute modifiers propagate into derived stats.

The RatioIncrease factor is float32 `(p0 * float32(.01)) + 2^-23`; RatioDecrease is float32 `2^-23 - (p0 * float32(.01))`. The returned float32 baseline×factor delta is independently truncated toward zero in final getter `0x14523f5e0`, then added to the raw base + additions before the final cap. This deliberate epsilon means 100 with a 30% decrease becomes **71**, not 70: the native delta is approximately -29.99999 and truncates to -29. Tests cover this rounding, independent same-parameter percentage effects, capped effect bases and recursive STR propagation. The earlier percentage-basis warning was removed only after this handler was recovered.

`python -m unittest test_catalog.py`: existing catalog reference and progression integrity checks pass. Catalog extraction remains local; public catalog generation strips workstation paths and historical chat references.

Current Goal: native battle-model inputs without save mutation.

Latest Decision: preserve raw and normalized data together; per-level costs and permanent sync grants must be included exactly once.

Next Step: integrate with independently verified native damage and passive calculations, then test in-game against displayed equipment stats and damage.

Known Blockers: runtime conditions, actual summon scaling and unknown artifact effects are not proven by these tables alone.
