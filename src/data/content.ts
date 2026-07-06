import seed from "./dungeon_crawl_seed_content.json";
import type { DungeonContent } from "../game/types";

function assertArray(value: unknown, label: string): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Dungeon content is missing ${label}.`);
  }
}

function validateDungeonContent(value: unknown): DungeonContent {
  if (!value || typeof value !== "object") {
    throw new Error("Dungeon content failed to load.");
  }

  const content = value as DungeonContent;
  assertArray(content.characters, "characters");
  assertArray(content.rooms, "rooms");
  assertArray(content.specialRooms, "specialRooms");
  assertArray(content.starterLoot, "starterLoot");

  if (!content.config || content.config.partySize !== 4) {
    throw new Error("Dungeon content must define a partySize of 4.");
  }

  if (!content.rooms.some((room) => room.tier === "BOSS")) {
    throw new Error("Dungeon content must include a boss room.");
  }

  return content;
}

export const dungeonCrawlContent = validateDungeonContent(seed);
export const characters = dungeonCrawlContent.characters;
export const rooms = dungeonCrawlContent.rooms;
export const specialRooms = dungeonCrawlContent.specialRooms;
export const starterLoot = dungeonCrawlContent.starterLoot;
