import type {
  AbilityDefinition,
  CombatRoomDefinition,
  CurrentTurn,
  DungeonContent,
  EffectDefinition,
  EnemyActionDefinition,
  EnemyRuntime,
  GameLogEntry,
  GameState,
  LogTone,
  LootCardDefinition,
  ModifierRuntime,
  PassiveDefinition,
  PlayerPosition,
  PlayerRuntime,
  RuntimeRoom,
  SpecialRoomDefinition,
  StatName,
  TreasureOutcomeDefinition
} from "./types";
import { checkPlayerAttackRoll, checkPlayerBlockRoll, statBonusFromLoot, statBonusFromModifiers } from "./rules";
import { hashSeed, randomInt, shuffleWithState } from "./rng";

const POSITIONS: PlayerPosition[] = ["A", "B", "C", "D"];

export function createTitleState(content: DungeonContent): GameState {
  return {
    phase: "TITLE",
    rngSeed: "",
    rngState: 1,
    selectedCharacterIds: [],
    selectedPlayers: [],
    playDeck: [],
    completedRooms: [],
    roomNumber: 0,
    currentRoom: null,
    currentSpecialId: null,
    turn: null,
    modifiers: [],
    lootDeck: content.starterLoot.map((card) => card.id),
    lootDiscard: [],
    pendingLootReward: [],
    vendor: null,
    pendingPlayerReroll: null,
    lastEnemyActionHits: [],
    log: []
  };
}

export function cloneState(state: GameState): GameState {
  return structuredClone(state) as GameState;
}

export function startNewGame(content: DungeonContent, seed = `run-${Date.now()}`): GameState {
  const state = createTitleState(content);
  state.phase = "PARTY_SELECT";
  state.rngSeed = seed;
  state.rngState = hashSeed(seed);
  const lootShuffle = shuffleWithState(content.starterLoot.map((card) => card.id), state.rngState);
  state.rngState = lootShuffle.state;
  state.lootDeck = lootShuffle.items;
  log(state, `New dungeon run seeded as ${seed}. Choose four heroes.`, "good");
  return state;
}

export function toggleCharacterSelection(state: GameState, characterId: string): GameState {
  const next = cloneState(state);
  if (next.selectedCharacterIds.includes(characterId)) {
    next.selectedCharacterIds = next.selectedCharacterIds.filter((id) => id !== characterId);
  } else if (next.selectedCharacterIds.length < 4) {
    next.selectedCharacterIds.push(characterId);
  }
  return next;
}

export function confirmParty(state: GameState, content: DungeonContent): GameState {
  const next = cloneState(state);
  if (next.selectedCharacterIds.length !== content.config.partySize) {
    log(next, "Select exactly four heroes before assigning positions.", "warn");
    return next;
  }

  next.selectedPlayers = next.selectedCharacterIds.map((characterId) => {
    const definition = requireCharacter(content, characterId);
    return {
      id: `player:${definition.id}`,
      characterId: definition.id,
      name: definition.name,
      role: definition.role,
      maxHp: definition.stats.maxHp,
      hp: definition.stats.maxHp,
      acc: definition.stats.acc,
      def: definition.stats.def,
      lootIds: [],
      abilityTokens: 0,
      dead: false,
      lootedOnDeath: false,
      skipNextAction: false,
      pendingReviveTurns: null,
      oncePerEncounterUsed: [],
      usedLootThisRoom: [],
      abilityDamageBonusById: {}
    };
  });
  next.phase = "POSITION_ASSIGNMENT";
  log(next, "Party confirmed. Assign one hero to each turn position.", "good");
  return next;
}

export function assignPosition(state: GameState, playerId: string, position: PlayerPosition): GameState {
  const next = cloneState(state);
  for (const player of next.selectedPlayers) {
    if (player.position === position) {
      player.position = undefined;
    }
    if (player.id === playerId) {
      player.position = position;
    }
  }
  return next;
}

export function confirmPositions(state: GameState, content: DungeonContent): GameState {
  const next = cloneState(state);
  const assigned = new Set(next.selectedPlayers.map((player) => player.position).filter(Boolean));
  if (assigned.size !== 4) {
    log(next, "Assign exactly one hero to A, B, C, and D.", "warn");
    return next;
  }

  buildPlayDeck(next, content);
  log(next, "The six-room dungeon deck is ready.", "good");
  return revealNextRoom(next, content);
}

export function revealNextRoom(state: GameState, content: DungeonContent): GameState {
  const next = cloneState(state);
  next.currentRoom = null;
  next.currentSpecialId = null;
  next.turn = null;
  next.vendor = null;
  next.lastEnemyActionHits = [];

  if (next.playDeck.length === 0) {
    next.phase = "VICTORY";
    log(next, "The dungeon is clear. The party wins!", "good");
    return next;
  }

  const [entry, ...rest] = next.playDeck;
  next.playDeck = rest;
  if (entry.kind === "combat") {
    next.currentRoom = createRuntimeRoom(requireRoom(content, entry.id));
  } else {
    next.currentSpecialId = entry.id;
  }
  next.phase = "ROOM_REVEAL";
  log(next, `Revealed ${getCurrentRoomName(next, content)}.`, "normal");
  return next;
}

export function enterRevealedRoom(state: GameState, content: DungeonContent): GameState {
  const next = cloneState(state);
  if (next.currentRoom) {
    next.phase = "COMBAT";
    next.turn = { index: 0, round: 1 };
    log(next, `${next.currentRoom.name} begins.`, "good");
    return ensureActiveTurn(next, content);
  }
  if (next.currentSpecialId) {
    next.phase = "SPECIAL_ROOM";
    const special = requireSpecialRoom(content, next.currentSpecialId);
  log(next, `${special.name} awaits a choice.`, "normal");
    if (special.id === "vendor") {
      prepareVendor(next, content);
    }
  }
  return next;
}

export function startSpecificCombatRoom(state: GameState, content: DungeonContent, roomId: string): GameState {
  const next = cloneState(state);
  next.currentRoom = createRuntimeRoom(requireRoom(content, roomId));
  next.currentSpecialId = null;
  next.phase = "COMBAT";
  next.turn = { index: 0, round: 1 };
  next.vendor = null;
  next.pendingLootReward = [];
  next.lastEnemyActionHits = [];
  next.pendingPlayerReroll = null;
  return ensureActiveTurn(next, content);
}

export function getCurrentTurn(state: GameState): CurrentTurn | null {
  if (!state.currentRoom || !state.turn) {
    return null;
  }
  const slot = state.currentRoom.turnOrder[state.turn.index];
  if (!slot) {
    return null;
  }
  if (slot.startsWith("player:")) {
    const position = slot.slice("player:".length) as PlayerPosition;
    const player = state.selectedPlayers.find((candidate) => candidate.position === position) ?? null;
    return { kind: "player", position, player, label: `${position}: ${player?.name ?? "Open"}` };
  }
  const [, enemyId, actionId] = slot.split(":");
  const enemy = state.currentRoom.enemies.find((candidate) => candidate.id === enemyId) ?? null;
  const action = enemy?.actions.find((candidate) => candidate.id === actionId) ?? null;
  return {
    kind: "enemy",
    enemyId,
    actionId,
    enemy,
    action: action ?? null,
    label: `${enemy?.name ?? enemyId}: ${action?.name ?? actionId}`
  };
}

