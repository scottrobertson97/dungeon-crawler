import { dungeonCrawlContent } from "../data/content";
import { createRng, rollD6, shuffleWithRng } from "./rng";
import {
  assertD6,
  clampAllocation,
  damageEnemy,
  damagePlayer,
  getEffectiveEnemyStats,
  getEffectivePlayerStats,
  getLivingPlayers,
  getTargetableEnemies,
  healEnemy,
  healPlayer,
  isCombatRoomComplete,
  isEnemyTargetable,
  isPartyDefeated,
  resolvePlayerAttackRoll,
  resolvePlayerBlockRoll,
  resolvePositionTargets,
} from "./rules";
import type {
  AbilityDefinition,
  CombatRoomDefinition,
  CombatRoomRuntime,
  DamageOverTime,
  DungeonCrawlContent,
  EffectDefinition,
  EnemyRuntime,
  GameAction,
  GameLogEntry,
  GameState,
  LootCardRuntime,
  ModifierDuration,
  PlayerAbilityChoice,
  PlayerPosition,
  PlayerRuntime,
  RoomDefinition,
  RuntimeRoom,
  SpecialRoomDefinition,
  TimedModifier,
  TurnSlot,
  VendorPayment,
} from "./types";
import { PLAYER_POSITIONS } from "./types";

export {
  getEffectiveEnemyStats,
  getEffectivePlayerStats,
  getLivingPlayers,
  getTargetableEnemies,
  isCombatRoomComplete,
  isEnemyTargetable,
  isPartyDefeated,
  resolvePlayerAttackRoll,
  resolvePlayerBlockRoll,
};

const DEFAULT_SEED = "dungeon-crawl-default";
const LOOT_DECK_COPIES = 4; // Eight placeholder cards x four copies models the missing 32-card deck.
const INVENTORY_LIMIT = 3;
const EQUIPMENT_LIMIT = 3;

function baseState(content: DungeonCrawlContent, seed: string): GameState {
  return {
    stateVersion: 1,
    phase: "TITLE",
    content,
    rng: createRng(seed),
    selectedCharacterIds: [],
    players: [],
    playDeck: [],
    roomIndex: 0,
    completedRoomIds: [],
    currentRoom: null,
    turn: null,
    modifiers: [],
    dots: [],
    lootDeck: [],
    lootDiscard: [],
    pendingLootReward: [],
    pendingLootRecipientIds: null,
    specialRoomState: null,
    pendingRerollPlayerId: null,
    pendingBlockBonuses: {},
    lootUsesThisRoom: {},
    log: [],
    nextRuntimeId: 1,
    nextLogId: 1,
  };
}

export function createTitleState(content: DungeonCrawlContent = dungeonCrawlContent): GameState {
  return baseState(content, DEFAULT_SEED);
}

function appendLog(
  state: GameState,
  message: string,
  level: GameLogEntry["level"] = "info",
): GameState {
  return {
    ...state,
    log: [...state.log, { id: state.nextLogId, level, message }],
    nextLogId: state.nextLogId + 1,
  };
}

function buildPlayDeck(
  content: DungeonCrawlContent,
  initialRng: GameState["rng"],
): { deck: RoomDefinition[]; rng: GameState["rng"] } {
  const aResult = shuffleWithRng(content.rooms.filter(({ tier }) => tier === "A"), initialRng);
  const bResult = shuffleWithRng(content.rooms.filter(({ tier }) => tier === "B"), aResult.rng);
  const specialResult = shuffleWithRng(content.specialRooms, bResult.rng);
  const bossResult = shuffleWithRng(content.rooms.filter(({ tier }) => tier === "BOSS"), specialResult.rng);
  return {
    deck: [
      ...aResult.items.slice(0, 2),
      specialResult.items[0],
      ...bResult.items.slice(0, 2),
      bossResult.items[0],
    ],
    rng: bossResult.rng,
  };
}

function buildLootDeck(content: DungeonCrawlContent): LootCardRuntime[] {
  return Array.from({ length: LOOT_DECK_COPIES }, (_, copyIndex) =>
    content.starterLoot.map((definition) => ({
      ...definition,
      tags: definition.tags ? [...definition.tags] : undefined,
      statBonus: definition.statBonus ? { ...definition.statBonus } : undefined,
      effects: definition.effects?.map((effect) => ({ ...effect })),
      instanceId: `loot:${definition.id}:${copyIndex + 1}`,
    })),
  ).flat();
}

export function startNewGame(state: GameState, seed = DEFAULT_SEED): GameState {
  const clean = baseState(state.content, seed);
  const roomResult = buildPlayDeck(clean.content, clean.rng);
  const lootResult = shuffleWithRng(buildLootDeck(clean.content), roomResult.rng);
  return appendLog(
    {
      ...clean,
      phase: "PARTY_SELECT",
      rng: lootResult.rng,
      playDeck: roomResult.deck,
      lootDeck: lootResult.items,
    },
    `A new six-room dungeon was built from seed "${seed}". Choose four heroes.`,
  );
}

export function toggleCharacterSelection(state: GameState, characterId: string): GameState {
  if (state.phase !== "PARTY_SELECT") return appendLog(state, "Characters can only be selected during party selection.", "error");
  if (!state.content.characters.some(({ id }) => id === characterId)) {
    return appendLog(state, `Unknown character: ${characterId}.`, "error");
  }
  if (state.selectedCharacterIds.includes(characterId)) {
    return { ...state, selectedCharacterIds: state.selectedCharacterIds.filter((id) => id !== characterId) };
  }
  if (state.selectedCharacterIds.length >= state.content.config.partySize) {
    return appendLog(state, "The party already has four characters.", "error");
  }
  return { ...state, selectedCharacterIds: [...state.selectedCharacterIds, characterId] };
}

function createPlayer(characterId: string, state: GameState): PlayerRuntime {
  const character = state.content.characters.find(({ id }) => id === characterId);
  if (!character) throw new Error(`Cannot create unknown character ${characterId}.`);
  return {
    id: `player:${character.id}`,
    characterId: character.id,
    name: character.name,
    role: character.role,
    position: null,
    hp: character.stats.maxHp,
    maxHp: character.stats.maxHp,
    baseMaxHp: character.stats.maxHp,
    baseAcc: character.stats.acc,
    baseDef: character.stats.def,
    isDead: false,
    inventory: [],
    equippedLootIds: [],
    abilities: character.abilities.map((ability) => ({
      ...ability,
      effects: ability.effects.map((effect) => ({ ...effect })),
    })),
    abilityState: {},
    abilityTokens: 0,
    skipActions: 0,
    pendingReviveTurns: null,
  };
}

export function confirmParty(state: GameState): GameState {
  if (state.phase !== "PARTY_SELECT") return appendLog(state, "Party selection is not active.", "error");
  if (state.selectedCharacterIds.length !== state.content.config.partySize) {
    return appendLog(state, "Select exactly four characters before continuing.", "error");
  }
  const positionedParty = state.selectedCharacterIds.map((id, index) => ({
    ...createPlayer(id, state),
    position: PLAYER_POSITIONS[index] ?? null,
  }));
  return revealRoom(
    appendLog(
      {
        ...state,
        players: positionedParty,
      },
      "Party confirmed. Heroes were assigned to positions A-D in selection order.",
    ),
    0,
  );
}

function hasCompleteFormation(players: PlayerRuntime[]): boolean {
  const positions = players.map(({ position }) => position);
  return (
    players.length === PLAYER_POSITIONS.length &&
    positions.every((position): position is PlayerPosition =>
      position !== null && PLAYER_POSITIONS.includes(position),
    ) &&
    new Set(positions).size === PLAYER_POSITIONS.length
  );
}

export function swapPlayerPosition(
  state: GameState,
  playerId: string,
  targetPosition: PlayerPosition,
): GameState {
  if (state.phase !== "ROOM_REVEAL" || state.currentRoom?.type !== "combat") {
    return appendLog(state, "Formation can only be changed while preparing for a combat room.", "error");
  }
  if (!PLAYER_POSITIONS.includes(targetPosition)) {
    return appendLog(state, `Unknown position: ${targetPosition}.`, "error");
  }
  if (!hasCompleteFormation(state.players)) {
    return appendLog(state, "All four positions must be occupied before heroes can swap.", "error");
  }
  const player = state.players.find(({ id }) => id === playerId);
  if (!player) return appendLog(state, `Unknown player: ${playerId}.`, "error");
  if (player.position === targetPosition) return state;
  const target = state.players.find(({ position }) => position === targetPosition);
  if (!target || player.position === null) {
    return appendLog(state, `Position ${targetPosition} is not occupied.`, "error");
  }
  const sourcePosition = player.position;
  return appendLog(
    {
      ...state,
      players: state.players.map((current) => {
        if (current.id === player.id) return { ...current, position: targetPosition };
        if (current.id === target.id) return { ...current, position: sourcePosition };
        return current;
      }),
    },
    `${player.name} and ${target.name} swap positions ${sourcePosition} and ${targetPosition}.`,
  );
}

export function assignPosition(state: GameState, playerId: string, position: PlayerPosition): GameState {
  if (state.phase !== "POSITION_ASSIGNMENT") return appendLog(state, "Positions cannot be changed right now.", "error");
  if (!PLAYER_POSITIONS.includes(position)) return appendLog(state, `Unknown position: ${position}.`, "error");
  if (!state.players.some(({ id }) => id === playerId)) return appendLog(state, `Unknown player: ${playerId}.`, "error");
  return {
    ...state,
    players: state.players.map((player) => {
      if (player.id === playerId) return { ...player, position };
      if (player.position === position) return { ...player, position: null };
      return player;
    }),
  };
}

