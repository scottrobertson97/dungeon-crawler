import { describe, expect, it } from "vitest";
import { dungeonCrawlContent, SUPPORTED_EFFECT_TYPES, validateDungeonCrawlContent } from "../data/content";
import {
  advanceTurn,
  assignLoot,
  assignPosition,
  confirmParty,
  confirmPositions,
  continueAfterLoot,
  continueAfterSpecialRoom,
  createTitleState,
  enterRevealedRoom,
  gameReducer,
  getCurrentTurn,
  getEffectiveEnemyStats,
  getEffectivePlayerStats,
  getProjectedTurnOrder,
  getTargetableEnemies,
  leaveVendor,
  resolveEnemyTurn,
  resolveHealingSpring,
  resolvePlayerAttackRoll,
  resolvePlayerBlockRoll,
  resolveTreasureRoom,
  resolveVendorTrade,
  resolveWitchRoom,
  startNewGame,
  swapPlayerPosition,
  toggleCharacterSelection,
  useLoot,
  usePlayerAbility,
} from "./engine";
import { createRng, shuffleWithRng } from "./rng";
import { deserializeGame, serializeGame } from "./save";
import type {
  GameState,
  PlayerPosition,
  RoomDefinition,
  TurnSlot,
} from "./types";

const defaultParty = [
  "avg-guy",
  "hayden-brockensword",
  "tim-grandmaster-wizard",
  "sten-the-casual",
];

function definition(roomId: string): RoomDefinition {
  const found = [...dungeonCrawlContent.rooms, ...dungeonCrawlContent.specialRooms].find(({ id }) => id === roomId);
  if (!found) throw new Error(`Missing test room ${roomId}.`);
  return found;
}

function setupRoom(
  roomId: string,
  party = defaultParty,
  seed = `test-${roomId}`,
): GameState {
  let state = startNewGame(createTitleState(), seed);
  for (const characterId of party) state = toggleCharacterSelection(state, characterId);
  state = { ...state, playDeck: [definition(roomId)] };
  state = confirmParty(state);
  return enterRevealedRoom(state);
}

function setupRevealedRoom(
  roomId: string,
  party = defaultParty,
  seed = `test-reveal-${roomId}`,
): GameState {
  let state = startNewGame(createTitleState(), seed);
  for (const characterId of party) state = toggleCharacterSelection(state, characterId);
  state = { ...state, playDeck: [definition(roomId)] };
  return confirmParty(state);
}

function atTurn(state: GameState, predicate: (slot: TurnSlot) => boolean): GameState {
  if (!state.turn) throw new Error("Expected combat turn state.");
  const index = state.turn.order.findIndex(predicate);
  if (index < 0) throw new Error("Expected turn slot was not found.");
  return { ...state, turn: { ...state.turn, index } };
}

function updateEnemyHp(state: GameState, definitionId: string, hp: number): GameState {
  if (state.currentRoom?.type !== "combat") throw new Error("Expected combat room.");
  return {
    ...state,
    currentRoom: {
      ...state.currentRoom,
      enemies: state.currentRoom.enemies.map((enemy) =>
        enemy.definitionId === definitionId ? { ...enemy, hp, isDead: hp <= 0 } : enemy,
      ),
    },
  };
}

describe("deterministic setup and phase flow", () => {
  it("validates every seeded turn reference and all 34 structured effect types", () => {
    expect(() => validateDungeonCrawlContent(dungeonCrawlContent)).not.toThrow();
    expect(SUPPORTED_EFFECT_TYPES.size).toBe(34);
  });

  it("builds the same six-room recipe and loot order from the same seed", () => {
    const first = startNewGame(createTitleState(), "repeatable");
    const second = startNewGame(createTitleState(), "repeatable");
    expect(first.playDeck.map(({ id }) => id)).toEqual(second.playDeck.map(({ id }) => id));
    expect(first.playDeck.map(({ tier }) => tier)).toEqual(["A", "A", "SPECIAL", "B", "B", "BOSS"]);
    expect(first.lootDeck.map(({ instanceId }) => instanceId)).toEqual(second.lootDeck.map(({ instanceId }) => instanceId));
    expect(first.lootDeck).toHaveLength(32);
  });

  it("uses a stable pure shuffle without mutating the input", () => {
    const source = [1, 2, 3, 4, 5];
    const first = shuffleWithRng(source, createRng("cards"));
    const second = shuffleWithRng(source, createRng("cards"));
    expect(first.items).toEqual(second.items);
    expect(source).toEqual([1, 2, 3, 4, 5]);
  });

  it("auto-assigns selected heroes to A-D and reveals the first room", () => {
    let state = startNewGame(createTitleState(), "positions");
    for (const id of defaultParty) state = toggleCharacterSelection(state, id);
    const firstRoomId = state.playDeck[0].id;
    state = confirmParty(state);
    expect(state.phase).toBe("ROOM_REVEAL");
    expect(state.players.map(({ position }) => position)).toEqual(["A", "B", "C", "D"]);
    expect(state.players.map(({ characterId }) => characterId)).toEqual(defaultParty);
    expect(state.currentRoom?.definitionId).toBe(firstRoomId);
    expect(state.turn).toBeNull();
  });

  it("keeps legacy manual assignment and confirmation available", () => {
    let state = startNewGame(createTitleState(), "legacy-position-controls");
    for (const id of defaultParty) state = toggleCharacterSelection(state, id);
    state = confirmParty(state);
    state = {
      ...state,
      phase: "POSITION_ASSIGNMENT",
      currentRoom: null,
      players: state.players.map((player) => ({ ...player, position: null })),
    };
    (["D", "C", "B", "A"] as PlayerPosition[]).forEach((position, index) => {
      state = assignPosition(state, state.players[index].id, position);
    });
    state = confirmPositions(state);
    expect(state.phase).toBe("ROOM_REVEAL");
    expect(state.players.map(({ position }) => position)).toEqual(["D", "C", "B", "A"]);
  });

  it("creates unique runtime enemy and turn-slot ids", () => {
    const state = setupRoom("room-1");
    expect(state.currentRoom?.type).toBe("combat");
    const ids = state.turn!.order.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    const giantSlots = state.turn!.order.filter((slot) => slot.actorType === "enemy");
    expect(new Set(giantSlots.map(({ actorId }) => actorId)).size).toBe(1);
  });
});

