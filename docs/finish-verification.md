# Finish attack readiness

Evidence: static disassembly of the installed executable, SHA-256 `b8c588e46ebadbe37feca7bdf2da0ae63a8538099d14a53ec0c2241b086e5ffa`, and the extracted current catalog. This is not a live battle capture.

## Entry and equipped Resonance actor

Finish phase is native phase value 2. The entry gate at `0x144F45450` checks the all-living-enemies-staggered predicate `0x144FB8190`, then requires at least one equipped Resonance actor whose readiness getter returns true. It is not equivalent to granting every character another ordinary action whenever one enemy staggers.

The owner stores its equipped Resonance ID in unit info `+0x200` (getter `0x14523A320`). Factory `0x144FA7720` refuses ID `-1`, looks up the equipped record, constructs a distinct `CPP_BtlUnit` actor, and stores it in owner info `+0x368`; that actor's info `+0x370` points back to the owner (`0x144FA79AD` and `0x144FA79BB`). The equipped actor controls Finish availability; it does not automatically become the eventual damage attacker.

The separate selection audit traces `0x144F54B20` through that `+0x370` backlink: the queued record is redirected to the owner, and `0x144F5CF49` resolves the owner as the attacker. Physical Finish calculations therefore use the owner's physical attack; magical Finish calculations use the owner's magical attack. Native attribute enum evidence places `FinishBlow` at 9 (`0x14883EEF0`) and `Summon` at 7 (`0x14883EED0`): the base kernel's attribute-7 Divine branch applies to Summon, not Finish. Treating Finish as Divine-scaled would be incorrect.

## Readiness getter and lifecycle

`CPP_BtlUnit` constructor `0x144FA0070` installs vtable `0x14864E3F8`. Its virtual `+0xA10` resolves to leaf `0x144FB90E0`:

```text
if (actor.info.flag49A)
    ready = actor.vitalityState == 0
else
    ready = actor.enabledVisibilityCache678
```

The fields have the following executable evidence:

- Actor state `+0x8D8` starts at zero (`0x144FA020A`). The low-HP update sets it to 1 (`0x144FCA6DF`), resets it to 0 after recovery (`0x144FCA758`), and the death path sets it to 2 (`0x144FBB14C`). Therefore checking only “not dead” does not reproduce the first branch: low HP also fails it.
- Actor `+0x678` starts true in the inherited constructor (`0x14522E6C4`). Setter `0x14524A4B0` forwards its boolean argument into the actor hidden bit (`0x143843330`, actor `+0x58` bit 7), then stores the inverse into `+0x678`, unless override `+0x679` forces true (`0x14524A4DD`). This is not a demonstrated LB gauge, charge counter, or cooldown.
- Info flag `+0x49A` is a construction flag, stored by `0x144FB59EC`. It is propagated unchanged through the equipped-actor factory. In the main battle factory, `0x144FABF90` supplies whether its battle initialization mode byte equals 1; another creation path at `0x144FA56FC` supplies false. The mode's semantic enum name has not been established here. Do not treat it as an awakening or synchronization unlock.

No AP, LB gauge, awakening, synchronization level, cooldown, or selected skill ID is read directly by this getter. The separate selection/payment audit confirms one equipped Resonance choice for the Finish phase, using its native Vision-row Finish skill getter (`+0x80`), with no AP/learned-skill selection gate. Current Finish rows cost zero; the normal payment path handles the selected action without an extra LB-gauge cost. Finish does not emit an additional ActionBegin or BeginTurn before phase end. These are phase-specific rules, not permission to append every party member's Finish automatically.

A newly constructed equipped actor starts with vitality state 0 and enabled cache true, so both getter branches initially pass. The observed writes to `+0x8D8` are vitality transitions; the writes to `+0x678` are constructor initialization and the shared hidden-state setter. This getter contains no Finish-use counter or reset. Whether another Finish opportunity is offered must follow phase entry and pending-action progression, not an invented cooldown in this getter.

## Current catalog facts