function createRuntimeRoom(definition: RoomDefinition): RuntimeRoom {
  if (definition.type === "special") {
    return {
      id: `room:${definition.id}`,
      definitionId: definition.id,
      name: definition.name,
      tier: "SPECIAL",
      type: "special",
      lootReward: 0,
      rawText: definition.rawText,
      effects: definition.effects.map((effect) => ({ ...effect })),
    };
  }
  return {
    id: `room:${definition.id}`,
    definitionId: definition.id,
    name: definition.name,
    tier: definition.tier,
    type: "combat",
    lootReward: definition.lootReward,
    rawTurnOrder: [...definition.turnOrder],
    enemies: definition.enemies.map((enemy, index) => ({
      id: `${definition.id}:enemy:${enemy.id}:${index + 1}`,
      definitionId: enemy.id,
      name: enemy.name,
      hp: enemy.stats.maxHp,
      maxHp: enemy.stats.maxHp,
      baseAcc: enemy.stats.acc,
      baseDef: enemy.stats.def,
      isDead: false,
      counters: { ...(enemy.counters ?? {}) },
      actions: enemy.actions.map((action) => ({
        ...action,
        effects: action.effects.map((effect) => ({ ...effect })),
      })),
      passives: (enemy.passives ?? []).map((effect) => ({ ...effect })),
      deathPassivesResolved: false,
    })),
  };
}

function revealRoom(state: GameState, roomIndex: number): GameState {
  const definition = state.playDeck[roomIndex];
  if (!definition) return appendLog({ ...state, phase: "VICTORY", currentRoom: null }, "The dungeon is complete. Victory!");
  return appendLog(
    {
      ...state,
      phase: "ROOM_REVEAL",
      roomIndex,
      currentRoom: createRuntimeRoom(definition),
      turn: null,
      modifiers: [],
      dots: [],
      specialRoomState: null,
      pendingRerollPlayerId: null,
      pendingBlockBonuses: {},
      lootUsesThisRoom: {},
    },
    `Room ${roomIndex + 1} of ${state.playDeck.length} revealed: ${definition.name}.`,
  );
}

export function confirmPositions(state: GameState): GameState {
  if (state.phase !== "POSITION_ASSIGNMENT") return appendLog(state, "Position assignment is not active.", "error");
  const positions = state.players.map(({ position }) => position);
  if (positions.some((position) => position === null) || new Set(positions).size !== PLAYER_POSITIONS.length) {
    return appendLog(state, "Assign exactly one hero to every position A-D.", "error");
  }
  return revealRoom(state, 0);
}

function buildTurnOrder(room: CombatRoomRuntime, players: PlayerRuntime[]): TurnSlot[] {
  const enemiesByDefinition = new Map<string, EnemyRuntime[]>();
  for (const enemy of room.enemies) {
    const bucket = enemiesByDefinition.get(enemy.definitionId) ?? [];
    bucket.push(enemy);
    enemiesByDefinition.set(enemy.definitionId, bucket);
  }
  const duplicateCursor = new Map<string, number>();
  return room.rawTurnOrder.flatMap((raw, index): TurnSlot[] => {
    const [actorType, identifier, actionId] = raw.split(":");
    if (actorType === "player" && PLAYER_POSITIONS.includes(identifier as PlayerPosition)) {
      const player = players.find(({ position }) => position === identifier);
      return player
        ? [{ id: `turn:${index}:${raw}`, actorType: "player", actorId: player.id, position: identifier as PlayerPosition, raw }]
        : [];
    }
    if (actorType === "enemy" && actionId) {
      const bucket = enemiesByDefinition.get(identifier) ?? [];
      if (bucket.length === 0) return [];
      const cursor = duplicateCursor.get(identifier) ?? 0;
      const enemy = bucket[cursor % bucket.length];
      duplicateCursor.set(identifier, cursor + 1);
      return [{ id: `turn:${index}:${enemy.id}:${actionId}`, actorType: "enemy", actorId: enemy.id, actionId, raw }];
    }
    return [];
  });
}

export function getProjectedTurnOrder(state: GameState): TurnSlot[] {
  return state.currentRoom?.type === "combat"
    ? buildTurnOrder(state.currentRoom, state.players)
    : [];
}

export function getCurrentTurn(state: GameState): TurnSlot | null {
  return state.turn?.order[state.turn.index] ?? null;
}

function recycleDiscardIfNeeded(state: GameState): GameState {
  if (state.lootDeck.length > 0 || state.lootDiscard.length === 0) return state;
  const result = shuffleWithRng(state.lootDiscard, state.rng);
  return { ...state, rng: result.rng, lootDeck: result.items, lootDiscard: [] };
}

function drawLootCards(state: GameState, count: number): { state: GameState; cards: LootCardRuntime[] } {
  let next = state;
  const cards: LootCardRuntime[] = [];
  for (let index = 0; index < count; index += 1) {
    next = recycleDiscardIfNeeded(next);
    const [card, ...remaining] = next.lootDeck;
    if (!card) break;
    cards.push(card);
    next = { ...next, lootDeck: remaining };
  }
  return { state: next, cards };
}

function currentSpecialHasEffect(state: GameState, effectType: string): boolean {
  return Boolean(
    state.currentRoom?.type === "special" &&
      state.currentRoom.effects.some(({ type }) => type === effectType),
  );
}

export function enterRevealedRoom(state: GameState): GameState {
  if (state.phase !== "ROOM_REVEAL" || !state.currentRoom) {
    return appendLog(state, "There is no revealed room to enter.", "error");
  }
  if (state.currentRoom.type === "special") {
    let next: GameState = {
      ...state,
      phase: "SPECIAL_ROOM",
      specialRoomState: { resolved: false, vendorOffer: [] },
    };
    if (currentSpecialHasEffect(next, "vendorTrade")) {
      const draw = drawLootCards(next, 4);
      next = {
        ...draw.state,
        specialRoomState: { resolved: false, vendorOffer: draw.cards },
      };
    }
    return appendLog(next, `${state.currentRoom.name} awaits the party.`);
  }

  const order = getProjectedTurnOrder(state);
  if (order.length === 0) return appendLog(state, "This combat room has no usable turn slots.", "error");
  const next = appendLog(
    {
      ...state,
      phase: "COMBAT",
      turn: { index: 0, order, round: 1, actionsResolved: 0 },
      modifiers: [],
      dots: [],
      lootUsesThisRoom: {},
      pendingRerollPlayerId: null,
      pendingBlockBonuses: {},
      players: state.players.map((player) => ({
        ...player,
        skipActions: 0,
        pendingReviveTurns: null,
        abilityState: Object.fromEntries(
          Object.entries(player.abilityState).map(([id, value]) => [id, { ...value, usedThisEncounter: false }]),
        ),
      })),
    },
    `Combat begins in ${state.currentRoom.name}.`,
  );
  return prepareCurrentTurn(next);
}

interface RollCursor {
  forced: number[];
  index: number;
}

function takeRoll(state: GameState, cursor: RollCursor): { state: GameState; roll: number } {
  const forced = cursor.forced[cursor.index];
  cursor.index += 1;
  if (forced !== undefined) {
    assertD6(forced);
    return { state, roll: forced };
  }
  const result = rollD6(state.rng);
  return { state: { ...state, rng: result.rng }, roll: result.roll };
}

function updateEnemy(state: GameState, enemyId: string, updater: (enemy: EnemyRuntime) => EnemyRuntime): GameState {
  if (!state.currentRoom || state.currentRoom.type !== "combat") return state;
  return {
    ...state,
    currentRoom: {
      ...state.currentRoom,
      enemies: state.currentRoom.enemies.map((enemy) => (enemy.id === enemyId ? updater(enemy) : enemy)),
    },
  };
}

function updatePlayer(state: GameState, playerId: string, updater: (player: PlayerRuntime) => PlayerRuntime): GameState {
  return { ...state, players: state.players.map((player) => (player.id === playerId ? updater(player) : player)) };
}

function allocateRuntimeId(state: GameState, prefix: string): { state: GameState; id: string } {
  return {
    state: { ...state, nextRuntimeId: state.nextRuntimeId + 1 },
    id: `${prefix}:${state.nextRuntimeId}`,
  };
}

function durationFromSeed(duration: unknown): ModifierDuration {
  switch (duration) {
    case "nextAction":
    case "targetNextAction":
    case "nextTurn":
    case "oneTurn":
      return { type: "targetActions", remaining: 1 };
    case "threeTurns":
      return { type: "targetActions", remaining: 3 };
    case "oneRound":
      return { type: "untilSourceNextTurn" };
    case "enemyRound":
      return { type: "enemyRound" };
    case "untilSourceNextTurn":
      return { type: "untilSourceNextTurn" };
    default:
      return { type: "room" };
  }
}

function addModifier(
  state: GameState,
  input: Omit<TimedModifier, "id" | "duration"> & { duration: unknown },
): GameState {
  if (
    input.stacking === "noStack" &&
    state.modifiers.some(
      (modifier) =>
        modifier.targetId === input.targetId &&
        modifier.stat === input.stat &&
        modifier.effectKey === input.effectKey,
    )
  ) {
    return appendLog(state, `The non-stacking ${input.stat.toUpperCase()} effect is already active on that target.`, "warning");
  }
  const allocation = allocateRuntimeId(state, "modifier");
  return {
    ...allocation.state,
    modifiers: [
      ...allocation.state.modifiers,
      { ...input, id: allocation.id, duration: durationFromSeed(input.duration) },
    ],
  };
}

