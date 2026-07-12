import type {
  EffectiveEnemyStats,
  EffectivePlayerStats,
  EnemyRuntime,
  GameState,
  PlayerPosition,
  PlayerRuntime,
  TimedModifier,
} from "./types";
import { PLAYER_POSITIONS } from "./types";

export interface RollResolution {
  roll: number;
  modifier: number;
  total: number;
  target: number;
  success: boolean;
  natural: "criticalFailure" | "criticalSuccess" | null;
}

export function resolvePlayerAttackRoll(
  roll: number,
  accuracy: number,
  enemyDefense: number,
  abilityAccuracyModifier = 0,
): RollResolution {
  assertD6(roll);
  const modifier = accuracy + abilityAccuracyModifier;
  const total = roll + modifier;
  const natural = roll === 1 ? "criticalFailure" : roll === 6 ? "criticalSuccess" : null;
  return {
    roll,
    modifier,
    total,
    target: enemyDefense,
    success: roll === 6 || (roll !== 1 && total >= enemyDefense),
    natural,
  };
}

export function resolvePlayerBlockRoll(
  roll: number,
  playerDefense: number,
  enemyAccuracy: number,
): RollResolution {
  assertD6(roll);
  const total = roll + playerDefense;
  const natural = roll === 1 ? "criticalFailure" : roll === 6 ? "criticalSuccess" : null;
  return {
    roll,
    modifier: playerDefense,
    total,
    target: enemyAccuracy,
    success: roll === 6 || (roll !== 1 && total >= enemyAccuracy),
    natural,
  };
}

export function assertD6(roll: number): void {
  if (!Number.isInteger(roll) || roll < 1 || roll > 6) {
    throw new Error(`Expected a d6 roll from 1 through 6; received ${roll}.`);
  }
}

function modifierTotal(modifiers: TimedModifier[], targetId: string, stat: "acc" | "def" | "dmg"): number {
  return modifiers
    .filter((modifier) => modifier.targetId === targetId && modifier.stat === stat)
    .reduce((total, modifier) => total + modifier.amount, 0);
}

export function getEffectivePlayerStats(
  state: Pick<GameState, "modifiers" | "content">,
  player: PlayerRuntime,
): EffectivePlayerStats {
  const equipped = player.inventory.filter((card) => player.equippedLootIds.includes(card.instanceId));
  const equipmentBonus = equipped.reduce(
    (totals, card) => ({
      maxHp: totals.maxHp + (card.statBonus?.maxHp ?? 0),
      acc: totals.acc + (card.statBonus?.acc ?? 0),
      def: totals.def + (card.statBonus?.def ?? 0),
      dmg: totals.dmg + (card.statBonus?.dmg ?? 0),
    }),
    { maxHp: 0, acc: 0, def: 0, dmg: 0 },
  );
  return {
    maxHp: Math.min(state.content.config.maxHpCap, player.baseMaxHp + equipmentBonus.maxHp),
    acc: player.baseAcc + equipmentBonus.acc + modifierTotal(state.modifiers, player.id, "acc"),
    def: player.baseDef + equipmentBonus.def + modifierTotal(state.modifiers, player.id, "def"),
    dmg: equipmentBonus.dmg + modifierTotal(state.modifiers, player.id, "dmg"),
  };
}

export function getEffectiveEnemyStats(
  state: Pick<GameState, "modifiers">,
  enemy: EnemyRuntime,
): EffectiveEnemyStats {
  return {
    acc: enemy.baseAcc + modifierTotal(state.modifiers, enemy.id, "acc"),
    def: enemy.baseDef + modifierTotal(state.modifiers, enemy.id, "def"),
    // Mechanical Golem's Optimize explicitly makes the counter future bonus damage.
    dmg: enemy.counters.optimizedStacks ?? 0,
  };
}

export function getLivingPlayers(state: Pick<GameState, "players">): PlayerRuntime[] {
  return state.players.filter((player) => !player.isDead && player.hp > 0);
}