describe("per-room combat preparation", () => {
  it("atomically swaps occupied positions and immediately changes the projected order", () => {
    const state = setupRevealedRoom("room-2");
    const playerA = state.players.find(({ position }) => position === "A")!;
    const playerB = state.players.find(({ position }) => position === "B")!;
    const before = getProjectedTurnOrder(state);

    const swapped = gameReducer(state, {
      type: "SWAP_PLAYER_POSITION",
      playerId: playerA.id,
      targetPosition: "B",
    });

    expect(swapped.players.find(({ id }) => id === playerA.id)?.position).toBe("B");
    expect(swapped.players.find(({ id }) => id === playerB.id)?.position).toBe("A");
    expect(new Set(swapped.players.map(({ position }) => position))).toEqual(new Set(["A", "B", "C", "D"]));
    expect(getProjectedTurnOrder(swapped)).not.toEqual(before);
    expect(getProjectedTurnOrder(swapped).find(
      (slot) => slot.actorType === "player" && slot.position === "A",
    )?.actorId).toBe(playerB.id);
    expect(swapPlayerPosition(swapped, playerA.id, "B")).toBe(swapped);
  });

  it("rejects formation changes after combat begins and during loot", () => {
    const revealed = setupRevealedRoom("room-2");
    const playerA = revealed.players.find(({ position }) => position === "A")!;
    const combat = enterRevealedRoom(revealed);
    const rejectedCombat = swapPlayerPosition(combat, playerA.id, "B");
    expect(rejectedCombat.players).toEqual(combat.players);
    expect(rejectedCombat.turn).toEqual(combat.turn);
    expect(rejectedCombat.log.at(-1)?.level).toBe("error");

    const loot = { ...revealed, phase: "LOOT_REWARD" as const };
    const rejectedLoot = swapPlayerPosition(loot, playerA.id, "B");
    expect(rejectedLoot.players).toEqual(loot.players);
    expect(rejectedLoot.log.at(-1)?.level).toBe("error");
  });

  it("uses the same projected order for combat, including duplicate enemies and repeated actions", () => {
    let state = setupRevealedRoom("room-1");
    if (state.currentRoom?.type !== "combat") throw new Error("Expected combat room.");
    const giant = state.currentRoom.enemies[0];
    const secondGiant = { ...giant, id: `${giant.id}:duplicate` };
    state = {
      ...state,
      currentRoom: {
        ...state.currentRoom,
        enemies: [giant, secondGiant],
        rawTurnOrder: [
          "enemy:giant:1",
          "enemy:giant:1",
          "player:A",
          "enemy:giant:3",
          "player:B",
        ],
      },
    };

    const projected = getProjectedTurnOrder(state);
    const enemySlots = projected.filter((slot) => slot.actorType === "enemy");
    expect(enemySlots.map(({ actorId }) => actorId)).toEqual([giant.id, secondGiant.id, giant.id]);
    expect(enemySlots.map(({ actionId }) => actionId)).toEqual(["1", "1", "3"]);

    const combat = enterRevealedRoom(state);
    expect(combat.turn?.order).toEqual(projected);
  });

  it("retains formation for room two and permits another preparation swap", () => {
    let state = startNewGame(createTitleState(), "room-two-preparation");
    for (const id of defaultParty) state = toggleCharacterSelection(state, id);
    state = { ...state, playDeck: [definition("room-1"), definition("room-2")] };
    state = confirmParty(state);
    state = swapPlayerPosition(state, state.players[0].id, "D");
    const retainedFormation = state.players.map(({ id, position }) => ({ id, position }));

    state = continueAfterLoot({
      ...state,
      phase: "LOOT_REWARD",
      pendingLootReward: [],
    });
    expect(state.phase).toBe("ROOM_REVEAL");
    expect(state.roomIndex).toBe(1);
    expect(state.currentRoom?.definitionId).toBe("room-2");
    expect(state.players.map(({ id, position }) => ({ id, position }))).toEqual(retainedFormation);

    const projectedBefore = getProjectedTurnOrder(state);
    const playerAtA = state.players.find(({ position }) => position === "A")!;
    state = swapPlayerPosition(state, playerAtA.id, "B");
    expect(getProjectedTurnOrder(state)).not.toEqual(projectedBefore);
  });

  it("preserves formation through special rooms without exposing a projected combat order", () => {
    const revealed = setupRevealedRoom("healing-spring");
    const formation = revealed.players.map(({ id, position }) => ({ id, position }));
    expect(getProjectedTurnOrder(revealed)).toEqual([]);

    const rejected = swapPlayerPosition(revealed, revealed.players[0].id, "B");
    expect(rejected.players.map(({ id, position }) => ({ id, position }))).toEqual(formation);
    expect(rejected.log.at(-1)?.level).toBe("error");

    const entered = enterRevealedRoom(revealed);
    expect(entered.phase).toBe("SPECIAL_ROOM");
    expect(entered.players.map(({ id, position }) => ({ id, position }))).toEqual(formation);
  });
});

