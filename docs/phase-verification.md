# Battle phase verification

Current Goal: replace invented bonus-turn assumptions with native phase grants, eligibility and lifecycle rules. Scope is the installed executable and cooked data; no game process or saves were opened or changed. Executable SHA-256: `b8c588e46ebadbe37feca7bdf2da0ae63a8538099d14a53ec0c2241b086e5ffa`.

## Phase identity and placement

The explicit reflection records at `0x14863DB68`, `0x14863DB78` and `0x14863DB88` map `eBtlPhaseType::Normal = 0`, `Additional = 1`, `Finish = 2`. These are stored as string-pointer/int64 pairs, not inferred from enum declaration order. The phase controller is battle context +48 → +40; its byte +40 is reset to Normal at `0x144FCB0E4`, set to Additional at `0x144FB6310`, and set to Finish at `0x144FB68E7`.

Normal actor selection at `0x144FCB24F` calls the normal selector `0x144FB0170` with mode zero. Only when it returns no remaining actor does `0x144FCB288` create class `0x144D9D2F0` and queue it at `0x144FCB2CA`. That class's native name is `CPP_BtlTaskAdditionalTurn` (getter name pointer `0x14864FF18`). Additional participation therefore follows normal-actor exhaustion, rather than interrupting the current normal round immediately after a proc.

AdditionalTurn state setup `0x144FAD8A0` has seven states. State 1 enters `0x144FB7580`, which skips directly to exit state 6 if the pending-beneficiary count is zero (`0x144FB75AA–0x144FB75C7`). State 2 enters the Additional presentation (`0x144FB62B0`), sets phase 1 and copies the pending actor list without sorting it. Its completion goes to state 3; state 3 waits for the action manager's scheduled actions to finish (`0x144FAA270`). It then enters Finish state 4 only if `0x144F45450` succeeds, otherwise exit state 6. State 5 waits for Finish execution; state 6 runs `0x144FB73C0`.

The phase-end cleanup calls context reset `0x144F603D0` at `0x144FB7441`. Reset calls `0x144FC2860`, clearing the pending controller array's count at `0x144FC28A7`, then advances the global turn number at `0x144F60403`. The pending quota thus lasts through one Normal → Additional → optional Finish cycle and is cleared once at turn end.

## Native grants and deduplication

Grant helper `0x144FA75F0` appends a unit to controller array +30/count +38 only once. It rejects any phase other than Normal (`0x144FA7631–0x144FA7635`), so Additional and Finish cannot generate another Additional participation. It also rejects enemy-kind actors, explicit actor-state flags +499/+49B, and the native impossibility query `0x145240D30`. Replacement actor flag +49A redirects to the linked actor +370. These state flags are preserved as native gates; their names are not guessed here.

`0x145240D30` rejects an active effect whose virtual +5F8 returns true, or a status whose native status-detail byte +13 forbids this phase grant. ImpossibleAddExPhase enum 153 resolves through `0x14513F138 → 0x144DC6000 → 0x144DC7580`, vtable `0x1486B3420`; its +5F8 is true-returning `0x140C8A800`. The current effect row is 11904.

The normal new-stagger path calls the grant helper for the attacking unit at `0x144F719E6`. It then calls the all-enemies-stagger predicate `0x144FB8190`; if true, `0x144F71A01` calls `0x144FA7D60`, which adds living party units with the same phase/state/impossibility gates and deduplication. Basic Additional participation does not require an equipped Resonance finisher. Do not omit these baseline stagger grants while modeling only special skills.

## Skill procs and their passives

AddExPhase enum 103 uses handler `0x145137F30`; AddRandExPhase enum 104 uses `0x1451380B0`. Both first calculate `T = parameter0 + sumOfMatchingSourceProbabilityBonuses` using `0x14523A630`, then draw:

```
r = min(99, trunc(f32(f32(rand() & 32767) * f32(100 / 32767))))
proc = r < T
```

Only after a successful roll do they check recipients and the grant helper. A duplicate pending owner or a non-Normal phase therefore does not automatically skip the proc RNG draw.

