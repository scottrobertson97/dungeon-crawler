export type PlayerPosition = "A" | "B" | "C" | "D";
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

export type StatName = "acc" | "def" | "dmg" | "maxHp";
export type LogTone = "normal" | "good" | "warn" | "danger";

export type StatBlockDefinition = {
  maxHp: number;
  acc: number;
  def: number;
};

export type EffectDefinition = {
  type?: string;
  [key: string]: unknown;
};

export type AbilityDefinition = {
  id: string;
  name: string;
  rawText: string;
  effects: EffectDefinition[];
  implementationNotes?: string;
};

export type CharacterDefinition = {
  id: string;
  name: string;
  role?: string;
  stats: StatBlockDefinition;
  abilities: AbilityDefinition[];
};

export type EnemyActionDefinition = {
  id: string;
  name: string;
  rawText: string;
  effects: EffectDefinition[];
  implementationNotes?: string;
};

export type PassiveDefinition = {
  type: string;
  [key: string]: unknown;
};

export type EnemyDefinition = {
  id: string;
  name: string;
  stats: StatBlockDefinition;
  actions: EnemyActionDefinition[];
  tags?: string[];
  passives?: PassiveDefinition[];
};

export type CombatRoomDefinition = {
  id: string;
  name: string;
  tier: "A" | "B" | "BOSS";
  type: "combat";
  lootReward: number;
  turnOrder: string[];
  enemies: EnemyDefinition[];
};

export type TreasureOutcomeDefinition = {
  roll: number[];
  name: string;
  rawText: string;
};

export type SpecialRoomDefinition = {
  id: string;
  name: string;
  type: "special";
  rawText: string;
  effects: Array<EffectDefinition | TreasureOutcomeDefinition>;
  implementationNotes?: string;
};

export type LootCardDefinition = {
  id: string;
  name: string;
  kind: "equipment" | "consumable" | "item";
  rawText: string;
  statBonus?: Partial<Record<StatName, number>>;
  tags?: string[];
  effects?: EffectDefinition[];
};

export type DungeonContent = {
  metadata: {
    gameTitle: string;
    sourceNotes?: string[];
    assumptions?: string[];
  };
  config: {
    partySize: 4;
    maxHpCap: number;
    dice: {
      combatDie: "d6";
    };
    playDeckRecipe: Array<"A" | "B" | "SPECIAL" | "BOSS">;
  };
  characters: CharacterDefinition[];
  rooms: CombatRoomDefinition[];
  specialRooms: SpecialRoomDefinition[];
  starterLoot: LootCardDefinition[];
};

export type DeckEntry =
  | { kind: "combat"; id: string }
  | { kind: "special"; id: string };

export type PlayerRuntime = {
  id: string;
  characterId: string;
  name: string;
  role?: string;
  position?: PlayerPosition;
  maxHp: number;
  hp: number;
  acc: number;
  def: number;
  lootIds: string[];
  abilityTokens: number;
  dead: boolean;
  lootedOnDeath: boolean;
  skipNextAction: boolean;
  pendingReviveTurns: number | null;
  oncePerEncounterUsed: string[];
  usedLootThisRoom: string[];
  abilityDamageBonusById: Record<string, number>;
};

export type DamageOverTime = {
  id: string;
  sourceId: string;
  damage: number;
  timing: "enemyTurnStart";
};

export type EnemyRuntime = {
  id: string;
  name: string;
  maxHp: number;
  hp: number;
  acc: number;
  def: number;
  tags: string[];
  actions: EnemyActionDefinition[];
  passives: PassiveDefinition[];
  dead: boolean;
  passiveTriggered: string[];
  counters: Record<string, number>;
  dots: DamageOverTime[];
  skipNextAction: boolean;
};

export type RuntimeRoom = {
  definitionId: string;
  name: string;
  tier: "A" | "B" | "BOSS";
  type: "combat";
  lootReward: number;
  turnOrder: string[];
  enemies: EnemyRuntime[];
};

export type ModifierRuntime = {
  id: string;
  sourceId: string;
  targetKind: "player" | "enemy";
  targetId: string;
  stat: "acc" | "def" | "dmg";
  amount: number;
  duration: "nextAction" | "nextTurn" | "nextBlock" | "oneTurn" | "oneRound" | "threeTurns" | "room";
  remainingTurns?: number;
  stacking?: "stack" | "noStack";
  label: string;
};

export type GameLogEntry = {
  id: string;
  text: string;
  tone: LogTone;
};

export type VendorState = {
  drawIds: string[];
  selectedPaymentIds: string[];
  selectedTakeId: string | null;
  selectedRecipientId: string | null;
};

export type GameState = {
  phase: GamePhase;
  rngSeed: string;
  rngState: number;
  selectedCharacterIds: string[];
  selectedPlayers: PlayerRuntime[];
  playDeck: DeckEntry[];
  completedRooms: string[];
  roomNumber: number;
  currentRoom: RuntimeRoom | null;
  currentSpecialId: string | null;
  turn: {
    index: number;
    round: number;
  } | null;
  modifiers: ModifierRuntime[];
  lootDeck: string[];
  lootDiscard: string[];
  pendingLootReward: string[];
  vendor: VendorState | null;
  pendingPlayerReroll: { playerId: string; lootId: string } | null;
  lastEnemyActionHits: string[];
  log: GameLogEntry[];
};

export type CurrentTurn =
  | { kind: "player"; position: PlayerPosition; player: PlayerRuntime | null; label: string }
  | {
      kind: "enemy";
      enemyId: string;
      actionId: string;
      enemy: EnemyRuntime | null;
      action: EnemyActionDefinition | null;
      label: string;
    };
