import seed from "../../dungeon_crawl_seed_content.json";
import type {
  CharacterDefinition,
  CombatRoomDefinition,
  DungeonCrawlContent,
  EffectDefinition,
  LootCardDefinition,
  RoomTier,
  SpecialRoomDefinition,
} from "../game/types";

type UnnormalizedContent = Omit<DungeonCrawlContent, "specialRooms"> & {
  specialRooms: Array<Omit<SpecialRoomDefinition, "tier" | "lootReward">>;
};

const raw = seed as unknown as UnnormalizedContent;

export const SUPPORTED_EFFECT_TYPES: ReadonlySet<string> = new Set([
  "addCounter",
  "applyDot",
  "applyModifier",
  "applyModifierAllPlayers",
  "applyModifierToLastTargets",
  "applyModifierToPositions",
  "attackAllPlayers",
  "attackEnemies",
  "attackEnemy",
  "attackHighestHpPlayers",
  "attackPlayersByPosition",
  "conditionalCounterAttackAllPlayers",
  "damageAllPlayersByCounter",
  "damageEnemy",
  "doubleBlockAllPlayers",
  "forceDiscardLootIfHit",
  "healAllAllies",
  "healAlly",
  "healEnemiesByTag",
  "healPartyToMax",
  "healSelf",
  "increaseAbilityDamage",
  "onDeathDamageAllPlayers",
  "passiveRevive",
  "reactionModifier",
  "rerollOncePerRoom",
  "returnToBottomOfLootDeck",
  "skipNextAction",
  "splitDamage",
  "splitHeal",
  "unblockableDamageAllPlayers",
  "untargetableUntilOthersDead",
  "vendorTrade",
  "witchPotionTrade",
]);

/**
 * Special rooms in the source JSON predate the common RoomDefinition shape.
 * Normalize them once at the data boundary so the engine never needs to guess.
 */
export const dungeonCrawlContent: DungeonCrawlContent = {
  ...raw,
  config: {
    ...raw.config,
    playDeckRecipe: [...raw.config.playDeckRecipe] as RoomTier[],
  },
  characters: raw.characters as CharacterDefinition[],
  rooms: raw.rooms as CombatRoomDefinition[],
  specialRooms: raw.specialRooms.map((room) => ({
    ...room,
    tier: "SPECIAL" as const,
    lootReward: 0 as const,
  })),
  starterLoot: raw.starterLoot as LootCardDefinition[],
};

export function validateDungeonCrawlContent(content: DungeonCrawlContent): void {
  const duplicateIds = (ids: string[]): string[] =>
    ids.filter((id, index) => ids.indexOf(id) !== index);

  if (content.config.partySize !== 4) {
    throw new Error(`Dungeon Crawl requires a four-character party; received ${content.config.partySize}.`);
  }
  if (content.characters.length < content.config.partySize) {
    throw new Error("Seed content does not contain enough characters to form a party.");
  }
  if (content.rooms.filter((room) => room.tier === "A").length < 2) {
    throw new Error("Seed content requires at least two A-tier combat rooms.");
  }
  if (content.rooms.filter((room) => room.tier === "B").length < 2) {
    throw new Error("Seed content requires at least two B-tier combat rooms.");
  }
  if (!content.rooms.some((room) => room.tier === "BOSS")) {
    throw new Error("Seed content requires a boss room.");
  }
  if (content.specialRooms.length === 0 || content.starterLoot.length === 0) {
    throw new Error("Seed content requires special rooms and starter loot.");
  }

  const contentIds = [
    ...content.characters.map(({ id }) => id),
    ...content.rooms.map(({ id }) => id),
    ...content.specialRooms.map(({ id }) => id),
    ...content.starterLoot.map(({ id }) => id),
  ];
  const duplicates = duplicateIds(contentIds);
  if (duplicates.length > 0) {
    throw new Error(`Duplicate top-level content ids: ${[...new Set(duplicates)].join(", ")}.`);
  }

  for (const room of content.rooms) {
    if (room.type !== "combat" || room.enemies.length === 0 || room.turnOrder.length === 0) {
      throw new Error(`Combat room ${room.id} is missing enemies or a turn order.`);
    }
    const enemyIds = room.enemies.map(({ id }) => id);
    const duplicateEnemyIds = duplicateIds(enemyIds);
    if (duplicateEnemyIds.length > 0) {
      throw new Error(`Combat room ${room.id} has duplicate enemy ids: ${[...new Set(duplicateEnemyIds)].join(", ")}.`);
    }
    for (const slot of room.turnOrder) {
      const [actorType, actorId, actionId] = slot.split(":");
      if (actorType === "player") {
        if (!(["A", "B", "C", "D"] as string[]).includes(actorId) || actionId !== undefined) {
          throw new Error(`Combat room ${room.id} has invalid player turn slot ${slot}.`);
        }
        continue;
      }
      const enemy = room.enemies.find(({ id }) => id === actorId);
      if (actorType !== "enemy" || !enemy || !enemy.actions.some(({ id }) => id === actionId)) {
        throw new Error(`Combat room ${room.id} has unresolved enemy turn slot ${slot}.`);
      }
    }
  }

  const visitEffect = (effect: EffectDefinition, source: string): void => {
    if (effect.type && !SUPPORTED_EFFECT_TYPES.has(effect.type)) {
      throw new Error(`Unsupported effect type ${effect.type} in ${source}.`);
    }
    for (const nested of [...(effect.onOneHit ?? []), ...(effect.onTwoHits ?? [])]) visitEffect(nested, source);
  };
  for (const character of content.characters) {
    for (const ability of character.abilities) {
      for (const effect of ability.effects) visitEffect(effect, `${character.id}/${ability.id}`);
    }
  }
  for (const room of content.rooms) {
    for (const enemy of room.enemies) {
      for (const passive of enemy.passives ?? []) visitEffect(passive, `${room.id}/${enemy.id}/passive`);
      for (const action of enemy.actions) {
        for (const effect of action.effects) visitEffect(effect, `${room.id}/${enemy.id}/${action.id}`);
      }
    }
  }
  for (const room of content.specialRooms) {
    for (const effect of room.effects) visitEffect(effect, room.id);
  }
  for (const loot of content.starterLoot) {
    for (const effect of loot.effects ?? []) visitEffect(effect, loot.id);
  }
}

validateDungeonCrawlContent(dungeonCrawlContent);

export const characters = dungeonCrawlContent.characters;
export const rooms = dungeonCrawlContent.rooms;
export const specialRooms = dungeonCrawlContent.specialRooms;
export const starterLoot = dungeonCrawlContent.starterLoot;

export function findCharacter(characterId: string): CharacterDefinition | undefined {
  return characters.find(({ id }) => id === characterId);
}