The current rows are:

| Effect | Trigger | Base threshold | Recipient |
| --- | --- | ---: | --- |
| 54100, Noctis skill grant | SkillEnd; lifetime one SkillEnd | 25 | Owner |
| 54101, Vaan random grant | Break; lifetime one SkillEnd | 20 | Eligible random ally |
| 54105, Call to Action grant | AddEffect; lifetime one SkillEnd | 100 | Effect recipient |

54101's historical row text mentions 25%, but the actual current numeric parameter is **20**. The random-recipient handler obtains actors of the source's affiliation, removes the source and already-pending actors, then chooses one remaining actor using a second RNG draw. An empty pool adds nobody and consumes no recipient-choice draw. The common grant helper still validates the chosen actor.

IncExAddProb modifiers use source aggregator `0x14523A630` and getter `0x145147720`, class `0x144DC68C0 → 0x144DC7670`, vtable `0x1486B5590`, virtual +5D0. The getter matches the originating skill ID against parameters 1–3 and returns raw parameter0. If parameter4 differs from -1, it additionally requires any current source calculation record +41 to be true. This is the native critical result byte written at `0x145233080`; it is not a whole-round guarantee from a character's critical stat.

| Effect | Matching skill IDs | Additive threshold bonus | Extra gate |
| --- | --- | ---: | --- |
| 54102 | 447800, 447810 | +50 | None |
| 54103 | 447800, 447810 | +100 | Current calculation contains a critical |
| 54104 | 447400, 447410 | +15 | None |

Thus Noctis's 25 plus 50 becomes threshold 75; Vaan's 20 plus 15 becomes 35. These are additive percentage points. Do not assume every character's owned passive is equipped, or apply a modifier to an unrelated originating skill.

The critical-history array is scoped to the current selected skill task. At `0x144F7F650`, the task frees the source's +3A8 records (`0x144F7F69D–0x144F7F6AA`), resets +3B0 to zero (`0x144F7F6B9`) and empties the allocation before applying BeforeDamageCalculation bundles (`0x144F7F6EA`) or starting the hit-ratio loop (`0x144F7F6FB`). A critical in an earlier sibling skill therefore cannot satisfy effect 54103 for a later noncritical Warp Strike. Within the current selected skill, any actual critical result may satisfy it.

An ordinary missed ratio does not generate a critical record. The hit-check kernel initializes output +40 to qword 1 (`0x145233B1A`), leaving +41 zero. The damage child copies that byte at `0x144F7170E–0x144F71719`; its miss test at `0x144F71799` skips the HP-damage calculation that would sample and write critical +41. Consequently effect 54103 requires a landed critical, not an independently sampled critical on a miss. Effect 54100's AfterDamageCalculation installation is itself subject to the existing any-hit gate; an all-miss selected skill does not install its SkillEnd proc.

## Finish is separately gated

After Additional execution, Finish predicate `0x144F45450` first requires `0x144FB8190` to succeed. That predicate checks the living nonreplacement enemy list for native Break or its special alternative `0x145243DD0`. The Finish predicate also requires at least one eligible party member's equipped-vision object +368 to return true from virtual +A10 (`0x144F455AA–0x144F455CD`). Merely owning a Resonance or having an entry in the catalog does not satisfy this native readiness call.

Finish presentation sets phase 2 at `0x144FB68E7`. Its readiness/resource ownership must be traced before automatically adding finisher damage to a build. This report does not silently replace that gate with an all-enemies-stagger assumption.

## Combat and action eligibility consequences

Gamble Shot's native phase bypass checks nonzero, so it covers both Additional and Finish: `0x145109BFE–0x145109C08`. It does not consume its own Gamble RNG draw on that bypass. The ordinary attack's other native checks remain applicable.