describe("combat math", () => {
  it("makes natural 1 fail, natural 6 succeed, and ties favor the player", () => {
    expect(resolvePlayerAttackRoll(1, 99, 2).success).toBe(false);
    expect(resolvePlayerAttackRoll(6, -99, 20).success).toBe(true);
    expect(resolvePlayerAttackRoll(3, 1, 4).success).toBe(true);
    expect(resolvePlayerBlockRoll(1, 99, 2).success).toBe(false);
    expect(resolvePlayerBlockRoll(6, -99, 20).success).toBe(true);
    expect(resolvePlayerBlockRoll(3, 2, 5).success).toBe(true);
  });

  it("kills an enemy, completes the room, revives allies, and draws loot", () => {
    let state = setupRoom("room-1");
    state = atTurn(state, (slot) => slot.actorType === "player" && slot.position === "A");
    state = updateEnemyHp(state, "giant", 4);
    const enemyId = getTargetableEnemies(state)[0].id;
    state = usePlayerAbility(state, { playerId: state.players[0].id, abilityId: "sword-attack", targetIds: [enemyId] }, [6]);
    expect(state.phase).toBe("LOOT_REWARD");
    expect(state.pendingLootReward).toHaveLength(2);
    expect(state.currentRoom?.type === "combat" && state.currentRoom.enemies[0].isDead).toBe(true);
  });

  it("redirects dead position targets without double-hitting", () => {
    let state = setupRoom("room-1");
    const [a, b, c, d] = state.players;
    state = {
      ...state,
      players: state.players.map((player) => (player.id === a.id ? { ...player, hp: 0, isDead: true } : player)),
    };
    state = atTurn(state, (slot) => slot.actorType === "enemy" && slot.actionId === "1");
    const before = Object.fromEntries(state.players.map((player) => [player.id, player.hp]));
    state = resolveEnemyTurn(state, [1, 1]);
    expect(state.players.find(({ id }) => id === b.id)!.hp).toBe(before[b.id] - 4);
    expect(state.players.find(({ id }) => id === c.id)!.hp).toBe(before[c.id] - 4);
    expect(state.players.find(({ id }) => id === d.id)!.hp).toBe(before[d.id]);
  });

  it("returns a dead hero's loot to the bottom of the deck", () => {
    let state = setupRoom("room-1");
    const player = state.players[0];
    const [card, ...deck] = state.lootDeck;
    state = {
      ...state,
      lootDeck: deck,
      players: state.players.map((current) =>
        current.id === player.id
          ? { ...current, hp: 1, inventory: [card], equippedLootIds: [card.instanceId] }
          : current,
      ),
    };
    state = atTurn(state, (slot) => slot.actorType === "enemy" && slot.actionId === "1");
    state = resolveEnemyTurn(state, [1, 6]);
    expect(state.players.find(({ id }) => id === player.id)!.inventory).toEqual([]);
    expect(state.lootDeck.at(-1)?.instanceId).toBe(card.instanceId);
  });

  it("revives Sten after his skipped turn when the party still lives", () => {
    let state = setupRoom("room-1", ["sten-the-casual", "avg-guy", "hayden-brockensword", "tim-grandmaster-wizard"]);
    const sten = state.players[0];
    state = { ...state, players: state.players.map((player) => (player.id === sten.id ? { ...player, hp: 1 } : player)) };
    state = atTurn(state, (slot) => slot.actorType === "enemy" && slot.actionId === "1");
    state = resolveEnemyTurn(state, [1, 6]);
    const revived = state.players.find(({ id }) => id === sten.id)!;
    expect(revived.isDead).toBe(false);
    expect(revived.hp).toBe(Math.ceil(revived.maxHp / 2));
  });

  it("keeps combat alive when the last fallen hero has Bonfire pending", () => {
    let state = setupRoom("room-1", ["sten-the-casual", "avg-guy", "hayden-brockensword", "tim-grandmaster-wizard"]);
    const sten = state.players[0];
    state = {
      ...state,
      players: state.players.map((player) =>
        player.id === sten.id ? { ...player, hp: 1 } : { ...player, hp: 0, isDead: true },
      ),
    };
    state = atTurn(state, (slot) => slot.actorType === "enemy" && slot.actionId === "1");
    state = resolveEnemyTurn(state, [1]);
    expect(state.phase).toBe("COMBAT");
    expect(state.players.find(({ id }) => id === sten.id)?.isDead).toBe(false);
    expect(state.players.find(({ id }) => id === sten.id)?.hp).toBe(Math.ceil(sten.maxHp / 2));
  });

  it("makes the cute baby wolf untargetable until all other enemies die", () => {
    let state = setupRoom("room-4");
    expect(getTargetableEnemies(state).map(({ definitionId }) => definitionId)).not.toContain("baby-wolf");
    if (state.currentRoom?.type !== "combat") throw new Error("Expected combat.");
    state = {
      ...state,
      currentRoom: {
        ...state.currentRoom,
        enemies: state.currentRoom.enemies.map((enemy) =>
          enemy.definitionId === "baby-wolf" ? enemy : { ...enemy, hp: 0, isDead: true },
        ),
      },
    };
    expect(getTargetableEnemies(state).map(({ definitionId }) => definitionId)).toEqual(["baby-wolf"]);
  });
});