export function usePlayerAbility(
  state: GameState,
  content: DungeonContent,
  playerId: string,
  abilityId: string,
  targetIds: string[] = [],
  allocation: Record<string, number> = {}
): GameState {
  const next = cloneState(state);
  const turn = getCurrentTurn(next);
  const player = next.selectedPlayers.find((candidate) => candidate.id === playerId);
  if (!player || !next.currentRoom || turn?.kind !== "player" || turn.player?.id !== playerId) {
    log(next, "That hero is not the current actor.", "warn");
    return next;
  }
  if (player.dead) {
    log(next, `${player.name} is down and cannot act.`, "warn");
    return advanceToNextTurn(next, content);
  }

  const character = requireCharacter(content, player.characterId);
  const ability = requireAbility(character.abilities, abilityId);
  if (player.oncePerEncounterUsed.includes(ability.id) && ability.effects.some((effect) => booleanField(effect, "oncePerEncounter"))) {
    log(next, `${ability.name} has already been used this encounter.`, "warn");
    return next;
  }

  const context = {
    player,
    ability,
    targetIds,
    allocation,
    hitEnemyIds: [] as string[]
  };

  log(next, `${player.name} uses ${ability.name}.`, "normal");
  for (const effect of ability.effects) {
    resolvePlayerEffect(next, content, context, effect);
  }

  if (ability.effects.some((effect) => booleanField(effect, "oncePerEncounter"))) {
    player.oncePerEncounterUsed.push(ability.id);
  }
  spendActionModifiers(next, "player", player.id);
  clampPlayerHp(next, content, player);
  if (checkCombatOutcome(next, content)) {
    return next;
  }
  return advanceToNextTurn(next, content);
}

export function resolveEnemyTurn(state: GameState, content: DungeonContent): GameState {
  const next = cloneState(state);
  const turn = getCurrentTurn(next);
  if (!next.currentRoom || turn?.kind !== "enemy" || !turn.enemy || !turn.action) {
    log(next, "There is no enemy action to resolve.", "warn");
    return next;
  }

  const enemy = turn.enemy;
  if (enemy.dead) {
    log(next, `${enemy.name} is defeated and its action is skipped.`, "normal");
    return advanceToNextTurn(next, content);
  }

  tickEnemyDots(next, content, enemy);
  if (enemy.dead || checkCombatOutcome(next, content)) {
    return advanceToNextTurn(next, content);
  }

  if (enemy.skipNextAction) {
    enemy.skipNextAction = false;
    log(next, `${enemy.name} loses its action.`, "warn");
    return advanceToNextTurn(next, content);
  }

  next.lastEnemyActionHits = [];
  log(next, `${enemy.name} resolves ${turn.action.name}.`, "normal");
  for (const effect of turn.action.effects) {
    resolveEnemyEffect(next, content, enemy, turn.action, effect);
  }

  spendActionModifiers(next, "enemy", enemy.id);
  if (checkCombatOutcome(next, content)) {
    return next;
  }
  return advanceToNextTurn(next, content);
}

export function assignLoot(state: GameState, content: DungeonContent, lootId: string, playerId: string | null): GameState {
  const next = cloneState(state);
  if (!next.pendingLootReward.includes(lootId)) {
    return next;
  }

  if (playerId === null) {
    next.pendingLootReward = removeFirst(next.pendingLootReward, lootId);
    next.lootDiscard.push(lootId);
    log(next, `${requireLoot(content, lootId).name} was discarded.`, "normal");
    return next;
  }

  const player = requirePlayer(next, playerId);
  if (player.lootIds.length >= 3) {
    log(next, `${player.name} already has three loot cards. Discard or use one first.`, "warn");
    return next;
  }

  player.lootIds.push(lootId);
  next.pendingLootReward = removeFirst(next.pendingLootReward, lootId);
  clampPlayerHp(next, content, player);
  log(next, `${player.name} takes ${requireLoot(content, lootId).name}.`, "good");
  return next;
}

export function discardPlayerLoot(state: GameState, content: DungeonContent, playerId: string, lootId: string): GameState {
  const next = cloneState(state);
  const player = requirePlayer(next, playerId);
  if (!player.lootIds.includes(lootId)) {
    return next;
  }
  player.lootIds = removeFirst(player.lootIds, lootId);
  next.lootDiscard.push(lootId);
  clampPlayerHp(next, content, player);
  log(next, `${player.name} discards ${requireLoot(content, lootId).name}.`, "normal");
  return next;
}

export function transferPlayerLoot(
  state: GameState,
  content: DungeonContent,
  fromPlayerId: string,
  toPlayerId: string,
  lootId: string
): GameState {
  const next = cloneState(state);
  const fromPlayer = requirePlayer(next, fromPlayerId);
  const toPlayer = requirePlayer(next, toPlayerId);
  if (!fromPlayer.lootIds.includes(lootId) || fromPlayer.id === toPlayer.id) {
    return next;
  }
  if (toPlayer.lootIds.length >= 3) {
    log(next, `${toPlayer.name} already has three loot cards.`, "warn");
    return next;
  }
  fromPlayer.lootIds = removeFirst(fromPlayer.lootIds, lootId);
  toPlayer.lootIds.push(lootId);
  clampPlayerHp(next, content, fromPlayer);
  clampPlayerHp(next, content, toPlayer);
  log(next, `${fromPlayer.name} passes ${requireLoot(content, lootId).name} to ${toPlayer.name}.`, "good");
  return next;
}

export function useLootCard(state: GameState, content: DungeonContent, playerId: string, lootId: string): GameState {
  const next = cloneState(state);
  const player = requirePlayer(next, playerId);
  const loot = requireLoot(content, lootId);
  if (!player.lootIds.includes(lootId) || loot.kind === "equipment") {
    return next;
  }

  if (loot.kind === "item") {
    if (player.usedLootThisRoom.includes(lootId)) {
      log(next, `${loot.name} has already been used this room.`, "warn");
      return next;
    }
    if (player.dead) {
      log(next, `${player.name} cannot use ${loot.name} while down.`, "warn");
      return next;
    }
    for (const effect of loot.effects ?? []) {
      if (effect.type === "rerollOncePerRoom") {
        next.pendingPlayerReroll = { playerId, lootId };
        player.usedLootThisRoom.push(lootId);
        log(next, `${player.name} readies ${loot.name}; their next player die will reroll once.`, "good");
      } else if (effect.type === "reactionModifier") {
        addModifier(next, {
          id: `loot:${loot.id}:${player.id}:${next.log.length}`,
          sourceId: loot.id,
          targetKind: "player",
          targetId: player.id,
          stat: stringField(effect, "stat", "def") as "acc" | "def" | "dmg",
          amount: numberField(effect, "amount", 0),
          duration: "nextBlock",
          label: loot.name
        });
        player.usedLootThisRoom.push(lootId);
        log(next, `${player.name} readies ${loot.name} for ${signed(numberField(effect, "amount", 0))} DEF on the next block.`, "good");
      } else {
        log(next, `TODO: ${loot.name} has unimplemented effect ${effect.type ?? "unknown"}.`, "warn");
      }
    }
    return next;
  }

  for (const effect of loot.effects ?? []) {
    if (effect.type === "healSelf") {
      healPlayer(next, content, player, numberField(effect, "amount", 0), loot.name);
    } else if (effect.type !== "returnToBottomOfLootDeck") {
      log(next, `TODO: ${loot.name} has unimplemented effect ${effect.type ?? "unknown"}.`, "warn");
    }
  }
  player.lootIds = removeFirst(player.lootIds, lootId);
  if ((loot.effects ?? []).some((effect) => effect.type === "returnToBottomOfLootDeck")) {
    next.lootDeck.push(lootId);
  } else {
    next.lootDiscard.push(lootId);
  }
  log(next, `${player.name} uses ${loot.name}.`, "good");
  return next;
}