The HP-damage extra-phase multiplier also uses the raw phase byte, independently of action flag +61. Damage application loads context +48 → controller +40 → phase byte +40 at `0x144F7AA19–0x144F7AA29`, forwards it at `0x144F7AA5F` through wrapper `0x145233FB0`, and places it in the HP calculation context at `0x1452329FE–0x145232A0E`. The factor checks nonzero at `0x145232BDD` and the damage-type definition's +11 allow flag at `0x145232BED`. Therefore both Additional and Finish use the native `exPhaseDamageMagnification` where that damage type permits it. Action flag +61's separate UI/action gates must not be substituted for this proven damage-context wire.

The current installed `DT_SkillDamageCalcData` was freshly decoded into `artifacts/phase-native/current-damage-calc-rows.json`. Physic and Magic both set `doCalcAdditionalTurn: true`, corresponding to native +11. The installed `exPhaseDamageMagnification` is 100.0: convert it through the established native percent/epsilon helper, rather than inventing a 2× bonus from the number 100.

The ExPhase usability lock has native enum value 3. Menu eligibility `0x144F456B0` dispatches it to `0x144F45D8F`, which rejects any nonzero phase at `0x144F45DA0 → 0x144F45E53`. Therefore a skill carrying that lock is unavailable in both Additional and Finish. AP/ownership and ordinary resource costs remain requirements; action payment still occurs at `0x144F6519B` after the phase-specific action flag is prepared.

ActionBegin and ActionBeginWithEx must remain distinct. AdditionalTurn's automatic-actor branch queries AutomaticSkill enum 42 at `0x144FB7688`, then emits event 3 and event 6 (`0x144FB769A–0x144FB76E2`). That branch does not emit ActionBegin event 2 or global BeginTurn event 7. It is specifically for automatic actors, not sufficient proof for every manual bonus command. Command flag +AB can suppress both events 2 and 3 in the ordinary command helper; it is a command flag, not the phase byte. A blanket phase-based Focus/luck event rule is not justified by that flag alone.

## Verification and implementation boundary

`artifacts/phase-native/verify.py` records the enum table, bounded disassembly slices, current effect rows, and transition fixtures. It executes only the copied scalar proc-comparison instructions locally, not game-object code. **229,376 comparisons passed** across all 32,768 15-bit samples for seven thresholds. Threshold 20 has 6,554 successful samples, 25 has 8,192, 35 has 11,469, and 75 has 24,576. These probabilities assume uniform 15-bit RNG output; this is not a live battle recording.

## Manual participation order and lifecycle

The native command manager copies the pending actors in insertion order, selects the actor at the current index, overwrites submitted action records with that actor and advances the index. See HandleBeginCommand `0x14514B6F0`, GetCurrentActionUnitUniqueId `0x1451457E0`, DecideCommand `0x145141130` and ordered emission `0x14514128D–0x145141332`. Additional actions do not receive another Agility sort.

Manual Additional input bypasses ordinary CPP_BtlTaskCommand creation at `0x144F4CB2E` and `0x144F5D5DF`. Its ordinary ActionBegin event 2 is not replayed: Focus damage duration and LuckyBorn are preserved. This does not establish generic manual WithEx event 3 handling; automatic Jump/Hide and Focus Magic remain outside this model.

## Limit Bursts in manual Additional selection

Limit Bursts are exposed through the ordinary command tree during Additional; this conclusion follows a positive root-entry append path, not just the absence of an ExPhase lock. Freshly decoded installed `DA_BtlCmd` sets `LimitId = 10` and its root scene uses `UI.Battle.Command.Behavior.List.Root`. Installed `DT_BtlCmdBehavior_List.List_Root` selects native `CPP_BtlCmdList_Root`, with no Blueprint replacement. The root constructor `0x144D88860` installs vtable `0x1486291E8`; its list-building override +2B0 is `0x14514D5D0`.

That builder reads the selected beneficiary from the UI manager, obtains the unit's owned command IDs through virtual +310 (`0x14514D6B0`), and visits each ID. An ID accepted by `0x144F581C0` is positively appended as a command entry at `0x14514D6F6–0x14514D762`. This acceptance helper checks owned-command membership (`0x144F58247–0x144F58262`) and the unit battle-command conditions (`0x144F5829C–0x144F5833E`); it does not replace the owned list with a phase-specific allowlist. Thus an actor whose owned commands include the LB command 10 receives that root entry in Additional too.