All 26 current Resonance records have a `finishBlow` skill reference; all resolve to a `FinishBlow` attribute skill with row cost zero. For example, Warrior of Light maps to Crystal Braver (`440010`), Terra to Riot Blade - Lotus (`440090`), and Noctis to Armiger Unleashed (`440290`). The catalog mapping is a distinct field from the awakening and synchronization grants. These row facts alone do not establish menu selection, payment ownership, phase repetition, or Finish actor damage-stat attribution.

## Remaining integration boundaries

Readiness must use the equipped actor's actual construction branch and current state. It must not invent a full-LB requirement, a per-fight charge, an awakening threshold, or a cooldown. The semantic name of the construction mode and any hidden/override transitions still need to remain explicit when reproducing unusual battle contexts.

## Tidus: one single-target sequence and one group append

Blitz Ace (`440210`) has nine physical parts against the selected target. Its AfterDamageCalculation effect `59000` is native `AppendDamage` (enum38), parameters `[440230,1,-1,...]`. This creates one execution of child `440230`: a separate one-part physical Group attack, mag21, row cost0, with the same actual owner source.

Native instant dispatcher `0x144F7E650` constructs `CPP_BtlEffectAppendDamage`; initializer `0x144F70410` resolves the child skill and reselects targets from the child's Group row (`0x144F70635`–`0x144F7065A`). It builds ordinary damage children with the child's own skill ID and part count (`0x144F707DB`, `0x144F708A3`). Thus the group append keeps its own hit and damage cap; it is not nine group attacks and not a flat multiplier on the original nine parts.

The post-calculation bundle dispatcher runs once outside the original part/target scan (`0x144F7FA73`). Its successful-result gate (`0x144F7FA20`–`0x144F7FA56`) suppresses AfterDamageCalculation effects when all primary damage results miss. The append belongs to this selected action, uses normal damage-result processing, and creates no extra selectable turn, AP slot, or MP payment. The child row contains no further AppendDamage, so no recursive chain is needed for this known pair.

The child is a damage effect rather than a second selected action: its own BeforeDamageCalculation/AfterDamageCalculation bundles are not dispatched separately. Blitz Ace has already installed level-scaling effect12966 before its primary calculation; the child inherits that owner's active effect. It must not install another copy or trigger another SkillBegin/SkillEnd.

## Selection, payment and phases

Read-only executable/cooked-asset audit. No game process, source save or production code changed. Executable SHA-256 B8C588E46EBADBE37FECA7BDF2DA0AE63A8538099D14A53EC0C2241B086E5FFA. Evidence below is static control flow, not a battle recording.

## Minimal model contract

- Finish is phase2 after the pending Additional execution, within the same global turn.
- Offer the ready linked vision actors found by native phase entry. Pick ONE entry per Finish phase; do not execute every vision finisher.
- The selected skill is the currently equipped vision's FinishBlow data field, not a mastered/equipped AP ability. The Finish UI queries neither AP, learned-active-skill membership, awakening nor sync for this choice.
- Redirect the selected vision actor to its linked owner before constructing action records. Actual attack source, current stats/effects and payment source are the OWNER character.
- Use normal damage selectors for native FinishBlow attribute9: Magic uses MAG, Physic uses ATK (subject to separately verified ordinary passive modifiers). Attribute7 Divine selection is SUMMON, not Finish.
- All27 current FinishBlow skill rows have Cost0 and isAvailableWhenDead=false. Attribute cost type is MP. Ordinary runtime consumption remains, including applicable additional-cost effects. Do not charge AP for using the separately offered Finish command.
- Keep ordinary source-dead validation. Phase2 bypasses the ordinary1452420D0 action-state restriction; do not impose a normal menu eligibility check which Finish UI does not invoke.
- Finish does not create the ordinary ActionBegin2 command wrapper. No BeginTurn7 occurs between Additional and Finish. A selected skill retains ordinary SkillBegin17/SkillEnd18.
- Phase5 waits for scheduled actions to complete then exits6, ends/resets global turn. Readiness is not a consumable charge according to independent readiness audit; a new later global-turn Finish phase may offer the vision again when phase readiness is satisfied.