export function continueAfterLoot(state: GameState, content: DungeonContent): GameState {
  const next = cloneState(state);
  if (next.pendingLootReward.length > 0) {
    log(next, "Assign or discard all pending loot before continuing.", "warn");
    return next;
  }
  return revealNextRoom(next, content);
}

export function resolveHealingSpring(state: GameState, content: DungeonContent): GameState {
  const next = cloneState(state);
  for (const player of next.selectedPlayers) {
    player.dead = false;
    player.pendingReviveTurns = null;
    player.hp = effectivePlayerMaxHp(next, content, player);
  }
  log(next, "The Spring of the Gods restores the whole party.", "good");
  return completeSpecialRoom(next, content);
}

export function resolveWitchTrade(state: GameState, content: DungeonContent, playerId: string): GameState {
  const next = cloneState(state);
  const player = requirePlayer(next, playerId);
  damagePlayer(next, content, player, 4, "Mysterious Witch");
  const drawn: string[] = [];
  let potionId: string | null = null;
  while (!potionId) {
    const card = drawOneLoot(next, content);
    if (!card) {
      break;
    }
    if (card.tags?.includes("potion")) {
      potionId = card.id;
    } else {
      drawn.push(card.id);
    }
  }
  if (drawn.length > 0) {
    const shuffled = shuffleWithState([...next.lootDeck, ...drawn], next.rngState);
    next.rngState = shuffled.state;
    next.lootDeck = shuffled.items;
    log(next, `The Witch shuffles ${drawn.length} non-potion cards back into the loot deck.`, "normal");
  }
  if (potionId) {
    if (!player.dead && player.lootIds.length < 3) {
      player.lootIds.push(potionId);
      log(next, `${player.name} receives ${requireLoot(content, potionId).name}.`, "good");
    } else {
      next.pendingLootReward.push(potionId);
      log(next, `${requireLoot(content, potionId).name} waits in the reward pile.`, "warn");
    }
  } else {
    log(next, "No potion could be found in the loot deck.", "warn");
  }
  return completeSpecialRoom(next, content);
}

export function resolveTreasureRoom(state: GameState, content: DungeonContent): GameState {
  const next = cloneState(state);
  const special = requireSpecialRoom(content, "treasure-room");
  const chestRoll = rollD6(next);
  const amountRoll = rollD6(next);
  const outcome = special.effects.find((effect) => {
    return "roll" in effect && Array.isArray(effect.roll) && effect.roll.includes(chestRoll);
  }) as TreasureOutcomeDefinition | undefined;

  if (!outcome) {
    log(next, `Treasure roll ${chestRoll} found no chest outcome.`, "warn");
    return completeSpecialRoom(next, content);
  }

  log(next, `Treasure roll ${chestRoll}: ${outcome.name}. Follow-up roll: ${amountRoll}.`, "good");
  if (outcome.name.includes("Ability")) {
    const recipients = outcome.name.includes("Basic")
      ? next.selectedPlayers.filter((player) => !player.dead).slice(0, 2)
      : next.selectedPlayers.filter((player) => !player.dead);
    for (const player of recipients) {
      player.abilityTokens += amountRoll;
      log(next, `${player.name} gains ${amountRoll} ability tokens.`, "good");
    }
    return completeSpecialRoom(next, content);
  }

  const drawCount = amountRoll;
  next.completedRooms.push("treasure-room");
  next.roomNumber += 1;
  next.currentSpecialId = null;
  next.pendingLootReward.push(...drawLoot(next, content, drawCount).map((card) => card.id));
  next.phase = "LOOT_REWARD";
  log(next, `The treasure chest adds ${drawCount} loot cards to the reward pile.`, "good");
  return next;
}

export function toggleVendorPayment(state: GameState, lootId: string): GameState {
  const next = cloneState(state);
  if (!next.vendor) {
    return next;
  }
  if (next.vendor.selectedPaymentIds.includes(lootId)) {
    next.vendor.selectedPaymentIds = next.vendor.selectedPaymentIds.filter((id) => id !== lootId);
  } else if (next.vendor.selectedPaymentIds.length < 2) {
    next.vendor.selectedPaymentIds.push(lootId);
  }
  return next;
}

export function chooseVendorTake(state: GameState, lootId: string): GameState {
  const next = cloneState(state);
  if (next.vendor) {
    next.vendor.selectedTakeId = lootId;
  }
  return next;
}

export function chooseVendorRecipient(state: GameState, playerId: string): GameState {
  const next = cloneState(state);
  if (next.vendor) {
    next.vendor.selectedRecipientId = playerId;
  }
  return next;
}

export function completeVendorTrade(state: GameState, content: DungeonContent): GameState {
  const next = cloneState(state);
  const vendor = next.vendor;
  if (!vendor || vendor.selectedPaymentIds.length !== 2 || !vendor.selectedTakeId || !vendor.selectedRecipientId) {
    log(next, "Pick two paid loot cards, one merchant card, and a recipient.", "warn");
    return next;
  }

  for (const paymentId of vendor.selectedPaymentIds) {
    const owner = next.selectedPlayers.find((player) => player.lootIds.includes(paymentId));
    if (owner) {
      owner.lootIds = removeFirst(owner.lootIds, paymentId);
      next.lootDiscard.push(paymentId);
      clampPlayerHp(next, content, owner);
    }
  }

  const recipient = requirePlayer(next, vendor.selectedRecipientId);
  if (recipient.lootIds.length < 3) {
    recipient.lootIds.push(vendor.selectedTakeId);
    log(next, `${recipient.name} trades for ${requireLoot(content, vendor.selectedTakeId).name}.`, "good");
  } else {
    next.pendingLootReward.push(vendor.selectedTakeId);
    log(next, `${requireLoot(content, vendor.selectedTakeId).name} waits in the reward pile.`, "warn");
  }

  const leftovers = vendor.drawIds.filter((lootId) => lootId !== vendor.selectedTakeId);
  const shuffled = shuffleWithState([...next.lootDeck, ...leftovers], next.rngState);
  next.rngState = shuffled.state;
  next.lootDeck = shuffled.items;
  return completeSpecialRoom(next, content);
}

export function skipVendorTrade(state: GameState, content: DungeonContent): GameState {
  const next = cloneState(state);
  if (next.vendor) {
    const shuffled = shuffleWithState([...next.lootDeck, ...next.vendor.drawIds], next.rngState);
    next.rngState = shuffled.state;
    next.lootDeck = shuffled.items;
  }
  log(next, "The merchant vanishes with no trade made.", "normal");
  return completeSpecialRoom(next, content);
}