The installed secondary `BP_BtlCmdList_Belong.Initialize` bytecode obtains the selected unit ID, calls `GetUsableActiveSkillsByCommand` with `BaseStackData.ActionKey.Id` (10 when opening Limit Burst), then appends the returned skill IDs as action entries. Its native API wrapper `0x144D6B820` calls `0x145240060` at `0x144D6B925`. The implementation selects owned active skills, matches their native `belongCommandList` against the requested ID at `0x145240143–0x145240163`, and appends matches at `0x145240191–0x1452401B8`. There is no Blueprint phase filter between this query and the displayed action list.

Ordinary usability still applies to the selected LB. `SKILL_ATTRIBUTE_DETAIL_DATA.isUnusableInCannotLimitBurst` is native byte +20 (setter `0x144C30630`), set for LimitBurst and FinishBlow in the freshly decoded installed attribute table. Menu eligibility calls `0x145244390`, which checks active effects' virtual +368 prohibition, then rejects attributes marked +20 when that prohibition is present (`0x144F45A5F–0x144F45A6C`). This flag is an effect-based restriction, not a synonym for Additional phase. The UI skill-row usable predicate calls the same ordinary eligibility function at `0x145168664`. Learned/owned LB availability, sufficient gauge, target validity and relevant status/effect restrictions therefore remain required. The ordinary resource payment is retained; an Additional LB is not free.

The cooked assets were decoded with a byte-identical round trip. These findings establish the native/data selection path and do not claim an observed game battle or UI recording.

## Vaan action-end timing

Effect 54101 is installed by the selected skill's Self AfterDamageCalculation bundle. Its native Break event is not emitted immediately for each staggered hit. It is emitted once by the enclosing action's completion path, after that bundle exists and before SkillEnd expiry.

1. The selected task's post-damage callback dispatches AfterDamageCalculation through `144F7FA6E–144F7FA73 → 144F7E590`. The existing any-landed-hit gate applies.
2. Enclosing action completion calls `144F83080` at `144F42394`.
3. `144F83080` scans the finished task+70 result array, stride70, and returns true if **any** record+5E is nonzero (`144F83125–144F83129`).
4. If true, the source's Break29 event apply is emitted once at `144F423C5–144F423D1` (virtual +358). Its lifetime processing follows at `144F4240D–144F4241C`. This reaches the newly installed 54101 Break handler.
5. SkillEnd18 apply/expiry happens later at `144F429BE–144F42A12`. Consequently 54101 is present for the same action's Break event and is then removed on SkillEnd, preventing it from leaking into a later unrelated action.

The record flag describes a **new** stagger from this selected skill, not the target's current stagger state. The stagger kernel starts with +46 zero, detects an already-broken target at `145231E1F–145231E26`, and returns without setting it. For a fresh target its post-damage BP condition sets +46 at `145232343`; the damage child copies that result into record+5E at `144F718D5–144F718DC`.

Therefore 54101 gets one proc attempt per selected action that causes at least one new stagger, even with multiple targets or hit ratios. It gets zero attempts for only previously staggered targets. Queue its random ally choice after every hit and basic stagger grant from that action. In particular, a later ratio can stagger the final enemy and grant all living party members before Vaan's recipient pool is formed; an immediate per-hit proc would change both order and RNG consumption.

Fixtures and native slices are generated by `verify.py`. Transition cases are native-derived assertions, not live battle captures. Scalar comparison verification passed 229,376 exhaustive samples again; those scalar checks do not independently execute the full event dispatcher.

## Finish implementation

The equipped actor's readiness, chosen owner, direct command, costs and phase lifecycle are now traced in [Finish verification](finish-verification.md). The builder permits one selected eligible Finish after Additional when all modeled enemies are staggered. It does not invent a gauge, AP slot, mastery threshold or per-battle cooldown. Unusual hidden-state and encounter overrides remain explicit boundaries.
