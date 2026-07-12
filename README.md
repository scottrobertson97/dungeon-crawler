# Dungeon Crawl

Dungeon Crawl is a local cooperative browser adaptation of a four-player tabletop dungeon crawler. One person can control the full party, or a hot-seat group can share one screen. The game automates room setup, turn order, dice math, damage, deaths, modifiers, loot, and dungeon progression while leaving character, target, ability, inventory, and special-room choices to the players.

The implementation uses Phaser for its 2D board presentation and plain TypeScript for deterministic game rules. Character, enemy, room, special-room, and starter-loot definitions come from `dungeon_crawl_seed_content.json`.

## Included MVP

- All 8 seeded heroes and 25 abilities, including target selection and split-damage/healing allocation.
- All 9 combat definitions, 20 seeded enemy records, 32 enemy actions, and Valeria as the boss.
- Treasure Room, Other Worldly Merchant, Spring of the Gods, and Mysterious Witch.
- A generated six-room run, indexed room turn orders, attack/block dice, modifiers, DOT, counters, passives, death, revival, loot, and victory/defeat.
- A 32-card placeholder loot deck built from four copies of the 8 seeded definitions.
- Versioned local autosaves and a Continue flow that preserves RNG, HP, turns, effects, inventory, and log history.

## Play loop

1. Select exactly four characters.
2. The selected heroes are placed into turn slots A, B, C, and D in selection order.
3. Build a six-room run: two A rooms, one special room, two B rooms, and a boss.
4. Before each combat room, review its full turn timeline and enemy action details, then rearrange the party by dragging hero cards or tapping two cards to swap them.
5. Begin combat to lock the formation until the next combat room. Special rooms keep the current formation and use their own decision flow.
6. Distribute loot and manage the party between rooms.
7. Defeat the boss to win before the full party falls.

## Local development

Requirements: a current Node.js LTS release and npm.

```powershell
npm install
npm run dev
```

Open the local URL printed by Vite. Useful verification commands:

```powershell
npm test
npm run build
npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
```

The production build is written to `dist/`.

## Project structure

- `src/game/` contains the pure TypeScript rules and state transitions.
- `src/data/` loads and normalizes the supplied seed content.
- `src/phaser/` renders the board, cards, controls, logs, overlays, and visual feedback in the Phaser canvas.
- `docs/project-brief.md` records the intended scope and architecture.
- `docs/rules-assumptions.md` records every intentional MVP ruling where the source material is ambiguous.

The game is pointer-driven. During combat preparation, drag hero cards between A-D or tap two cards to swap their positions. Choose abilities and targets directly on the board; allocation abilities expose `+`/`-` controls that must total the card's full damage or healing value. The `?` button opens the rules reference, and `Esc` closes it.

## GitHub Pages

The workflow in `.github/workflows/pages.yml` tests and builds the project before publishing `dist/`. In the GitHub repository, set **Settings > Pages > Source** to **GitHub Actions**.

Vite defaults to relative asset URLs through `GITHUB_PAGES_BASE=./`, which works for project Pages and static mirrors. If the deployment needs an explicit path, create a repository Actions variable named `GITHUB_PAGES_BASE` with `/<repository-name>/`, or `/` for a root/custom-domain site.

## Source material and MVP assumptions

The web-game handoff and `dungeon_crawl_seed_content.json` are the sources of truth for the MVP. Seeded placeholder loot remains temporary because the original 32-card loot deck was unavailable. Non-boss combat rooms use the handoff's placeholder reward of two loot cards, and Valeria is the provisional boss until final boss content is supplied.