function consumeActionModifiers(state: GameState, targetId: string, eligibleIds: Set<string>): GameState {
  return {
    ...state,
    modifiers: state.modifiers.flatMap((modifier) => {
      if (
        modifier.targetId !== targetId ||
        modifier.duration.type !== "targetActions" ||
        !eligibleIds.has(modifier.id)
      ) {
        return [modifier];
      }
      return modifier.duration.remaining <= 1
        ? []
        : [{ ...modifier, duration: { ...modifier.duration, remaining: modifier.duration.remaining - 1 } }];
    }),
  };
}

function refreshPlayerMaxHp(state: GameState, playerId: string): GameState {
  const player = state.players.find(({ id }) => id === playerId);
  if (!player) return state;
  const stats = getEffectivePlayerStats(state, player);
  return updatePlayer(state, playerId, (current) => ({ ...current, maxHp: stats.maxHp, hp: Math.min(current.hp, stats.maxHp) }));
}

function hasRevivePassive(player: PlayerRuntime): number | null {
  for (const ability of player.abilities) {
    const passive = ability.effects.find(({ type }) => type === "passiveRevive");
    if (passive) return typeof passive.delayTurns === "number" ? passive.delayTurns : 1;
  }
  return null;
}

function applyPlayerDamage(state: GameState, playerId: string, amount: number, source: string): GameState {
  const before = state.players.find(({ id }) => id === playerId);
  if (!before || before.isDead || amount <= 0) return state;
  const after = damagePlayer(before, amount);
  let next = updatePlayer(state, playerId, () => after);
  next = appendLog(next, `${before.name} takes ${amount} damage from ${source} (${after.hp}/${after.maxHp} HP).`);
  if (!after.isDead) return next;

  const delay = hasRevivePassive(before);
  const lostLoot = before.inventory;
  next = updatePlayer(next, playerId, (player) => ({
    ...player,
    hp: 0,
    isDead: true,
    inventory: [],
    equippedLootIds: [],
    maxHp: player.baseMaxHp,
    pendingReviveTurns: delay,
  }));
  next = {
    ...next,
    lootDeck: [...next.lootDeck, ...lostLoot],
    modifiers: next.modifiers.filter((modifier) => modifier.targetId !== playerId),
    pendingRerollPlayerId: next.pendingRerollPlayerId === playerId ? null : next.pendingRerollPlayerId,
    pendingBlockBonuses: Object.fromEntries(
      Object.entries(next.pendingBlockBonuses).filter(([id]) => id !== playerId),
    ),
  };
  return appendLog(
    next,
    `${before.name} falls${lostLoot.length ? ` and loses ${lostLoot.length} loot card${lostLoot.length === 1 ? "" : "s"}` : ""}.${delay !== null ? " Bonfire will revive Sten after one skipped turn." : ""}`,
    "warning",
  );
}

function applyEnemyDamage(state: GameState, enemyId: string, amount: number, source: string): GameState {
  if (!state.currentRoom || state.currentRoom.type !== "combat") return state;
  const before = state.currentRoom.enemies.find(({ id }) => id === enemyId);
  if (!before || before.isDead || amount <= 0) return state;
  const after = damageEnemy(before, amount);
  let next = updateEnemy(state, enemyId, () => after);
  next = appendLog(next, `${before.name} takes ${amount} damage from ${source} (${after.hp}/${after.maxHp} HP).`);
  if (!after.isDead) return next;

  next = updateEnemy(next, enemyId, (enemy) => ({ ...enemy, deathPassivesResolved: true }));
  next = appendLog(next, `${before.name} is defeated.`, "warning");
  if (!before.deathPassivesResolved) {
    for (const passive of before.passives) {
      if (passive.type !== "onDeathDamageAllPlayers") continue;
      const damage = Number(passive.damage ?? 0);
      for (const player of getLivingPlayers(next)) {
        next = applyPlayerDamage(next, player.id, damage, `${before.name}'s death effect`);
      }
    }
  }
  return next;
}

function clearEncounterAbilityFlags(player: PlayerRuntime): PlayerRuntime {
  return {
    ...player,
    abilityState: Object.fromEntries(
      Object.entries(player.abilityState).map(([id, value]) => [id, { ...value, usedThisEncounter: false }]),
    ),
  };
}

function completeCombatRoom(state: GameState): GameState {
  if (!state.currentRoom || state.currentRoom.type !== "combat") return state;
  const room = state.currentRoom;
  const completedRoomIds = state.completedRoomIds.includes(room.definitionId)
    ? state.completedRoomIds
    : [...state.completedRoomIds, room.definitionId];
  if (room.tier === "BOSS") {
    return appendLog(
      {
        ...state,
        phase: "VICTORY",
        completedRoomIds,
        turn: null,
        modifiers: [],
        dots: [],
      },
      `${room.name} has fallen. The party wins the dungeon!`,
    );
  }

  let next: GameState = {
    ...state,
    completedRoomIds,
    turn: null,
    modifiers: [],
    dots: [],
    pendingRerollPlayerId: null,
    pendingBlockBonuses: {},
    players: state.players.map((player) => {
      const refreshed = clearEncounterAbilityFlags(player);
      return player.isDead
        ? {
            ...refreshed,
            hp: Math.ceil(player.maxHp / 2),
            isDead: false,
            pendingReviveTurns: null,
            skipActions: 0,
          }
        : refreshed;
    }),
  };
  const draw = drawLootCards(next, room.lootReward);
  next = {
    ...draw.state,
    phase: "LOOT_REWARD",
    pendingLootReward: draw.cards,
    pendingLootRecipientIds: null,
  };
  return appendLog(
    next,
    `${room.name} is cleared. Fallen heroes return at half health and the party draws ${draw.cards.length} loot.`,
  );
}

function finishCombatOutcome(state: GameState): GameState {
  const bonfireRevivePending = state.players.some((player) => player.pendingReviveTurns !== null);
  if (isPartyDefeated(state) && !bonfireRevivePending) {
    return appendLog(
      { ...state, phase: "DEFEAT", turn: null, modifiers: [], dots: [] },
      "Every hero has fallen. The dungeon claims the party.",
      "error",
    );
  }
  return isCombatRoomComplete(state) ? completeCombatRoom(state) : state;
}

function tickDotsForEnemy(state: GameState, enemyId: string): GameState {
  const dots = state.dots.filter((dot) => dot.targetId === enemyId && dot.timing === "enemyTurnStart");
  let next = state;
  for (const dot of dots) {
    const enemy =
      next.currentRoom?.type === "combat"
        ? next.currentRoom.enemies.find(({ id }) => id === enemyId)
        : undefined;
    if (!enemy || enemy.isDead) break;
    next = appendLog(next, `${enemy.name} suffers ${dot.damage} ongoing damage.`);
    next = applyEnemyDamage(next, enemyId, dot.damage, "Fire Ball");
  }
  return next;
}

function moveTurnIndex(state: GameState): GameState {
  if (!state.turn || state.turn.order.length === 0) return state;
  const wrapped = state.turn.index + 1 >= state.turn.order.length;
  let modifiers = state.modifiers;
  if (wrapped) {
    modifiers = modifiers.flatMap((modifier) => {
      if (modifier.duration.type === "enemyRound") return [];
      if (modifier.duration.type !== "rounds") return [modifier];
      return modifier.duration.remaining <= 1
        ? []
        : [{ ...modifier, duration: { ...modifier.duration, remaining: modifier.duration.remaining - 1 } }];
    });
  }
  return {
    ...state,
    modifiers,
    turn: {
      ...state.turn,
      index: wrapped ? 0 : state.turn.index + 1,
      round: wrapped ? state.turn.round + 1 : state.turn.round,
      actionsResolved: state.turn.actionsResolved + 1,
    },
  };
}

function prepareCurrentTurn(state: GameState): GameState {
  let next = state;
  const maximumSkips = (state.turn?.order.length ?? 0) * 3 + 1;
  for (let skips = 0; skips < maximumSkips && next.phase === "COMBAT"; skips += 1) {
    const slot = getCurrentTurn(next);
    if (!slot) return appendLog(next, "Combat has no current turn slot.", "error");
    next = {
      ...next,
      modifiers: next.modifiers.filter(
        (modifier) => !(modifier.duration.type === "untilSourceNextTurn" && modifier.sourceId === slot.actorId),
      ),
    };

    if (slot.actorType === "enemy") {
      const enemy =
        next.currentRoom?.type === "combat"
          ? next.currentRoom.enemies.find(({ id }) => id === slot.actorId)
          : undefined;
      if (!enemy || enemy.isDead) {
        next = moveTurnIndex(next);
        continue;
      }
      next = tickDotsForEnemy(next, enemy.id);
      next = finishCombatOutcome(next);
      if (next.phase !== "COMBAT") return next;
      const afterDot =
        next.currentRoom?.type === "combat"
          ? next.currentRoom.enemies.find(({ id }) => id === slot.actorId)
          : undefined;
      if (!afterDot || afterDot.isDead) {
        next = moveTurnIndex(next);
        continue;
      }
      return next;
    }

    const player = next.players.find(({ id }) => id === slot.actorId);
    if (!player) {
      next = moveTurnIndex(next);
      continue;
    }
    if (player.isDead) {
      if (player.pendingReviveTurns !== null && player.pendingReviveTurns > 0) {
        const remaining = player.pendingReviveTurns - 1;
        next = updatePlayer(next, player.id, (current) =>
          remaining === 0
            ? {
                ...current,
                pendingReviveTurns: null,
                isDead: false,
                hp: Math.ceil(current.maxHp / 2),
              }
            : { ...current, pendingReviveTurns: remaining },
        );
        next = appendLog(
          next,
          remaining === 0
            ? `${player.name} skips this turn, then rises from the Bonfire at half health.`
            : `${player.name} remains at the Bonfire for ${remaining} more turn(s).`,
        );
      }
      next = moveTurnIndex(next);
      continue;
    }
    if (player.skipActions > 0) {
      const eligible = new Set(next.modifiers.map(({ id }) => id));
      next = updatePlayer(next, player.id, (current) => ({ ...current, skipActions: current.skipActions - 1 }));
      next = consumeActionModifiers(next, player.id, eligible);
      next = appendLog(next, `${player.name}'s action is skipped.`, "warning");
      next = moveTurnIndex(next);
      continue;
    }
    return next;
  }
  return finishCombatOutcome(appendLog(next, "No living combatant has a usable turn slot.", "warning"));
}

