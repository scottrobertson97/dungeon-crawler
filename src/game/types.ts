export type PlayerPosition = "A" | "B" | "C" | "D";

export const PLAYER_POSITIONS: readonly PlayerPosition[] = ["A", "B", "C", "D"];

export type RoomTier = "A" | "B" | "BOSS" | "SPECIAL";
export type GamePhase =
  | "TITLE"
  | "PARTY_SELECT"
  | "POSITION_ASSIGNMENT"
  | "ROOM_REVEAL"
  | "COMBAT"
  | "LOOT_REWARD"
  | "SPECIAL_ROOM"
  | "VICTORY"
  | "DEFEAT";

export type StatName = "acc" | "def" | "dmg";
export type LootKind = "equipment" | "consumable" | "item";

export type EffectType =
  | "attackEnemy"
  | "attackEnemies"
  | "attackAllPlayers"
  | "attackPlayersByPosition"
  | "attackHighestHpPlayers"
  | "doubleBlockAllPlayers"
  | "unblockableDamageAllPlayers"
  | "damageAllPlayersByCounter"
  | "damageEnemy"
  | "splitDamage"
  | "healSelf"
  | "healAlly"
  | "healAllAllies"
  | "splitHeal"
  | "healEnemiesByTag"
  | "healPartyToMax"
  | "applyModifier"
  | "applyModifierToPositions"
  | "applyModifierAllPlayers"
  | "applyModifierToLastTargets"
  | "applyDot"
  | "addCounter"
  | "conditionalCounterAttackAllPlayers"
  | "forceDiscardLootIfHit"
  | "increaseAbilityDamage"
  | "skipNextAction"
  | "untargetableUntilOthersDead"
  | "onDeathDamageAllPlayers"
  | "passiveRevive"
  | "vendorTrade"
  | "witchPotionTrade"
  | "returnToBottomOfLootDeck"
  | "rerollOncePerRoom"
  | "reactionModifier";

/**
 * The seed is deliberately data-driven. Known fields are typed for engine use,
 * while the index signature lets future seed content fail gracefully in the
 * effect dispatcher instead of failing to load.
 */
export interface EffectDefinition {
  type?: EffectType | (string & {});
  target?: string;
  targetCount?: number;
  targetPosition?: PlayerPosition;
  positions?: PlayerPosition[];
  targetCountLimit?: number;
  enemyId?: string;
  abilityId?: string;
  stat?: StatName;
  amount?: number;
  damage?: number;
  totalDamage?: number;
  totalHealing?: number;
  accuracyModifier?: number;
  duration?: string;
  timing?: string;
  stacking?: "stack" | "noStack";
  oncePerEncounter?: boolean;
  maxDamage?: number;
  counter?: string;
  threshold?: number;
  consume?: number;
  damagePerCounter?: number;
  damagePerHit?: number;
  onOneHit?: EffectDefinition[];
  onTwoHits?: EffectDefinition[];
  delayTurns?: number;
  tag?: string;
  drawCount?: number;
  drawUntilTag?: string;
  hpCost?: number;
  tradeCost?: { lootCards: number };
  usesPerRoom?: number;
  roll?: number[];
  name?: string;
  rawText?: string;
  [key: string]: unknown;
}

export interface StatDefinition {
  maxHp: number;
  acc: number;
  def: number;
}

export interface AbilityDefinition {
  id: string;
  name: string;
  rawText: string;
  effects: EffectDefinition[];
  implementationNotes?: string;
}

export interface CharacterDefinition {
  id: string;
  name: string;
  role?: string;
  stats: StatDefinition;
  abilities: AbilityDefinition[];
}

export interface EnemyActionDefinition {
  id: string;
  name: string;
  rawText: string;
  effects: EffectDefinition[];
  implementationNotes?: string;
}

export interface EnemyDefinition {
  id: string;
  name: string;
  stats: StatDefinition;
  actions: EnemyActionDefinition[];
  passives?: EffectDefinition[];
  counters?: Record<string, number>;
}

export interface CombatRoomDefinition {
  id: string;
  name: string;
  tier: Exclude<RoomTier, "SPECIAL">;
  type: "combat";
  lootReward: number;
  turnOrder: string[];
  enemies: EnemyDefinition[];
  sourceNote?: string;
}

export interface SpecialRoomDefinition {
  id: string;
  name: string;
  tier: "SPECIAL";
  type: "special";
  lootReward: 0;
  rawText: string;
  effects: EffectDefinition[];
  implementationNotes?: string;
}

export type RoomDefinition = CombatRoomDefinition | SpecialRoomDefinition;

export interface LootStatBonus {
  maxHp?: number;
  acc?: number;
  def?: number;
  dmg?: number;
}

export interface LootCardDefinition {
  id: string;
  name: string;
  kind: LootKind;
  rawText: string;
  tags?: string[];
  statBonus?: LootStatBonus;
  effects?: EffectDefinition[];
}

export interface DungeonCrawlContent {
  metadata: {
    gameTitle: string;
    sourceNotes: string[];
    assumptions: string[];
  };
  config: {
    partySize: number;
    maxHpCap: number;
    dice: { combatDie: string };
    playDeckRecipe: RoomTier[];
  };
  characters: CharacterDefinition[];
  rooms: CombatRoomDefinition[];
  specialRooms: SpecialRoomDefinition[];
  starterLoot: LootCardDefinition[];
}

