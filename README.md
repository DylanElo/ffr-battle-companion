# Resonance Battle Companion

Boss weaknesses, gear planning and Resonance kits for FINAL FANTASY RESONANCE: **https://dylanelo.github.io/ffr-battle-companion/**

Works without a save for looking things up. Load your save to plan with what you actually own. The save is read in your browser tab and never uploaded. It's only changed if you ask for your plans to be equipped, and then as a new downloaded file.

## What it does

- **Next fight** (the first page once your save is loaded): opens on the first boss at or above your party's level (or Any fight), runs Best party for it, and **Equip in my save** downloads your save with that party equipped plus a backup, in one click.
- **Before/after**: every party and character result scores the exact recorded equipment and equipped abilities with the same model. AP and slots include every equipped ability. An incomplete or unsupported current party has no improvement percentage. Unrecorded Mastery can still understate the saved setup.
- **Understand each choice**: every equipment slot stays visible. Open an item to see its stats, effects, and the estimated change with that slot empty. **Why this build** shows AP/slots, every equipped ability and its removal comparison, damage inputs and model limits. Removal checks keep other gear and abilities fixed and may choose another attack; they are not additive item bonuses. Empty slots state whether copies are unavailable, a choice would harm the modeled build, or remaining effects cannot be evaluated.
- **Finite MP**: five-round estimates spend the chosen action's MP. Exhausted turns contribute zero and are reported; recovery and replacement attacks are not invented. Party support replaces the caster's attack, including its stagger and LB contribution. All numbers are model estimates, not calibrated battle measurements.
- **Fight**: pick an enemy to see what it's weak to, resists and attacks with. **Best party** searches parties of four you can field, with owned Resonances, shared equipment and learned abilities, and estimates five-round damage using recovered game formulas and explicit simulation assumptions. Build for any mix of Damage, Stagger, Limit Burst and Durability (each counts the share of a bar filled per round: enemy HP, its stagger bar, your LB gauge), require a healer or protection, lock characters in, then compare three options and use one as your gear plans. Below that: your Resonances with unlocked skills it's weak to, its skills and its status resistances.
- **Characters**: an equip screen per character with real stat totals (base, level, sync and gear). **Build** is the one build tool: it searches Resonance, gear, attack, abilities and passives together for any mix of damage, stagger, Limit Burst and durability, against a chosen enemy or **any fight** (a neutral boss at your party's level with the median stats of the nearest bosses and no elemental weaknesses), and compares the result with what's equipped now. Untick **Let it pick the Resonance** (or choose one in the Resonance box) to build around a Resonance you pick; the Fight page's **Build X around Y** buttons open it that way and start the search. Keep plans per character and export them. **Equip plans in my save** writes the plans' gear, Resonances and abilities into a copy of your save (with a backup download) for you to drop into your save folder; it and Next fight's Equip in my save are the only features that write a save.
- **Resonances**: every kit with its finisher and what unlocks at each awakening and sync level, plus your own progress. **Filter by effect** finds Resonances by what their skills and passives do (ATK/MAG/DEF/SPR/Speed down or up, statuses, heals, revive, cure, dispel, cover, provoke and more), who they hit (one enemy, all enemies, self, allies), physical or magic, and element, optionally limited to what a character has unlocked. Each match shows the skill and where it unlocks.
- **How this works** (footer): what the recommendations do and don't account for, impact tiers and source tables.

Optimize is a quick flat-stat comparison. Best party uses battle calculations and passive effects instead. It reports the strongest candidates found by a bounded search, not a proof of the global optimum. Damage is a native-formula prediction, not a live measurement.

The damage arithmetic has been checked against isolated instruction blocks from the installed executable: 1,009 attack/defense pairs, 5,000 HP cases, 5,000 stagger cases and all 9,801 level pairs from 1 to 99. Proven rounding and MP-cost errors were corrected, and Legendary SOLDIER's higher-stat rules are included. See [combat verification](docs/combat-verification.md) for the executable hash, exact examples, test command and remaining timing assumptions.

The default scenario gives each member one turn: one action, or the same attack twice with Arms Akimbo or Dualcast (Magic Boost doubles magic attacks for 1.5× MP). Each hit is capped at 9,999 unless Break the Limit is equipped. Members start at full HP with no buffs; no free setup turns or automatic finishers. Scores are per round over a five-round fight; staggered rounds (from the stagger through the next round) deal ×1.5, so fast breakers also raise damage: each stagger fills every member's LB gauge by 25 (Fill LB on Stagger adds to whoever lands it; Double/Triple Charge multiply), and a Limit Burst is used when it beats the normal turn. Limit Burst power scales with level (×(1 + level/15)). A supported buff/debuff spends its caster’s action and only benefits allies acting later by Agility. Enemy entries are base rows; a specific encounter may override them. Mixed two-action turns (e.g. buff then attack), support Limit Bursts, LB from damage taken, bespoke reactions, unknown active artifacts and unsupported calculations are explicitly excluded. Runtime Spirit expansion retains an evidence caveat; see [model notes](docs/model-notes.md).

## Development

Static files in [`docs/`](docs), no build step: `python -m http.server -d docs`.

- [`docs/core.js`](docs/core.js): stock, reservations, recommendations and mastery rules. Tests: `node --test tests/core.test.cjs`.
- [`docs/save.js`](docs/save.js): reads the encrypted save (read-only use here).
- [`docs/app.js`](docs/app.js): the interface.
- [`docs/damage.js`](docs/damage.js), [`docs/passives.js`](docs/passives.js) and [`docs/stats.js`](docs/stats.js): native-formula damage, supported effect rules and saved-progression stat derivation.
- [`docs/battle.js`](docs/battle.js) and [`docs/search.js`](docs/search.js): legal action/passive loadouts and shared-inventory party search. A Web Worker keeps the interface responsive and makes cancellation immediate.
- [`docs/data/catalog.json`](docs/data/catalog.json): game tables (Resonances, skills, passives, equipment, characters, enemies), generated locally from an installed copy of the game.

Unofficial fan project. Not affiliated with or endorsed by Square Enix.