export function advanceTurn(state: GameState): GameState {
  if (state.phase !== "COMBAT" || !state.turn) return state;
  return prepareCurrentTurn(moveTurnIndex(state));
}

interface EffectContext {
  lastEnemyTargets: string[];
  lastEnemyHits: string[];
  lastPlayerTargets: string[];
  lastPlayerHits: string[];
}

function attackEnemyWithPlayer(
  state: GameState,
  playerId: string,
  enemyId: string,
  ability: AbilityDefinition,
  effect: EffectDefinition,
  baseDamage: number,
  cursor: RollCursor,
): { state: GameState; hit: boolean } {
  const player = state.players.find(({ id }) => id === playerId);
  const enemy =
    state.currentRoom?.type === "combat"
      ? state.currentRoom.enemies.find(({ id }) => id === enemyId)
      : undefined;
  if (!player || !enemy || !isEnemyTargetable(enemy, state.currentRoom?.type === "combat" ? state.currentRoom.enemies : [])) {
    return { state: appendLog(state, "That enemy is not a legal target.", "error"), hit: false };
  }

  let rollResult = takeRoll(state, cursor);
  let next = rollResult.state;
  let roll = rollResult.roll;
  if (next.pendingRerollPlayerId === player.id) {
    const original = roll;
    rollResult = takeRoll(next, cursor);
    next = { ...rollResult.state, pendingRerollPlayerId: null };
    roll = rollResult.roll;
    next = appendLog(next, `${player.name}'s Lucky Token rerolls ${original} into ${roll}.`, "roll");
  }

  const playerStats = getEffectivePlayerStats(next, player);
  const enemyStats = getEffectiveEnemyStats(next, enemy);
  const resolution = resolvePlayerAttackRoll(
    roll,
    playerStats.acc,
    enemyStats.def,
    Number(effect.accuracyModifier ?? 0),
  );
  next = appendLog(
    next,
    `${player.name} uses ${ability.name} on ${enemy.name}: rolled ${roll} + ${resolution.modifier} ACC = ${resolution.total} vs DEF ${resolution.target}. ${resolution.success ? "Hit" : "Miss"}.`,
    "roll",
  );
  if (!resolution.success) return { state: next, hit: false };
  const scaling = player.abilityState[ability.id]?.damageBonus ?? 0;
  const damage = Math.max(0, baseDamage + scaling + playerStats.dmg);
  return { state: applyEnemyDamage(next, enemy.id, damage, ability.name), hit: true };
}

function addPlayerModifier(
  state: GameState,
  playerId: string,
  sourceId: string,
  abilityId: string,
  effect: EffectDefinition,
): GameState {
  if (!effect.stat || typeof effect.amount !== "number") {
    return appendLog(state, `Effect ${effect.type ?? "unknown"} is missing modifier data.`, "warning");
  }
  return addModifier(state, {
    sourceId,
    sourceType: "player",
    targetId: playerId,
    stat: effect.stat,
    amount: effect.amount,
    duration: effect.duration,
    stacking: effect.stacking ?? "stack",
    effectKey: `${abilityId}:${effect.stat}`,
  });
}

function addEnemyModifier(
  state: GameState,
  enemyId: string,
  sourceId: string,
  sourceType: "player" | "enemy",
  effectKey: string,
  effect: EffectDefinition,
): GameState {
  if (!effect.stat || typeof effect.amount !== "number") return state;
  return addModifier(state, {
    sourceId,
    sourceType,
    targetId: enemyId,
    stat: effect.stat,
    amount: effect.amount,
    duration: effect.duration,
    stacking: effect.stacking ?? "stack",
    effectKey,
  });
}

function validatePlayerAbilityChoice(
  state: GameState,
  player: PlayerRuntime,
  ability: AbilityDefinition,
  choice: PlayerAbilityChoice,
): string | null {
  if (ability.effects.length > 0 && ability.effects.every(({ type }) => type === "passiveRevive")) {
    return `${ability.name} is a passive and does not consume an action.`;
  }
  if (
    ability.effects.some(({ oncePerEncounter }) => oncePerEncounter) &&
    player.abilityState[ability.id]?.usedThisEncounter
  ) {
    return `${ability.name} has already been used in this encounter.`;
  }

  const targetable = new Set(getTargetableEnemies(state).map(({ id }) => id));
  const livingPlayers = new Set(getLivingPlayers(state).map(({ id }) => id));
  const targetIds = choice.targetIds ?? [];
  for (const effect of ability.effects) {
    if (effect.type === "attackEnemy" && !targetIds.some((id) => targetable.has(id))) {
      return `${ability.name} needs one targetable enemy.`;
    }
    if (effect.type === "attackEnemies" && effect.target !== "allEnemies") {
      const enemies = targetIds.filter((id) => targetable.has(id));
      if (enemies.length === 0 || enemies.length > Number(effect.targetCount ?? enemies.length)) {
        return `${ability.name} needs between one and ${effect.targetCount ?? "all"} targetable enemies.`;
      }
    }
    if (effect.type === "splitDamage") {
      const allocation = clampAllocation(choice.allocation, targetable, Number(effect.totalDamage ?? 0));
      const total = allocation ? Object.values(allocation).reduce((sum, amount) => sum + amount, 0) : 0;
      if (!allocation || total !== Number(effect.totalDamage ?? 0)) return `${ability.name} must allocate all of its damage.`;
    }
    if (effect.type === "splitHeal") {
      const allocation = clampAllocation(choice.allocation, livingPlayers, Number(effect.totalHealing ?? 0));
      const total = allocation ? Object.values(allocation).reduce((sum, amount) => sum + amount, 0) : 0;
      if (!allocation || total !== Number(effect.totalHealing ?? 0)) return `${ability.name} must allocate all of its healing.`;
    }
    if (effect.type === "healAlly" && !targetIds.some((id) => livingPlayers.has(id) && id !== player.id)) {
      return `${ability.name} needs a living ally.`;
    }
    if (effect.type === "applyModifier" && (effect.target === "ally" || effect.target === "selfAndAlly")) {
      if (!targetIds.some((id) => livingPlayers.has(id) && id !== player.id)) return `${ability.name} needs a living ally.`;
    }
  }
  return null;
}

