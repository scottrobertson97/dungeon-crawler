# Dungeon Crawl Web Game — Codex Handoff

## One-sentence goal

Turn **Dungeon Crawl**, a cooperative 4-player tabletop dungeon crawler, into a playable browser-based web game that preserves the tabletop decision-making while automating bookkeeping, dice math, turn tracking, damage, modifiers, deaths, room flow, and loot.

## Source files to use

Use these files as the source of truth:

- `Rules.docx` — core rules, game flow, combat rules, inventory, loot, rooms, room completion.
- `Players.xlsx` — character roster, stats, and raw ability text.
- `Encounters.xlsx` — combat rooms, boss room, and special rooms.
- `Cards.xlsx` — appears to contain a different card-game template with sheets named `Villians`, `Events`, and `Properties`. **Do not import this into the MVP unless Scott confirms it belongs to this game.**

A structured starter content file has also been prepared:

- `dungeon_crawl_seed_content.json` — normalized starter data extracted from `Players.xlsx` and `Encounters.xlsx`, plus placeholder loot cards.

## MVP scope

Build a **local browser game** first. No backend. No online multiplayer. No accounts. No real-time networking.

The MVP should support one person controlling the whole party on one screen, or a local hot-seat group sharing a screen.

### The web version should feel like this

This is not an action RPG. It is a digital board/card game assistant:

1. Choose 4 characters.
2. Assign each character to turn positions `A`, `B`, `C`, and `D`.
3. Build a 6-room dungeon run.
4. Reveal rooms one at a time.
5. Resolve combat by clicking abilities, selecting targets, rolling dice, and advancing the turn tracker.
6. Resolve special rooms.
7. Distribute loot between rooms.
8. Defeat the boss to win, or lose if all players die in a combat room.

## Recommended stack

Use:

- **Vite**
- **React**
- **TypeScript**
- **Vitest**
- Plain CSS or CSS modules
- Optional: `zod` for validating JSON content

Do **not** use Phaser for the MVP. This game is mostly state, cards, panels, turns, and log output. React is the better first shape. Phaser can come later only if we want more animated board presentation.

## Core design pillars

1. **Rules engine first, UI second.**  
   Combat and room flow should live in pure TypeScript functions/reducers, not inside React components.

2. **Data-driven content.**  
   Characters, rooms, enemy actions, special rooms, and loot should be JSON/TS data. Do not hardcode specific room logic directly inside components.

3. **Do not parse ability text at runtime.**  
   Keep `rawText` for display, but use structured `effects` arrays for behavior.

4. **Preserve player agency.**  
   The app should not make strategic choices for the players. It should ask players to choose targets, choose abilities, decide loot distribution, and decide special room choices.

5. **Small vertical slice before full content.**  
   First make Room 1 playable with four characters, then expand.

---

# Core tabletop rules to implement

## Game flow

The tabletop game is a cooperative 4-player dungeon crawler. The run has 6 rooms, with the last room being a boss fight.

Deck recipe:

```ts
["A", "A", "SPECIAL", "B", "B", "BOSS"]
```

For MVP data assumptions:

- Treat `Room 1` through `Room 4` as A-tier rooms.
- Treat `Room 5` through `Room 8` as B-tier rooms.
- Treat `Boss Room` as the boss.
- Treat `Treasure Room`, `Vendor`, `Healing Spring`, and `Witch` as special rooms.

At new game:

1. Pick 4 characters.
2. Shuffle A rooms.
3. Shuffle B rooms.
4. Shuffle special rooms.
5. Build the play deck:
   - 2 A rooms
   - 1 special room
   - 2 B rooms
   - 1 boss room
6. Reveal the first room.

## Stats

All players and enemies use:

```ts
type StatBlock = {
  maxHp: number;
  hp: number;
  acc: number;
  def: number;
  dmgBonus?: number;
};
```

Important rules:

- `HP` is health.
- `ACC` modifies attacking.
- `DEF` modifies blocking.
- `DMG` from loot increases damage-dealing actions.
- Player max HP cannot exceed `24`.
- Players can equip up to 3 loot cards.

## Player positions

At the start of combat, players are assigned to exactly one position each:

```ts
type PlayerPosition = "A" | "B" | "C" | "D";
```

Room turn orders refer to these positions.

Example turn slot values:

```ts
"player:A"
"enemy:giant:1"
```

The current room owns the turn sequence. The UI should show the current slot and upcoming slots.

## Player attack roll

When a player uses a damage action against an enemy:

```ts
roll = d6();
total = roll + player.acc + temporaryAccModifiers + abilityAccuracyModifier;

if roll === 1:
  miss, regardless of stats

else if roll === 6:
  hit, regardless of stats

else if total >= enemy.def:
  hit

else:
  miss
```

Ties succeed for players.

## Enemy attack / player block roll

When an enemy attacks one or more players:

```ts
roll = d6();
total = roll + player.def + temporaryDefModifiers;

if roll === 1:
  block fails, regardless of stats

else if roll === 6:
  block succeeds, regardless of stats

else if total >= enemy.acc:
  block succeeds

else:
  block fails
```

Ties succeed for players.

## Damage and death

Enemy death:

- If enemy HP is `0` or lower, enemy is dead.
- Dead enemies skip their actions.
- Effects that require a dead enemy should be skipped unless explicitly stated otherwise.

Player death:

- If player HP is `0` or lower, player is dead.
- Dead players lose all carried/equipped loot.
- Lost loot goes to the bottom of the loot deck.
- Dead players skip actions for the rest of the current room.
- If an enemy action targets a dead player, redirect it to the next untargeted living player in turn order.
- If an enemy action hits all players, do not double-hit the redirected player.

Party defeat:

- If all players die during a combat room, the game ends.

Room completion:

- When all enemies are dead, combat room ends.
- Dead party members resurrect at half max HP.
- Party draws loot equal to the room reward.
- Party distributes loot.
- Next room is revealed.

## Upkeep / temporary modifiers

There are two important cleanup moments:

1. **Start of a player's turn:** remove tokens/modifiers placed by that player's previous action unless the effect says otherwise.
2. **Start of an enemy round:** remove tokens/modifiers placed by enemy actions unless the effect says otherwise.

Model this explicitly. Do not rely on ad hoc cleanup.

Recommended modifier shape:

```ts
type ModifierDuration =
  | { type: "untilSourceNextTurn"; sourceId: string }
  | { type: "targetNextAction"; targetId: string }
  | { type: "oneTurn" }
  | { type: "oneRound" }
  | { type: "threeTurns"; remainingTurns: number }
  | { type: "room" };

type TimedModifier = {
  id: string;
  sourceId: string;
  targetId: string;
  stat: "acc" | "def" | "dmg";
  amount: number;
  duration: ModifierDuration;
  stacking?: "stack" | "noStack";
};
```

---

# Technical architecture

## Suggested project structure

```txt
dungeon-crawl-web/
  package.json
  vite.config.ts
  tsconfig.json
  src/
    main.tsx
    App.tsx

    data/
      dungeon_crawl_seed_content.json
      content.ts

    game/
      types.ts
      constants.ts
      reducer.ts
      selectors.ts

      rules/
        dice.ts
        deck.ts
        combat.ts
        targetting.ts
        turnOrder.ts
        modifiers.ts
        loot.ts
        roomCompletion.ts
        specialRooms.ts
        effects.ts

      tests/
        dice.test.ts
        combat.test.ts
        turnOrder.test.ts
        modifiers.test.ts
        roomCompletion.test.ts

    components/
      Layout/
      TitleScreen.tsx
      PartySelect.tsx
      PositionAssignment.tsx
      DungeonRunView.tsx
      CombatView.tsx
      TurnTracker.tsx
      PlayerPanel.tsx
      EnemyPanel.tsx
      AbilityPanel.tsx
      DiceRollPanel.tsx
      LootDistribution.tsx
      SpecialRoomView.tsx
      GameLog.tsx

    styles/
      app.css
```

## State model

Start with a reducer-driven state machine.

```ts
type GamePhase =
  | "TITLE"
  | "PARTY_SELECT"
  | "POSITION_ASSIGNMENT"
  | "ROOM_REVEAL"
  | "COMBAT"
  | "LOOT_REWARD"
  | "SPECIAL_ROOM"
  | "VICTORY"
  | "DEFEAT";

type GameState = {
  phase: GamePhase;
  rngSeed: string | null;

  allCharacters: CharacterDefinition[];
  selectedPlayers: PlayerRuntime[];

  playDeck: RoomDefinition[];
  completedRooms: RoomDefinition[];
  currentRoom: RuntimeRoom | null;

  lootDeck: LootCardDefinition[];
  lootDiscard: LootCardDefinition[];
  pendingLootReward: LootCardDefinition[];

  turn: {
    index: number;
    order: TurnSlot[];
    round: number;
  } | null;

  modifiers: TimedModifier[];
  log: GameLogEntry[];
};
```

## Runtime vs definition objects

Keep static definitions separate from runtime state.

Definitions:

```ts
type CharacterDefinition = {
  id: string;
  name: string;
  role?: string;
  stats: {
    maxHp: number;
    acc: number;
    def: number;
  };
  abilities: AbilityDefinition[];
};

type EnemyDefinition = {
  id: string;
  name: string;
  stats: {
    maxHp: number;
    acc: number;
    def: number;
  };
  actions: EnemyActionDefinition[];
  passives?: PassiveDefinition[];
  counters?: Record<string, number>;
};

type RoomDefinition = {
  id: string;
  name: string;
  tier: "A" | "B" | "BOSS" | "SPECIAL";
  type: "combat" | "special";
  lootReward: number;
  turnOrder?: string[];
  enemies?: EnemyDefinition[];
  effects?: SpecialRoomEffect[];
};
```

Runtime:

```ts
type PlayerRuntime = {
  id: string;
  characterId: string;
  name: string;
  position: PlayerPosition | null;
  hp: number;
  maxHp: number;
  baseAcc: number;
  baseDef: number;
  damageBonus: number;
  isDead: boolean;
  inventory: LootCardDefinition[];
  abilityState: Record<string, unknown>;
  abilityTokens: number;
};

type EnemyRuntime = {
  id: string;
  definitionId: string;
  name: string;
  hp: number;
  maxHp: number;
  baseAcc: number;
  baseDef: number;
  isDead: boolean;
  counters: Record<string, number>;
};
```

---

# UI requirements

## Title screen

Buttons:

- New Game
- Continue Game, if localStorage save exists
- Rules Summary

## Party select

Show all character cards.

Each card should show:

- Name
- Role
- HP / ACC / DEF
- Ability list

Rules:

- Must select exactly 4 characters.
- Disable Start until 4 are selected.

## Position assignment

After choosing party, assign selected players to `A`, `B`, `C`, `D`.

Rules:

- Exactly one player per position.
- This assignment can persist through the whole dungeon for MVP.
- Later, allow reassignment before each combat room.

## Combat screen

Suggested layout:

```txt
[ Dungeon Progress: Room 2 / 6 ]

[ Turn Tracker Ribbon ]
A -> enemy 1 -> B -> C -> enemy 2 -> D -> enemy 3

[ Current Room / Enemy Cards ]
Enemy card     Enemy card     Enemy card

[ Party Panels ]
A Player       B Player       C Player       D Player

[ Action Panel ]
Current actor actions / ability buttons / target picker

[ Dice + Resolution Log ]
```

Important UI behavior:

- The current turn slot should be obvious.
- Dead combatants should be visually dimmed.
- Temporary modifiers should be visible as small badges.
- The game log should explain every roll and result:
  - `Hayden uses Light's Slice on Giant. Rolled 4 + ACC 1 = 5 vs DEF 4. Hit. Giant takes 5 damage.`
  - `Giant attacks A and B. Hayden rolls 2 + DEF 3 = 5 vs ACC 7. Block fails. Hayden takes 4 damage.`

## Loot reward screen

When a combat room ends:

- Draw loot cards.
- Show loot reward pile.
- Let the player assign each loot card to one party member or discard.
- Enforce max 3 equipped/carrying loot cards for MVP.
- Add a simple "swap inventory" flow between rooms.

## Special room screen

Render:

- Room name
- Flavor text
- Available action buttons
- Result log
- Continue button

Special rooms in seed data:

- Treasure Room
- Other Worldly Merchant
- Spring of the Gods
- Mysterious Witch

---

# Reducer actions

Implement these reducer actions first:

```ts
type GameAction =
  | { type: "START_NEW_GAME"; seed?: string }
  | { type: "SELECT_CHARACTER"; characterId: string }
  | { type: "UNSELECT_CHARACTER"; characterId: string }
  | { type: "CONFIRM_PARTY" }
  | { type: "ASSIGN_POSITION"; playerId: string; position: PlayerPosition }
  | { type: "CONFIRM_POSITIONS" }
  | { type: "REVEAL_NEXT_ROOM" }
  | { type: "START_COMBAT" }
  | { type: "PLAYER_USE_ABILITY"; playerId: string; abilityId: string; targets: string[]; allocation?: Record<string, number> }
  | { type: "RESOLVE_ENEMY_ACTION"; enemyId: string; actionId: string }
  | { type: "ADVANCE_TURN" }
  | { type: "COMPLETE_ROOM" }
  | { type: "ASSIGN_LOOT"; lootCardId: string; playerId: string | null }
  | { type: "EQUIP_LOOT"; playerId: string; lootCardId: string }
  | { type: "RESOLVE_SPECIAL_ROOM"; choiceId?: string; playerId?: string }
  | { type: "SAVE_GAME" }
  | { type: "LOAD_GAME"; state: GameState };
```

