import type { GameState } from "./types";

export const SAVE_KEY = "dungeon-crawl-save-v1";

export function saveGame(state: GameState): void {
  if (state.phase === "TITLE") {
    return;
  }
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
}

export function loadGame(): GameState | null {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) {
    return null;
  }
  try {
    return normalizeSave(JSON.parse(raw) as GameState);
  } catch {
    localStorage.removeItem(SAVE_KEY);
    return null;
  }
}

export function hasSaveGame(): boolean {
  return Boolean(localStorage.getItem(SAVE_KEY));
}

export function clearSaveGame(): void {
  localStorage.removeItem(SAVE_KEY);
}

function normalizeSave(state: GameState): GameState {
  state.vendor ??= null;
  state.pendingPlayerReroll ??= null;
  state.lastEnemyActionHits ??= [];
  state.modifiers ??= [];
  state.pendingLootReward ??= [];
  state.lootDiscard ??= [];
  state.selectedPlayers = (state.selectedPlayers ?? []).map((player) => ({
    ...player,
    lootIds: player.lootIds ?? [],
    abilityTokens: player.abilityTokens ?? 0,
    lootedOnDeath: player.lootedOnDeath ?? false,
    skipNextAction: player.skipNextAction ?? false,
    pendingReviveTurns: player.pendingReviveTurns ?? null,
    oncePerEncounterUsed: player.oncePerEncounterUsed ?? [],
    usedLootThisRoom: player.usedLootThisRoom ?? [],
    abilityDamageBonusById: player.abilityDamageBonusById ?? {}
  }));
  return state;
}