function resolvePlayerEffect(
  state: GameState,
  playerId: string,
  ability: AbilityDefinition,
  effect: EffectDefinition,
  choice: PlayerAbilityChoice,
  context: EffectContext,
  cursor: RollCursor,
): GameState {
  const player = state.players.find(({ id }) => id === playerId);
  if (!player) return state;
  const targetIds = choice.targetIds ?? [];
  switch (effect.type) {
    case "attackEnemy": {
      const targetId = targetIds.find((id) => getTargetableEnemies(state).some((enemy) => enemy.id === id));
      if (!targetId) return appendLog(state, `${ability.name} has no legal enemy target.`, "error");
      const attack = attackEnemyWithPlayer(state, playerId, targetId, ability, effect, Number(effect.damage ?? 0), cursor);
      context.lastEnemyTargets = [targetId];
      context.lastEnemyHits = attack.hit ? [targetId] : [];
      return attack.state;
    }
    case "attackEnemies": {
      const legal = getTargetableEnemies(state);
      const chosen = effect.target === "allEnemies"
        ? legal
        : targetIds
            .map((id) => legal.find((enemy) => enemy.id === id))
            .filter((enemy): enemy is EnemyRuntime => Boolean(enemy))
            .slice(0, Number(effect.targetCount ?? legal.length));
      let next = state;
      context.lastEnemyTargets = chosen.map(({ id }) => id);
      context.lastEnemyHits = [];
      for (const enemy of chosen) {
        const attack = attackEnemyWithPlayer(next, playerId, enemy.id, ability, effect, Number(effect.damage ?? 0), cursor);
        next = attack.state;
        if (attack.hit) context.lastEnemyHits.push(enemy.id);
      }
      return next;
    }
    case "splitDamage": {
      const legal = new Set(getTargetableEnemies(state).map(({ id }) => id));
      const allocation = clampAllocation(choice.allocation, legal, Number(effect.totalDamage ?? 0));
      if (!allocation) return appendLog(state, `${ability.name} has an invalid damage allocation.`, "error");
      let next = state;
      context.lastEnemyTargets = Object.keys(allocation);
      context.lastEnemyHits = [];
      for (const [enemyId, damage] of Object.entries(allocation)) {
        const attack = attackEnemyWithPlayer(next, playerId, enemyId, ability, effect, damage, cursor);
        next = attack.state;
        if (attack.hit) context.lastEnemyHits.push(enemyId);
      }
      return next;
    }
    case "applyDot": {
      let next = state;
      for (const enemyId of context.lastEnemyHits) {
        const allocation = allocateRuntimeId(next, "dot");
        const dot: DamageOverTime = {
          id: allocation.id,
          sourceId: playerId,
          targetId: enemyId,
          damage: Number(effect.damage ?? 0),
          timing: "enemyTurnStart",
        };
        next = { ...allocation.state, dots: [...allocation.state.dots, dot] };
      }
      return next;
    }
    case "healSelf": {
      const before = state.players.find(({ id }) => id === playerId)!;
      const after = healPlayer(before, Number(effect.amount ?? 0));
      return appendLog(updatePlayer(state, playerId, () => after), `${before.name} heals ${after.hp - before.hp} HP with ${ability.name}.`);
    }
    case "healAlly": {
      const target = targetIds
        .map((id) => state.players.find((candidate) => candidate.id === id))
        .find((candidate): candidate is PlayerRuntime => Boolean(candidate && candidate.id !== playerId && !candidate.isDead));
      if (!target) return state;
      const after = healPlayer(target, Number(effect.amount ?? 0));
      return appendLog(updatePlayer(state, target.id, () => after), `${player.name} heals ${target.name} for ${after.hp - target.hp} HP.`);
    }
    case "healAllAllies": {
      let next = state;
      for (const target of getLivingPlayers(state)) {
        next = updatePlayer(next, target.id, (current) => healPlayer(current, Number(effect.amount ?? 0)));
      }
      return appendLog(next, `${ability.name} restores up to ${effect.amount ?? 0} HP to every living hero.`);
    }
    case "splitHeal": {
      const legal = new Set(getLivingPlayers(state).map(({ id }) => id));
      const allocation = clampAllocation(choice.allocation, legal, Number(effect.totalHealing ?? 0));
      if (!allocation) return state;
      let next = state;
      for (const [targetId, amount] of Object.entries(allocation)) {
        next = updatePlayer(next, targetId, (target) => healPlayer(target, amount));
      }
      return appendLog(next, `${player.name} distributes ${effect.totalHealing ?? 0} healing with ${ability.name}.`);
    }
    case "applyModifier": {
      if (effect.target === "enemy") {
        const targets = context.lastEnemyHits.length ? context.lastEnemyHits : context.lastEnemyTargets;
        return targets.reduce(
          (next, enemyId) => addEnemyModifier(next, enemyId, playerId, "player", ability.id, effect),
          state,
        );
      }
      const livingAllyIds = targetIds.filter((id) =>
        state.players.some((candidate) => candidate.id === id && candidate.id !== playerId && !candidate.isDead),
      );
      const targets = effect.target === "self"
        ? [playerId]
        : effect.target === "selfAndAlly"
          ? [playerId, ...livingAllyIds.slice(0, 1)]
          : livingAllyIds.slice(0, 1);
      return targets.reduce(
        (next, targetId) => addPlayerModifier(next, targetId, playerId, ability.id, effect),
        state,
      );
    }
    case "increaseAbilityDamage": {
      const targetAbilityId = String(effect.abilityId ?? "");
      const current = player.abilityState[targetAbilityId]?.damageBonus ?? 0;
      const damageBonus = Math.min(Number(effect.maxDamage ?? Infinity), current + Number(effect.amount ?? 0));
      const next = updatePlayer(state, playerId, (target) => ({
        ...target,
        abilityState: {
          ...target.abilityState,
          [targetAbilityId]: { ...target.abilityState[targetAbilityId], damageBonus },
        },
      }));
      return appendLog(next, `${player.name} sharpens Sword Attack to ${damageBonus} base damage.`);
    }
    case "passiveRevive":
      return state;
    default:
      return appendLog(state, `Effect ${effect.type ?? "unknown"} is not implemented for player abilities; it was skipped safely.`, "warning");
  }
}

export function usePlayerAbility(
  state: GameState,
  choice: PlayerAbilityChoice,
  forcedRolls: number[] = [],
): GameState {
  const slot = getCurrentTurn(state);
  if (state.phase !== "COMBAT" || !slot || slot.actorType !== "player" || slot.actorId !== choice.playerId) {
    return appendLog(state, "It is not that player's turn.", "error");
  }
  const player = state.players.find(({ id }) => id === choice.playerId);
  const ability = player?.abilities.find(({ id }) => id === choice.abilityId);
  if (!player || player.isDead || !ability) return appendLog(state, "That ability is unavailable.", "error");
  const validationError = validatePlayerAbilityChoice(state, player, ability, choice);
  if (validationError) return appendLog(state, validationError, "error");

  const existingModifierIds = new Set(state.modifiers.map(({ id }) => id));
  const context: EffectContext = {
    lastEnemyTargets: [],
    lastEnemyHits: [],
    lastPlayerTargets: [],
    lastPlayerHits: [],
  };
  const cursor: RollCursor = { forced: forcedRolls, index: 0 };
  let next = state;
  for (const effect of ability.effects) {
    next = resolvePlayerEffect(next, player.id, ability, effect, choice, context, cursor);
  }
  if (ability.effects.some(({ oncePerEncounter }) => oncePerEncounter)) {
    next = updatePlayer(next, player.id, (current) => ({
      ...current,
      abilityState: {
        ...current.abilityState,
        [ability.id]: { ...current.abilityState[ability.id], usedThisEncounter: true },
      },
    }));
  }
  next = consumeActionModifiers(next, player.id, existingModifierIds);
  next = finishCombatOutcome(next);
  return next.phase === "COMBAT" ? advanceTurn(next) : next;
}

function attackPlayersWithEnemy(
  state: GameState,
  enemyId: string,
  playerIds: string[],
  damage: number,
  actionName: string,
  cursor: RollCursor,
  context: EffectContext,
): GameState {
  const enemy =
    state.currentRoom?.type === "combat"
      ? state.currentRoom.enemies.find(({ id }) => id === enemyId)
      : undefined;
  if (!enemy) return state;
  let next = state;
  context.lastPlayerTargets = [...playerIds];
  context.lastPlayerHits = [];
  for (const playerId of playerIds) {
    const player = next.players.find(({ id }) => id === playerId);
    if (!player || player.isDead) continue;
    const enemyStats = getEffectiveEnemyStats(next, enemy);
    const playerStats = getEffectivePlayerStats(next, player);
    const reactionBonus = next.pendingBlockBonuses[player.id] ?? 0;
    if (reactionBonus) {
      next = {
        ...next,
        pendingBlockBonuses: Object.fromEntries(
          Object.entries(next.pendingBlockBonuses).filter(([id]) => id !== player.id),
        ),
      };
    }
    let rollResult = takeRoll(next, cursor);
    next = rollResult.state;
    let roll = rollResult.roll;
    if (next.pendingRerollPlayerId === player.id) {
      const original = roll;
      rollResult = takeRoll(next, cursor);
      next = { ...rollResult.state, pendingRerollPlayerId: null };
      roll = rollResult.roll;
      next = appendLog(next, `${player.name}'s Lucky Token rerolls ${original} into ${roll}.`, "roll");
    }
    const resolution = resolvePlayerBlockRoll(roll, playerStats.def + reactionBonus, enemyStats.acc);
    next = appendLog(
      next,
      `${player.name} blocks ${enemy.name}'s ${actionName}: rolled ${roll} + ${resolution.modifier} DEF = ${resolution.total} vs ACC ${resolution.target}. ${resolution.success ? "Blocked" : "Hit"}.`,
      "roll",
    );
    if (resolution.success) continue;
    context.lastPlayerHits.push(player.id);
    next = applyPlayerDamage(next, player.id, Math.max(0, damage + enemyStats.dmg), `${enemy.name}'s ${actionName}`);
  }
  return next;
}

function addEnemyActionModifierToPlayer(
  state: GameState,
  enemyId: string,
  playerId: string,
  actionId: string,
  effect: EffectDefinition,
): GameState {
  if (!effect.stat || typeof effect.amount !== "number") return state;
  return addModifier(state, {
    sourceId: enemyId,
    sourceType: "enemy",
    targetId: playerId,
    stat: effect.stat,
    amount: effect.amount,
    duration: effect.duration,
    stacking: effect.stacking ?? "stack",
    effectKey: `${actionId}:${effect.stat}`,
  });
}

function discardFirstLootOnHit(state: GameState, playerId: string, source: string): GameState {
  const player = state.players.find(({ id }) => id === playerId);
  const card = player?.inventory[0];
  if (!player || !card) return state;
  let next = updatePlayer(state, player.id, (current) => ({
    ...current,
    inventory: current.inventory.filter(({ instanceId }) => instanceId !== card.instanceId),
    equippedLootIds: current.equippedLootIds.filter((id) => id !== card.instanceId),
  }));
  next = { ...next, lootDeck: [...next.lootDeck, card] };
  next = refreshPlayerMaxHp(next, player.id);
  return appendLog(next, `${player.name} loses ${card.name} to ${source}; it returns to the bottom of the loot deck.`, "warning");
}