describe("seeded effects and passives", () => {
  it("resolves every seeded enemy action without unsupported-effect fallbacks", () => {
    for (const room of dungeonCrawlContent.rooms) {
      const base = setupRoom(room.id);
      for (const [index, slot] of base.turn!.order.entries()) {
        if (slot.actorType !== "enemy") continue;
        let state = setupRoom(room.id);
        state = {
          ...state,
          players: state.players.map((player) => ({ ...player, hp: 100, maxHp: 100, isDead: false })),
          currentRoom: state.currentRoom?.type === "combat"
            ? {
                ...state.currentRoom,
                enemies: state.currentRoom.enemies.map((enemy) => ({ ...enemy, hp: 100, maxHp: 100, isDead: false })),
              }
            : state.currentRoom,
          turn: { ...state.turn!, index },
        };
        state = resolveEnemyTurn(state, Array(12).fill(6));
        expect(
          state.log.some(({ message }) => message.includes("not implemented") || message.includes("skipped safely")),
          `${room.id}/${slot.raw}`,
        ).toBe(false);
      }
    }
  });

  it("resolves every active seeded hero ability without unsupported-effect fallbacks", () => {
    for (const character of dungeonCrawlContent.characters) {
      for (const ability of character.abilities) {
        if (ability.effects.every(({ type }) => type === "passiveRevive")) continue;
        const party = [character.id, ...defaultParty].filter((id, index, ids) => ids.indexOf(id) === index).slice(0, 4);
        let state = setupRoom("room-8", party, `ability-${character.id}-${ability.id}`);
        state = atTurn(state, (slot) => slot.actorType === "player" && slot.position === "A");
        if (state.currentRoom?.type !== "combat") throw new Error("Expected combat.");
        state = {
          ...state,
          players: state.players.map((player) => ({ ...player, hp: 50, maxHp: 50, isDead: false })),
          currentRoom: {
            ...state.currentRoom,
            enemies: state.currentRoom.enemies.map((enemy) => ({ ...enemy, hp: 50, maxHp: 50, isDead: false })),
          },
        };
        const actor = state.players.find(({ position }) => position === "A")!;
        const enemies = getTargetableEnemies(state);
        const allies = state.players.filter(({ id }) => id !== actor.id);
        const primary = ability.effects[0];
        const totalDamage = Number(primary.totalDamage ?? 0);
        const totalHealing = Number(primary.totalHealing ?? 0);
        const targetIds = primary.type === "attackEnemies" && primary.target === "allEnemies"
          ? enemies.map(({ id }) => id)
          : primary.type === "attackEnemies"
            ? enemies.slice(0, Number(primary.targetCount ?? 1)).map(({ id }) => id)
            : primary.type === "healAlly" || (primary.type === "applyModifier" && ["ally", "selfAndAlly"].includes(String(primary.target)))
              ? [allies[0].id]
              : primary.type === "attackEnemy" ? [enemies[0].id] : [];
        const allocation = primary.type === "splitDamage"
          ? { [enemies[0].id]: totalDamage }
          : primary.type === "splitHeal" ? { [allies[0].id]: totalHealing } : undefined;
        state = usePlayerAbility(state, { playerId: actor.id, abilityId: ability.id, targetIds, allocation }, Array(8).fill(6));
        expect(
          state.log.some(({ message }) => message.includes("not implemented") || message.includes("skipped safely")),
          `${character.id}/${ability.id}`,
        ).toBe(false);
      }
    }
  });

  it("ticks Fire Ball at the target enemy's next turn start", () => {
    let state = setupRoom("room-1", ["tim-grandmaster-wizard", "avg-guy", "hayden-brockensword", "sten-the-casual"]);
    state = atTurn(state, (slot) => slot.actorType === "player" && slot.position === "A");
    state = updateEnemyHp(state, "giant", 10);
    const enemyId = getTargetableEnemies(state)[0].id;
    state = usePlayerAbility(state, { playerId: state.players[0].id, abilityId: "fire-ball", targetIds: [enemyId] }, [6]);
    const giant = state.currentRoom?.type === "combat" ? state.currentRoom.enemies[0] : undefined;
    expect(giant?.hp).toBe(4);
    expect(state.log.some(({ message }) => message.includes("ongoing damage"))).toBe(true);
  });

  it("applies and consumes Robin's next-enemy-action ACC debuff", () => {
    let state = setupRoom("room-1", ["robin-master-assassin", "avg-guy", "hayden-brockensword", "sten-the-casual"]);
    state = atTurn(state, (slot) => slot.actorType === "player" && slot.position === "A");
    const enemyId = getTargetableEnemies(state)[0].id;
    state = usePlayerAbility(state, { playerId: state.players[0].id, abilityId: "debilitating-strike", targetIds: [enemyId] }, [6]);
    const enemy = state.currentRoom?.type === "combat" ? state.currentRoom.enemies[0] : undefined;
    expect(enemy && getEffectiveEnemyStats(state, enemy).acc).toBe(5);
    state = resolveEnemyTurn(state); // Giant action 3 heals and consumes its next-action modifier.
    const after = state.currentRoom?.type === "combat" ? state.currentRoom.enemies[0] : undefined;
    expect(after && getEffectiveEnemyStats(state, after).acc).toBe(7);
  });

  it("heals all skeleton-named enemies with Bone Rattle", () => {
    let state = setupRoom("room-3");
    if (state.currentRoom?.type !== "combat") throw new Error("Expected combat.");
    state = {
      ...state,
      currentRoom: {
        ...state.currentRoom,
        enemies: state.currentRoom.enemies.map((enemy) => ({ ...enemy, hp: Math.max(1, enemy.maxHp - 5) })),
      },
    };
    const before = state.currentRoom?.type === "combat" ? state.currentRoom.enemies.map(({ hp }) => hp) : [];
    state = atTurn(state, (slot) => slot.actorType === "enemy" && slot.actionId === "3");
    state = resolveEnemyTurn(state);
    const after = state.currentRoom?.type === "combat" ? state.currentRoom.enemies.map(({ hp }) => hp) : [];
    expect(after).toEqual(before.map((hp: number) => hp + 3));
  });

  it("charges and consumes Doomsayer tokens for Apocalypse", () => {
    let state = setupRoom("room-6");
    for (let count = 0; count < 3; count += 1) {
      state = atTurn(state, (slot) => slot.actorType === "enemy" && slot.actionId === "2");
      state = resolveEnemyTurn(state);
    }
    state = atTurn(state, (slot) => slot.actorType === "enemy" && slot.actionId === "3");
    const before = state.players.map(({ hp }) => hp);
    state = resolveEnemyTurn(state, [1, 1, 1, 1]);
    const doomsayer = state.currentRoom?.type === "combat"
      ? state.currentRoom.enemies.find(({ definitionId }) => definitionId === "doomsayer")
      : undefined;
    expect(doomsayer?.counters.doomTokens).toBe(0);
    expect(state.players.map(({ hp }) => hp)).toEqual(before.map((hp) => Math.max(0, hp - 8)));
  });

  it("uses Optimize stacks as future Mechanical Golem damage", () => {
    let state = setupRoom("room-8");
    state = updateEnemyHp(state, "mechanical-golem", 17);
    state = atTurn(state, (slot) => slot.actorType === "enemy" && slot.actionId === "4");
    state = resolveEnemyTurn(state);
    const mechanical = state.currentRoom?.type === "combat"
      ? state.currentRoom.enemies.find(({ definitionId }) => definitionId === "mechanical-golem")
      : undefined;
    expect(mechanical?.hp).toBe(20);
    expect(mechanical?.counters.optimizedStacks).toBe(1);
    state = atTurn(state, (slot) => slot.actorType === "enemy" && slot.actionId === "3");
    const target = state.players.find(({ position }) => position === "C")!;
    const before = target.hp;
    state = resolveEnemyTurn(state, [1]);
    expect(state.players.find(({ id }) => id === target.id)!.hp).toBe(before - 5);
  });

  it("resolves Valeria's double block and skips a twice-hit hero", () => {
    let state = setupRoom("boss-valeria-spider-queen");
    const first = state.players.find(({ position }) => position === "A")!;
    const before = first.hp;
    state = resolveEnemyTurn(state, [1, 1, 6, 6, 6, 6, 6, 6]);
    expect(state.players.find(({ id }) => id === first.id)!.hp).toBe(before - 2);
    const current = getCurrentTurn(state);
    expect(current?.actorType).toBe("enemy");
    expect(current?.actorType === "enemy" ? current.actionId : null).toBe("2");
  });

  it("triggers Flesh Golem's unblockable on-death damage", () => {
    let state = setupRoom("room-8");
    state = atTurn(state, (slot) => slot.actorType === "player" && slot.position === "A");
    state = updateEnemyHp(state, "flesh-golem", 4);
    const flesh = getTargetableEnemies(state).find(({ definitionId }) => definitionId === "flesh-golem")!;
    const before = state.players.map(({ hp }) => hp);
    state = usePlayerAbility(state, { playerId: state.players[0].id, abilityId: "sword-attack", targetIds: [flesh.id] }, [6]);
    expect(state.players.map(({ hp }) => hp)).toEqual(before.map((hp) => hp - 1));
  });
});