export function isEnemyTargetable(enemy: EnemyRuntime, enemies: EnemyRuntime[]): boolean {
  if (enemy.isDead || enemy.hp <= 0) return false;
  const protectedUntilLast = enemy.passives.some(({ type }) => type === "untargetableUntilOthersDead");
  if (!protectedUntilLast) return true;
  return !enemies.some((other) => other.id !== enemy.id && !other.isDead && other.hp > 0);
}

export function getTargetableEnemies(
  state: Pick<GameState, "currentRoom">,
): EnemyRuntime[] {
  if (!state.currentRoom || state.currentRoom.type !== "combat") return [];
  return state.currentRoom.enemies.filter((enemy) => isEnemyTargetable(enemy, state.currentRoom!.type === "combat" ? state.currentRoom!.enemies : []));
}

export function isCombatRoomComplete(state: Pick<GameState, "currentRoom">): boolean {
  return Boolean(
    state.currentRoom?.type === "combat" &&
      state.currentRoom.enemies.length > 0 &&
      state.currentRoom.enemies.every((enemy) => enemy.isDead || enemy.hp <= 0),
  );
}

export function isPartyDefeated(state: Pick<GameState, "players">): boolean {
  return state.players.length > 0 && state.players.every((player) => player.isDead || player.hp <= 0);
}

export function healPlayer(player: PlayerRuntime, amount: number): PlayerRuntime {
  if (amount <= 0 || player.isDead) return player;
  return { ...player, hp: Math.min(player.maxHp, player.hp + amount) };
}

export function damagePlayer(player: PlayerRuntime, amount: number): PlayerRuntime {
  if (amount <= 0 || player.isDead) return player;
  const hp = Math.max(0, player.hp - amount);
  return { ...player, hp, isDead: hp === 0 };
}

export function healEnemy(enemy: EnemyRuntime, amount: number): EnemyRuntime {
  if (amount <= 0 || enemy.isDead) return enemy;
  return { ...enemy, hp: Math.min(enemy.maxHp, enemy.hp + amount) };
}

export function damageEnemy(enemy: EnemyRuntime, amount: number): EnemyRuntime {
  if (amount <= 0 || enemy.isDead) return enemy;
  const hp = Math.max(0, enemy.hp - amount);
  return { ...enemy, hp, isDead: hp === 0 };
}

/**
 * Resolve position targets in table order. Dead/already-targeted positions move
 * clockwise to the next living untargeted player, preventing all-player and
 * multi-position attacks from double-hitting a redirected character.
 */
export function resolvePositionTargets(
  players: PlayerRuntime[],
  positions: PlayerPosition[],
): PlayerRuntime[] {
  const used = new Set<string>();
  const targets: PlayerRuntime[] = [];
  for (const position of positions) {
    const startingIndex = PLAYER_POSITIONS.indexOf(position);
    for (let offset = 0; offset < PLAYER_POSITIONS.length; offset += 1) {
      const candidatePosition = PLAYER_POSITIONS[(startingIndex + offset) % PLAYER_POSITIONS.length];
      const candidate = players.find(
        (player) => player.position === candidatePosition && !player.isDead && player.hp > 0 && !used.has(player.id),
      );
      if (!candidate) continue;
      used.add(candidate.id);
      targets.push(candidate);
      break;
    }
  }
  return targets;
}

export function clampAllocation(
  allocation: Record<string, number> | undefined,
  allowedIds: Set<string>,
  maximum: number,
): Record<string, number> | null {
  if (!allocation) return null;
  const entries = Object.entries(allocation);
  if (
    entries.length === 0 ||
    entries.some(([id, amount]) => !allowedIds.has(id) || !Number.isInteger(amount) || amount < 0) ||
    entries.reduce((sum, [, amount]) => sum + amount, 0) > maximum
  ) {
    return null;
  }
  return Object.fromEntries(entries.filter(([, amount]) => amount > 0));
}