function resolveDoubleBlock(
  state: GameState,
  enemy: EnemyRuntime,
  actionId: string,
  actionName: string,
  effect: EffectDefinition,
  cursor: RollCursor,
  context: EffectContext,
): GameState {
  let next = state;
  context.lastPlayerTargets = getLivingPlayers(state).map(({ id }) => id);
  context.lastPlayerHits = [];
  for (const targetId of context.lastPlayerTargets) {
    let hits = 0;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const target = next.players.find(({ id }) => id === targetId);
      if (!target || target.isDead) break;
      const enemyStats = getEffectiveEnemyStats(next, enemy);
      const playerStats = getEffectivePlayerStats(next, target);
      const reactionBonus = next.pendingBlockBonuses[target.id] ?? 0;
      if (reactionBonus) {
        next = {
          ...next,
          pendingBlockBonuses: Object.fromEntries(
            Object.entries(next.pendingBlockBonuses).filter(([id]) => id !== target.id),
          ),
        };
      }
      let rollResult = takeRoll(next, cursor);
      next = rollResult.state;
      let roll = rollResult.roll;
      if (next.pendingRerollPlayerId === target.id) {
        const original = roll;
        rollResult = takeRoll(next, cursor);
        next = { ...rollResult.state, pendingRerollPlayerId: null };
        roll = rollResult.roll;
        next = appendLog(next, `${target.name}'s Lucky Token rerolls ${original} into ${roll}.`, "roll");
      }
      const resolution = resolvePlayerBlockRoll(roll, playerStats.def + reactionBonus, enemyStats.acc);
      next = appendLog(
        next,
        `${target.name} makes Web Sling block ${attempt + 1}: ${roll} + ${playerStats.def + reactionBonus} vs ${enemyStats.acc}. ${resolution.success ? "Blocked" : "Hit"}.`,
        "roll",
      );
      if (!resolution.success) hits += 1;
    }
    if (hits === 0) continue;
    context.lastPlayerHits.push(targetId);
    next = applyPlayerDamage(next, targetId, hits * Number(effect.damagePerHit ?? 0), `${enemy.name}'s ${actionName}`);
    const nested = hits >= 2 ? effect.onTwoHits : effect.onOneHit;
    for (const nestedEffect of nested ?? []) {
      if (nestedEffect.type === "applyModifier") {
        next = addEnemyActionModifierToPlayer(next, enemy.id, targetId, actionId, nestedEffect);
      } else if (nestedEffect.type === "skipNextAction") {
        next = updatePlayer(next, targetId, (player) => ({ ...player, skipActions: player.skipActions + 1 }));
      } else {
        next = appendLog(next, `Nested enemy effect ${nestedEffect.type ?? "unknown"} was skipped safely.`, "warning");
      }
    }
  }
  return next;
}

function resolveEnemyEffect(
  state: GameState,
  enemy: EnemyRuntime,
  action: EnemyRuntime["actions"][number],
  effect: EffectDefinition,
  context: EffectContext,
  cursor: RollCursor,
): GameState {
  switch (effect.type) {
    case "attackPlayersByPosition": {
      const targets = resolvePositionTargets(state.players, effect.positions ?? []).map(({ id }) => id);
      return attackPlayersWithEnemy(state, enemy.id, targets, Number(effect.damage ?? 0), action.name, cursor, context);
    }
    case "attackAllPlayers": {
      const targets = getLivingPlayers(state).map(({ id }) => id);
      return attackPlayersWithEnemy(state, enemy.id, targets, Number(effect.damage ?? 0), action.name, cursor, context);
    }
    case "attackHighestHpPlayers": {
      const targets = getLivingPlayers(state)
        .sort((left, right) => right.hp - left.hp || PLAYER_POSITIONS.indexOf(left.position!) - PLAYER_POSITIONS.indexOf(right.position!))
        .slice(0, Number(effect.targetCount ?? 1))
        .map(({ id }) => id);
      return attackPlayersWithEnemy(state, enemy.id, targets, Number(effect.damage ?? 0), action.name, cursor, context);
    }
    case "doubleBlockAllPlayers":
      return resolveDoubleBlock(state, enemy, action.id, action.name, effect, cursor, context);
    case "unblockableDamageAllPlayers": {
      let next = state;
      context.lastPlayerTargets = getLivingPlayers(state).map(({ id }) => id);
      context.lastPlayerHits = [...context.lastPlayerTargets];
      for (const playerId of context.lastPlayerTargets) {
        next = applyPlayerDamage(next, playerId, Number(effect.damage ?? 0), `${enemy.name}'s ${action.name}`);
      }
      return next;
    }
    case "healSelf": {
      const before =
        state.currentRoom?.type === "combat"
          ? state.currentRoom.enemies.find(({ id }) => id === enemy.id)
          : undefined;
      if (!before) return state;
      const after = healEnemy(before, Number(effect.amount ?? 0));
      return appendLog(updateEnemy(state, enemy.id, () => after), `${enemy.name} restores ${after.hp - before.hp} HP.`);
    }
    case "damageEnemy": {
      const target =
        state.currentRoom?.type === "combat"
          ? state.currentRoom.enemies.find(({ definitionId }) => definitionId === effect.enemyId)
          : undefined;
      return target
        ? applyEnemyDamage(state, target.id, Number(effect.amount ?? 0), `${enemy.name}'s ${action.name}`)
        : appendLog(state, `${action.name} could not find enemy ${effect.enemyId ?? "unknown"}; effect skipped.`, "warning");
    }
    case "healEnemiesByTag": {
      const tag = String(effect.tag ?? "").toLowerCase();
      let next = state;
      const targets =
        state.currentRoom?.type === "combat"
          ? state.currentRoom.enemies.filter(
              (target) =>
                !target.isDead &&
                (target.definitionId.toLowerCase().includes(tag) || target.name.toLowerCase().includes(tag)),
            )
          : [];
      for (const target of targets) {
        next = updateEnemy(next, target.id, (current) => healEnemy(current, Number(effect.amount ?? 0)));
      }
      return appendLog(next, `${enemy.name} restores ${effect.amount ?? 0} HP to ${targets.length} ${tag || "matching"} enemies.`);
    }
    case "applyModifierToPositions": {
      const targetIds = context.lastPlayerTargets.length
        ? context.lastPlayerTargets
        : resolvePositionTargets(state.players, effect.positions ?? []).map(({ id }) => id);
      return targetIds.reduce(
        (next, playerId) => addEnemyActionModifierToPlayer(next, enemy.id, playerId, action.id, effect),
        state,
      );
    }
    case "applyModifierAllPlayers":
      return getLivingPlayers(state).reduce(
        (next, player) => addEnemyActionModifierToPlayer(next, enemy.id, player.id, action.id, effect),
        state,
      );
    case "applyModifierToLastTargets":
      return context.lastPlayerTargets.reduce(
        (next, playerId) => addEnemyActionModifierToPlayer(next, enemy.id, playerId, action.id, effect),
        state,
      );
    case "addCounter": {
      const counter = String(effect.counter ?? "counter");
      const amount = Number(effect.amount ?? 0);
      const next = updateEnemy(state, enemy.id, (current) => ({
        ...current,
        counters: { ...current.counters, [counter]: (current.counters[counter] ?? 0) + amount },
      }));
      return appendLog(next, `${enemy.name} gains ${amount} ${counter} (${(enemy.counters[counter] ?? 0) + amount}).`);
    }
    case "conditionalCounterAttackAllPlayers": {
      const counter = String(effect.counter ?? "counter");
      if ((enemy.counters[counter] ?? 0) < Number(effect.threshold ?? 0)) {
        return appendLog(state, `${enemy.name}'s ${action.name} has too few ${counter} and does nothing.`);
      }
      const consumed = Number(effect.consume ?? 0);
      let next = updateEnemy(state, enemy.id, (current) => ({
        ...current,
        counters: { ...current.counters, [counter]: Math.max(0, (current.counters[counter] ?? 0) - consumed) },
      }));
      next = attackPlayersWithEnemy(
        next,
        enemy.id,
        getLivingPlayers(next).map(({ id }) => id),
        Number(effect.damage ?? 0),
        action.name,
        cursor,
        context,
      );
      return next;
    }
    case "damageAllPlayersByCounter": {
      const counter = String(effect.counter ?? "counter");
      const damage = (enemy.counters[counter] ?? 0) * Number(effect.damagePerCounter ?? 0);
      let next = state;
      context.lastPlayerTargets = getLivingPlayers(state).map(({ id }) => id);
      context.lastPlayerHits = damage > 0 ? [...context.lastPlayerTargets] : [];
      for (const playerId of context.lastPlayerTargets) {
        next = applyPlayerDamage(next, playerId, damage, `${enemy.name}'s ${action.name}`);
      }
      return next;
    }
    case "forceDiscardLootIfHit": {
      const positioned = state.players.find(({ position }) => position === effect.targetPosition);
      const hitTargetId = positioned && context.lastPlayerHits.includes(positioned.id)
        ? positioned.id
        : context.lastPlayerHits[0];
      return hitTargetId ? discardFirstLootOnHit(state, hitTargetId, action.name) : state;
    }
    default:
      return appendLog(state, `Enemy effect ${effect.type ?? "unknown"} is not implemented; it was skipped safely.`, "warning");
  }
}

export function resolveEnemyTurn(state: GameState, forcedRolls: number[] = []): GameState {
  const slot = getCurrentTurn(state);
  if (state.phase !== "COMBAT" || !slot || slot.actorType !== "enemy") {
    return appendLog(state, "It is not an enemy turn.", "error");
  }
  const enemy =
    state.currentRoom?.type === "combat"
      ? state.currentRoom.enemies.find(({ id }) => id === slot.actorId)
      : undefined;
  const action = enemy?.actions.find(({ id }) => id === slot.actionId);
  if (!enemy || enemy.isDead || !action) {
    return advanceTurn(appendLog(state, "The enemy action slot is invalid or its actor is dead.", "warning"));
  }

  const existingModifierIds = new Set(state.modifiers.map(({ id }) => id));
  const context: EffectContext = {
    lastEnemyTargets: [],
    lastEnemyHits: [],
    lastPlayerTargets: [],
    lastPlayerHits: [],
  };
  const cursor: RollCursor = { forced: forcedRolls, index: 0 };
  let next = appendLog(state, `${enemy.name} uses ${action.name}.`);
  for (const effect of action.effects) {
    next = resolveEnemyEffect(next, enemy, action, effect, context, cursor);
  }
  next = consumeActionModifiers(next, enemy.id, existingModifierIds);
  next = finishCombatOutcome(next);
  return next.phase === "COMBAT" ? advanceTurn(next) : next;
}