export function getPlayerEffectiveStats(state: GameState, content: DungeonContent, player: PlayerRuntime) {
  const loot = content.starterLoot;
  return {
    maxHp: effectivePlayerMaxHp(state, content, player),
    acc:
      player.acc +
      statBonusFromLoot(player, loot, "acc") +
      statBonusFromModifiers(state.modifiers, "player", player.id, "acc"),
    def:
      player.def +
      statBonusFromLoot(player, loot, "def") +
      statBonusFromModifiers(state.modifiers, "player", player.id, "def"),
    dmg:
      statBonusFromLoot(player, loot, "dmg") +
      statBonusFromModifiers(state.modifiers, "player", player.id, "dmg")
  };
}

export function getEnemyEffectiveStats(state: GameState, enemy: EnemyRuntime) {
  return {
    acc: enemy.acc + statBonusFromModifiers(state.modifiers, "enemy", enemy.id, "acc"),
    def: enemy.def + statBonusFromModifiers(state.modifiers, "enemy", enemy.id, "def"),
    dmg: statBonusFromModifiers(state.modifiers, "enemy", enemy.id, "dmg")
  };
}

export function isEnemyTargetable(room: RuntimeRoom, enemy: EnemyRuntime): boolean {
  if (enemy.dead) {
    return false;
  }
  if (!enemy.passives.some((passive) => passive.type === "untargetableUntilOthersDead")) {
    return true;
  }
  return room.enemies.every((candidate) => candidate.id === enemy.id || candidate.dead);
}

export function getCurrentRoomName(state: GameState, content: DungeonContent): string {
  if (state.currentRoom) {
    return state.currentRoom.name;
  }
  if (state.currentSpecialId) {
    return requireSpecialRoom(content, state.currentSpecialId).name;
  }
  return "the dungeon";
}

function buildPlayDeck(state: GameState, content: DungeonContent): void {
  const aRooms = shuffleWithState(
    content.rooms.filter((room) => room.tier === "A").map((room) => room.id),
    state.rngState
  );
  const bRooms = shuffleWithState(
    content.rooms.filter((room) => room.tier === "B").map((room) => room.id),
    aRooms.state
  );
  const specials = shuffleWithState(
    content.specialRooms.map((room) => room.id),
    bRooms.state
  );
  const boss = content.rooms.find((room) => room.tier === "BOSS");
  if (!boss) {
    throw new Error("No boss room exists in the seed content.");
  }
  state.rngState = specials.state;
  state.playDeck = [
    { kind: "combat", id: aRooms.items[0] },
    { kind: "combat", id: aRooms.items[1] },
    { kind: "special", id: specials.items[0] },
    { kind: "combat", id: bRooms.items[0] },
    { kind: "combat", id: bRooms.items[1] },
    { kind: "combat", id: boss.id }
  ];
}

function createRuntimeRoom(room: CombatRoomDefinition): RuntimeRoom {
  return {
    definitionId: room.id,
    name: room.name,
    tier: room.tier,
    type: "combat",
    lootReward: room.lootReward,
    turnOrder: [...room.turnOrder],
    enemies: room.enemies.map((enemy) => ({
      id: enemy.id,
      name: enemy.name,
      maxHp: enemy.stats.maxHp,
      hp: enemy.stats.maxHp,
      acc: enemy.stats.acc,
      def: enemy.stats.def,
      tags: enemy.tags ?? [],
      actions: enemy.actions,
      passives: enemy.passives ?? [],
      dead: false,
      passiveTriggered: [],
      counters: {},
      dots: [],
      skipNextAction: false
    }))
  };
}

function resolvePlayerEffect(
  state: GameState,
  content: DungeonContent,
  context: {
    player: PlayerRuntime;
    ability: AbilityDefinition;
    targetIds: string[];
    allocation: Record<string, number>;
    hitEnemyIds: string[];
  },
  effect: EffectDefinition
): void {
  switch (effect.type) {
    case "attackEnemy":
      for (const targetId of context.targetIds.slice(0, numberField(effect, "targetCount", 1))) {
        attackEnemyWithPlayer(state, content, context, targetId, effect);
      }
      break;
    case "attackEnemies": {
      const targets =
        stringField(effect, "target", "") === "allEnemies"
          ? livingEnemies(state).map((enemy) => enemy.id)
          : context.targetIds.slice(0, numberField(effect, "targetCount", 1));
      for (const targetId of targets) {
        attackEnemyWithPlayer(state, content, context, targetId, effect);
      }
      break;
    }
    case "splitDamage":
      resolveSplitDamage(state, content, context, effect);
      break;
    case "healAlly":
      for (const targetId of context.targetIds.slice(0, 1)) {
        healPlayer(state, content, requirePlayer(state, targetId), numberField(effect, "amount", 0), context.ability.name);
      }
      break;
    case "splitHeal":
      resolveSplitHeal(state, content, context, effect);
      break;
    case "healAllAllies":
      for (const player of state.selectedPlayers.filter((candidate) => !candidate.dead)) {
        healPlayer(state, content, player, numberField(effect, "amount", 0), context.ability.name);
      }
      break;
    case "applyModifier":
      applyPlayerModifierEffect(state, context, effect);
      break;
    case "applyDot":
      for (const enemyId of context.hitEnemyIds) {
        const enemy = requireEnemy(state, enemyId);
        enemy.dots.push({
          id: `dot:${context.player.id}:${context.ability.id}:${state.log.length}`,
          sourceId: context.player.id,
          damage: numberField(effect, "damage", 0),
          timing: "enemyTurnStart"
        });
        log(state, `${enemy.name} is burning for ${numberField(effect, "damage", 0)} damage at enemy turn start.`, "warn");
      }
      break;
    case "increaseAbilityDamage": {
      const abilityId = stringField(effect, "abilityId", "");
      const current = context.player.abilityDamageBonusById[abilityId] ?? 0;
      const nextValue = Math.min(current + numberField(effect, "amount", 1), numberField(effect, "maxDamage", 12));
      context.player.abilityDamageBonusById[abilityId] = nextValue;
      log(state, `${context.player.name}'s sword damage bonus is now ${nextValue}.`, "good");
      break;
    }
    case "passiveRevive":
      log(state, `${context.ability.name} is a passive and will trigger when ${context.player.name} falls.`, "normal");
      break;
    default:
      log(state, `TODO: ${context.ability.name} has unimplemented effect ${effect.type ?? "unknown"}.`, "warn");
  }
}

