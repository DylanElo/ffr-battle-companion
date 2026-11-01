# Targeted live calibration, 2026-11-01

The character-first builder now reproduces the observed modifier assembly for
Sakura's Arms Akimbo → Magic Barrage → Ultima sequence. This is a bounded combat
check, not verification of every skill, passive, encounter or RNG roll.

## Observations and replay

An external read-only monitor decoded retained native
`BTL_EFFECT_UNIT_PARAMETER_VARIATION_DATA` records: skill ID, calculated damage,
before/after HP, critical flag, hit number and damage multiplier. No game memory,
saves or loader settings were changed.

| Actual targets | Native multiplier | Model multiplier | Observed Ultima damage | Model range |
|---|---:|---:|---|---|
| Two | 3.3000011444091797 | 3.3 | 18,561; 19,333 | 17,836–19,713 |
| One, after the other enemy died | 4.200000762939453 | 4.2 | 23,803; 24,284; 23,269 | 22,700–25,090 |

The replay uses level 57, MAG 718, target level 52/MDEF 400, Expert outgoing
damage 0.8, full HP, the captured equipment/abilities and three distinct current
skill IDs: Arms Akimbo 400650, Magic Barrage 400360 and Ultima 220340. It does not
feed the native damage multiplier back into the model.

The five recorded hits are noncritical. An earlier partial-HP encounter separately
recorded three noncritical Ultimas and a 32,030 critical Ultima; the latter exceeded
the target's remaining 27,314 HP. Its multiplier ratio agrees with the native
150% critical scale, but that encounter's full history was not retained and is
not the proof for the corrected modifier assembly.

## Corrections supported by the native trace

- **Equipped Resonance Sync grants:** earned active and passive Sync abilities
  apply automatically for the equipped, owned Resonance and current character.
  This does not expand its Master Skill bundle or apply permanent stats twice.
- **Distinct sources:** Moonlight Ring and Spirit of Y'shtola both supply effect
  16011. Each eligible DamageMultiplier instance contributes; ability IDs, AP
  costs and slots remain unique. Other identical-effect families remain
  conservative.
- **Sharp Mind:** native group/all-target damage gains its bonus only with one
  actual target. The two-to-one transition adds 100 percentage points and removes
  10 points of Decimating Attacks, explaining the observed 0.9 difference.
- **Skill Flow:** union the current initialized parent/leaf/reaction IDs with
  the last five completed **global turn** buckets. Repeated Ultimas count once.
  Archive and clear only after Normal → Additional → optional Finish completes.
  Damage effect 12909 and break effect 15109 enter their respective buckets.

Installed-image provenance: automatic grants follow 1452510D0 / 14524FDE0 →
145021000 → 145020E50 / 14501E850 / 14501ECA0. History append is 144FC4470,
called from skill initialization 144F65040 after validation/payment and before
sequence execution; 144FC2860 archives all units at global-cycle end. Skill Flow
is 145148340; the damage bucket 14523E3E0 sums timing-eligible instances.

Regression coverage is in `tests/skill-history-calibration.test.cjs`,
`tests/passive-occurrences.test.cjs` and `tests/stats.test.cjs`, including live
evaluation, party recalculation, wrappers, additional phases, expired history,
rejected payment, ownership and milestone boundaries.

## Limits

Context sampling is sequential. The fast context recorder began after the last
Ultima; the ordered retained current-turn list, empty prior history and verified
append-before-execution rule establish the three-ID prefix. This is not an
atomic per-hit snapshot. MAG 718 has separate native-getter observations and a
save-derived cross-check; target MDEF 400 is cross-checked from raw/native catalog
data, rather than an atomic final-getter read during each hit. The detailed
guarded stat-memory report was not retained, so those observations alone are not
a complete stat proof.

The diagnostic float32 reconstruction matches both native multipliers bit for
bit. The production percentage bucket remains an approximation at float32 ULP
level; the damage checks compare legal random ranges, not exact random rolls.
The planner uses the configured target count and does not replay individual
enemy deaths. Sharp Mind's additional native context-byte gate is unmapped;
coverage here is ordinary, unreflected damage. Unknown effects and other combat
contexts retain their existing limitations.