export function assignLoot(state: GameState, lootInstanceId: string, playerId: string | null): GameState {
  if (state.phase !== "LOOT_REWARD") return appendLog(state, "There is no loot reward to assign.", "error");
  const card = state.pendingLootReward.find(({ instanceId }) => instanceId === lootInstanceId);
  if (!card) return appendLog(state, `Unknown reward card: ${lootInstanceId}.`, "error");
  if (playerId === null) {
    return appendLog(
      {
        ...state,
        pendingLootReward: state.pendingLootReward.filter(({ instanceId }) => instanceId !== lootInstanceId),
        lootDiscard: [...state.lootDiscard, card],
      },
      `${card.name} is discarded.`,
    );
  }
  const player = state.players.find(({ id }) => id === playerId);
  if (!player || player.isDead) return appendLog(state, "Loot must go to a living party member.", "error");
  if (state.pendingLootRecipientIds && !state.pendingLootRecipientIds.includes(player.id)) {
    return appendLog(state, `${player.name} is not an eligible recipient for this treasure reward.`, "error");
  }
  if (player.inventory.length >= INVENTORY_LIMIT) return appendLog(state, `${player.name}'s inventory is full.`, "error");

  const autoEquip = card.kind !== "consumable" && player.equippedLootIds.length < EQUIPMENT_LIMIT;
  let next = updatePlayer(state, player.id, (current) => ({
    ...current,
    inventory: [...current.inventory, card],
    equippedLootIds: autoEquip ? [...current.equippedLootIds, card.instanceId] : current.equippedLootIds,
  }));
  next = {
    ...next,
    pendingLootReward: next.pendingLootReward.filter(({ instanceId }) => instanceId !== card.instanceId),
  };
  next = refreshPlayerMaxHp(next, player.id);
  return appendLog(next, `${player.name} takes ${card.name}${autoEquip ? " and equips it" : ""}.`);
}

export function equipLoot(state: GameState, playerId: string, lootInstanceId: string): GameState {
  const player = state.players.find(({ id }) => id === playerId);
  const card = player?.inventory.find(({ instanceId }) => instanceId === lootInstanceId);
  if (!player || !card) return appendLog(state, "That loot card is not in the player's inventory.", "error");
  if (card.kind === "consumable") return appendLog(state, "Consumables are used, not equipped.", "error");
  if (player.equippedLootIds.includes(card.instanceId)) return state;
  if (player.equippedLootIds.length >= EQUIPMENT_LIMIT) return appendLog(state, "A hero can equip at most three loot cards.", "error");
  let next = updatePlayer(state, player.id, (current) => ({
    ...current,
    equippedLootIds: [...current.equippedLootIds, card.instanceId],
  }));
  next = refreshPlayerMaxHp(next, player.id);
  return appendLog(next, `${player.name} equips ${card.name}.`);
}

export function unequipLoot(state: GameState, playerId: string, lootInstanceId: string): GameState {
  const player = state.players.find(({ id }) => id === playerId);
  if (!player?.equippedLootIds.includes(lootInstanceId)) return state;
  let next = updatePlayer(state, player.id, (current) => ({
    ...current,
    equippedLootIds: current.equippedLootIds.filter((id) => id !== lootInstanceId),
  }));
  next = refreshPlayerMaxHp(next, player.id);
  return appendLog(next, `${player.name} unequips ${player.inventory.find(({ instanceId }) => instanceId === lootInstanceId)?.name ?? "loot"}.`);
}

export function transferLoot(
  state: GameState,
  fromPlayerId: string,
  toPlayerId: string,
  lootInstanceId: string,
): GameState {
  if (state.phase === "COMBAT") return appendLog(state, "Loot can only be transferred between rooms.", "error");
  const from = state.players.find(({ id }) => id === fromPlayerId);
  const to = state.players.find(({ id }) => id === toPlayerId);
  const card = from?.inventory.find(({ instanceId }) => instanceId === lootInstanceId);
  if (!from || !to || !card || from.id === to.id) return appendLog(state, "That loot transfer is invalid.", "error");
  if (to.inventory.length >= INVENTORY_LIMIT) return appendLog(state, `${to.name}'s inventory is full.`, "error");
  const wasEquipped = from.equippedLootIds.includes(card.instanceId);
  let next = updatePlayer(state, from.id, (current) => ({
    ...current,
    inventory: current.inventory.filter(({ instanceId }) => instanceId !== card.instanceId),
    equippedLootIds: current.equippedLootIds.filter((id) => id !== card.instanceId),
  }));
  next = updatePlayer(next, to.id, (current) => ({
    ...current,
    inventory: [...current.inventory, card],
    equippedLootIds:
      wasEquipped && card.kind !== "consumable" && current.equippedLootIds.length < EQUIPMENT_LIMIT
        ? [...current.equippedLootIds, card.instanceId]
        : current.equippedLootIds,
  }));
  next = refreshPlayerMaxHp(refreshPlayerMaxHp(next, from.id), to.id);
  return appendLog(next, `${from.name} gives ${card.name} to ${to.name}.`);
}

export function useLoot(state: GameState, playerId: string, lootInstanceId: string): GameState {
  const player = state.players.find(({ id }) => id === playerId);
  const card = player?.inventory.find(({ instanceId }) => instanceId === lootInstanceId);
  if (!player || !card || player.isDead) return appendLog(state, "That loot card cannot be used.", "error");
  if (card.kind !== "consumable" && !player.equippedLootIds.includes(card.instanceId)) {
    return appendLog(state, `${card.name} must be equipped before use.`, "error");
  }
  const uses = state.lootUsesThisRoom[card.instanceId] ?? 0;
  let next = state;
  if (card.kind === "consumable") {
    for (const effect of card.effects ?? []) {
      if (effect.type === "healSelf") {
        next = updatePlayer(next, player.id, (current) => healPlayer(current, Number(effect.amount ?? 0)));
      } else if (effect.type !== "returnToBottomOfLootDeck") {
        next = appendLog(next, `Loot effect ${effect.type ?? "unknown"} was skipped safely.`, "warning");
      }
    }
    next = updatePlayer(next, player.id, (current) => ({
      ...current,
      inventory: current.inventory.filter(({ instanceId }) => instanceId !== card.instanceId),
      equippedLootIds: current.equippedLootIds.filter((id) => id !== card.instanceId),
    }));
    const returnsToBottom = card.effects?.some(({ type }) => type === "returnToBottomOfLootDeck");
    next = returnsToBottom
      ? { ...next, lootDeck: [...next.lootDeck, card] }
      : { ...next, lootDiscard: [...next.lootDiscard, card] };
    return appendLog(refreshPlayerMaxHp(next, player.id), `${player.name} uses ${card.name}.`);
  }

  const reroll = card.effects?.find(({ type }) => type === "rerollOncePerRoom");
  const reaction = card.effects?.find(({ type }) => type === "reactionModifier");
  const useLimit = Number(reaction?.usesPerRoom ?? (reroll ? 1 : 0));
  if (useLimit === 0) return appendLog(state, `${card.name}'s effect is passive or unsupported.`, "warning");
  if (uses >= useLimit) return appendLog(state, `${card.name} has already been used this room.`, "error");
  if (reroll) next = { ...next, pendingRerollPlayerId: player.id };
  if (reaction) {
    next = {
      ...next,
      pendingBlockBonuses: {
        ...next.pendingBlockBonuses,
        [player.id]: (next.pendingBlockBonuses[player.id] ?? 0) + Number(reaction.amount ?? 0),
      },
    };
  }
  return appendLog(
    { ...next, lootUsesThisRoom: { ...next.lootUsesThisRoom, [card.instanceId]: uses + 1 } },
    `${player.name} readies ${card.name}.`,
  );
}

function advanceAfterCurrentRoom(state: GameState): GameState {
  const roomId = state.currentRoom?.definitionId;
  const completedRoomIds = roomId && !state.completedRoomIds.includes(roomId)
    ? [...state.completedRoomIds, roomId]
    : state.completedRoomIds;
  return revealRoom({
    ...state,
    completedRoomIds,
    pendingLootReward: [],
    pendingLootRecipientIds: null,
    specialRoomState: null,
  }, state.roomIndex + 1);
}

export function continueAfterLoot(state: GameState): GameState {
  if (state.phase !== "LOOT_REWARD") return appendLog(state, "The party is not distributing loot.", "error");
  if (state.pendingLootReward.length > 0) return appendLog(state, "Assign or discard every reward before continuing.", "error");
  return advanceAfterCurrentRoom(state);
}

export function resolveHealingSpring(state: GameState): GameState {
  if (state.phase !== "SPECIAL_ROOM" || !currentSpecialHasEffect(state, "healPartyToMax")) {
    return appendLog(state, "The party is not at the Spring of the Gods.", "error");
  }
  const next = {
    ...state,
    players: state.players.map((player) => ({
      ...player,
      hp: player.maxHp,
      isDead: false,
      pendingReviveTurns: null,
    })),
    specialRoomState: { resolved: true, vendorOffer: [], result: "The party is fully healed." },
  };
  return appendLog(next, "The Spring of the Gods restores every hero to full health.");
}