## Selection and exact skill

Finish phase entry144FB6820 setsphase2 at144FB68E7, then iterates actors, follows each actorinfo+368 linked actor, checks linkedactor virtual+A10 at144FB6A0E, and appends its UniqueID144FB6A18–25. It sends those IDs in commandpackettype2 at144FB6A8F.

InstalledVM_FinishCmd andVM_FinishCmdEntry Blueprints have no script functions; they inherit native implementations. Native HandleBeginCommand14514BAF0 requires UI managerphase2, then callsRetainEntryData145153C90. That routine resolves each linked vision actor, reads info+D0 (vision ID) at145153F72 and calls14501AD30 at145153F78. Getter14501AD30 obtains native Visiondatatable0x2D and returns row+80 at14501AE03–AE2F, the installed Vision.FinishBlow field. This path does not enumerate owner learned/equipped skill lists.

Cooked WBP_FinishCmdEntry.BP_OnClicked setsmanager.SpecificActionUnitUniqueId=EntryData.UnitUniqueId, makes ActionKey{CategorySkill1,Id=EntryData.SkillId}, and callsVM_BtlCmd.DecideActionKey. There is no wrapper choice such as Arms Akimbo/Dualcast in this entry selection. The installed ordinary Skill-category default behavior in DA_BtlCmdAction is Execute/Batch with TargetSelect; actual target relation and range remain the selected skill row's definition, not an invented all-enemy finisher target. Friendly/support FinishBlows exist and cannot be treated as offensive damage automatically.

## One selected command, not all ready entries

HandleBeginCommand14514B6F0 clears manager's storedcommands+98/count+A0 at14514B7B6–B7FB. DecideCommand145141130 stores the chosen command then checksphase2 at145141239–3D. The phase2 branch14514123F–1264 clears beneficiarylist+60/count68 instead of normal index increment14126B. With no remaining beneficiaries, it commits the stored command list at14514128D onward. Thus one chosen vision entry completes this Finish selection, even though the menu offers several ready visions.

AdditionalTurn state5tick144FA9910 calls presentation/execution tick144FC70F0, tests actionmanagercompletion and count0 at144FA9940–994D, then enters exitstate6 at144FA994F–995A. Exit144FB73C0 calls turnreset144F603D0 at144FB7441. Readiness flags are audited independently by focus_builder in docs/finish-verification.md.

## Actual attacker and payment source

DecideCommand145141130 reads selected FinishactorID frommanager+70 at145141134–1157, then calls144F54B20 at145141188. That helper resolves actorinfo, checksinfo49A at144F54B85, follows linkedowneractor info+370 at144F54B8E, and returns the owner's UniqueID at144F54BA6–BB. The returned ID overwrites every selected actionrecord+4 at1451411A4.

Native dispatch144F5CF49 reads that record+4 and resolves it via144FB4580 atCF4C. It puts the resolved OWNER actor in the attackerarray atCF99 and passes it to144F4B570 atD12A. Factory144F40CB0 reads the actorarray's first pointer at40CE4–E7 and that actor's info+838 at40D84. Thus the queued action uses owner stats/effects and owner resources. The linked vision actor supplies selection/visual identity and skill lookup; it is not a separate stat source for this action.

PaymentnotConsume329 is zero: manager emission1451412FD sets packetword31=0x100 (byte31=0); wrapper144F4B661–B668 copiespacket31 into argumentstack58; factory144F40F92–40FB0 copies that byte into action329. Generic costcheck32A is zero (packed thirdbyte cleared144F40F69). The factory constructor144D96E50–E57 initiallyclears328/329/32A as well. Runtime144F65040 still calls144F47340 at6519B; no phase2free-payment exception exists. Current ordinary base MP cost is zero, but applicable extra costrecords are not implicitly suppressed.