function attackEnemyWithPlayer(
  state: GameState,
  content: DungeonContent,
  context: {
    player: PlayerRuntime;
    ability: AbilityDefinition;
    hitEnemyIds: string[];
  },
  targetId: string,
  effect: EffectDefinition
): void {
  if (!state.currentRoom) {
    return;
  }
  const enemy = state.currentRoom.enemies.find((candidate) => candidate.id === targetId);
  if (!enemy || !isEnemyTargetable(state.currentRoom, enemy)) {
    log(state, "That enemy cannot be targeted right now.", "warn");
    return;
  }

  const playerStats = getPlayerEffectiveStats(state, content, context.player);
  const enemyStats = getEnemyEffectiveStats(state, enemy);
  const roll = rollPlayerDie(state, content, context.player, context.ability.name);
  const accuracyModifier = numberField(effect, "accuracyModifier", numberField(effect, "accModifier", 0));
  const result = checkPlayerAttackRoll(roll, playerStats.acc, enemyStats.def, accuracyModifier);
  const totalText = `${roll} + ACC ${playerStats.acc}${accuracyModifier ? ` ${signed(accuracyModifier)}` : ""}`;
  if (!result.success) {
    log(
      state,
      `${context.player.name} rolls ${totalText} = ${result.total} vs DEF ${enemyStats.def}. Miss.`,
      "warn"
    );
    return;
  }

  const baseDamage = numberField(effect, "damage", 0);
  const abilityBonus = context.player.abilityDamageBonusById[context.ability.id] ?? 0;
  const damage = Math.max(0, baseDamage + playerStats.dmg + abilityBonus);
  log(
    state,
    `${context.player.name} rolls ${totalText} = ${result.total} vs DEF ${enemyStats.def}. Hit for ${damage}.`,
    "good"
  );
  context.hitEnemyIds.push(enemy.id);
  damageEnemy(state, content, enemy, damage, context.ability.name);
}

function resolveSplitDamage(
  state: GameState,
  content: DungeonContent,
  context: {
    player: PlayerRuntime;
    ability: AbilityDefinition;
    allocation: Record<string, number>;
  },
  effect: EffectDefinition
): void {
  const total = numberField(effect, "totalDamage", 0) + getPlayerEffectiveStats(state, content, context.player).dmg;
  const allocatedTotal = Object.values(context.allocation).reduce((sum, value) => sum + value, 0);
  if (allocatedTotal !== total) {
    log(state, `${context.ability.name} must allocate exactly ${total} damage.`, "warn");
    return;
  }
  for (const [enemyId, amount] of Object.entries(context.allocation)) {
    if (amount > 0) {
      damageEnemy(state, content, requireEnemy(state, enemyId), amount, context.ability.name);
    }
  }
}

function resolveSplitHeal(
  state: GameState,
  content: DungeonContent,
  context: {
    player: PlayerRuntime;
    ability: AbilityDefinition;
    allocation: Record<string, number>;
  },
  effect: EffectDefinition
): void {
  const total = numberField(effect, "totalHealing", 0);
  const allocatedTotal = Object.values(context.allocation).reduce((sum, value) => sum + value, 0);
  if (allocatedTotal !== total) {
    log(state, `${context.ability.name} must allocate exactly ${total} healing.`, "warn");
    return;
  }
  for (const [playerId, amount] of Object.entries(context.allocation)) {
    if (amount > 0) {
      healPlayer(state, content, requirePlayer(state, playerId), amount, context.ability.name);
    }
  }
}

function applyPlayerModifierEffect(
  state: GameState,
  context: {
    player: PlayerRuntime;
    ability: AbilityDefinition;
    targetIds: string[];
  },
  effect: EffectDefinition
): void {
  const stat = stringField(effect, "stat", "acc") as "acc" | "def" | "dmg";
  const amount = numberField(effect, "amount", 0);
  const duration = normalizeDuration(stringField(effect, "duration", "nextAction"));
  const target = stringField(effect, "target", "self");
  const targetPairs: Array<{ kind: "player" | "enemy"; id: string; label: string }> = [];

  if (target === "self") {
    targetPairs.push({ kind: "player", id: context.player.id, label: context.player.name });
  } else if (target === "ally") {
    for (const id of context.targetIds.slice(0, 1)) {
      targetPairs.push({ kind: "player", id, label: requirePlayer(state, id).name });
    }
  } else if (target === "selfAndAlly") {
    targetPairs.push({ kind: "player", id: context.player.id, label: context.player.name });
    for (const id of context.targetIds.slice(0, 1)) {
      targetPairs.push({ kind: "player", id, label: requirePlayer(state, id).name });
    }
  } else if (target === "enemy") {
    for (const id of context.targetIds.slice(0, 1)) {
      targetPairs.push({ kind: "enemy", id, label: requireEnemy(state, id).name });
    }
  }

  for (const targetPair of targetPairs) {
    addModifier(state, {
      id: `mod:${context.player.id}:${context.ability.id}:${targetPair.id}:${state.log.length}`,
      sourceId: context.player.id,
      targetKind: targetPair.kind,
      targetId: targetPair.id,
      stat,
      amount,
      duration,
      remainingTurns: duration === "threeTurns" ? 3 : duration === "oneRound" ? 1 : undefined,
      stacking: stringField(effect, "stacking", "stack") as "stack" | "noStack",
      label: context.ability.name
    });
    log(state, `${targetPair.label} gains ${signed(amount)} ${stat.toUpperCase()} from ${context.ability.name}.`, "good");
  }
}

function resolveEnemyEffect(
  state: GameState,
  content: DungeonContent,
  enemy: EnemyRuntime,
  action: EnemyActionDefinition,
  effect: EffectDefinition
): void {
  const optimizedBonus = enemy.counters.optimizedStacks ?? 0;
  switch (effect.type) {
    case "attackPlayersByPosition":
      attackPlayers(state, content, enemy, action.name, positionsToPlayers(state, stringArrayField(effect, "positions")), numberField(effect, "damage", 0) + optimizedBonus);
      break;
    case "attackAllPlayers":
      attackPlayers(state, content, enemy, action.name, state.selectedPlayers.filter((player) => !player.dead), numberField(effect, "damage", 0) + optimizedBonus);
      break;
    case "attackHighestHpPlayers": {
      const targets = [...state.selectedPlayers]
        .filter((player) => !player.dead)
        .sort((a, b) => b.hp - a.hp)
        .slice(0, numberField(effect, "targetCount", 1));
      attackPlayers(state, content, enemy, action.name, targets, numberField(effect, "damage", 0) + optimizedBonus);
      break;
    }
    case "unblockableDamageAllPlayers":
      for (const player of state.selectedPlayers.filter((candidate) => !candidate.dead)) {
        damagePlayer(state, content, player, numberField(effect, "damage", 0) + optimizedBonus, action.name);
      }
      break;
    case "healSelf":
      healEnemy(state, enemy, numberField(effect, "amount", 0), action.name);
      break;
    case "healEnemiesByTag":
      for (const target of livingEnemies(state).filter((candidate) => candidate.tags.includes(stringField(effect, "tag", "")))) {
        healEnemy(state, target, numberField(effect, "amount", 0), action.name);
      }
      break;
    case "damageEnemy": {
      const target = state.currentRoom?.enemies.find((candidate) => candidate.id === stringField(effect, "enemyId", ""));
      if (target && !target.dead) {
        damageEnemy(state, content, target, numberField(effect, "amount", 0), action.name);
      } else {
        log(state, `${action.name} has no living linked enemy to damage.`, "warn");
      }
      break;
    }
    case "applyModifierToPositions":
      for (const player of positionsToPlayers(state, stringArrayField(effect, "positions"))) {
        addEnemyModifier(state, enemy, player.id, "player", effect, action.name);
      }
      break;
    case "applyModifierAllPlayers":
      for (const player of state.selectedPlayers.filter((candidate) => !candidate.dead)) {
        addEnemyModifier(state, enemy, player.id, "player", effect, action.name);
      }
      break;
    case "applyModifierToLastTargets":
      for (const playerId of state.lastEnemyActionHits) {
        addEnemyModifier(state, enemy, playerId, "player", effect, action.name);
      }
      break;
    case "addCounter": {
      const counter = stringField(effect, "counter", "counter");
      enemy.counters[counter] = (enemy.counters[counter] ?? 0) + numberField(effect, "amount", 1);
      log(state, `${enemy.name} gains ${numberField(effect, "amount", 1)} ${counter}.`, "warn");
      break;
    }
    case "conditionalCounterAttackAllPlayers": {
      const counter = stringField(effect, "counter", "counter");
      const threshold = numberField(effect, "threshold", 1);
      if ((enemy.counters[counter] ?? 0) >= threshold) {
        enemy.counters[counter] -= numberField(effect, "consume", threshold);
        attackPlayers(state, content, enemy, action.name, state.selectedPlayers.filter((player) => !player.dead), numberField(effect, "damage", 0));
      } else {
        log(state, `${enemy.name} needs ${threshold} ${counter} before ${action.name} triggers.`, "normal");
      }
      break;
    }
    case "damageAllPlayersByCounter": {
      const counter = stringField(effect, "counter", "counter");
      const amount = (enemy.counters[counter] ?? 0) * numberField(effect, "damagePerCounter", 1);
      for (const player of state.selectedPlayers.filter((candidate) => !candidate.dead)) {
        damagePlayer(state, content, player, amount, action.name);
      }
      break;
    }
    case "forceDiscardLootIfHit": {
      const target = positionToPlayer(state, stringField(effect, "targetPosition", "A") as PlayerPosition);
      if (target && state.lastEnemyActionHits.includes(target.id) && target.lootIds.length > 0) {
        const lost = target.lootIds[0];
        target.lootIds = removeFirst(target.lootIds, lost);
        state.lootDiscard.push(lost);
        log(state, `${target.name} loses ${requireLoot(content, lost).name}.`, "danger");
      }
      break;
    }
    case "doubleBlockAllPlayers":
      resolveDoubleBlock(state, content, enemy, effect);
      break;
    default:
      log(state, `TODO: ${action.name} has unimplemented effect ${effect.type ?? "unknown"}.`, "warn");
  }
}

