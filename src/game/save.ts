import { dungeonCrawlContent } from "../data/content";
import type { DungeonCrawlContent, GameState, RoomDefinition } from "./types";

export const SAVE_VERSION = 1 as const;
export const SAVE_KEY = "dungeon-crawl-save-v1";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface SaveEnvelopeV1 {
  saveVersion: typeof SAVE_VERSION;
  state: GameState;
}

function browserStorage(): StorageLike | null {
  return typeof globalThis !== "undefined" && "localStorage" in globalThis
    ? (globalThis.localStorage as StorageLike)
    : null;
}

function currentDefinition(content: DungeonCrawlContent, saved: RoomDefinition): RoomDefinition {
  return (
    content.rooms.find(({ id }) => id === saved.id) ??
    content.specialRooms.find(({ id }) => id === saved.id) ??
    saved
  );
}

export function serializeGame(state: GameState): string {
  const envelope: SaveEnvelopeV1 = { saveVersion: SAVE_VERSION, state };
  return JSON.stringify(envelope);
}

export function deserializeGame(
  serialized: string,
  content: DungeonCrawlContent = dungeonCrawlContent,
): GameState {
  const parsed = JSON.parse(serialized) as Partial<SaveEnvelopeV1>;
  if (parsed.saveVersion !== SAVE_VERSION) {
    throw new Error(`Unsupported Dungeon Crawl save version: ${String(parsed.saveVersion)}.`);
  }
  const state = parsed.state;
  if (
    !state ||
    state.stateVersion !== 1 ||
    !Array.isArray(state.players) ||
    !Array.isArray(state.playDeck) ||
    !Array.isArray(state.log) ||
    typeof state.phase !== "string"
  ) {
    throw new Error("Dungeon Crawl save data is incomplete or corrupt.");
  }
  return {
    ...state,
    content,
    playDeck: state.playDeck.map((room) => currentDefinition(content, room)),
    pendingLootRecipientIds: state.pendingLootRecipientIds ?? null,
  };
}

export function saveGame(state: GameState, storage: StorageLike | null = browserStorage()): boolean {
  if (!storage) return false;
  storage.setItem(SAVE_KEY, serializeGame(state));
  return true;
}

export function loadGame(
  storage: StorageLike | null = browserStorage(),
  content: DungeonCrawlContent = dungeonCrawlContent,
): GameState | null {
  const serialized = storage?.getItem(SAVE_KEY);
  if (!serialized) return null;
  try {
    return deserializeGame(serialized, content);
  } catch {
    return null;
  }
}

export function hasSavedGame(storage: StorageLike | null = browserStorage()): boolean {
  return Boolean(storage?.getItem(SAVE_KEY));
}

export function clearSavedGame(storage: StorageLike | null = browserStorage()): void {
  storage?.removeItem(SAVE_KEY);
}