Runtimeprecheck144F464E0 readsphase; phase2 skips1452420D0 restriction at4656C–46586. It retains source-dead virtual+2D0 at4661E unless rowF9/isAvailableWhenDead orpacket37A exceptions apply. All27 currentFinishBlow rows setisAvailableWhenDeadfalse. Do not count an owner-dead Finish merely because linkedvision appeared healthy/ready.

Finish selection bypasses ordinary root menu144F456B0. That function's AP/learned/menuCannotLimitBurst attribute filtering must not be invented as an extra Finish-use requirement. Runtime source/target/cost checks still apply.

## Event/lifetime boundary

Nonzero-phase acceptance skips ordinaryCPP_BtlTaskCommand creation at144F4CB2E–32 and144F5D5DF–EC. Additional/Finish run in separateAdditionalTurn state machine144FAD8A0; ordinarycommandwrapper is recreated onlyafterphaseexit by144FA99C0→144F3CDB0. Thus do not replay normal actorActionBegin2 during the Finish. This preserves Focus's event2 lifetime and prevents LuckyBorn65004's event2 trigger from granting invented luck. Selected skilltasks still emitSkillBegin17 at144F82843–63 and ordinarySkillEnd18. GlobalBeginTurn7 belongs globalturnreset, not Finish selection/execution.

Generic event3/6 behavior for manual phase actions remains separately scoped; do not generalize the automatic-only144FB7580 branch to every manual actor.

## Recovery and OverHeal

Source: current installed executable, SHA-256 B8C588E46EBADBE37FECA7BDF2DA0AE63A8538099D14A53EC0C2241B086E5FFA. Read-only static inspection plus isolated copied scalar instructions. No game process or saves modified.

## Dispatch and supported rows

The Increase branch of the ordinary HP skill task calls recovery wrapper 145234030 at 144F7AC50; wrapper calls 1452342C0 at 1452340A2. This is a different kernel from damage 145232800. Current SKILL_DAMAGE_CALC_DATA recovery rows for Physic/Magic disable critical, defense, element, break and hit-count calculations, enable random/skill effects/additional-phase calculations. Parsed rows are recovery-rows.json.

Finish skills 414100 (Leah), 412510 (Ayaka), 412600 (Charlotte) are Magic/Increase/HitPoint, friendly Group, magnifications 100/300/150 respectively. All receive effect12966 MulBaseSkillByLevel before calculation. Wilhelm412620 has no HP recovery: its defense effect must not be scored as healing. Cure/Protect/Shell/Regen and other secondary effects require their own state rules and are outside the scalar fixture.

## Core calculation

Both Physic and Magic cases at 1452344B0-145234535 call 145239500, which sums/clamps parameter16 Divine (getter at 14523950F-14523954E). It does not use MAG or recipient MDEF. At145234574 Divine is divided by UNIT_PARAMETER_CALC_DATA+0xD8. Reflection property record14887B648 names this baseRecoveryCalcFactor; current row value256.

Let f be float32 rounding after every displayed arithmetic operation. Let x=f(f(Divine)/f(256)), t=0.9999998807907104.

- if x<t: factor=f(x+1.0000001192092896).
- otherwise: factor=f(4/f(expf(f(t-x))+1)).
- value=f(coefficient*factor), where coefficient is the existing skill coefficient helper14523E1D0 called at14523457C. This includes the level coefficient effect; do not apply level twice.
- variance=f(f(f(f(random15)*f(randomMagnitude))*f(2/32767))-f(randomMagnitude)+1), as distinct sequential instructions1452345CB-1452345EC. random15 is rand()&32767; current randomMagnitude=.05. Multiply value by variance, with f rounding.
- Next multiply recovery-effect factors (attacker virtual520 and attacker virtual460 contributions;14523460F-1452346C8), nonzero-phase factor when enabled (1452346CC-1452346F1), spread helper145237420 (1452346FF), and external scale (145234733), each float32 operation. Do not reuse ordinary damage modifiers blindly: recovery has separate virtual slots.

At14523481E truncate toward zero, then cap at source14523C190. That getter starts99999, selects9999 when sourcevirtual2E8 type1 (player), and takes max with each active effect virtual470 (Break the Limit cap). There is no minimum-one clamp in this recovery kernel: zero stays zero. Do not derive one from the data row doMinDamageGuarantee flag.