export function resolveTreasureRoom(
  state: GameState,
  playerIds: string[] = [],
  forcedRolls: number[] = [],
): GameState {
  if (state.phase !== "SPECIAL_ROOM" || state.currentRoom?.definitionId !== "treasure-room") {
    return appendLog(state, "The party is not in the Treasure Room.", "error");
  }
  if (state.specialRoomState?.resolved) return state;
  const cursor: RollCursor = { forced: forcedRolls, index: 0 };
  let first = takeRoll(state, cursor);
  let next = first.state;
  const chestRoll = first.roll;
  const second = takeRoll(next, cursor);
  next = second.state;
  const rewardRoll = second.roll;
  const living = getLivingPlayers(next);
  const chosen = playerIds
    .map((id) => living.find((player) => player.id === id))
    .filter((player): player is PlayerRuntime => Boolean(player));
  const resultName = chestRoll <= 2
    ? "Basic Ability Chest"
    : chestRoll <= 4
      ? "Basic Loot Chest"
      : chestRoll === 5
        ? "Intermediate Ability Chest"
        : "Intermediate Loot Chest";

  if (chestRoll === 1 || chestRoll === 2 || chestRoll === 5) {
    const recipientLimit = chestRoll <= 2 ? 2 : living.length;
    const recipients = chestRoll <= 2
      ? (chosen.length ? chosen : living).slice(0, recipientLimit)
      : living;
    next = {
      ...next,
      players: next.players.map((player) =>
        recipients.some(({ id }) => id === player.id)
          ? { ...player, abilityTokens: player.abilityTokens + rewardRoll }
          : player,
      ),
      specialRoomState: { resolved: true, vendorOffer: [], result: `${resultName}: ${rewardRoll} ability tokens.` },
    };
    return appendLog(next, `${resultName}: ${recipients.map(({ name }) => name).join(" and ")} gain ${rewardRoll} ability tokens each.`);
  }

  const lootRecipients = chestRoll <= 4
    ? (chosen.length ? chosen : living).slice(0, 2)
    : living;
  const draw = drawLootCards(next, rewardRoll * lootRecipients.length);
  return appendLog(
    {
      ...draw.state,
      phase: "LOOT_REWARD",
      pendingLootReward: draw.cards,
      pendingLootRecipientIds: lootRecipients.map(({ id }) => id),
      specialRoomState: { resolved: true, vendorOffer: [], result: `${resultName}: ${draw.cards.length} loot.` },
    },
    `${resultName}: ${lootRecipients.map(({ name }) => name).join(", ")} may divide ${draw.cards.length} loot cards.`,
  );
}

function shuffleCardsIntoDeck(state: GameState, cards: LootCardRuntime[]): GameState {
  const result = shuffleWithRng([...state.lootDeck, ...cards], state.rng);
  return { ...state, rng: result.rng, lootDeck: result.items };
}

export function resolveVendorTrade(
  state: GameState,
  offeredLootInstanceId: string,
  recipientPlayerId: string,
  payments: VendorPayment[],
): GameState {
  if (state.phase !== "SPECIAL_ROOM" || !currentSpecialHasEffect(state, "vendorTrade") || !state.specialRoomState) {
    return appendLog(state, "The party is not trading with the merchant.", "error");
  }
  const offered = state.specialRoomState.vendorOffer.find(({ instanceId }) => instanceId === offeredLootInstanceId);
  const recipient = state.players.find(({ id }) => id === recipientPlayerId);
  const uniquePayments = new Set(payments.map(({ lootInstanceId }) => lootInstanceId));
  if (!offered || !recipient || payments.length !== 2 || uniquePayments.size !== 2) {
    return appendLog(state, "A vendor trade needs one offered card and two distinct party loot cards.", "error");
  }
  const paymentCards = payments.map((payment) =>
    state.players
      .find(({ id }) => id === payment.playerId)
      ?.inventory.find(({ instanceId }) => instanceId === payment.lootInstanceId),
  );
  if (paymentCards.some((card) => !card)) return appendLog(state, "One of the vendor payment cards is missing.", "error");
  const recipientPayments = payments.filter(({ playerId }) => playerId === recipient.id).length;
  if (recipient.inventory.length - recipientPayments >= INVENTORY_LIMIT) {
    return appendLog(state, `${recipient.name} has no room for the traded item.`, "error");
  }

  let next = state;
  for (const payment of payments) {
    next = updatePlayer(next, payment.playerId, (player) => ({
      ...player,
      inventory: player.inventory.filter(({ instanceId }) => instanceId !== payment.lootInstanceId),
      equippedLootIds: player.equippedLootIds.filter((id) => id !== payment.lootInstanceId),
    }));
    next = refreshPlayerMaxHp(next, payment.playerId);
  }
  next = updatePlayer(next, recipient.id, (player) => ({
    ...player,
    inventory: [...player.inventory, offered],
    equippedLootIds:
      offered.kind !== "consumable" && player.equippedLootIds.length < EQUIPMENT_LIMIT
        ? [...player.equippedLootIds, offered.instanceId]
        : player.equippedLootIds,
  }));
  const returned = [
    ...state.specialRoomState.vendorOffer.filter(({ instanceId }) => instanceId !== offered.instanceId),
    ...(paymentCards as LootCardRuntime[]),
  ];
  next = shuffleCardsIntoDeck(next, returned);
  next = {
    ...next,
    specialRoomState: { resolved: true, vendorOffer: [], result: `${recipient.name} received ${offered.name}.` },
  };
  return appendLog(next, `${recipient.name} trades two items for ${offered.name}.`);
}

export function leaveVendor(state: GameState): GameState {
  if (state.phase !== "SPECIAL_ROOM" || !currentSpecialHasEffect(state, "vendorTrade") || !state.specialRoomState) {
    return state;
  }
  const next = shuffleCardsIntoDeck(state, state.specialRoomState.vendorOffer);
  return appendLog(
    { ...next, specialRoomState: { resolved: true, vendorOffer: [], result: "No trade was made." } },
    "The party leaves the merchant without trading.",
  );
}

export function resolveWitchRoom(state: GameState, playerId: string): GameState {
  if (state.phase !== "SPECIAL_ROOM" || !currentSpecialHasEffect(state, "witchPotionTrade")) {
    return appendLog(state, "The party is not visiting the Mysterious Witch.", "error");
  }
  const player = state.players.find(({ id }) => id === playerId);
  if (!player || player.isDead || player.inventory.length >= INVENTORY_LIMIT) {
    return appendLog(state, "Choose a living hero with an open inventory slot.", "error");
  }
  let next = applyPlayerDamage(state, player.id, 4, "the Witch's bargain");
  if (next.players.find(({ id }) => id === player.id)?.isDead) {
    return appendLog({ ...next, specialRoomState: { resolved: true, vendorOffer: [], result: "The bargain was fatal." } }, "The Witch's bargain claims the hero before a potion can be taken.", "warning");
  }
  const skipped: LootCardRuntime[] = [];
  let potion: LootCardRuntime | undefined;
  while (next.lootDeck.length > 0 || next.lootDiscard.length > 0) {
    next = recycleDiscardIfNeeded(next);
    const [card, ...remaining] = next.lootDeck;
    next = { ...next, lootDeck: remaining };
    if (card.tags?.includes("potion")) {
      potion = card;
      break;
    }
    skipped.push(card);
  }
  next = shuffleCardsIntoDeck(next, skipped);
  if (!potion) return appendLog(next, "The Witch finds no potion; no card is awarded.", "warning");
  next = updatePlayer(next, player.id, (current) => ({ ...current, inventory: [...current.inventory, potion!] }));
  next = {
    ...next,
    specialRoomState: { resolved: true, vendorOffer: [], result: `${player.name} received ${potion.name}.` },
  };
  return appendLog(next, `${player.name} pays 4 HP and receives ${potion.name}.`);
}

export function continueAfterSpecialRoom(state: GameState): GameState {
  if (state.phase !== "SPECIAL_ROOM" || !state.specialRoomState?.resolved) {
    return appendLog(state, "Resolve the special room before continuing.", "error");
  }
  return advanceAfterCurrentRoom(state);
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "START_NEW_GAME":
      return startNewGame(state, action.seed);
    case "TOGGLE_CHARACTER":
      return toggleCharacterSelection(state, action.characterId);
    case "CONFIRM_PARTY":
      return confirmParty(state);
    case "ASSIGN_POSITION":
      return assignPosition(state, action.playerId, action.position);
    case "CONFIRM_POSITIONS":
      return confirmPositions(state);
    case "SWAP_PLAYER_POSITION":
      return swapPlayerPosition(state, action.playerId, action.targetPosition);
    case "ENTER_REVEALED_ROOM":
      return enterRevealedRoom(state);
    case "PLAYER_USE_ABILITY":
      return usePlayerAbility(state, action.choice, action.rolls);
    case "RESOLVE_ENEMY_TURN":
      return resolveEnemyTurn(state, action.rolls);
    case "ASSIGN_LOOT":
      return assignLoot(state, action.lootInstanceId, action.playerId);
    case "CONTINUE_AFTER_LOOT":
      return continueAfterLoot(state);
    case "CONTINUE_AFTER_SPECIAL_ROOM":
      return continueAfterSpecialRoom(state);
    case "LOAD_GAME":
      return action.state;
    default:
      return state;
  }
}
