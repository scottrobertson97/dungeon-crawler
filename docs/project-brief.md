# Dungeon Crawl Project Brief

## Concept

Turn the cooperative Dungeon Crawl tabletop game into a readable, responsive 2D Phaser game for a single browser. The web version should preserve the party's strategic decisions while automating bookkeeping: dungeon construction, turn order, dice rolls, block and damage calculations, status effects, deaths, room completion, loot, and victory or defeat.

The supplied handoff originally favored React because the game is panel- and state-heavy. The explicit implementation request selects Phaser, so Phaser owns the complete visible card-table presentation while plain TypeScript modules continue to own rules and content. A small DOM live region mirrors phase and log status for assistive technology.

## Audience and platform

- One player controlling the entire party, or a local hot-seat group.
- Desktop-first browser play with a responsive layout for smaller screens.
- Static hosting on GitHub Pages.
- No server, accounts, or networked multiplayer.

## Complete player loop

1. Start or continue a local game.
2. Choose exactly four seeded characters.
3. Place the chosen characters into A, B, C, and D in selection order.
4. Construct a run from two A rooms, one special room, two B rooms, and one boss room.
5. Before each combat room, review its complete turn timeline and enemy action details, then drag heroes between positions or tap two heroes to swap them.
6. Begin combat to lock the formation, then resolve player/enemy turns by choosing abilities and targets.
7. Complete combat or make the required special-room decisions; special rooms retain the current formation without a combat-preparation step.
8. Draw, distribute, equip, swap, or discard loot between rooms.
9. Continue until the boss is defeated or every party member dies in combat.

## First playable slice

The first verification target is one complete A-tier combat room:

- Seed data loads and reports useful character and room counts.
- Four characters can be selected, automatically placed into unique turn slots, and rearranged on the room-preparation screen.
- The preparation screen exposes the room's complete upcoming turn order and the rules and stats for each enemy action.
- Players can choose a direct-damage ability and a valid target.
- Player attacks, enemy block rolls, enemy actions, damage, death, and turn advancement resolve through the rules engine.
- Defeating every enemy ends the room and draws placeholder loot.
- The event log explains rolls and state changes.

The architecture should then allow the remaining seeded rooms, special rooms, effects, and loot to be added mainly through data and effect handlers.

## Content ownership

`dungeon_crawl_seed_content.json` is the normalized source for characters, combat rooms, special rooms, enemies, and starter loot. Runtime code must use structured effects rather than parsing displayed `rawText`. Ambiguous content should remain visible with an implementation note instead of silently inventing a rule.

MVP assumptions from the handoff:

- Rooms 1-4 are A tier; Rooms 5-8 are B tier.
- Treasure Room, Vendor, Healing Spring, and Witch are special rooms.
- Non-boss combat rooms award two placeholder loot cards.
- Valeria is the provisional boss.
- Players may carry/equip up to three loot cards.

## Technical shape

- Phaser 4 renders the 2D board, pieces, room state, and visual feedback.
- Pure TypeScript game modules own deterministic state transitions and random-number injection.
- JSON/TypeScript content adapters validate and expose seed data.
- Phaser owns dense cards, buttons, turn details, target selection, inventory, combat logs, dice resolution, and overlays.
- Vitest covers rules, turn sequencing, dice boundaries, death/revival, room completion, and content invariants.
- Local storage may preserve the current room, HP, formation, frozen combat order, loot, and log for Continue Game.

## Deployment

- Build command: `npm run build`
- Test command: `npm test`
- Build output: `dist/`
- Vite base: `GITHUB_PAGES_BASE`, defaulting to `./`
- Deployment: `.github/workflows/pages.yml`

The completion gate is a passing test suite, a passing production build, relative asset references in `dist/index.html`, and a fresh strict-port preview that reaches the playable loop without console errors.