function attackPlayers(
  state: GameState,
  content: DungeonContent,
  enemy: EnemyRuntime,
  source: string,
  targets: PlayerRuntime[],
  damage: number
): void {
  const uniqueTargets = new Map<string, PlayerRuntime>();
  for (const target of targets) {
    const redirected = target.dead ? nextLivingPlayer(state, target.position) : target;
    if (redirected && !redirected.dead) {
      uniqueTargets.set(redirected.id, redirected);
    }
  }

  for (const player of uniqueTargets.values()) {
    const stats = getPlayerEffectiveStats(state, content, player);
    const enemyStats = getEnemyEffectiveStats(state, enemy);
    const roll = rollPlayerDie(state, content, player, source);
    const result = checkPlayerBlockRoll(roll, stats.def, enemyStats.acc);
    if (result.success) {
      log(state, `${player.name} blocks ${source}: ${roll} + DEF ${stats.def} = ${result.total} vs ACC ${enemyStats.acc}.`, "good");
    } else {
      log(state, `${player.name} fails to block ${source}: ${roll} + DEF ${stats.def} = ${result.total} vs ACC ${enemyStats.acc}.`, "danger");
      state.lastEnemyActionHits.push(player.id);
      damagePlayer(state, content, player, damage, source);
    }
    spendBlockModifiers(state, player.id);
  }
}

function resolveDoubleBlock(state: GameState, content: DungeonContent, enemy: EnemyRuntime, effect: EffectDefinition): void {
  const damagePerHit = numberField(effect, "damagePerHit", 1);
  for (const player of state.selectedPlayers.filter((candidate) => !candidate.dead)) {
    let failures = 0;
    for (let index = 0; index < 2; index += 1) {
      const stats = getPlayerEffectiveStats(state, content, player);
      const enemyStats = getEnemyEffectiveStats(state, enemy);
      const roll = rollPlayerDie(state, content, player, "Web Sling");
      const result = checkPlayerBlockRoll(roll, stats.def, enemyStats.acc);
      if (!result.success) {
        failures += 1;
      }
    }
    if (failures > 0) {
      damagePlayer(state, content, player, failures * damagePerHit, "Web Sling");
      state.lastEnemyActionHits.push(player.id);
    }
    if (failures === 1) {
      addModifier(state, {
        id: `mod:${enemy.id}:web:${player.id}:${state.log.length}`,
        sourceId: enemy.id,
        targetKind: "player",
        targetId: player.id,
        stat: "acc",
        amount: -1,
        duration: "nextAction",
        label: "Web Sling"
      });
      log(state, `${player.name} is tangled and takes -1 ACC next action.`, "warn");
    } else if (failures >= 2) {
      player.skipNextAction = true;
      log(state, `${player.name} is fully webbed and will skip the next action.`, "danger");
    } else {
      log(state, `${player.name} slips through both webs.`, "good");
    }
  }
}

function addEnemyModifier(
  state: GameState,
  enemy: EnemyRuntime,
  targetId: string,
  targetKind: "player" | "enemy",
  effect: EffectDefinition,
  label: string
): void {
  const stat = stringField(effect, "stat", "acc") as "acc" | "def" | "dmg";
  const amount = numberField(effect, "amount", 0);
  addModifier(state, {
    id: `mod:${enemy.id}:${targetId}:${state.log.length}`,
    sourceId: enemy.id,
    targetKind,
    targetId,
    stat,
    amount,
    duration: normalizeDuration(stringField(effect, "duration", "nextAction")),
    label
  });
  const name = targetKind === "player" ? requirePlayer(state, targetId).name : requireEnemy(state, targetId).name;
  log(state, `${name} takes ${signed(amount)} ${stat.toUpperCase()} from ${label}.`, "warn");
}

function addModifier(state: GameState, modifier: ModifierRuntime): void {
  if (modifier.stacking === "noStack") {
    state.modifiers = state.modifiers.filter((existing) => {
      return !(
        existing.targetKind === modifier.targetKind &&
        existing.targetId === modifier.targetId &&
        existing.stat === modifier.stat &&
        existing.label === modifier.label
      );
    });
  }
  state.modifiers.push(modifier);
}

function spendActionModifiers(state: GameState, targetKind: "player" | "enemy", targetId: string): void {
  state.modifiers = state.modifiers
    .map((modifier) => {
      if (modifier.targetKind !== targetKind || modifier.targetId !== targetId) {
        return modifier;
      }
      if (["nextAction", "nextTurn", "oneTurn"].includes(modifier.duration)) {
        return null;
      }
      if (modifier.duration === "threeTurns") {
        const remainingTurns = (modifier.remainingTurns ?? 3) - 1;
        return remainingTurns > 0 ? { ...modifier, remainingTurns } : null;
      }
      return modifier;
    })
    .filter((modifier): modifier is ModifierRuntime => Boolean(modifier));
}

