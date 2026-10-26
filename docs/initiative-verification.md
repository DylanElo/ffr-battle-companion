# Initiative verification

The game chooses actions using randomized priority, rather than sorting the party once by Agility. This audit uses installed native code, extracted parameters and isolated execution of arithmetic instructions. It does not represent a recorded battle.

Executable SHA-256: `B8C588E46EBADBE37FECA7BDF2DA0AE63A8538099D14A53EC0C2241B086E5FFA`.

## How priority works

The game computes current Agility with live stat effects, applies random rate and flat offsets, adds applicable WaitTimeOffset effects, and truncates the result. Higher priority acts first. NPCs divide their Agility contribution by their actions already used plus one; party characters do not use that divisor.

Current native parameters roll rate jitter from −20 to +20 and flat jitter from −5 to +5. Each unit receives its own pair. The game prepares a preview pair, promotes it on the next global turn and rolls another preview. Order can therefore change each turn.

For ordinary exact ties, an enemy wins against a party member. Between ordinary party members, the later saved party slot wins. Special Rearguard and command/effect states have separate branches.

| Claim | Native evidence |
| --- | --- |
| Highest priority wins; living/available candidates are checked each selection | Selector `0x144FB0170`, action-count check `0x144FB0288–0x144FB02A0`, comparison/replacement `0x144FB02CA–0x144FB02CC`. |
| Priority uses current computed Agility and wait offsets | Calculator `0x144FB0320`, Agility getter `0x1452371D0`, WaitTimeOffset sum `0x145240700`. Arithmetic constants: 100 at `0x14778B544`, 0.01 at `0x1477778BC`. |
| Native jitter amplitudes and distribution | Generator `0x144FC5370`, parameter fields +160/+164; RNG normalizer at `0x14779D350` is `3.0518509447574615e-05`. Buckets are close to uniform, not exactly uniform. |
| Current and preview rolls | Initial rolls `0x144FAC6CC`/`0x144FAC6DC`; promotion `0x144FC2DEF–0x144FC2DF6`; next preview `0x144FC2ED5`. |
| Ordinary tie rules | Comparator `0x144FB8300`; enemy tie branches `0x144FB83BC–0x144FB83C7` and `0x144FB853D–0x144FB8541`; saved-party lookup `0x14511C310` → `0x15BB35AE0`. |

## First Strike and Take Initiative are different

First Strike (1049) installs WaitTimeOffset effect 54201 at BeginBattle. Its parameters add 100000 to current-phase priority. It does not add Agility, damage or another action, and does not modify the preview phase. Its lifetime is one applicable BeginTurn event. The exact start-of-battle event order is a separate lifecycle question.

WaitTimeOffset factory `0x14513E496`, initializer `0x14514C9A0` and getter `0x14514B640` prove the phase condition. Global-turn reset `0x14513A350` handles phase promotion for applicable effects.

Take Initiative effect 12943, from Preemptive Strike (1394), grants its damage modifier only when there is at most one target and that target's scheduled-action counter has not advanced. It is not a whole-round buff merely because an enemy was staggered or failed to deal damage. Native handler `0x1451464E0` reads target counter +4E0 at `0x1451465CB`; action processing increments the counter at `0x144FB42A0`, and global-turn reset clears it at `0x144FC2F8C–0x144FC2FAC`.

## What the fixtures verify

The sanitized [native initiative fixture](../tests/fixtures/native-initiative.json) contains exact arithmetic examples and full jitter bucket counts. The audit executed copied scalar arithmetic instructions with explicit RNG inputs: 20 fixture vectors, 5000 seeded priority inputs and all 32768 RNG values for each jitter amplitude. The JavaScript float32 translation matched all 5000 native priority results.

Float32 rounding matters: Agility 50, rate 20 and flat 5 produce priority 34 in the native calculation, despite ideal decimal algebra giving 35.

These checks establish arithmetic and static comparator behavior. Any finite sampling of fight orderings remains an estimate, not an exact expected value or an observed combat result. Extra actions, changing Agility, Rearguard, explicit wait effects and exceptional queue scripts need their own supported handling.
