# Scion Sorceress and Area Effect Adept

Installed `FFRS-Win64-Shipping.exe` SHA-256:
`b8c588e46ebadbe37feca7bdf2da0ae63a8538099d14a53ec0c2241b086e5ffa`.
The native getter/aggregate fixture is `tests/fixtures/native-scion-area.json`.
The functions were executed unchanged in synthetic Unicorn memory, with no game
process access. Skill Flow's caller was independently disassembled.

## Scion Sorceress

Effect 19012, type `DmgMulSkillNumUp` (native enum 140), maps through factory
`14513ECA0` to vtable `1486A7FD8`, override `+5E0 = 144DC3120`.
The getter returns float32 `float32(float32(p0) * float32(.01)) + EPS`, rounded
again to float32; EPS is `2^-23`. Catalog p0 is 150, giving
`1.5000001192092896`.

`145239560` starts at exactly 1 and multiplies every live effect's `+5E0`
getter, in effect-list order, with a float32 rounding after every multiply.
It does not deduplicate instances. The base getter returns exactly 1.
Two physical 19012 instances therefore give `2.250000476837158`; this does
not establish duplicate equipment legality.

Skill Flow `145148340` calls this aggregate at `1451485F6` and `145148644`.
Its uncapped contribution is multiplied at `145148630`; its cap is multiplied
at `14514866F`. `minss` then `maxss 0` follow at `145148676–14514867F`.
Thus Scion scales both the history increment and the 50% cap, for damage and
stagger getters sharing this implementation. It does not itself grant Skill Flow.

`modifiers.skillHistoryMultiplier` exposes the product. Passive analysis applies
it to both Skill Flow branches before converting the result to percentage units.
The existing unscaled percentage approximation is retained when the product is 1.

## Area Effect Adept

Effect 19002, type `IgnoreAllMagicReduction` (native enum 110), maps through
factory `14513E1E8` to vtable `1486B2010`, override `+580 = 140C8A800`.
That getter returns true without consulting parameters. Its base getter returns false.

Spread helper `145237420` first checks the skill's byte `+BD`, the native
`isApplyAllMag` field (reflected setter `144C3B0D0`). If false, it returns exactly 1.
Otherwise it scans the source parameter's live effect instances and returns 1 if
any `+580` getter returns true. With no bypass, it returns the current
`allDamageMagnification` percentage with native float32 conversion and EPS.
The synthetic fixture uses 40, producing `0.40000009536743164`.
Duplicate bypass instances remain a boolean presence check.

Verified helper callers include stagger `1452321F3`, ordinary damage `145232C11`,
and recovery `1452346FF`. The gate is the actual native skill flag, not a guessed
Group target, damage type, or number of spells. `modifiers.ignoreAreaReduction`
exposes that presence; the arithmetic caller must apply the native flag and
calculation rules. These damage, stagger and supported Finish-recovery paths are
modeled. Catalog effect 61001 is evaluated separately by the MP cost model;
passive analysis defers it to that resource path rather than treating it as an
unsupported damage modifier.

Its doubled cost requires the native selected-command all-target-conversion
flag. A natural Group/All target, or the skill-data `isApplyAllMag` damage flag,
does not establish that cost flag. Existing generated recipes explicitly select
unconverted skill IDs and pass false; explicit future conversion recipes must
carry their own flag. See [MP cost verification](mp-cost-verification.md).

These effects still obey supplied physical-source identity and normal bundle,
condition, recipient and probability checks. Other duplicate effect types retain
their existing conservative treatment.