function spendBlockModifiers(state: GameState, playerId: string): void {
  state.modifiers = state.modifiers.filter((modifier) => {
    return !(modifier.targetKind === "player" && modifier.targetId === playerId && modifier.duration === "nextBlock");
  });
}

function advanceToNextTurn(state: GameState, content: DungeonContent): GameState {
  if (!state.currentRoom || !state.turn) {
    return state;
  }
  advanceOneSlot(state);
  return ensureActiveTurn(state, content);
}

function ensureActiveTurn(state: GameState, content: DungeonContent): GameState {
  if (!state.currentRoom || !state.turn) {
    return state;
  }
  for (let guard = 0; guard < state.currentRoom.turnOrder.length * 2; guard += 1) {
    const turn = getCurrentTurn(state);
    if (!turn) {
      advanceOneSlot(state);
      continue;
    }
    if (turn.kind === "player") {
      const player = turn.player;
      if (!player) {
        advanceOneSlot(state);
        continue;
      }
      if (player.pendingReviveTurns !== null && player.dead) {
        player.pendingReviveTurns -= 1;
        if (player.pendingReviveTurns <= 0) {
          player.dead = false;
          player.pendingReviveTurns = null;
          player.hp = Math.max(1, Math.ceil(effectivePlayerMaxHp(state, content, player) / 2));
          log(state, `${player.name}'s Bonfire brings them back at half HP.`, "good");
        }
        advanceOneSlot(state);
        continue;
      }
      if (player.dead) {
        advanceOneSlot(state);
        continue;
      }
      if (player.skipNextAction) {
        player.skipNextAction = false;
        log(state, `${player.name} skips an action.`, "warn");
        spendActionModifiers(state, "player", player.id);
        advanceOneSlot(state);
        continue;
      }
      return state;
    }

    if (!turn.enemy || turn.enemy.dead) {
      advanceOneSlot(state);
      continue;
    }
    return state;
  }
  checkCombatOutcome(state, content);
  return state;
}

function advanceOneSlot(state: GameState): void {
  if (!state.currentRoom || !state.turn) {
    return;
  }
  state.turn.index = (state.turn.index + 1) % state.currentRoom.turnOrder.length;
  if (state.turn.index === 0) {
    state.turn.round += 1;
    state.modifiers = state.modifiers
      .map((modifier) => {
        if (modifier.duration !== "oneRound") {
          return modifier;
        }
        const remainingTurns = (modifier.remainingTurns ?? 1) - 1;
        return remainingTurns > 0 ? { ...modifier, remainingTurns } : null;
      })
      .filter((modifier): modifier is ModifierRuntime => Boolean(modifier));
  }
}

function tickEnemyDots(state: GameState, content: DungeonContent, enemy: EnemyRuntime): void {
  for (const dot of enemy.dots) {
    damageEnemy(state, content, enemy, dot.damage, "burning damage");
  }
}

function checkCombatOutcome(state: GameState, content: DungeonContent): boolean {
  if (!state.currentRoom) {
    return false;
  }
  if (state.selectedPlayers.every((player) => player.dead)) {
    state.phase = "DEFEAT";
    state.turn = null;
    log(state, "The whole party has fallen.", "danger");
    return true;
  }
  if (state.currentRoom.enemies.every((enemy) => enemy.dead)) {
    completeCombatRoom(state, content);
    return true;
  }
  return false;
}

function completeCombatRoom(state: GameState, content: DungeonContent): void {
  const room = state.currentRoom;
  if (!room) {
    return;
  }
  state.completedRooms.push(room.definitionId);
  state.roomNumber += 1;
  state.currentRoom = null;
  state.turn = null;
  state.modifiers = state.modifiers.filter((modifier) => modifier.duration !== "room");
  for (const player of state.selectedPlayers) {
    if (player.dead) {
      player.dead = false;
      player.pendingReviveTurns = null;
      player.hp = Math.max(1, Math.ceil(effectivePlayerMaxHp(state, content, player) / 2));
      log(state, `${player.name} rises after the room at half HP.`, "good");
    }
    player.oncePerEncounterUsed = [];
    player.usedLootThisRoom = [];
    player.lootedOnDeath = false;
  }
  state.pendingPlayerReroll = null;
  log(state, `${room.name} is complete.`, "good");
  if (room.tier === "BOSS") {
    state.phase = "VICTORY";
    log(state, "Valeria falls. Dungeon Crawl is won!", "good");
    return;
  }
  state.pendingLootReward.push(...drawLoot(state, content, room.lootReward).map((card) => card.id));
  state.phase = "LOOT_REWARD";
}

function completeSpecialRoom(state: GameState, content: DungeonContent): GameState {
  if (state.currentSpecialId) {
    state.completedRooms.push(state.currentSpecialId);
    state.roomNumber += 1;
  }
  state.currentSpecialId = null;
  state.vendor = null;
  state.pendingPlayerReroll = null;
  for (const player of state.selectedPlayers) {
    player.usedLootThisRoom = [];
    player.lootedOnDeath = false;
  }
  if (state.pendingLootReward.length > 0) {
    state.phase = "LOOT_REWARD";
    return state;
  }
  return revealNextRoom(state, content);
}

function damageEnemy(
  state: GameState,
  content: DungeonContent,
  enemy: EnemyRuntime,
  amount: number,
  source: string
): void {
  if (enemy.dead || amount <= 0) {
    return;
  }
  enemy.hp = Math.max(0, enemy.hp - amount);
  log(state, `${enemy.name} takes ${amount} damage from ${source}.`, "danger");
  if (enemy.hp <= 0) {
    enemy.dead = true;
    log(state, `${enemy.name} is defeated.`, "good");
    for (const passive of enemy.passives) {
      if (passive.type === "onDeathDamageAllPlayers" && !enemy.passiveTriggered.includes(passive.type)) {
        enemy.passiveTriggered.push(passive.type);
        const damage = numberField(passive, "damage", 0);
        for (const player of state.selectedPlayers.filter((candidate) => !candidate.dead)) {
          damagePlayer(state, content, player, damage, `${enemy.name}'s death burst`);
        }
      }
    }
  }
}

function damagePlayer(
  state: GameState,
  content: DungeonContent,
  player: PlayerRuntime,
  amount: number,
  source: string
): void {
  if (player.dead || amount <= 0) {
    return;
  }
  player.hp = Math.max(0, player.hp - amount);
  log(state, `${player.name} takes ${amount} damage from ${source}.`, "danger");
  if (player.hp <= 0) {
    player.dead = true;
    log(state, `${player.name} falls.`, "danger");
    if (!player.lootedOnDeath && player.lootIds.length > 0) {
      state.lootDeck.push(...player.lootIds);
      player.lootIds = [];
      player.lootedOnDeath = true;
      log(state, `${player.name}'s loot returns to the bottom of the deck.`, "warn");
    }
    const character = requireCharacter(content, player.characterId);
    if (character.abilities.some((ability) => ability.effects.some((effect) => effect.type === "passiveRevive"))) {
      player.pendingReviveTurns = 1;
      log(state, `${player.name}'s Bonfire will revive them after one skipped turn.`, "warn");
    }
  }
}