export interface RngState {
  seed: string;
  state: number;
  draws: number;
}

export interface AbilityRuntimeState {
  usedThisEncounter?: boolean;
  damageBonus?: number;
}

export interface PlayerRuntime {
  id: string;
  characterId: string;
  name: string;
  role?: string;
  position: PlayerPosition | null;
  hp: number;
  maxHp: number;
  baseMaxHp: number;
  baseAcc: number;
  baseDef: number;
  isDead: boolean;
  inventory: LootCardRuntime[];
  equippedLootIds: string[];
  abilities: AbilityDefinition[];
  abilityState: Record<string, AbilityRuntimeState>;
  abilityTokens: number;
  skipActions: number;
  pendingReviveTurns: number | null;
}

export interface EnemyRuntime {
  id: string;
  definitionId: string;
  name: string;
  hp: number;
  maxHp: number;
  baseAcc: number;
  baseDef: number;
  isDead: boolean;
  counters: Record<string, number>;
  actions: EnemyActionDefinition[];
  passives: EffectDefinition[];
  deathPassivesResolved: boolean;
}

export type LootCardRuntime = LootCardDefinition & { instanceId: string };

export interface CombatRoomRuntime {
  id: string;
  definitionId: string;
  name: string;
  tier: Exclude<RoomTier, "SPECIAL">;
  type: "combat";
  lootReward: number;
  rawTurnOrder: string[];
  enemies: EnemyRuntime[];
}

export interface SpecialRoomRuntime {
  id: string;
  definitionId: string;
  name: string;
  tier: "SPECIAL";
  type: "special";
  lootReward: 0;
  rawText: string;
  effects: EffectDefinition[];
}

export type RuntimeRoom = CombatRoomRuntime | SpecialRoomRuntime;

export interface PlayerTurnSlot {
  id: string;
  actorType: "player";
  actorId: string;
  position: PlayerPosition;
  raw: string;
}

export interface EnemyTurnSlot {
  id: string;
  actorType: "enemy";
  actorId: string;
  actionId: string;
  raw: string;
}

export type TurnSlot = PlayerTurnSlot | EnemyTurnSlot;

export interface TurnState {
  index: number;
  order: TurnSlot[];
  round: number;
  actionsResolved: number;
}

export type ModifierDuration =
  | { type: "targetActions"; remaining: number }
  | { type: "untilSourceNextTurn" }
  | { type: "rounds"; remaining: number }
  | { type: "enemyRound" }
  | { type: "room" };

export interface TimedModifier {
  id: string;
  sourceId: string;
  sourceType: "player" | "enemy" | "loot";
  targetId: string;
  stat: StatName;
  amount: number;
  duration: ModifierDuration;
  stacking: "stack" | "noStack";
  effectKey: string;
}

export interface DamageOverTime {
  id: string;
  sourceId: string;
  targetId: string;
  damage: number;
  timing: "enemyTurnStart";
}

export interface GameLogEntry {
  id: number;
  level: "info" | "roll" | "warning" | "error";
  message: string;
}

export interface SpecialRoomState {
  resolved: boolean;
  vendorOffer: LootCardRuntime[];
  result?: string;
}

export interface GameState {
  stateVersion: 1;
  phase: GamePhase;
  content: DungeonCrawlContent;
  rng: RngState;
  selectedCharacterIds: string[];
  players: PlayerRuntime[];
  playDeck: RoomDefinition[];
  roomIndex: number;
  completedRoomIds: string[];
  currentRoom: RuntimeRoom | null;
  turn: TurnState | null;
  modifiers: TimedModifier[];
  dots: DamageOverTime[];
  lootDeck: LootCardRuntime[];
  lootDiscard: LootCardRuntime[];
  pendingLootReward: LootCardRuntime[];
  pendingLootRecipientIds: string[] | null;
  specialRoomState: SpecialRoomState | null;
  pendingRerollPlayerId: string | null;
  pendingBlockBonuses: Record<string, number>;
  lootUsesThisRoom: Record<string, number>;
  log: GameLogEntry[];
  nextRuntimeId: number;
  nextLogId: number;
}

export interface EffectivePlayerStats {
  maxHp: number;
  acc: number;
  def: number;
  dmg: number;
}

export interface EffectiveEnemyStats {
  acc: number;
  def: number;
  dmg: number;
}

export interface PlayerAbilityChoice {
  playerId: string;
  abilityId: string;
  targetIds?: string[];
  allocation?: Record<string, number>;
}

export interface VendorPayment {
  playerId: string;
  lootInstanceId: string;
}

export type GameAction =
  | { type: "START_NEW_GAME"; seed?: string }
  | { type: "TOGGLE_CHARACTER"; characterId: string }
  | { type: "CONFIRM_PARTY" }
  | { type: "ASSIGN_POSITION"; playerId: string; position: PlayerPosition }
  | { type: "CONFIRM_POSITIONS" }
  | { type: "ENTER_REVEALED_ROOM" }
  | { type: "PLAYER_USE_ABILITY"; choice: PlayerAbilityChoice; rolls?: number[] }
  | { type: "RESOLVE_ENEMY_TURN"; rolls?: number[] }
  | { type: "ASSIGN_LOOT"; lootInstanceId: string; playerId: string | null }
  | { type: "CONTINUE_AFTER_LOOT" }
  | { type: "CONTINUE_AFTER_SPECIAL_ROOM" }
  | { type: "LOAD_GAME"; state: GameState };
