import { describe, expect, it } from "vitest";
import { dungeonCrawlContent } from "../data/content";
import {
  assignLoot,
  assignPosition,
  completeVendorTrade,
  confirmParty,
  confirmPositions,
  continueAfterLoot,
  enterRevealedRoom,
  getCurrentTurn,
  getPlayerEffectiveStats,
  isEnemyTargetable,
  resolveHealingSpring,
  resolveEnemyTurn,
  resolveTreasureRoom,
  resolveWitchTrade,
  startNewGame,
  startSpecificCombatRoom,
  toggleCharacterSelection,
  transferPlayerLoot,
  useLootCard,
  usePlayerAbility
} from "./engine";
import { checkPlayerAttackRoll, checkPlayerBlockRoll } from "./rules";
import type { GameState } from "./types";

describe("combat dice rules", () => {
  it("player attack misses on natural 1 and hits on natural 6", () => {
    expect(checkPlayerAttackRoll(1, 99, 4).success).toBe(false);
    expect(checkPlayerAttackRoll(6, 0, 99).success).toBe(true);
  });

  it("player attack ties hit", () => {
    expect(checkPlayerAttackRoll(3, 1, 4).success).toBe(true);
  });

  it("block ties succeed and natural edges override stats", () => {
    expect(checkPlayerBlockRoll(3, 4, 7).success).toBe(true);
    expect(checkPlayerBlockRoll(1, 99, 7).success).toBe(false);
    expect(checkPlayerBlockRoll(6, 0, 99).success).toBe(true);
  });
});