function healPlayer(
  state: GameState,
  content: DungeonContent,
  player: PlayerRuntime,
  amount: number,
  source: string
): void {
  if (player.dead || amount <= 0) {
    return;
  }
  const maxHp = effectivePlayerMaxHp(state, content, player);
  const before = player.hp;
  player.hp = Math.min(maxHp, player.hp + amount);
  log(state, `${player.name} heals ${player.hp - before} HP from ${source}.`, "good");
}

function healEnemy(state: GameState, enemy: EnemyRuntime, amount: number, source: string): void {
  if (enemy.dead || amount <= 0) {
    return;
  }
  const before = enemy.hp;
  enemy.hp = Math.min(enemy.maxHp, enemy.hp + amount);
  log(state, `${enemy.name} heals ${enemy.hp - before} HP from ${source}.`, "good");
}

function drawLoot(state: GameState, content: DungeonContent, count: number): LootCardDefinition[] {
  const drawn: LootCardDefinition[] = [];
  for (let index = 0; index < count; index += 1) {
    const card = drawOneLoot(state, content);
    if (!card) {
      break;
    }
    drawn.push(card);
  }
  if (drawn.length > 0) {
    log(state, `Drew loot: ${drawn.map((card) => card.name).join(", ")}.`, "good");
  }
  return drawn;
}

function drawOneLoot(state: GameState, content: DungeonContent): LootCardDefinition | null {
  if (state.lootDeck.length === 0 && state.lootDiscard.length > 0) {
    const shuffled = shuffleWithState(state.lootDiscard, state.rngState);
    state.rngState = shuffled.state;
    state.lootDeck = shuffled.items;
    state.lootDiscard = [];
  }
  const lootId = state.lootDeck.shift();
  return lootId ? requireLoot(content, lootId) : null;
}

function prepareVendor(state: GameState, content: DungeonContent): void {
  const drawIds = drawLoot(state, content, 4).map((card) => card.id);
  state.vendor = {
    drawIds,
    selectedPaymentIds: [],
    selectedTakeId: null,
    selectedRecipientId: null
  };
}

function rollD6(state: GameState): number {
  const result = randomInt(state.rngState, 1, 6);
  state.rngState = result.state;
  return result.value;
}

function rollPlayerDie(state: GameState, content: DungeonContent, player: PlayerRuntime, source: string): number {
  const first = rollD6(state);
  if (state.pendingPlayerReroll?.playerId !== player.id) {
    return first;
  }
  const lootId = state.pendingPlayerReroll.lootId;
  const second = rollD6(state);
  log(state, `${player.name} uses ${requireLoot(content, lootId).name} on ${source}: ${first} -> ${second}.`, "good");
  state.pendingPlayerReroll = null;
  return second;
}

function effectivePlayerMaxHp(state: GameState, content: DungeonContent, player: PlayerRuntime): number {
  return Math.min(
    content.config.maxHpCap,
    player.maxHp + statBonusFromLoot(player, content.starterLoot, "maxHp")
  );
}

function clampPlayerHp(state: GameState, content: DungeonContent, player: PlayerRuntime): void {
  player.hp = Math.min(player.hp, effectivePlayerMaxHp(state, content, player));
}

function positionsToPlayers(state: GameState, positions: string[]): PlayerRuntime[] {
  return positions
    .map((position) => positionToPlayer(state, position as PlayerPosition))
    .filter((player): player is PlayerRuntime => Boolean(player));
}

function positionToPlayer(state: GameState, position: PlayerPosition): PlayerRuntime | null {
  return state.selectedPlayers.find((player) => player.position === position) ?? null;
}

function nextLivingPlayer(state: GameState, afterPosition?: PlayerPosition): PlayerRuntime | null {
  const start = Math.max(0, POSITIONS.indexOf(afterPosition ?? "A"));
  const ordered = [...POSITIONS.slice(start + 1), ...POSITIONS.slice(0, start + 1)];
  for (const position of ordered) {
    const player = positionToPlayer(state, position);
    if (player && !player.dead) {
      return player;
    }
  }
  return null;
}

function livingEnemies(state: GameState): EnemyRuntime[] {
  return state.currentRoom?.enemies.filter((enemy) => !enemy.dead) ?? [];
}

function requireCharacter(content: DungeonContent, characterId: string) {
  const character = content.characters.find((candidate) => candidate.id === characterId);
  if (!character) {
    throw new Error(`Unknown character: ${characterId}`);
  }
  return character;
}

function requireAbility(abilities: AbilityDefinition[], abilityId: string): AbilityDefinition {
  const ability = abilities.find((candidate) => candidate.id === abilityId);
  if (!ability) {
    throw new Error(`Unknown ability: ${abilityId}`);
  }
  return ability;
}

function requireRoom(content: DungeonContent, roomId: string): CombatRoomDefinition {
  const room = content.rooms.find((candidate) => candidate.id === roomId);
  if (!room) {
    throw new Error(`Unknown room: ${roomId}`);
  }
  return room;
}

function requireSpecialRoom(content: DungeonContent, roomId: string): SpecialRoomDefinition {
  const room = content.specialRooms.find((candidate) => candidate.id === roomId);
  if (!room) {
    throw new Error(`Unknown special room: ${roomId}`);
  }
  return room;
}

function requireLoot(content: DungeonContent, lootId: string): LootCardDefinition {
  const loot = content.starterLoot.find((candidate) => candidate.id === lootId);
  if (!loot) {
    throw new Error(`Unknown loot: ${lootId}`);
  }
  return loot;
}

function requirePlayer(state: GameState, playerId: string): PlayerRuntime {
  const player = state.selectedPlayers.find((candidate) => candidate.id === playerId);
  if (!player) {
    throw new Error(`Unknown player: ${playerId}`);
  }
  return player;
}

function requireEnemy(state: GameState, enemyId: string): EnemyRuntime {
  const enemy = state.currentRoom?.enemies.find((candidate) => candidate.id === enemyId);
  if (!enemy) {
    throw new Error(`Unknown enemy: ${enemyId}`);
  }
  return enemy;
}

function log(state: GameState, text: string, tone: LogTone = "normal"): void {
  const entry: GameLogEntry = {
    id: `${state.log.length + 1}-${Math.abs(hashSeed(text)).toString(36)}`,
    text,
    tone
  };
  state.log.push(entry);
  state.log = state.log.slice(-120);
}

function removeFirst(items: string[], item: string): string[] {
  const index = items.indexOf(item);
  if (index === -1) {
    return items;
  }
  return [...items.slice(0, index), ...items.slice(index + 1)];
}

function numberField(record: Record<string, unknown>, key: string, fallback: number): number {
  const value = record[key];
  return typeof value === "number" ? value : fallback;
}

function stringField(record: Record<string, unknown>, key: string, fallback: string): string {
  const value = record[key];
  return typeof value === "string" ? value : fallback;
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function booleanField(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true;
}

function normalizeDuration(value: string): ModifierRuntime["duration"] {
  if (value === "targetNextAction") {
    return "nextAction";
  }
  if (value === "nextTurn") {
    return "nextTurn";
  }
  if (value === "oneTurn" || value === "oneRound" || value === "threeTurns" || value === "room") {
    return value;
  }
  return "nextAction";
}

function signed(amount: number): string {
  return amount >= 0 ? `+${amount}` : `${amount}`;
}