Codex can split some actions later, but the first version should stay understandable.

---

# First vertical slice

Build this before attempting the whole game.

## Slice objective

A player can:

1. Start a new game.
2. Select 4 characters.
3. Assign A/B/C/D.
4. Reveal Room 1.
5. Play through Room 1 against the Giant.
6. Use player attacks.
7. Resolve Giant actions.
8. Kill the Giant.
9. Complete the room and draw placeholder loot.

## Use only these player abilities at first

Implement the simplest direct-damage ability for each selected character:

- Hayden — Light's Slice
- Tim — Lightning Bolt
- Robin — Dagger Attack
- Avg Guy — Sword Attack
- Varisiara — Longbow
- Blane — Ukulele Uppercut
- Aeterna — Wind Blades
- Sten — Sword Attack

After the vertical slice works, add buffs, heals, split damage, DOT, special passives, and one-off effects.

---

# Implementation phases

## Phase 1 — Project scaffold and data loading

Tasks:

- Create Vite + React + TypeScript project.
- Add Vitest.
- Add `src/data/dungeon_crawl_seed_content.json`.
- Add TypeScript content loader in `src/data/content.ts`.
- Add `src/game/types.ts`.
- Render a debug screen that lists loaded characters and rooms.

Acceptance criteria:

- `npm run dev` starts app.
- `npm test` runs.
- Character and room counts display correctly.
- Invalid or missing JSON data fails loudly in dev.

## Phase 2 — Pure rules engine

Tasks:

- Implement `rollD6`.
- Implement player hit check.
- Implement enemy block check.
- Implement damage application.
- Implement death checks.
- Implement basic turn order advancement.
- Implement room completion check.

Acceptance criteria:

- Unit tests cover:
  - Roll 1 is critical failure.
  - Roll 6 is critical success.
  - Ties favor players.
  - Player attack uses ACC vs enemy DEF.
  - Enemy attack uses player DEF vs enemy ACC.
  - Dead enemies skip actions.
  - Combat ends when all enemies are dead.
  - Defeat happens when all players are dead.

## Phase 3 — Playable Room 1

Tasks:

- Party selection UI.
- Position assignment UI.
- Combat UI.
- Basic ability buttons.
- Target picker for enemy targets.
- Enemy action resolver for Giant actions.
- Game log.

Acceptance criteria:

- Room 1 can be completed manually from the UI.
- The current turn is always visible.
- Damage updates are visible.
- Dice rolls are logged.
- Dead state works.

## Phase 4 — Full combat rooms

Tasks:

- Add all combat rooms from seed data.
- Implement common effect types:
  - `attackEnemy`
  - `attackEnemies`
  - `attackAllPlayers`
  - `attackPlayersByPosition`
  - `healSelf`
  - `healAlly`
  - `healAllAllies`
  - `applyModifier`
  - `applyModifierToPositions`
  - `applyModifierAllPlayers`
  - `addCounter`
  - `conditionalCounterAttackAllPlayers`
  - `damageAllPlayersByCounter`
  - `splitDamage`
  - `splitHeal`
- Add passives:
  - `untargetableUntilOthersDead`
  - `onDeathDamageAllPlayers`
  - `passiveRevive`

Acceptance criteria:

- Every seeded combat room can be started.
- No enemy action crashes if its target is dead.
- Every unimplemented effect logs a clear TODO instead of silently failing.

## Phase 5 — Loot and inventory

Tasks:

- Implement loot deck shuffle/draw.
- Implement inventory max 3.
- Implement equipment stat bonuses:
  - HP
  - ACC
  - DEF
  - DMG
- Implement consumable potions.
- Add loot distribution screen.
- Add inventory swap between rooms.

Acceptance criteria:

- Players can equip up to 3 cards.
- Max HP cap of 24 is enforced.
- Equipment bonuses affect rolls/damage.
- Consumables are used once and returned/discarded according to their data.

## Phase 6 — Special rooms

Tasks:

- Healing Spring: heal party to max.
- Vendor: draw 4 loot cards and trade 2 existing party loot cards for one drawn card.
- Witch: selected player takes 4 damage, then draws until potion.
- Treasure Room: roll d6 and award loot or ability tokens.

Acceptance criteria:

- Special rooms resolve and advance to next room.
- If ability tokens are not spendable yet, they are still tracked and shown.
- Special rooms are logged clearly.

## Phase 7 — Save/load and polish

Tasks:

- Save game state to localStorage.
- Add continue game.
- Add restart run.
- Add simple responsive layout.
- Add rule reference modal.
- Add "undo last action" only if easy; otherwise skip for MVP.

