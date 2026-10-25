# Resonance Battle Companion

Boss weaknesses, gear planning and Resonance kits for FINAL FANTASY RESONANCE: **https://dylanelo.github.io/ffr-battle-companion/**

Works without a save for looking things up. Load your save to plan with what you actually own. The save is read in your browser tab and never uploaded or changed.

## What it does

- **Party**: searches four-person parties, owned Resonances, shared equipment and learned ability loadouts for an encounter. It uses native-formula HP/stagger damage, recorded progression, supported passive synergies, skill costs and slots. Choose damage, break, or a balanced objective; optionally require healing/protection or lock characters in the party. Compare three candidates, inspect counted/excluded effects, stage their plans or export the result.
- **Bosses**: what an enemy is weak to, resists and attacks with. With your save loaded, your Resonances are ranked by how many unlocked skills hit a weakness, and you can jump straight to planning gear around one.
- **Gear**: the best loadout for a goal (physical damage, magic, durability, speed and more) from equipment you own. It won't take gear another character is wearing unless you allow it. Keep plans per character and export them.
- **Resonances**: every kit with its finisher and what unlocks at each awakening and sync level, plus your own progress.
- **About the data**: what the recommendations do and don't account for, impact tiers and source tables.

The **Gear** view remains a quick flat-stat comparison. The **Party** page uses battle calculations and passive effects instead. It reports the strongest candidates found by a bounded search, not a proof of the global optimum. Damage is a native-formula prediction, not a live measurement.

The default scenario gives each member one ordinary action, with no free setup turns or automatic finishers. A supported buff/debuff spends its caster’s action and only benefits allies acting later by Agility. Enemy entries are base rows; a specific encounter may override them. Nested multi-action commands, bespoke reactions, unknown active artifacts and unsupported calculations are explicitly excluded. Runtime Spirit expansion retains an evidence caveat; see [model notes](docs/model-notes.md).

## Development

Static files in [`docs/`](docs), no build step: `python -m http.server -d docs`.

- [`docs/core.js`](docs/core.js): stock, reservations, recommendations and mastery rules. Tests: `node --test tests/core.test.cjs`.
- [`docs/save.js`](docs/save.js): reads the encrypted save (read-only use here).
- [`docs/app.js`](docs/app.js): the interface.
- [`docs/damage.js`](docs/damage.js), [`docs/passives.js`](docs/passives.js) and [`docs/stats.js`](docs/stats.js): native-formula damage, supported effect rules and saved-progression stat derivation.
- [`docs/battle.js`](docs/battle.js) and [`docs/search.js`](docs/search.js): legal action/passive loadouts and shared-inventory party search. A Web Worker keeps the interface responsive and makes cancellation immediate.
- [`docs/data/catalog.json`](docs/data/catalog.json): game tables (Resonances, skills, passives, equipment, characters, enemies), generated locally from an installed copy of the game.

Unofficial fan project. Not affiliated with or endorsed by Square Enix.