describe("turn and modifier upkeep", () => {
  it("keeps Misty Step active when cast from the final player position", () => {
    let state = setupRoom("room-1", ["avg-guy", "hayden-brockensword", "sten-the-casual", "tim-grandmaster-wizard"]);
    const tim = state.players.find(({ position }) => position === "D")!;
    state = atTurn(state, (slot) => slot.actorType === "player" && slot.position === "D");
    state = usePlayerAbility(state, { playerId: tim.id, abilityId: "misty-step" });
    expect(getEffectivePlayerStats(state, state.players.find(({ id }) => id === tim.id)!).def).toBe(tim.baseDef + 2);

    const timIndex = state.turn!.order.findIndex((slot) => slot.actorType === "player" && slot.actorId === tim.id);
    state = { ...state, turn: { ...state.turn!, index: (timIndex - 1 + state.turn!.order.length) % state.turn!.order.length } };
    state = advanceTurn(state);
    expect(getEffectivePlayerStats(state, state.players.find(({ id }) => id === tim.id)!).def).toBe(tim.baseDef);
  });

  it("prevents non-stacking melodies and expires them after three target actions", () => {
    let state = setupRoom("room-1", ["blane-harmonys-composer", "avg-guy", "hayden-brockensword", "sten-the-casual"]);
    const blane = state.players[0];
    const ally = state.players[1];
    state = atTurn(state, (slot) => slot.actorType === "player" && slot.position === "A");
    state = usePlayerAbility(state, { playerId: blane.id, abilityId: "defensive-melody", targetIds: [ally.id] });
    expect(state.modifiers.filter(({ targetId, stat }) => targetId === ally.id && stat === "def")).toHaveLength(1);
    state = atTurn(state, (slot) => slot.actorType === "player" && slot.position === "A");
    state = usePlayerAbility(state, { playerId: blane.id, abilityId: "defensive-melody", targetIds: [ally.id] });
    expect(state.modifiers.filter(({ targetId, stat }) => targetId === ally.id && stat === "def")).toHaveLength(1);

    const enemyId = getTargetableEnemies(state)[0].id;
    for (let count = 0; count < 3; count += 1) {
      state = atTurn(state, (slot) => slot.actorType === "player" && slot.position === "B");
      state = usePlayerAbility(state, { playerId: ally.id, abilityId: "sword-attack", targetIds: [enemyId] }, [6]);
    }
    expect(state.modifiers.some(({ targetId, stat }) => targetId === ally.id && stat === "def")).toBe(false);
  });

  it("increments the round counter when the final turn slot resolves", () => {
    let state = setupRoom("room-1");
    state = atTurn(state, (slot) => slot.actorType === "player" && slot.position === "D");
    const enemyId = getTargetableEnemies(state)[0].id;
    state = usePlayerAbility(state, { playerId: state.players[3].id, abilityId: "bad-sword", targetIds: [enemyId] }, [6]);
    expect(state.turn?.round).toBe(2);
  });
});