Acceptance criteria:

- Refreshing the page does not lose a run.
- Continue loads the same room, HP, turn order, loot, and log.
- Game can reach victory/defeat.

---

# Testing checklist

Codex should create focused unit tests for the rules engine, not just component snapshots.

## Dice/combat tests

- Player attack misses on natural 1 even if stats would hit.
- Player attack hits on natural 6 even if stats would miss.
- Player attack hits on tie.
- Enemy attack is blocked on tie.
- Enemy attack hits on player natural 1.
- Enemy attack is blocked on player natural 6.

## Turn order tests

- Turn order advances from last slot back to first.
- Dead enemy action slots are skipped.
- Dead player action slots are skipped.
- Round counter increments correctly.

## Death/retargeting tests

- Dead player loses loot.
- Dead player revives at half max HP after room completion.
- Enemy targeted at dead player redirects to next living untargeted player.
- All-player attacks do not double-target redirected players.

## Modifier tests

- Player-origin modifiers clear at correct upkeep.
- Enemy-origin modifiers clear at enemy upkeep.
- Non-stacking buffs do not stack.
- Three-turn buffs decrement properly.

## Loot tests

- Inventory cap is 3.
- Max HP cap is 24.
- DMG equipment increases damage-dealing player abilities.
- Consumable returns to correct deck/discard location.

---

# Known ambiguities / intentional MVP assumptions

These should be captured as comments/TODOs in the code.

1. **Loot deck source is incomplete.**  
   The rules mention 32 loot cards, but the uploaded card workbook did not appear to contain Dungeon Crawl loot. Use placeholder loot until Scott supplies the real list.

2. **Room loot reward values are missing in the encounter spreadsheet.**  
   Use `lootReward: 2` for non-boss combat rooms until balanced.

3. **Ability tokens appear in Treasure Room but not in the core rules.**  
   Add `abilityTokens` to player state, display them, but do not build a full upgrade economy yet.

4. **Fire Ball DOT duration is unclear.**  
   MVP assumption: DOT ticks at enemy turn start until enemy dies or room ends.

5. **Sten's Bonfire passive needs clear timing.**  
   MVP assumption: when Sten dies, mark him as pending revive; after one skipped Sten turn, revive at half max HP.

6. **Some enemy actions use "automatic" damage.**  
   If text says automatically receive damage, skip block roll. Otherwise, enemy damaging actions should use block rolls.

7. **Boss sheet says Valeria was originally a miniboss idea.**  
   Use Valeria as the MVP boss until a final boss card exists.

8. **Cards.xlsx looks unrelated.**  
   Do not import it into this game unless confirmed.

---

# Content seed

Use `dungeon_crawl_seed_content.json` as the first data import.

Codex should copy it into:

```txt
src/data/dungeon_crawl_seed_content.json
```

Then create:

```ts
// src/data/content.ts
import seed from "./dungeon_crawl_seed_content.json";

export const dungeonCrawlContent = seed;
export const characters = seed.characters;
export const rooms = seed.rooms;
export const specialRooms = seed.specialRooms;
export const starterLoot = seed.starterLoot;
```

In `tsconfig.json`, ensure JSON imports work:

```json
{
  "compilerOptions": {
    "resolveJsonModule": true,
    "esModuleInterop": true
  }
}
```

---

# Suggested first Codex prompt

Use this prompt after creating the repo:

```txt
You are implementing a browser version of my tabletop game Dungeon Crawl.

Read DUNGEON_CRAWL_WEB_GAME_HANDOFF.md and use dungeon_crawl_seed_content.json as the seed data.

Start with the smallest playable vertical slice:
- Vite + React + TypeScript
- Vitest
- Load and display character/room seed data
- New game flow
- Select exactly 4 characters
- Assign them to A/B/C/D
- Reveal Room 1
- Play Room 1 against the Giant
- Implement player attack rolls, enemy block rolls, enemy actions, damage, death, turn advancement, room completion, and basic loot draw

Keep the rules engine pure and tested. Do not hardcode rules inside React components. Do not implement online multiplayer or backend. Use TODO comments for ambiguous rules instead of inventing large systems.
```

---

# Definition of done for initial repo

The initial repo is good enough when:

- It runs locally with `npm run dev`.
- Tests run with `npm test`.
- A new game can be started.
- Four characters can be selected.
- Positions A/B/C/D can be assigned.
- Room 1 can be completed.
- Dice rolls and hit/block outcomes follow the rules.
- Damage, death, and room completion work.
- Game log clearly explains what happened.
- Code is organized so adding the rest of the rooms is mostly data/effect work.