Raw phase1 and phase2 both qualify as nonzero for the enabled additional-phase factor. Current exPhaseDamageMagnification100 gives f(f(100*.01)+EPS); this is not a separate +100% damage bonus.

## Final HP and OverHeal

Result stores preHP at14523483C. Normal result HP at145234864-145234890 is max(0,min(preHP+amount,maxHP+targetInfo268)); targetInfo268 is an additional HP bound term and must remain explicit if nonzero. Baseline supported scenario can use zero.

145243B20 returns true if an active target effect virtual588 is true. Positive identity: enum114 OverHeal from reflection1488404E0; factory entry14513E434 calls144DCBB10, ctor144DCC140 installsVT1486C5CC8, slot588 points140C8A800 returningtrue. In that case145234857-145234862 returns preHP+amount directly without the normal maxHP ceiling. Leah applies21200 OverHeal before recovery, so the recipient packet can exceed maxHP. This is distinct from an extra amount bonus.

Target KO and immunity gates remain in the kernel145234774-145234802. Current three skills target Alive; do not add revival. Secondary cleanse/buffs/heal-block state requires its own audit before scoring.

## Independent scalar oracle

execute-recovery.py executes copied native SSE sections145234548-1452345BB and1452345CB-1452345F1 with explicit Divine/coefficient/rand inputs. The nonlinear call resolves the same imported Windows CRT expf as the game (game thunk1475831CA -> IAT147732BC8 -> api-ms-win-crt-math-l1-1-0!expf), rather than replacing it with the helper implementation under test. It does not launch/inject the game. Native-recovery.json holds48 vectors covering the nonlinear boundary and variance endpoints; coefficient/effect collection and state clamping are separately traced above and not represented as executed full-battle proof.

The published recovery fixture includes 138 independently executed arithmetic vectors, including level-adjusted coefficients, plus cap/input checks. The complete event dispatcher, healing bonuses and encounter script are not executed by those scalar vectors.

## Finish LB gain

Effect62000, installed after a landed Firion/Shantotto finisher and applied at SkillEnd, adds 20 raw LB points. Native parameter4 RatioIncrease uses a fixed basis100, even with a 200-point capacity. The ordinary strongest Charge multiplier applies before truncation and capacity clamping. See `0x145139734–0x145139772`, `0x145139875`, `0x145230890` and `0x145230430`. No second selected action or payment is added.

## Forecast boundary

The builder models ordinary initially healthy equipped Resonance actors and the listed party members. The five-round damage forecast does not predict enemy death, arbitrary scripts, hidden-actor overrides, or encounter-specific Seal assignment. The Finish gate also accepts an actively sealed enemy (effect11905, CPP_ContFxSeal); this does not grant Finish against every stagger-immune target. Unscored secondary effects are listed beside the result instead of treated as free damage.

## Protection and stored excess HP

Wilhelm's70% and Cecil's50% barriers reduce every part of the next qualifying incoming selected skill, for physical and magic damage. The shared SkillEndReducedDamage27 event then consumes them, including when Hit and Run nullifies final HP damage. Distinct factors combine in float32 before one truncation; see [defense evidence](damage-research.md). The controlled incoming scenario counts one selected skill per character per normal round.

Leah's excess HP is stored separately at native info+268. Current HP is base+excess (`0x14523C777`). Negative HP changes consume excess first (`0x145230340`); ordinary recovery preserves the existing excess bound. The forecast retains that buffer across later hits instead of clamping it away.

HP percentage costs also preserve the excess-first rule: actual payment derives the amount from maximum HP, then calls virtual2D8 (`0x14513C0B2–0x14513C0DA`) which resolves to `0x145230340`. Eligibility reads base+excess (`0x144F50C14–0x144F50C38`). A Leah OverHeal buffer may therefore fund a later HP-cost skill; no alternative invented HP pool or free payment is assumed.