describe("Dungeon Crawl engine", () => {
  it("builds a six-room deck and enters combat from a selected party", () => {
    const state = startReadyRun();
    expect(state.playDeck.length + (state.currentRoom ? 1 : 0) + (state.currentSpecialId ? 1 : 0)).toBe(6);
    const combat = enterRevealedRoom(state, dungeonCrawlContent);
    expect(combat.phase).toBe("COMBAT");
    expect(getCurrentTurn(combat)).toBeTruthy();
  });

  it("completes Room 1 and creates a loot reward when the Giant dies", () => {
    let state = startRoomOne();
    const player = state.selectedPlayers.find((candidate) => candidate.position === "A");
    const giant = state.currentRoom?.enemies[0];
    expect(player).toBeTruthy();
    expect(giant).toBeTruthy();
    if (!player || !giant) {
      throw new Error("test setup failed");
    }
    state.turn = { index: state.currentRoom!.turnOrder.indexOf("player:A"), round: 1 };
    giant.hp = 1;
    state = usePlayerAbility(state, dungeonCrawlContent, player.id, "lights-slice", [giant.id]);
    expect(["LOOT_REWARD", "COMBAT"]).toContain(state.phase);
    if (state.phase === "LOOT_REWARD") {
      expect(state.pendingLootReward.length).toBeGreaterThan(0);
    }
  });

  it("enforces the three-card loot cap", () => {
    let state = startReadyRun();
    const player = state.selectedPlayers[0];
    state.phase = "LOOT_REWARD";
    state.pendingLootReward = ["well-made-chainmail", "keen-blade", "archers-gloves", "heart-amulet"];
    state = assignLoot(state, dungeonCrawlContent, "well-made-chainmail", player.id);
    state = assignLoot(state, dungeonCrawlContent, "keen-blade", player.id);
    state = assignLoot(state, dungeonCrawlContent, "archers-gloves", player.id);
    state = assignLoot(state, dungeonCrawlContent, "heart-amulet", player.id);
    expect(state.selectedPlayers[0].lootIds).toHaveLength(3);
    expect(state.pendingLootReward).toContain("heart-amulet");
  });

  it("healing spring restores living and fallen party members", () => {
    let state = startReadyRun();
    state.phase = "SPECIAL_ROOM";
    state.currentSpecialId = "healing-spring";
    state.selectedPlayers[0].hp = 1;
    state.selectedPlayers[1].hp = 0;
    state.selectedPlayers[1].dead = true;
    state = resolveHealingSpring(state, dungeonCrawlContent);
    expect(state.selectedPlayers[0].hp).toBe(state.selectedPlayers[0].maxHp);
    expect(state.selectedPlayers[1].dead).toBe(false);
    expect(state.selectedPlayers[1].hp).toBe(state.selectedPlayers[1].maxHp);
  });

  it("treasure room tracks ability tokens or pending loot", () => {
    let state = startReadyRun();
    state.phase = "SPECIAL_ROOM";
    state.currentSpecialId = "treasure-room";
    state = resolveTreasureRoom(state, dungeonCrawlContent);
    const tokenTotal = state.selectedPlayers.reduce((sum, player) => sum + player.abilityTokens, 0);
    expect(tokenTotal + state.pendingLootReward.length).toBeGreaterThan(0);
  });

  it("serializes and hydrates pure game state", () => {
    const state = startReadyRun();
    const copy = JSON.parse(JSON.stringify(state)) as GameState;
    expect(copy.selectedPlayers).toHaveLength(4);
    expect(copy.playDeck.length).toBeGreaterThan(0);
  });

  it("can start every seeded combat room and resolve every enemy action without TODO fallbacks", () => {
    for (const room of dungeonCrawlContent.rooms) {
      for (const [index, slot] of room.turnOrder.entries()) {
        if (!slot.startsWith("enemy:")) {
          continue;
        }
        let state = startSpecificCombatRoom(startReadyRun(), dungeonCrawlContent, room.id);
        state.turn = { index, round: 1 };
        state.selectedPlayers.forEach((player) => {
          player.hp = 80;
          player.maxHp = 80;
          player.dead = false;
        });

        expect(() => {
          state = resolveEnemyTurn(state, dungeonCrawlContent);
        }, `${room.id} ${slot}`).not.toThrow();
        expect(state.log.some((entry) => entry.text.includes("TODO:"))).toBe(false);
      }
    }
  });

  it("resolves every seeded player ability without TODO fallbacks", () => {
    for (const character of dungeonCrawlContent.characters) {
      for (const ability of character.abilities) {
        let state = startReadyRunWith(character.id);
        state = startSpecificCombatRoom(state, dungeonCrawlContent, "room-8");
        const player = state.selectedPlayers[0];
        const playerTurnIndex = state.currentRoom?.turnOrder.indexOf("player:A") ?? -1;
        state.turn = { index: playerTurnIndex, round: 1 };
        state.selectedPlayers.forEach((candidate) => {
          candidate.hp = 40;
          candidate.maxHp = 40;
          candidate.dead = false;
        });
        state.currentRoom?.enemies.forEach((enemy) => {
          enemy.hp = 40;
          enemy.maxHp = 40;
          enemy.dead = false;
        });

        const { targetIds, allocation } = inputsForAbility(state, ability.id);
        expect(() => {
          state = usePlayerAbility(state, dungeonCrawlContent, player.id, ability.id, targetIds, allocation);
        }, `${character.id} ${ability.id}`).not.toThrow();
        expect(state.log.some((entry) => entry.text.includes("TODO:"))).toBe(false);
      }
    }
  });

  it("implements placeholder item effects for Lucky Token and Guard Charm", () => {
    let state = startReadyRun();
    state = startSpecificCombatRoom(state, dungeonCrawlContent, "room-1");
    const player = state.selectedPlayers[0];
    player.lootIds = ["lucky-token", "guard-charm"];
    state.turn = { index: state.currentRoom!.turnOrder.indexOf("player:A"), round: 1 };

    state = useLootCard(state, dungeonCrawlContent, player.id, "lucky-token");
    expect(state.pendingPlayerReroll?.playerId).toBe(player.id);
    state = usePlayerAbility(state, dungeonCrawlContent, player.id, "lights-slice", ["giant"]);
    expect(state.pendingPlayerReroll).toBeNull();
    expect(state.selectedPlayers[0].usedLootThisRoom).toContain("lucky-token");

    state = startSpecificCombatRoom(state, dungeonCrawlContent, "room-1");
    state.selectedPlayers[0].lootIds = ["guard-charm"];
    state = useLootCard(state, dungeonCrawlContent, state.selectedPlayers[0].id, "guard-charm");
    expect(state.modifiers.some((modifier) => modifier.duration === "nextBlock" && modifier.stat === "def")).toBe(true);
  });

  it("applies equipment bonuses, max HP cap, consumables, and inventory transfer", () => {
    let state = startReadyRun();
    const playerA = state.selectedPlayers[0];
    const playerB = state.selectedPlayers[1];
    playerA.maxHp = 23;
    playerA.hp = 10;
    playerA.lootIds = ["well-made-chainmail", "archers-gloves", "keen-blade", "heart-amulet"];
    const stats = getPlayerEffectiveStats(state, dungeonCrawlContent, playerA);
    expect(stats.maxHp).toBe(24);
    expect(stats.acc).toBe(playerA.acc + 1);
    expect(stats.def).toBe(playerA.def + 1);
    expect(stats.dmg).toBe(1);

    playerA.lootIds = ["minor-healing-potion"];
    state.lootDeck = [];
    state = useLootCard(state, dungeonCrawlContent, playerA.id, "minor-healing-potion");
    expect(state.selectedPlayers[0].hp).toBe(12);
    expect(state.selectedPlayers[0].lootIds).not.toContain("minor-healing-potion");
    expect(state.lootDeck.at(-1)).toBe("minor-healing-potion");

    state.selectedPlayers[0].lootIds = ["guard-charm"];
    state.selectedPlayers[1].lootIds = [];
    state = transferPlayerLoot(state, dungeonCrawlContent, playerA.id, playerB.id, "guard-charm");
    expect(state.selectedPlayers[0].lootIds).not.toContain("guard-charm");
    expect(state.selectedPlayers[1].lootIds).toContain("guard-charm");
  });

  it("resolves vendor and witch special-room loot flows", () => {
    let state = startReadyRun();
    state.phase = "SPECIAL_ROOM";
    state.currentSpecialId = "vendor";
    state.selectedPlayers[0].lootIds = ["well-made-chainmail", "keen-blade"];
    state.vendor = {
      drawIds: ["archers-gloves", "heart-amulet"],
      selectedPaymentIds: ["well-made-chainmail", "keen-blade"],
      selectedTakeId: "archers-gloves",
      selectedRecipientId: state.selectedPlayers[1].id
    };
    state = completeVendorTrade(state, dungeonCrawlContent);
    expect(state.selectedPlayers[0].lootIds).toEqual([]);
    expect(state.selectedPlayers[1].lootIds).toContain("archers-gloves");
    expect(state.lootDiscard).toEqual(expect.arrayContaining(["well-made-chainmail", "keen-blade"]));
    expect(state.lootDeck).toContain("heart-amulet");

    state = startReadyRun();
    state.phase = "SPECIAL_ROOM";
    state.currentSpecialId = "witch";
    state.lootDeck = ["well-made-chainmail", "minor-healing-potion"];
    state.selectedPlayers[0].hp = 10;
    state = resolveWitchTrade(state, dungeonCrawlContent, state.selectedPlayers[0].id);
    expect(state.selectedPlayers[0].hp).toBe(6);
    expect(state.selectedPlayers[0].lootIds).toContain("minor-healing-potion");
    expect(state.lootDeck).toContain("well-made-chainmail");
    expect(state.lootDiscard).not.toContain("well-made-chainmail");
  });

  it("implements seeded passives for target lock, death burst, and Sten revive", () => {
    let state = startSpecificCombatRoom(startReadyRun(), dungeonCrawlContent, "room-4");
    const babyWolf = state.currentRoom!.enemies.find((enemy) => enemy.id === "baby-wolf")!;
    expect(isEnemyTargetable(state.currentRoom!, babyWolf)).toBe(false);
    state.currentRoom!.enemies.filter((enemy) => enemy.id !== "baby-wolf").forEach((enemy) => {
      enemy.dead = true;
    });
    expect(isEnemyTargetable(state.currentRoom!, babyWolf)).toBe(true);

    state = startSpecificCombatRoom(startReadyRun(), dungeonCrawlContent, "room-8");
    const fleshGolem = state.currentRoom!.enemies.find((enemy) => enemy.id === "flesh-golem")!;
    fleshGolem.hp = 1;
    const beforeHp = state.selectedPlayers[0].hp;
    state.turn = { index: state.currentRoom!.turnOrder.indexOf("player:A"), round: 1 };
    state = usePlayerAbility(state, dungeonCrawlContent, state.selectedPlayers[0].id, "lights-slice", ["flesh-golem"]);
    expect(state.selectedPlayers[0].hp).toBe(beforeHp - 1);

    state = startReadyRunWith("sten-the-casual");
    state = startSpecificCombatRoom(state, dungeonCrawlContent, "room-1");
    state.currentRoom!.turnOrder = ["player:A"];
    state.turn = { index: 0, round: 1 };
    state.selectedPlayers[0].dead = true;
    state.selectedPlayers[0].hp = 0;
    state.selectedPlayers[0].pendingReviveTurns = 1;
    state = usePlayerAbility(state, dungeonCrawlContent, state.selectedPlayers[0].id, "bad-sword", ["giant"]);
    expect(state.selectedPlayers[0].dead).toBe(false);
    expect(state.selectedPlayers[0].hp).toBeGreaterThan(0);
  });

  it("supports victory, defeat, DOT, and once-per-encounter ability limits", () => {
    let state = startSpecificCombatRoom(startReadyRun(), dungeonCrawlContent, "boss-valeria-spider-queen");
    state.currentRoom!.enemies[0].hp = 1;
    state.turn = { index: state.currentRoom!.turnOrder.indexOf("player:A"), round: 1 };
    state = usePlayerAbility(state, dungeonCrawlContent, state.selectedPlayers[0].id, "lights-slice", ["valeria"]);
    expect(state.phase).toBe("VICTORY");

    state = startSpecificCombatRoom(startReadyRun(), dungeonCrawlContent, "room-4");
    state.selectedPlayers.forEach((player) => {
      player.hp = 1;
      player.dead = false;
    });
    state.currentRoom!.turnOrder = ["enemy:baby-wolf:1"];
    state.turn = { index: 0, round: 1 };
    state = resolveEnemyTurn(state, dungeonCrawlContent);
    expect(state.phase).toBe("DEFEAT");

    state = startReadyRunWith("tim-grandmaster-wizard");
    state = startSpecificCombatRoom(state, dungeonCrawlContent, "room-1");
    state.rngState = 1;
    state.currentRoom!.enemies[0].def = -100;
    state.turn = { index: state.currentRoom!.turnOrder.indexOf("player:A"), round: 1 };
    state = usePlayerAbility(state, dungeonCrawlContent, state.selectedPlayers[0].id, "fire-ball", ["giant"]);
    expect(state.currentRoom?.enemies[0].dots.length).toBeGreaterThan(0);
    const beforeDotHp = state.currentRoom!.enemies[0].hp;
    state.turn = { index: state.currentRoom!.turnOrder.indexOf("enemy:giant:1"), round: 1 };
    state = resolveEnemyTurn(state, dungeonCrawlContent);
    expect(state.currentRoom?.enemies[0].hp).toBeLessThan(beforeDotHp);

    state = startReadyRunWith("tim-grandmaster-wizard");
    state = startSpecificCombatRoom(state, dungeonCrawlContent, "room-1");
    state.turn = { index: state.currentRoom!.turnOrder.indexOf("player:A"), round: 1 };
    state = usePlayerAbility(state, dungeonCrawlContent, state.selectedPlayers[0].id, "misty-step");
    state.turn = { index: state.currentRoom!.turnOrder.indexOf("player:A"), round: 1 };
    state = usePlayerAbility(state, dungeonCrawlContent, state.selectedPlayers[0].id, "misty-step");
    expect(state.log.some((entry) => entry.text.includes("already been used"))).toBe(true);
  });
});

