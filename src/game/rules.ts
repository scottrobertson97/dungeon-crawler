import type { LootCardDefinition, ModifierRuntime, PlayerRuntime, StatName } from "./types";

export type RollResult = {
  roll: number;
  total: number;
  success: boolean;
  reason: "natural-1" | "natural-6" | "tie-or-better" | "below-target";
};

export function checkPlayerAttackRoll(
  roll: number,
  playerAcc: number,
  enemyDef: number,
  abilityAccuracyModifier = 0
): RollResult {
  const total = roll + playerAcc + abilityAccuracyModifier;
  if (roll === 1) {
    return { roll, total, success: false, reason: "natural-1" };
  }
  if (roll === 6) {
    return { roll, total, success: true, reason: "natural-6" };
  }
  return {
    roll,
    total,
    success: total >= enemyDef,
    reason: total >= enemyDef ? "tie-or-better" : "below-target"
  };
}

export function checkPlayerBlockRoll(roll: number, playerDef: number, enemyAcc: number): RollResult {
  const total = roll + playerDef;
  if (roll === 1) {
    return { roll, total, success: false, reason: "natural-1" };
  }
  if (roll === 6) {
    return { roll, total, success: true, reason: "natural-6" };
  }
  return {
    roll,
    total,
    success: total >= enemyAcc,
    reason: total >= enemyAcc ? "tie-or-better" : "below-target"
  };
}

export function statBonusFromLoot(
  player: PlayerRuntime,
  loot: LootCardDefinition[],
  stat: StatName
): number {
  const lootById = new Map(loot.map((card) => [card.id, card]));
  return player.lootIds.reduce((sum, lootId) => {
    const card = lootById.get(lootId);
    return sum + (card?.statBonus?.[stat] ?? 0);
  }, 0);
}

export function statBonusFromModifiers(
  modifiers: ModifierRuntime[],
  targetKind: "player" | "enemy",
  targetId: string,
  stat: "acc" | "def" | "dmg"
): number {
  return modifiers
    .filter((modifier) => {
      return modifier.targetKind === targetKind && modifier.targetId === targetId && modifier.stat === stat;
    })
    .reduce((sum, modifier) => sum + modifier.amount, 0);
}
