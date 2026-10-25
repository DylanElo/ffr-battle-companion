# Resonance Battle Companion

Boss weaknesses, gear planning and Resonance kits for FINAL FANTASY RESONANCE: **https://dylanelo.github.io/ffr-battle-companion/**

Works without a save for looking things up. Load your save to plan with what you actually own. The save is read in your browser tab and never uploaded or changed.

## What it does

- **Bosses**: what an enemy is weak to, resists and attacks with. With your save loaded, your Resonances are ranked by how many unlocked skills hit a weakness, and you can jump straight to planning gear around one.
- **Gear**: the best loadout for a goal (physical damage, magic, durability, speed and more) from equipment you own. It won't take gear another character is wearing unless you allow it. Keep plans per character and export them.
- **Resonances**: every kit with its finisher and what unlocks at each awakening and sync level, plus your own progress.
- **About the data**: what the recommendations do and don't account for, impact tiers and source tables.

“Best loadout” scores flat equipment stats only. Effects such as “+20% Fire damage” are listed for you to judge rather than scored.

## Development

Static files in [`docs/`](docs), no build step: `python -m http.server -d docs`.

- [`docs/core.js`](docs/core.js): stock, reservations, recommendations and mastery rules. Tests: `node --test tests/core.test.cjs`.
- [`docs/save.js`](docs/save.js): reads the encrypted save. Shared with the [Resonance Save Editor](https://github.com/DylanElo/ffrs-save-editor).
- [`docs/app.js`](docs/app.js): the interface.
- [`docs/data/catalog.json`](docs/data/catalog.json): game tables (Resonances, skills, passives, equipment, characters, enemies), generated locally from an installed copy of the game.

Unofficial fan project. Not affiliated with or endorsed by Square Enix.