describe("loot, special rooms, victory, and saves", () => {
  it("reveals the second room after every first-room reward is assigned or discarded", () => {
    let state = startNewGame(createTitleState(), "first-room-progression");
    for (const characterId of defaultParty) state = toggleCharacterSelection(state, characterId);
    state = confirmParty(state);
    const expectedSecondRoom = state.playDeck[1];

    state = enterRevealedRoom(state);
    state = atTurn(state, (slot) => slot.actorType === "player" && slot.position === "A");
    if (state.currentRoom?.type !== "combat") throw new Error("Expected the first deck room to be combat.");
    const target = state.currentRoom.enemies[0];
    state = {
      ...state,
      currentRoom: {
        ...state.currentRoom,
        enemies: state.currentRoom.enemies.map((enemy) =>
          enemy.id === target.id
            ? { ...enemy, hp: 4, isDead: false }
            : { ...enemy, hp: 0, isDead: true },
        ),
      },
    };
    state = usePlayerAbility(
      state,
      { playerId: state.players[0].id, abilityId: "sword-attack", targetIds: [target.id] },
      [6],
    );
    expect(state.phase).toBe("LOOT_REWARD");

    const rewards = [...state.pendingLootReward];
    state = assignLoot(state, rewards[0].instanceId, state.players[0].id);
    for (const reward of rewards.slice(1)) state = assignLoot(state, reward.instanceId, null);
    expect(state.pendingLootReward).toEqual([]);

    state = continueAfterLoot(state);
    expect(state.phase).toBe("ROOM_REVEAL");
    expect(state.roomIndex).toBe(1);
    expect(state.currentRoom?.definitionId).toBe(expectedSecondRoom.id);
  });

  it("equips stat loot, enforces inventory, and returns a potion to the deck", () => {
    let state = setupRoom("room-1");
    const player = state.players[0];
    const heart = state.lootDeck.find(({ id }) => id === "heart-amulet")!;
    const potion = state.lootDeck.find(({ id }) => id === "minor-healing-potion")!;
    const filler = state.lootDeck.find(({ id }) => id === "keen-blade")!;
    state = {
      ...state,
      phase: "LOOT_REWARD",
      pendingLootReward: [heart, potion, filler],
      lootDeck: state.lootDeck.filter(({ instanceId }) => ![heart.instanceId, potion.instanceId, filler.instanceId].includes(instanceId)),
    };
    state = assignLoot(state, heart.instanceId, player.id);
    state = assignLoot(state, potion.instanceId, player.id);
    state = assignLoot(state, filler.instanceId, player.id);
    const equipped = state.players.find(({ id }) => id === player.id)!;
    expect(getEffectivePlayerStats(state, equipped).maxHp).toBe(player.maxHp + 2);
    state = { ...state, players: state.players.map((current) => (current.id === player.id ? { ...current, hp: 1 } : current)) };
    state = useLoot(state, player.id, potion.instanceId);
    expect(state.players.find(({ id }) => id === player.id)!.hp).toBe(3);
    expect(state.lootDeck.at(-1)?.instanceId).toBe(potion.instanceId);
  });

  it("auto-equips reusable item loot so its room action is immediately available", () => {
    let state = setupRoom("room-1");
    const player = state.players[0];
    const lucky = state.lootDeck.find(({ id }) => id === "lucky-token")!;
    state = {
      ...state,
      phase: "LOOT_REWARD",
      pendingLootReward: [lucky],
      lootDeck: state.lootDeck.filter(({ instanceId }) => instanceId !== lucky.instanceId),
    };
    state = assignLoot(state, lucky.instanceId, player.id);
    expect(state.players[0].equippedLootIds).toContain(lucky.instanceId);
    state = useLoot(state, player.id, lucky.instanceId);
    expect(state.pendingRerollPlayerId).toBe(player.id);
  });

  it("caps max HP at 24 and applies equipped DMG to an attack", () => {
    let state = setupRoom("room-1");
    const player = state.players[0];
    const heart = state.lootDeck.find(({ id }) => id === "heart-amulet")!;
    const blade = state.lootDeck.find(({ id }) => id === "keen-blade")!;
    state = {
      ...state,
      players: state.players.map((current) =>
        current.id === player.id
          ? {
              ...current,
              baseMaxHp: 23,
              maxHp: 23,
              inventory: [heart, blade],
              equippedLootIds: [heart.instanceId, blade.instanceId],
            }
          : current,
      ),
    };
    expect(getEffectivePlayerStats(state, state.players[0]).maxHp).toBe(24);
    state = atTurn(state, (slot) => slot.actorType === "player" && slot.position === "A");
    state = updateEnemyHp(state, "giant", 10);
    const enemyId = getTargetableEnemies(state)[0].id;
    state = usePlayerAbility(state, { playerId: player.id, abilityId: "sword-attack", targetIds: [enemyId] }, [6]);
    const giant = state.currentRoom?.type === "combat" ? state.currentRoom.enemies[0] : undefined;
    expect(giant?.hp).toBe(5);
  });

  it("uses Lucky Token and Guard Charm once per room before a block", () => {
    let state = setupRoom("room-1");
    const player = state.players[0];
    const lucky = state.lootDeck.find(({ id }) => id === "lucky-token")!;
    const guard = state.lootDeck.find(({ id }) => id === "guard-charm")!;
    state = {
      ...state,
      players: state.players.map((current) =>
        current.id === player.id
          ? { ...current, inventory: [lucky, guard], equippedLootIds: [lucky.instanceId, guard.instanceId] }
          : current,
      ),
    };
    state = useLoot(state, player.id, lucky.instanceId);
    state = useLoot(state, player.id, guard.instanceId);
    const before = player.hp;
    state = atTurn(state, (slot) => slot.actorType === "enemy" && slot.actionId === "1");
    state = resolveEnemyTurn(state, [1, 6, 6]);
    expect(state.players.find(({ id }) => id === player.id)!.hp).toBe(before);
    expect(state.pendingRerollPlayerId).toBeNull();
    expect(state.pendingBlockBonuses[player.id]).toBeUndefined();
  });

  it("resolves the Healing Spring and Treasure Room rewards", () => {
    let spring = setupRoom("healing-spring");
    spring = { ...spring, players: spring.players.map((player) => ({ ...player, hp: 1 })) };
    spring = resolveHealingSpring(spring);
    expect(spring.players.every((player) => player.hp === player.maxHp)).toBe(true);
    expect(continueAfterSpecialRoom(spring).phase).toBe("VICTORY");

    let treasure = setupRoom("treasure-room");
    const recipients = treasure.players.slice(0, 2).map(({ id }) => id);
    treasure = resolveTreasureRoom(treasure, recipients, [1, 4]);
    expect(treasure.players.slice(0, 2).every(({ abilityTokens }) => abilityTokens === 4)).toBe(true);

    let intermediate = setupRoom("treasure-room");
    intermediate = resolveTreasureRoom(intermediate, recipients, [5, 3]);
    expect(intermediate.players.every(({ abilityTokens }) => abilityTokens === 3)).toBe(true);

    let basicLoot = setupRoom("treasure-room");
    basicLoot = resolveTreasureRoom(basicLoot, recipients, [3, 2]);
    expect(basicLoot.pendingLootReward).toHaveLength(4);
    expect(basicLoot.pendingLootRecipientIds).toEqual(recipients);
    const ineligible = basicLoot.players[2];
    basicLoot = assignLoot(basicLoot, basicLoot.pendingLootReward[0].instanceId, ineligible.id);
    expect(basicLoot.pendingLootReward).toHaveLength(4);

    let intermediateLoot = setupRoom("treasure-room");
    intermediateLoot = resolveTreasureRoom(intermediateLoot, recipients, [6, 2]);
    expect(intermediateLoot.pendingLootReward).toHaveLength(8);
    expect(intermediateLoot.pendingLootRecipientIds).toHaveLength(4);
  });

  it("draws vendor offers and accepts exactly two items for one", () => {
    let state = setupRoom("vendor");
    expect(state.specialRoomState?.vendorOffer).toHaveLength(4);
    const [paymentA, paymentB] = state.lootDeck.slice(0, 2);
    const recipient = state.players[0];
    state = {
      ...state,
      lootDeck: state.lootDeck.slice(2),
      players: state.players.map((player, index) =>
        index === 0 ? { ...player, inventory: [paymentA] } : index === 1 ? { ...player, inventory: [paymentB] } : player,
      ),
    };
    const offered = state.specialRoomState!.vendorOffer[0];
    state = resolveVendorTrade(state, offered.instanceId, recipient.id, [
      { playerId: state.players[0].id, lootInstanceId: paymentA.instanceId },
      { playerId: state.players[1].id, lootInstanceId: paymentB.instanceId },
    ]);
    expect(state.specialRoomState?.resolved).toBe(true);
    expect(state.players[0].inventory.some(({ instanceId }) => instanceId === offered.instanceId)).toBe(true);
  });

  it("lets the Witch exchange 4 HP for the first potion and shuffles other cards back", () => {
    let state = setupRoom("witch");
    const player = state.players[0];
    const before = player.hp;
    state = resolveWitchRoom(state, player.id);
    const after = state.players.find(({ id }) => id === player.id)!;
    expect(after.hp).toBe(before - 4);
    expect(after.inventory.some(({ tags }) => tags?.includes("potion"))).toBe(true);
  });

  it("allows leaving the merchant without a trade", () => {
    const state = leaveVendor(setupRoom("vendor"));
    expect(state.specialRoomState?.resolved).toBe(true);
    expect(state.specialRoomState?.vendorOffer).toEqual([]);
  });

  it("reaches defeat when all players die and victory when the boss dies", () => {
    let defeat = setupRoom("room-4", ["avg-guy", "hayden-brockensword", "tim-grandmaster-wizard", "robin-master-assassin"]);
    defeat = { ...defeat, players: defeat.players.map((player) => ({ ...player, hp: 1 })) };
    defeat = resolveEnemyTurn(defeat);
    expect(defeat.phase).toBe("DEFEAT");

    let victory = setupRoom("boss-valeria-spider-queen");
    victory = atTurn(victory, (slot) => slot.actorType === "player" && slot.position === "A");
    victory = updateEnemyHp(victory, "valeria", 4);
    const boss = getTargetableEnemies(victory)[0];
    victory = usePlayerAbility(victory, { playerId: victory.players[0].id, abilityId: "sword-attack", targetIds: [boss.id] }, [6]);
    expect(victory.phase).toBe("VICTORY");
  });

  it("round-trips a swapped preparation without changing its formation or preview", () => {
    let state = setupRevealedRoom("room-2");
    state = swapPlayerPosition(state, state.players[0].id, "C");
    const preview = getProjectedTurnOrder(state);

    const restored = deserializeGame(serializeGame(state));
    expect(restored.phase).toBe("ROOM_REVEAL");
    expect(restored.players.map(({ id, position }) => ({ id, position }))).toEqual(
      state.players.map(({ id, position }) => ({ id, position })),
    );
    expect(getProjectedTurnOrder(restored)).toEqual(preview);
  });

  it("preserves the already-frozen turn order and cursor in an active-combat save", () => {
    let state = setupRevealedRoom("room-3");
    state = swapPlayerPosition(state, state.players[0].id, "D");
    state = enterRevealedRoom(state);
    state = { ...state, turn: { ...state.turn!, index: 3, actionsResolved: 7 } };
    const frozenTurn = state.turn;

    const restored = deserializeGame(serializeGame(state));
    expect(restored.phase).toBe("COMBAT");
    expect(restored.turn).toEqual(frozenTurn);
  });

  it("migrates a partial legacy position-assignment save into room-one preparation", () => {
    let state = startNewGame(createTitleState(), "legacy-partial-save");
    for (const id of defaultParty) state = toggleCharacterSelection(state, id);
    state = confirmParty(state);
    const firstRoomId = state.playDeck[0].id;
    const partialPositions: Array<PlayerPosition | null> = ["C", null, "A", null];
    state = {
      ...state,
      phase: "POSITION_ASSIGNMENT",
      currentRoom: null,
      turn: null,
      players: state.players.map((player, index) => ({
        ...player,
        position: partialPositions[index],
      })),
    };

    const restored = deserializeGame(serializeGame(state));
    expect(restored.stateVersion).toBe(1);
    expect(restored.phase).toBe("ROOM_REVEAL");
    expect(restored.roomIndex).toBe(0);
    expect(restored.currentRoom?.definitionId).toBe(firstRoomId);
    expect(restored.players.map(({ position }) => position)).toEqual(["C", "B", "A", "D"]);
  });

  it("round-trips a versioned save while reattaching current content", () => {
    const state = setupRoom("room-1");
    const restored = deserializeGame(serializeGame(state));
    expect(restored.phase).toBe(state.phase);
    expect(restored.rng).toEqual(state.rng);
    expect(restored.currentRoom).toEqual(state.currentRoom);
    expect(restored.content).toBe(dungeonCrawlContent);
  });
});