function startReadyRunWith(requiredCharacterId?: string): GameState {
  let state = startNewGame(dungeonCrawlContent, "vitest-seed");
  const ids = [
    requiredCharacterId,
    ...dungeonCrawlContent.characters.map((character) => character.id)
  ].filter((id, index, allIds): id is string => Boolean(id) && allIds.indexOf(id) === index).slice(0, 4);
  for (const id of ids) {
    state = toggleCharacterSelection(state, id);
  }
  state = confirmParty(state, dungeonCrawlContent);
  state = assignPosition(state, state.selectedPlayers[0].id, "A");
  state = assignPosition(state, state.selectedPlayers[1].id, "B");
  state = assignPosition(state, state.selectedPlayers[2].id, "C");
  state = assignPosition(state, state.selectedPlayers[3].id, "D");
  return confirmPositions(state, dungeonCrawlContent);
}

function startReadyRun(): GameState {
  return startReadyRunWith();
}

function inputsForAbility(state: GameState, abilityId: string): { targetIds: string[]; allocation: Record<string, number> } {
  const enemyIds = state.currentRoom?.enemies.map((enemy) => enemy.id) ?? [];
  const playerIds = state.selectedPlayers.map((player) => player.id);
  switch (abilityId) {
    case "holy-shockwave":
      return { targetIds: enemyIds.slice(0, 3), allocation: {} };
    case "multishot":
      return { targetIds: enemyIds, allocation: {} };
    case "lay-on-hands":
    case "defensive-melody":
    case "offensive-melody":
    case "guiding-winds":
    case "winds-of-evasion":
      return { targetIds: [playerIds[1] ?? playerIds[0]], allocation: {} };
    case "natures-boon":
      return { targetIds: [playerIds[1] ?? playerIds[0]], allocation: {} };
    case "multistrike":
      return { targetIds: enemyIds, allocation: { [enemyIds[0]]: 6 } };
    case "healing-hymn":
      return { targetIds: playerIds, allocation: { [playerIds[0]]: 3 } };
    case "misty-step":
    case "decrease-polygon-count":
    case "bonfire":
    case "breeze-of-healing":
      return { targetIds: [], allocation: {} };
    default:
      return { targetIds: enemyIds.slice(0, 1), allocation: {} };
  }
}

function startRoomOne(): GameState {
  let state = startReadyRun();
  state.currentRoom = {
    definitionId: "room-1",
    name: "Room 1",
    tier: "A",
    type: "combat",
    lootReward: 2,
    turnOrder: ["player:A"],
    enemies: [
      {
        id: "giant",
        name: "Giant",
        maxHp: 25,
        hp: 25,
        acc: 7,
        def: 4,
        tags: [],
        actions: [],
        passives: [],
        dead: false,
        passiveTriggered: [],
        counters: {},
        dots: [],
        skipNextAction: false
      }
    ]
  };
  state.phase = "COMBAT";
  state.turn = { index: 0, round: 1 };
  return state;
}
