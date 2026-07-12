import Phaser from "phaser";

import { dungeonCrawlContent } from "../../data/content";
import {
  assignLoot,
  assignPosition,
  confirmParty,
  confirmPositions,
  continueAfterLoot,
  continueAfterSpecialRoom,
  createTitleState,
  equipLoot,
  enterRevealedRoom,
  getCurrentTurn,
  getEffectiveEnemyStats,
  getEffectivePlayerStats,
  getTargetableEnemies,
  leaveVendor,
  resolveEnemyTurn,
  resolveHealingSpring,
  resolveTreasureRoom,
  resolveVendorTrade,
  resolveWitchRoom,
  startNewGame,
  transferLoot,
  toggleCharacterSelection,
  unequipLoot,
  useLoot,
  usePlayerAbility
} from "../../game/engine";
import { clearSavedGame, loadGame, saveGame } from "../../game/save";
import type {
  AbilityDefinition,
  CharacterDefinition,
  CombatRoomRuntime,
  EnemyRuntime,
  GameState,
  LootCardRuntime,
  PlayerPosition,
  PlayerRuntime,
  TurnSlot,
  VendorPayment
} from "../../game/types";
import { PLAYER_POSITIONS } from "../../game/types";
import {
  addButton,
  addDungeonBackdrop,
  addPanel,
  addPill,
  addRule,
  addText,
  COLORS,
  FONTS,
  fitText,
  VIEW_HEIGHT,
  VIEW_WIDTH
} from "../ui";

type TargetMode =
  | { kind: "none" }
  | { kind: "enemy"; maximum: number; all: boolean }
  | { kind: "player"; maximum: number; excludeSelf: boolean }
  | { kind: "allocation-enemy"; total: number }
  | { kind: "allocation-player"; total: number };

const CARD_ROLE_COLORS = [0x6c55a6, 0x49755c, 0x45718a, 0x8b5b42, 0x7e4562, 0x5b6d3a, 0x7b6537, 0x4d627f];

export class DungeonScene extends Phaser.Scene {
  private state: GameState = createTitleState(dungeonCrawlContent);
  private savedState: GameState | null = null;
  private screen!: Phaser.GameObjects.Container;
  private rulesOpen = false;
  private positionCandidateId: string | null = null;
  private selectedAbilityId: string | null = null;
  private selectedTargets = new Set<string>();
  private allocation: Record<string, number> = {};
  private treasureRecipients = new Set<string>();
  private vendorOfferId: string | null = null;
  private vendorRecipientId: string | null = null;
  private vendorPayments = new Map<string, VendorPayment>();
  private movingLoot: { fromPlayerId: string; lootInstanceId: string } | null = null;
  private lootPage = 0;

  constructor() {
    super("dungeon");
  }

  create(): void {
    this.cameras.main.setBackgroundColor(COLORS.ink);
    this.savedState = loadGame();
    this.input.keyboard?.on("keydown-ESC", () => {
      if (!this.rulesOpen) return;
      this.rulesOpen = false;
      this.render();
    });
    this.render();
  }

  private commit(next: GameState, options: { clearChoices?: boolean; save?: boolean } = {}): void {
    const previousPhase = this.state.phase;
    this.state = next;
    if (next.phase === "LOOT_REWARD" && previousPhase !== "LOOT_REWARD") this.lootPage = 0;
    if (options.clearChoices ?? true) this.clearActionChoice();
    if (options.save ?? next.phase !== "TITLE") {
      saveGame(next);
      this.savedState = next;
    }
    this.render();
  }

  private clearActionChoice(): void {
    this.selectedAbilityId = null;
    this.selectedTargets.clear();
    this.allocation = {};
  }

  private render(): void {
    this.screen?.destroy(true);
    this.screen = this.add.container(0, 0);
    addDungeonBackdrop(this, this.screen);

    switch (this.state.phase) {
      case "TITLE":
        this.renderTitle();
        break;
      case "PARTY_SELECT":
        this.renderPartySelect();
        break;
      case "POSITION_ASSIGNMENT":
        this.renderPositionAssignment();
        break;
      case "ROOM_REVEAL":
        this.renderRoomReveal();
        break;
      case "COMBAT":
        this.renderCombat();
        break;
      case "LOOT_REWARD":
        this.renderLootReward();
        break;
      case "SPECIAL_ROOM":
        this.renderSpecialRoom();
        break;
      case "VICTORY":
      case "DEFEAT":
        this.renderEndState();
        break;
    }

    if (this.state.phase !== "TITLE") this.renderUtilityButtons();
    if (this.rulesOpen) this.renderRulesOverlay();
    this.updateAccessibleStatus();
  }

  private renderTitle(): void {
    const root = this.screen;
    const rune = this.add.graphics();
    rune.lineStyle(3, COLORS.gold, 0.42);
    rune.strokeCircle(VIEW_WIDTH / 2, 310, 196);
    rune.lineStyle(1, COLORS.arcaneBright, 0.28);
    rune.strokeCircle(VIEW_WIDTH / 2, 310, 156);
    for (let index = 0; index < 8; index += 1) {
      const angle = (Math.PI * 2 * index) / 8;
      rune.lineBetween(
        VIEW_WIDTH / 2 + Math.cos(angle) * 164,
        310 + Math.sin(angle) * 164,
        VIEW_WIDTH / 2 + Math.cos(angle) * 188,
        310 + Math.sin(angle) * 188
      );
    }
    root.add(rune);

    addText(this, root, VIEW_WIDTH / 2, 86, "A LOCAL COOPERATIVE TABLETOP ADVENTURE", {
      size: 16,
      color: "#d9ad5b",
      family: FONTS.body,
      style: "bold",
      originX: 0.5
    });
    addText(this, root, VIEW_WIDTH / 2, 128, "DUNGEON CRAWL", {
      size: 76,
      color: "#f7eed6",
      family: FONTS.display,
      style: "bold",
      originX: 0.5
    });
    addText(this, root, VIEW_WIDTH / 2, 215, "Choose four heroes. Survive six rooms. Defeat the Spider Queen.", {
      size: 21,
      color: "#c9b9c5",
      originX: 0.5
    });

    const door = this.add.graphics();
    door.fillStyle(0x21182a, 1);
    door.fillRoundedRect(VIEW_WIDTH / 2 - 86, 260, 172, 228, 84);
    door.lineStyle(5, COLORS.gold, 0.78);
    door.strokeRoundedRect(VIEW_WIDTH / 2 - 86, 260, 172, 228, 84);
    door.fillStyle(0x08070d, 1);
    door.fillRoundedRect(VIEW_WIDTH / 2 - 55, 296, 110, 192, 54);
    door.fillStyle(COLORS.goldBright, 1);
    door.fillCircle(VIEW_WIDTH / 2 + 34, 395, 7);
    root.add(door);

    addButton(this, root, VIEW_WIDTH / 2, 565, 360, 66, "Begin a New Run", () => {
      clearSavedGame();
      const seed = `run-${Date.now().toString(36)}`;
      this.commit(startNewGame(createTitleState(dungeonCrawlContent), seed));
    }, { tone: "gold", fontSize: 21 });

    addButton(this, root, VIEW_WIDTH / 2, 647, 360, 58, "Continue Saved Run", () => {
      const loaded = loadGame();
      if (loaded) this.commit(loaded, { save: false });
    }, { tone: "arcane", enabled: Boolean(this.savedState), fontSize: 18 });

    addButton(this, root, VIEW_WIDTH / 2, 719, 360, 54, "Rules Summary", () => {
      this.rulesOpen = true;
      this.render();
    }, { tone: "dark" });

    addText(this, root, VIEW_WIDTH / 2, 818, "One screen · One party · No accounts · Autosaves locally", {
      size: 15,
      color: "#8f7f8c",
      originX: 0.5
    });
  }

  private renderPartySelect(): void {
    this.renderScreenHeading("Choose Your Party", "Select exactly four of the eight seeded heroes.", "PARTY MUSTER");
    addPill(this, this.screen, VIEW_WIDTH - 112, 48, `${this.state.selectedCharacterIds.length} / 4`, this.state.selectedCharacterIds.length === 4 ? "success" : "gold", 110);

    const cardWidth = 318;
    const cardHeight = 300;
    this.state.content.characters.forEach((character, index) => {
      const column = index % 4;
      const row = Math.floor(index / 4);
      const x = 185 + column * 354;
      const y = 260 + row * 326;
      this.renderCharacterCard(character, x, y, cardWidth, cardHeight, index);
    });

    addButton(this, this.screen, VIEW_WIDTH / 2, 850, 360, 58, "Confirm Party", () => {
      this.commit(confirmParty(this.state));
    }, { tone: "gold", enabled: this.state.selectedCharacterIds.length === 4, fontSize: 19 });
  }

  private renderCharacterCard(
    character: CharacterDefinition,
    x: number,
    y: number,
    width: number,
    height: number,
    index: number
  ): void {
    const selected = this.state.selectedCharacterIds.includes(character.id);
    addPanel(this, this.screen, x, y, width, height, {
      fill: selected ? 0x32243d : COLORS.panel,
      stroke: selected ? COLORS.goldBright : COLORS.line,
      radius: 18
    });

    const sigilColor = CARD_ROLE_COLORS[index % CARD_ROLE_COLORS.length];
    const sigil = this.add.circle(x - width / 2 + 50, y - height / 2 + 50, 31, sigilColor, 1).setStrokeStyle(2, selected ? COLORS.goldBright : COLORS.line);
    const initials = character.name.split(/[ ,]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
    const initialText = this.add.text(sigil.x, sigil.y, initials, {
      color: "#fff3d7",
      fontFamily: FONTS.display,
      fontSize: "21px",
      fontStyle: "bold"
    }).setOrigin(0.5);
    this.screen.add([sigil, initialText]);

    addText(this, this.screen, x - width / 2 + 94, y - height / 2 + 24, fitText(character.name, 25), {
      size: 20,
      family: FONTS.display,
      style: "bold",
      width: width - 112
    });
    addText(this, this.screen, x - width / 2 + 94, y - height / 2 + 82, character.role ?? "Adventurer", {
      size: 13,
      color: "#b9a9b6",
      style: "italic",
      width: width - 112
    });

    addPill(this, this.screen, x - 92, y - 24, `HP ${character.stats.maxHp}`, "danger", 76);
    addPill(this, this.screen, x, y - 24, `ACC ${character.stats.acc}`, "arcane", 78);
    addPill(this, this.screen, x + 92, y - 24, `DEF ${character.stats.def}`, "success", 78);

    addText(this, this.screen, x - width / 2 + 18, y + 8, character.abilities.map((ability) => `• ${ability.name}`).join("\n"), {
      size: 12,
      color: "#d9cbd5",
      width: width - 36,
      lineSpacing: 4
    });

    addButton(this, this.screen, x, y + height / 2 - 34, width - 36, 46, selected ? "Remove from Party" : "Add to Party", () => {
      this.commit(toggleCharacterSelection(this.state, character.id), { clearChoices: false });
    }, { tone: selected ? "danger" : "dark", fontSize: 15 });
  }

  private renderPositionAssignment(): void {
    this.renderScreenHeading("Assign Turn Positions", "Choose a hero, then place them in A, B, C, or D.", "FORMATION");

    addText(this, this.screen, 72, 126, "1. CHOOSE A HERO", { size: 14, color: "#d9ad5b", style: "bold" });
    this.state.players.forEach((player, index) => {
      const selected = this.positionCandidateId === player.id;
      const x = 212 + index * 338;
      addPanel(this, this.screen, x, 240, 300, 184, {
        fill: selected ? 0x362847 : COLORS.panel,
        stroke: selected ? COLORS.arcaneBright : COLORS.line
      });
      addText(this, this.screen, x, 181, player.name, {
        size: 20,
        family: FONTS.display,
        style: "bold",
        width: 250,
        align: "center",
        originX: 0.5
      });
      addPill(this, this.screen, x, 229, player.position ? `Currently ${player.position}` : "Unassigned", player.position ? "success" : "neutral", 124);
      addButton(this, this.screen, x, 292, 240, 46, selected ? "Selected" : "Choose Hero", () => {
        this.positionCandidateId = player.id;
        this.render();
      }, { tone: selected ? "arcane" : "dark", fontSize: 15 });
    });

    addText(this, this.screen, 72, 370, "2. PLACE IN FORMATION", { size: 14, color: "#d9ad5b", style: "bold" });
    PLAYER_POSITIONS.forEach((position, index) => {
      const x = 212 + index * 338;
      const player = this.state.players.find((candidate) => candidate.position === position);
      addPanel(this, this.screen, x, 545, 300, 260, {
        fill: player ? 0x26362f : COLORS.panel,
        stroke: player ? COLORS.mossBright : COLORS.line,
        radius: 20
      });
      addText(this, this.screen, x, 438, position, {
        size: 54,
        family: FONTS.display,
        style: "bold",
        color: player ? "#b9edc9" : "#8f7f8c",
        originX: 0.5
      });
      addText(this, this.screen, x, 520, player?.name ?? "Empty position", {
        size: 20,
        family: FONTS.display,
        style: "bold",
        color: player ? "#f7eed6" : "#8f7f8c",
        width: 250,
        align: "center",
        originX: 0.5
      });
      if (player) {
        addPill(this, this.screen, x, 565, `${player.hp} HP · ${player.baseAcc} ACC · ${player.baseDef} DEF`, "neutral", 220);
      }
      addButton(this, this.screen, x, 633, 240, 48, player ? "Replace" : "Assign Here", () => {
        if (!this.positionCandidateId) return;
        const candidateId = this.positionCandidateId;
        this.positionCandidateId = null;
        this.commit(assignPosition(this.state, candidateId, position), { clearChoices: false });
      }, { tone: player ? "dark" : "gold", enabled: Boolean(this.positionCandidateId), fontSize: 15 });
    });

    const ready = new Set(this.state.players.map((player) => player.position).filter(Boolean)).size === 4;
    addButton(this, this.screen, VIEW_WIDTH / 2, 790, 360, 58, "Lock Formation & Reveal Room", () => {
      this.commit(confirmPositions(this.state));
    }, { tone: "gold", enabled: ready, fontSize: 18 });
  }

  private renderRoomReveal(): void {
    const room = this.state.currentRoom;
    this.renderScreenHeading(`Room ${this.state.roomIndex + 1} of ${this.state.playDeck.length}`, "The next card turns face-up.", "DUNGEON PATH");
    this.renderRunProgress(134);
    if (!room) return;

    addPanel(this, this.screen, VIEW_WIDTH / 2, 490, 850, 500, {
      fill: room.type === "combat" ? 0x241923 : 0x202537,
      stroke: room.type === "combat" ? COLORS.bloodBright : COLORS.arcaneBright,
      radius: 28
    });
    addPill(this, this.screen, VIEW_WIDTH / 2, 280, room.tier, room.tier === "SPECIAL" ? "arcane" : room.tier === "BOSS" ? "danger" : "gold", 130);
    addText(this, this.screen, VIEW_WIDTH / 2, 324, room.name, {
      size: 46,
      family: FONTS.display,
      style: "bold",
      originX: 0.5,
      width: 760,
      align: "center"
    });
    addRule(this, this.screen, 430, 396, 1010, COLORS.line, 0.7);

    if (room.type === "combat") {
      addText(this, this.screen, VIEW_WIDTH / 2, 422, room.tier === "BOSS" ? "BOSS ENCOUNTER" : "COMBAT ENCOUNTER", {
        size: 14,
        color: "#e26369",
        style: "bold",
        originX: 0.5
      });
      room.enemies.forEach((enemy, index) => {
        const x = VIEW_WIDTH / 2 + (index - (room.enemies.length - 1) / 2) * 220;
        const circle = this.add.circle(x, 518, 52, 0x562833, 1).setStrokeStyle(2, COLORS.bloodBright);
        const initials = this.add.text(x, 518, this.enemyInitials(enemy.name), {
          color: "#ffd2ce",
          fontFamily: FONTS.display,
          fontSize: "25px",
          fontStyle: "bold"
        }).setOrigin(0.5);
        this.screen.add([circle, initials]);
        addText(this, this.screen, x, 584, fitText(enemy.name, 22), {
          size: 17,
          family: FONTS.display,
          style: "bold",
          originX: 0.5,
          width: 200,
          align: "center"
        });
        addPill(this, this.screen, x, 625, `${enemy.hp} HP · ${enemy.baseDef} DEF`, "danger", 154);
      });
      addText(this, this.screen, VIEW_WIDTH / 2, 684, `${room.rawTurnOrder.length} turn slots · ${room.lootReward} loot reward`, {
        size: 15,
        color: "#b9a9b6",
        originX: 0.5
      });
    } else {
      addText(this, this.screen, VIEW_WIDTH / 2, 438, room.rawText, {
        size: 22,
        color: "#d9cbd5",
        width: 690,
        align: "center",
        originX: 0.5,
        lineSpacing: 8
      });
      addText(this, this.screen, VIEW_WIDTH / 2, 650, "Your party will choose how to resolve this room.", {
        size: 16,
        color: "#a98be5",
        style: "italic",
        originX: 0.5
      });
    }

    addButton(this, this.screen, VIEW_WIDTH / 2, 790, 360, 60, room.type === "combat" ? "Enter Combat" : "Enter Special Room", () => {
      this.commit(enterRevealedRoom(this.state));
    }, { tone: room.type === "combat" ? "danger" : "arcane", fontSize: 19 });
  }

  private renderScreenHeading(title: string, subtitle: string, eyebrow: string): void {
    addText(this, this.screen, 58, 28, eyebrow, { size: 13, color: "#d9ad5b", style: "bold" });
    addText(this, this.screen, 58, 48, title, { size: 34, family: FONTS.display, style: "bold" });
    addText(this, this.screen, 58, 91, subtitle, { size: 15, color: "#b9a9b6" });
    addRule(this, this.screen, 58, 116, VIEW_WIDTH - 58, COLORS.line, 0.5);
  }

  private renderRunProgress(y: number): void {
    const startX = 280;
    const gap = 176;
    const graphics = this.add.graphics();
    graphics.lineStyle(3, COLORS.line, 0.55);
    graphics.lineBetween(startX, y, startX + gap * 5, y);
    this.screen.add(graphics);
    this.state.playDeck.forEach((room, index) => {
      const x = startX + index * gap;
      const completed = index < this.state.roomIndex || this.state.completedRoomIds.includes(room.id);
      const current = index === this.state.roomIndex;
      const fill = completed ? COLORS.moss : current ? COLORS.gold : COLORS.panelSoft;
      const stroke = completed ? COLORS.mossBright : current ? COLORS.goldBright : COLORS.line;
      const node = this.add.circle(x, y, current ? 22 : 17, fill).setStrokeStyle(3, stroke);
      this.screen.add(node);
      addText(this, this.screen, x, y, completed ? "✓" : String(index + 1), {
        size: current ? 17 : 14,
        family: FONTS.body,
        style: "bold",
        originX: 0.5,
        originY: 0.5
      });
      addText(this, this.screen, x, y + 30, room.tier, {
        size: 11,
        color: current ? "#f3cf7a" : "#8f7f8c",
        style: "bold",
        originX: 0.5
      });
    });
  }

  private renderCombat(): void {
    const room = this.state.currentRoom;
    if (!room || room.type !== "combat") return;
    const slot = getCurrentTurn(this.state);
    const round = this.state.turn?.round ?? 1;
    this.renderScreenHeading(room.name, `Round ${round} · Resolve the highlighted turn from left to right.`, room.tier === "BOSS" ? "BOSS CHAMBER" : `ROOM ${this.state.roomIndex + 1} OF ${this.state.playDeck.length}`);
    addPill(this, this.screen, 1070, 53, `${room.enemies.filter((enemy) => !enemy.isDead).length} enemies`, "danger", 120);
    addPill(this, this.screen, 1200, 53, `${this.state.players.filter((player) => !player.isDead).length} heroes`, "success", 110);
    this.renderTurnRibbon(slot);
    this.renderCombatEnemies(room);
    this.renderCombatParty();
    this.renderCombatActionPanel(slot);
    this.renderCombatLog();
  }

  private renderTurnRibbon(current: TurnSlot | null): void {
    const turn = this.state.turn;
    if (!turn) return;
    addText(this, this.screen, 55, 132, "TURN ORDER", { size: 12, color: "#d9ad5b", style: "bold" });
    const availableWidth = 1000;
    const gap = 8;
    const chipWidth = Math.min(124, (availableWidth - gap * (turn.order.length - 1)) / turn.order.length);
    turn.order.forEach((slot, index) => {
      const x = 55 + chipWidth / 2 + index * (chipWidth + gap);
      const active = slot.id === current?.id;
      const actorDead = slot.actorType === "player"
        ? this.state.players.find((player) => player.id === slot.actorId)?.isDead
        : this.state.currentRoom?.type === "combat"
          ? this.state.currentRoom.enemies.find((enemy) => enemy.id === slot.actorId)?.isDead
          : false;
      const tone = slot.actorType === "player" ? (active ? 0x3d7054 : 0x26362f) : (active ? 0x813b48 : 0x42242c);
      const stroke = slot.actorType === "player" ? COLORS.mossBright : COLORS.bloodBright;
      const rect = this.add.rectangle(x, 171, chipWidth, 54, tone, actorDead ? 0.35 : 1).setStrokeStyle(active ? 3 : 1, stroke, active ? 1 : 0.55);
      this.screen.add(rect);
      const label = slot.actorType === "player"
        ? slot.position
        : this.enemyActionLabel(slot.actorId, slot.actionId);
      addText(this, this.screen, x, 171, fitText(label, chipWidth < 100 ? 12 : 16), {
        size: active ? 13 : 11,
        style: "bold",
        color: actorDead ? "#736872" : "#f7eed6",
        width: chipWidth - 8,
        align: "center",
        originX: 0.5,
        originY: 0.5
      });
      if (active) {
        const marker = this.add.triangle(x, 207, 0, 0, 12, 0, 6, 8, COLORS.goldBright);
        this.screen.add(marker);
      }
    });
  }

  private renderCombatEnemies(room: CombatRoomRuntime): void {
    const width = Math.min(292, 910 / Math.max(1, room.enemies.length));
    const gap = 16;
    const total = width * room.enemies.length + gap * (room.enemies.length - 1);
    const start = 545 - total / 2 + width / 2;
    room.enemies.forEach((enemy, index) => {
      const x = start + index * (width + gap);
      const y = 330;
      const targetable = getTargetableEnemies(this.state).some((candidate) => candidate.id === enemy.id);
      addPanel(this, this.screen, x, y, width, 222, {
        fill: enemy.isDead ? 0x1b171c : targetable ? 0x332029 : 0x252028,
        alpha: enemy.isDead ? 0.68 : 0.98,
        stroke: enemy.isDead ? 0x4f464d : targetable ? COLORS.bloodBright : COLORS.line,
        radius: 16
      });
      const sigil = this.add.circle(x - width / 2 + 42, y - 75, 25, enemy.isDead ? 0x302b30 : 0x6c2e3b).setStrokeStyle(2, enemy.isDead ? COLORS.line : COLORS.bloodBright);
      const initials = this.add.text(sigil.x, sigil.y, this.enemyInitials(enemy.name), {
        color: enemy.isDead ? "#736872" : "#ffd2ce",
        fontFamily: FONTS.display,
        fontSize: "16px",
        fontStyle: "bold"
      }).setOrigin(0.5);
      this.screen.add([sigil, initials]);
      addText(this, this.screen, x - width / 2 + 78, y - 96, fitText(enemy.name, 25), {
        size: 17,
        family: FONTS.display,
        style: "bold",
        color: enemy.isDead ? "#736872" : "#f7eed6",
        width: width - 92
      });
      addText(this, this.screen, x - width / 2 + 78, y - 69, enemy.isDead ? "DEFEATED" : targetable ? "TARGETABLE" : "PROTECTED", {
        size: 10,
        color: enemy.isDead ? "#736872" : targetable ? "#e26369" : "#d9ad5b",
        style: "bold"
      });
      this.renderHpBar(x - width / 2 + 18, y - 31, width - 36, enemy.hp, enemy.maxHp, COLORS.bloodBright);
      const stats = getEffectiveEnemyStats(this.state, enemy);
      addPill(this, this.screen, x - width / 2 + 54, y + 12, `HP ${Math.max(0, enemy.hp)}/${enemy.maxHp}`, "danger", 100);
      addPill(this, this.screen, x + 22, y + 12, `ACC ${stats.acc}`, "arcane", 72);
      addPill(this, this.screen, x + width / 2 - 46, y + 12, `DEF ${stats.def}`, "success", 72);
      const statuses = [
        ...Object.entries(enemy.counters).filter(([, value]) => value > 0).map(([key, value]) => `${key} ${value}`),
        ...this.state.dots.filter((dot) => dot.targetId === enemy.id).map((dot) => `Burn ${dot.damage}`),
        ...enemy.passives.map((passive) => passive.type ?? "passive")
      ];
      addText(this, this.screen, x - width / 2 + 18, y + 46, statuses.length ? statuses.map((status) => `◆ ${status}`).join("  ") : "No active effects", {
        size: 11,
        color: statuses.length ? "#d9ad5b" : "#786b76",
        width: width - 36,
        align: "center"
      });
    });
  }

  private renderCombatParty(): void {
    const ordered = [...this.state.players].sort((left, right) => PLAYER_POSITIONS.indexOf(left.position ?? "A") - PLAYER_POSITIONS.indexOf(right.position ?? "A"));
    ordered.forEach((player, index) => {
      const width = 236;
      const x = 142 + index * 260;
      const y = 535;
      const slot = getCurrentTurn(this.state);
      const active = slot?.actorType === "player" && slot.actorId === player.id;
      const stats = getEffectivePlayerStats(this.state, player);
      addPanel(this, this.screen, x, y, width, 172, {
        fill: player.isDead ? 0x19171b : active ? 0x294535 : COLORS.panel,
        alpha: player.isDead ? 0.62 : 0.98,
        stroke: player.isDead ? 0x4f464d : active ? COLORS.goldBright : COLORS.line,
        radius: 14
      });
      addPill(this, this.screen, x - 82, y - 59, player.position ?? "?", active ? "gold" : "success", 42);
      addText(this, this.screen, x - 52, y - 71, fitText(player.name, 22), {
        size: 15,
        family: FONTS.display,
        style: "bold",
        color: player.isDead ? "#736872" : "#f7eed6",
        width: 158
      });
      this.renderHpBar(x - width / 2 + 14, y - 31, width - 28, player.hp, stats.maxHp, COLORS.mossBright);
      addText(this, this.screen, x - width / 2 + 14, y - 9, `${Math.max(0, player.hp)}/${stats.maxHp} HP`, { size: 11, color: "#b9edc9", style: "bold" });
      addText(this, this.screen, x + width / 2 - 14, y - 9, `ACC ${stats.acc} · DEF ${stats.def} · DMG +${stats.dmg}`, {
        size: 10,
        color: "#cbbbd0",
        originX: 1
      });
      const inventory = player.inventory.length
        ? player.inventory.map((card) => `${player.equippedLootIds.includes(card.instanceId) ? "◆" : "◇"} ${fitText(card.name, 18)}`).join("\n")
        : "No loot carried";
      addText(this, this.screen, x - width / 2 + 14, y + 20, inventory, {
        size: 10,
        color: player.inventory.length ? "#d9cbd5" : "#786b76",
        width: width - 28,
        lineSpacing: 3
      });
      if (player.abilityTokens > 0) addPill(this, this.screen, x + 76, y + 59, `${player.abilityTokens} tokens`, "arcane", 92);
      if (player.isDead) addPill(this, this.screen, x, y + 58, player.pendingReviveTurns !== null ? "BONFIRE" : "FALLEN", "danger", 94);
    });
  }

  private renderCombatActionPanel(slot: TurnSlot | null): void {
    addPanel(this, this.screen, 545, 760, 1000, 252, { fill: 0x1c1624, stroke: COLORS.line, radius: 16 });
    if (!slot) {
      addText(this, this.screen, 545, 760, "No current turn.", { size: 20, originX: 0.5, originY: 0.5 });
      return;
    }
    if (slot.actorType === "enemy") this.renderEnemyTurnPanel(slot.actorId, slot.actionId);
    else this.renderPlayerTurnPanel(slot.actorId);
  }

  private renderEnemyTurnPanel(enemyId: string, actionId: string): void {
    const room = this.state.currentRoom;
    const enemy = room?.type === "combat" ? room.enemies.find((candidate) => candidate.id === enemyId) : null;
    const action = enemy?.actions.find((candidate) => candidate.id === actionId);
    addText(this, this.screen, 66, 650, "ENEMY TURN", { size: 12, color: "#e26369", style: "bold" });
    addText(this, this.screen, 66, 674, `${enemy?.name ?? "Enemy"} · ${action?.name ?? "Action"}`, {
      size: 24,
      family: FONTS.display,
      style: "bold",
      color: "#ffd2ce"
    });
    addText(this, this.screen, 66, 713, action?.rawText ?? "Resolve this enemy action.", {
      size: 15,
      color: "#cbbbd0",
      width: 580,
      lineSpacing: 4
    });

    const charms = this.state.players.flatMap((player) =>
      player.inventory
        .filter((card) =>
          player.equippedLootIds.includes(card.instanceId) &&
          card.effects?.some((effect) => effect.type === "reactionModifier")
        )
        .map((card) => ({ player, card }))
    );
    addText(this, this.screen, 66, 798, "Reactions", { size: 11, color: "#d9ad5b", style: "bold" });
    charms.slice(0, 4).forEach(({ player, card }, index) => {
      const used = (this.state.lootUsesThisRoom[card.instanceId] ?? 0) > 0;
      addButton(this, this.screen, 148 + index * 190, 842, 174, 42, `${player.position}: ${fitText(card.name, 15)}`, () => {
        this.commit(useLoot(this.state, player.id, card.instanceId), { clearChoices: false });
      }, { tone: "dark", enabled: !used, fontSize: 12 });
    });
    if (charms.length === 0) addText(this, this.screen, 66, 826, "No readied block reactions.", { size: 12, color: "#786b76" });

    addButton(this, this.screen, 895, 760, 250, 64, "Resolve Enemy Action", () => {
      this.commit(resolveEnemyTurn(this.state));
    }, { tone: "danger", fontSize: 17 });
  }

  private renderPlayerTurnPanel(playerId: string): void {
    const player = this.state.players.find((candidate) => candidate.id === playerId);
    if (!player) return;
    addText(this, this.screen, 66, 640, `${player.position} · PLAYER TURN`, { size: 12, color: "#75b58c", style: "bold" });
    addText(this, this.screen, 66, 662, player.name, { size: 22, family: FONTS.display, style: "bold" });

    player.abilities.forEach((ability, index) => {
      const passive = ability.effects.every((effect) => effect.type === "passiveRevive");
      const selected = this.selectedAbilityId === ability.id;
      const x = 178 + index * 224;
      addButton(this, this.screen, x, 710, 208, 54, fitText(ability.name, 21), () => {
        this.selectedAbilityId = ability.id;
        this.selectedTargets.clear();
        this.allocation = {};
        this.render();
      }, { tone: selected ? "arcane" : "dark", enabled: !passive, fontSize: 13 });
    });

    const ability = player.abilities.find((candidate) => candidate.id === this.selectedAbilityId);
    if (!ability) {
      addText(this, this.screen, 66, 762, "Choose an ability to see legal targets and resolve the action.", { size: 14, color: "#8f7f8c" });
      this.renderUsableLoot(player, 66, 815);
      return;
    }

    addText(this, this.screen, 66, 750, fitText(ability.rawText, 112), { size: 13, color: "#cbbbd0", width: 580 });
    const mode = this.targetMode(ability);
    this.renderTargetControls(player, mode, 66, 792);
    this.renderUsableLoot(player, 66, 850);
    addButton(this, this.screen, 900, 830, 230, 56, "Resolve Ability", () => {
      const targetIds = mode.kind === "enemy" && mode.all
        ? getTargetableEnemies(this.state).map((enemy) => enemy.id)
        : [...this.selectedTargets];
      this.commit(usePlayerAbility(this.state, {
        playerId: player.id,
        abilityId: ability.id,
        targetIds,
        allocation: { ...this.allocation }
      }));
    }, { tone: "gold", enabled: this.choiceIsValid(mode), fontSize: 16 });
  }

  private renderTargetControls(player: PlayerRuntime, mode: TargetMode, startX: number, y: number): void {
    if (mode.kind === "none") {
      addPill(this, this.screen, startX + 70, y + 8, "No target needed", "success", 140);
      return;
    }
    const enemies = getTargetableEnemies(this.state);
    const players = this.state.players.filter((candidate) => !candidate.isDead && (!mode.kind.includes("player") || !("excludeSelf" in mode) || !mode.excludeSelf || candidate.id !== player.id));
    const allocationMode = mode.kind === "allocation-enemy" || mode.kind === "allocation-player";
    const candidates = mode.kind === "enemy" || mode.kind === "allocation-enemy"
      ? enemies.map((enemy) => ({ id: enemy.id, label: enemy.name }))
      : players.map((candidate) => ({ id: candidate.id, label: `${candidate.position}: ${candidate.name}` }));
    if (mode.kind === "enemy" && mode.all) {
      addPill(this, this.screen, startX + 88, y + 8, `All ${candidates.length} enemies`, "danger", 176);
      return;
    }
    if (allocationMode) {
      const total = mode.total;
      const used = Object.values(this.allocation).reduce((sum, value) => sum + value, 0);
      addText(this, this.screen, startX, y - 12, `Allocate ${total} · ${total - used} remaining`, { size: 11, color: used === total ? "#75b58c" : "#d9ad5b", style: "bold" });
      candidates.forEach((candidate, index) => {
        const x = startX + 84 + index * 178;
        addButton(this, this.screen, x - 48, y + 23, 34, 34, "−", () => {
          this.allocation[candidate.id] = Math.max(0, (this.allocation[candidate.id] ?? 0) - 1);
          this.render();
        }, { tone: "dark", fontSize: 16 });
        addPill(this, this.screen, x, y + 23, String(this.allocation[candidate.id] ?? 0), "arcane", 46);
        addButton(this, this.screen, x + 48, y + 23, 34, 34, "+", () => {
          if (used < total) this.allocation[candidate.id] = (this.allocation[candidate.id] ?? 0) + 1;
          this.render();
        }, { tone: "dark", enabled: used < total, fontSize: 16 });
        addText(this, this.screen, x, y + 45, fitText(candidate.label, 18), { size: 9, color: "#9c8e9a", width: 150, align: "center", originX: 0.5 });
      });
      return;
    }

    const maximum = mode.maximum;
    candidates.forEach((candidate, index) => {
      const selected = this.selectedTargets.has(candidate.id);
      addButton(this, this.screen, startX + 85 + index * 178, y + 12, 164, 40, fitText(candidate.label, 19), () => {
        if (selected) this.selectedTargets.delete(candidate.id);
        else if (maximum === 1) {
          this.selectedTargets.clear();
          this.selectedTargets.add(candidate.id);
        } else if (this.selectedTargets.size < maximum) this.selectedTargets.add(candidate.id);
        this.render();
      }, { tone: selected ? "arcane" : "dark", fontSize: 11 });
    });
  }

  private renderUsableLoot(player: PlayerRuntime, x: number, y: number): void {
    const usable = player.inventory.filter((card) =>
      card.kind === "consumable" ||
      (player.equippedLootIds.includes(card.instanceId) && card.effects?.some((effect) => effect.type === "rerollOncePerRoom"))
    );
    usable.slice(0, 3).forEach((card, index) => {
      const used = (this.state.lootUsesThisRoom[card.instanceId] ?? 0) > 0;
      addButton(this, this.screen, x + 92 + index * 190, y, 176, 38, `Use ${fitText(card.name, 14)}`, () => {
        this.commit(useLoot(this.state, player.id, card.instanceId), { clearChoices: false });
      }, { tone: "dark", enabled: !used, fontSize: 11 });
    });
  }

  private renderCombatLog(): void {
    addPanel(this, this.screen, 1238, 500, 350, 744, { fill: 0x16121b, stroke: COLORS.line, radius: 16 });
    addText(this, this.screen, 1083, 145, "RESOLUTION LOG", { size: 12, color: "#d9ad5b", style: "bold" });
    addRule(this, this.screen, 1083, 170, 1393, COLORS.line, 0.6);
    const entries = this.state.log.slice(-13);
    entries.forEach((entry, index) => {
      const color = entry.level === "error" ? "#ffaaa7" : entry.level === "warning" ? "#f3cf7a" : entry.level === "roll" ? "#cbb7ff" : "#cbbdc7";
      addText(this, this.screen, 1083, 188 + index * 49, fitText(entry.message, 70), {
        size: 11,
        color,
        width: 306,
        lineSpacing: 2
      });
      if (index < entries.length - 1) addRule(this, this.screen, 1083, 229 + index * 49, 1393, COLORS.line, 0.22);
    });
  }

  private targetMode(ability: AbilityDefinition): TargetMode {
    for (const effect of ability.effects) {
      if (effect.type === "splitDamage") return { kind: "allocation-enemy", total: Number(effect.totalDamage ?? 0) };
      if (effect.type === "splitHeal") return { kind: "allocation-player", total: Number(effect.totalHealing ?? 0) };
      if (effect.type === "attackEnemy") return { kind: "enemy", maximum: 1, all: false };
      if (effect.type === "attackEnemies") return { kind: "enemy", maximum: Number(effect.targetCount ?? 99), all: effect.target === "allEnemies" };
      if (effect.type === "healAlly") return { kind: "player", maximum: 1, excludeSelf: true };
      if (effect.type === "applyModifier" && (effect.target === "ally" || effect.target === "selfAndAlly")) {
        return { kind: "player", maximum: 1, excludeSelf: true };
      }
    }
    return { kind: "none" };
  }

  private choiceIsValid(mode: TargetMode): boolean {
    switch (mode.kind) {
      case "none":
        return true;
      case "enemy":
        return mode.all ? getTargetableEnemies(this.state).length > 0 : this.selectedTargets.size > 0 && this.selectedTargets.size <= mode.maximum;
      case "player":
        return this.selectedTargets.size === 1;
      case "allocation-enemy":
      case "allocation-player":
        return Object.values(this.allocation).reduce((sum, value) => sum + value, 0) === mode.total;
    }
  }

  private renderLootReward(): void {
    const cards = this.state.pendingLootReward;
    this.renderScreenHeading(
      "Distribute the Spoils",
      cards.length > 0
        ? "Choose A, B, C, D, or Discard on every reward. Clear the pile to unlock the next room."
        : "The reward pile is clear. Review equipment, then reveal the next room.",
      cards.length > 0 ? "STEP 1 OF 2 · LOOT REWARD" : "STEP 2 OF 2 · ROOM COMPLETE",
    );
    this.renderRunProgress(142);
    this.renderInventoryWorkbench();

    const pageSize = 6;
    const maxPage = Math.max(0, Math.ceil(cards.length / pageSize) - 1);
    this.lootPage = Math.min(this.lootPage, maxPage);
    const visibleCards = cards.slice(this.lootPage * pageSize, this.lootPage * pageSize + pageSize);
    addText(this, this.screen, 54, 352, `REWARD PILE · ${cards.length} REMAINING`, { size: 12, color: "#d9ad5b", style: "bold" });
    if (this.state.pendingLootRecipientIds) {
      const positions = this.state.players
        .filter((player) => this.state.pendingLootRecipientIds?.includes(player.id))
        .map((player) => player.position)
        .join(", ");
      addPill(this, this.screen, 365, 352, `Treasure recipients: ${positions}`, "gold", 250);
    }
    if (maxPage > 0) {
      addButton(this, this.screen, 735, 352, 42, 30, "‹", () => {
        this.lootPage = Math.max(0, this.lootPage - 1);
        this.render();
      }, { tone: "dark", enabled: this.lootPage > 0, fontSize: 14 });
      addPill(this, this.screen, 790, 352, `${this.lootPage + 1}/${maxPage + 1}`, "neutral", 58);
      addButton(this, this.screen, 845, 352, 42, 30, "›", () => {
        this.lootPage = Math.min(maxPage, this.lootPage + 1);
        this.render();
      }, { tone: "dark", enabled: this.lootPage < maxPage, fontSize: 14 });
    }
    const cardWidth = visibleCards.length > 3 ? 286 : 326;
    const columns = visibleCards.length > 3 ? 3 : Math.max(1, visibleCards.length);
    visibleCards.forEach((card, index) => {
      const row = Math.floor(index / columns);
      const column = index % columns;
      const totalWidth = columns * cardWidth + (columns - 1) * 18;
      const startX = 520 - totalWidth / 2 + cardWidth / 2;
      const x = startX + column * (cardWidth + 18);
      const y = 494 + row * 226;
      this.renderRewardCard(card, x, y, cardWidth, 204);
    });
    if (cards.length === 0) {
      addPanel(this, this.screen, 520, 525, 760, 230, { fill: 0x1d2822, stroke: COLORS.mossBright });
      addText(this, this.screen, 520, 476, "Every reward has found a home.", {
        size: 28,
        family: FONTS.display,
        style: "bold",
        color: "#b9edc9",
        originX: 0.5
      });
      addText(this, this.screen, 520, 535, "Review equipment above, then reveal the next room.", { size: 16, color: "#b9a9b6", originX: 0.5 });
      addButton(this, this.screen, 520, 600, 340, 58, `Reveal Room ${Math.min(this.state.roomIndex + 2, this.state.playDeck.length)}`, () => {
        this.continueFromLoot(false);
      }, { tone: "gold", fontSize: 18 });
    }

    this.renderLootSidebar();
    addButton(
      this,
      this.screen,
      1218,
      832,
      300,
      56,
      cards.length > 0 ? `Discard ${cards.length} Remaining & Continue` : `Reveal Room ${Math.min(this.state.roomIndex + 2, this.state.playDeck.length)}`,
      () => this.continueFromLoot(cards.length > 0),
      { tone: cards.length > 0 ? "danger" : "gold", fontSize: cards.length > 0 ? 13 : 17 },
    );
  }

  private renderInventoryWorkbench(): void {
    addText(this, this.screen, 54, 178, "PARTY INVENTORIES", { size: 12, color: "#d9ad5b", style: "bold" });
    const ordered = [...this.state.players].sort((left, right) => (left.position ?? "Z").localeCompare(right.position ?? "Z"));
    ordered.forEach((player, index) => {
      const x = 167 + index * 264;
      addPanel(this, this.screen, x, 262, 248, 146, { fill: COLORS.panel, stroke: this.movingLoot?.fromPlayerId === player.id ? COLORS.goldBright : COLORS.line, radius: 12 });
      addPill(this, this.screen, x - 92, 219, player.position ?? "?", "success", 38);
      addText(this, this.screen, x - 65, 207, fitText(player.name, 21), { size: 14, family: FONTS.display, style: "bold", width: 165 });
      if (player.inventory.length === 0) {
        addText(this, this.screen, x, 270, "Empty · 0 / 3", { size: 12, color: "#786b76", originX: 0.5 });
      }
      player.inventory.forEach((card, cardIndex) => {
        const equipped = player.equippedLootIds.includes(card.instanceId);
        const selectedMove = this.movingLoot?.lootInstanceId === card.instanceId;
        const rowY = 252 + cardIndex * 30;
        addText(this, this.screen, x - 108, rowY, `${equipped ? "◆" : "◇"} ${fitText(card.name, 20)}`, {
          size: 10,
          color: selectedMove ? "#f3cf7a" : "#d9cbd5",
          width: 150
        });
        if (card.kind === "consumable") {
          addPill(this, this.screen, x + 73, rowY + 5, "Potion", "danger", 52);
        } else {
          addButton(this, this.screen, x + 73, rowY + 5, 52, 24, equipped ? "Off" : "On", () => {
            this.commit(equipped ? unequipLoot(this.state, player.id, card.instanceId) : equipLoot(this.state, player.id, card.instanceId), { clearChoices: false });
          }, { tone: equipped ? "success" : "dark", fontSize: 9 });
        }
        addButton(this, this.screen, x + 108, rowY + 5, 24, 24, "→", () => {
          this.movingLoot = selectedMove ? null : { fromPlayerId: player.id, lootInstanceId: card.instanceId };
          this.render();
        }, { tone: selectedMove ? "gold" : "dark", fontSize: 10 });
      });
    });
  }

  private renderRewardCard(card: LootCardRuntime, x: number, y: number, width: number, height: number): void {
    const tone = card.kind === "equipment" ? "success" : card.kind === "consumable" ? "danger" : "arcane";
    addPanel(this, this.screen, x, y, width, height, {
      fill: card.kind === "equipment" ? 0x213329 : card.kind === "consumable" ? 0x352027 : 0x2a2340,
      stroke: card.kind === "equipment" ? COLORS.mossBright : card.kind === "consumable" ? COLORS.bloodBright : COLORS.arcaneBright,
      radius: 16
    });
    addPill(this, this.screen, x - width / 2 + 58, y - height / 2 + 28, card.kind.toUpperCase(), tone, 94);
    addText(this, this.screen, x - width / 2 + 16, y - 61, fitText(card.name, 30), { size: 18, family: FONTS.display, style: "bold", width: width - 32 });
    addText(this, this.screen, x - width / 2 + 16, y - 28, card.rawText, { size: 11, color: "#cbbbd0", width: width - 32, lineSpacing: 3 });
    addText(this, this.screen, x - width / 2 + 18, y + 42, "GIVE TO", { size: 9, color: "#d9ad5b", style: "bold" });
    this.state.players.forEach((player, index) => {
      const eligible = !this.state.pendingLootRecipientIds || this.state.pendingLootRecipientIds.includes(player.id);
      addButton(this, this.screen, x - width / 2 + 43 + index * 55, y + 68, 48, 34, player.position ?? "?", () => {
        this.commit(assignLoot(this.state, card.instanceId, player.id), { clearChoices: false });
      }, { tone: "dark", enabled: eligible && player.inventory.length < 3 && !player.isDead, fontSize: 11 });
    });
    addButton(this, this.screen, x + width / 2 - 50, y + 68, 68, 34, "Discard", () => {
      this.commit(assignLoot(this.state, card.instanceId, null), { clearChoices: false });
    }, { tone: "danger", fontSize: 10 });
  }

  private renderLootSidebar(): void {
    addPanel(this, this.screen, 1234, 508, 356, 620, { fill: 0x16121b, stroke: COLORS.line, radius: 16 });
    addText(this, this.screen, 1080, 213, "EQUIPMENT & TRANSFER", { size: 12, color: "#d9ad5b", style: "bold" });
    addText(this, this.screen, 1080, 246, "◆ equipped  ◇ carried\nA hero can carry up to three cards.", { size: 12, color: "#b9a9b6", width: 306, lineSpacing: 5 });
    addRule(this, this.screen, 1080, 306, 1388, COLORS.line, 0.5);
    if (this.movingLoot) {
      const from = this.state.players.find((player) => player.id === this.movingLoot?.fromPlayerId);
      const card = from?.inventory.find((item) => item.instanceId === this.movingLoot?.lootInstanceId);
      addText(this, this.screen, 1080, 330, `Move ${card?.name ?? "loot"} from ${from?.position ?? "?"}:`, { size: 13, color: "#f3cf7a", style: "bold", width: 306 });
      this.state.players.filter((player) => player.id !== from?.id).forEach((player, index) => {
        addButton(this, this.screen, 1151 + (index % 2) * 154, 395 + Math.floor(index / 2) * 54, 140, 42, `Give to ${player.position}`, () => {
          if (!this.movingLoot) return;
          const next = transferLoot(this.state, this.movingLoot.fromPlayerId, player.id, this.movingLoot.lootInstanceId);
          this.movingLoot = null;
          this.commit(next, { clearChoices: false });
        }, { tone: "dark", enabled: player.inventory.length < 3, fontSize: 12 });
      });
    } else {
      addText(this, this.screen, 1080, 336, "Use the arrow beside a carried card to pass it to another hero.", { size: 13, color: "#8f7f8c", width: 306 });
    }
    addRule(this, this.screen, 1080, 492, 1388, COLORS.line, 0.5);
    addText(this, this.screen, 1080, 514, "RUN TOTALS", { size: 12, color: "#d9ad5b", style: "bold" });
    addText(this, this.screen, 1080, 546, [
      `${this.state.completedRoomIds.length} rooms cleared`,
      `${this.state.players.reduce((sum, player) => sum + player.inventory.length, 0)} loot carried`,
      `${this.state.players.reduce((sum, player) => sum + player.abilityTokens, 0)} ability tokens`,
      `${this.state.lootDeck.length} cards remain in deck`
    ].join("\n"), { size: 14, color: "#cbbbd0", lineSpacing: 10 });
  }

  private continueFromLoot(discardRemaining: boolean): void {
    let next = this.state;
    if (discardRemaining) {
      for (const card of [...next.pendingLootReward]) {
        next = assignLoot(next, card.instanceId, null);
      }
    }
    this.movingLoot = null;
    this.commit(continueAfterLoot(next));
  }

  private renderSpecialRoom(): void {
    const room = this.state.currentRoom;
    if (!room || room.type !== "special") return;
    this.renderScreenHeading(room.name, room.rawText, "SPECIAL ROOM");
    this.renderRunProgress(174);

    if (this.state.specialRoomState?.resolved) {
      addPanel(this, this.screen, VIEW_WIDTH / 2, 485, 820, 400, { fill: 0x202d27, stroke: COLORS.mossBright, radius: 24 });
      addPill(this, this.screen, VIEW_WIDTH / 2, 336, "RESOLVED", "success", 130);
      addText(this, this.screen, VIEW_WIDTH / 2, 400, this.state.specialRoomState.result ?? "The room is complete.", {
        size: 29,
        family: FONTS.display,
        style: "bold",
        color: "#b9edc9",
        width: 680,
        align: "center",
        originX: 0.5
      });
      addButton(this, this.screen, VIEW_WIDTH / 2, 620, 320, 58, "Continue to Next Room", () => {
        this.commit(continueAfterSpecialRoom(this.state));
      }, { tone: "gold", fontSize: 18 });
      return;
    }

    switch (room.definitionId) {
      case "healing-spring":
        this.renderHealingSpring();
        break;
      case "treasure-room":
        this.renderTreasureRoom();
        break;
      case "vendor":
        this.renderVendorRoom();
        break;
      case "witch":
        this.renderWitchRoom();
        break;
      default:
        addText(this, this.screen, VIEW_WIDTH / 2, 460, "This special room has no resolver.", { size: 22, color: "#ffaaa7", originX: 0.5 });
    }
  }

  private renderHealingSpring(): void {
    addPanel(this, this.screen, VIEW_WIDTH / 2, 500, 820, 440, { fill: 0x1f3036, stroke: COLORS.blueBright, radius: 26 });
    const pool = this.add.graphics();
    pool.fillStyle(0x315e75, 0.8);
    pool.fillEllipse(VIEW_WIDTH / 2, 490, 430, 142);
    pool.lineStyle(4, COLORS.blueBright, 0.8);
    pool.strokeEllipse(VIEW_WIDTH / 2, 490, 430, 142);
    pool.fillStyle(0x9de5f2, 0.7);
    pool.fillCircle(VIEW_WIDTH / 2 - 100, 480, 8);
    pool.fillCircle(VIEW_WIDTH / 2 + 78, 512, 6);
    this.screen.add(pool);
    addText(this, this.screen, VIEW_WIDTH / 2, 310, "The spring can restore every hero to full health.", { size: 22, color: "#b9e8f1", originX: 0.5 });
    this.state.players.forEach((player, index) => addPill(this, this.screen, 445 + index * 184, 618, `${player.position} · ${player.hp}/${player.maxHp} HP`, player.hp < player.maxHp ? "danger" : "success", 152));
    addButton(this, this.screen, VIEW_WIDTH / 2, 712, 320, 58, "Bathe in the Spring", () => {
      this.commit(resolveHealingSpring(this.state));
    }, { tone: "success", fontSize: 18 });
  }

  private renderTreasureRoom(): void {
    addPanel(this, this.screen, VIEW_WIDTH / 2, 505, 900, 470, { fill: 0x302a1d, stroke: COLORS.goldBright, radius: 26 });
    addText(this, this.screen, VIEW_WIDTH / 2, 302, "Choose two heroes for a basic chest. Intermediate chests reward the whole party.", {
      size: 18,
      color: "#f6d98d",
      width: 760,
      align: "center",
      originX: 0.5
    });
    this.state.players.filter((player) => !player.isDead).forEach((player, index) => {
      const selected = this.treasureRecipients.has(player.id);
      addButton(this, this.screen, 435 + index * 190, 406, 172, 58, `${player.position} · ${fitText(player.name, 14)}`, () => {
        if (selected) this.treasureRecipients.delete(player.id);
        else if (this.treasureRecipients.size < 2) this.treasureRecipients.add(player.id);
        this.render();
      }, { tone: selected ? "gold" : "dark", fontSize: 12 });
    });
    const die = this.add.graphics();
    die.fillStyle(0xf0e4c8, 1);
    die.fillRoundedRect(VIEW_WIDTH / 2 - 58, 485, 116, 116, 18);
    die.lineStyle(4, COLORS.gold, 1);
    die.strokeRoundedRect(VIEW_WIDTH / 2 - 58, 485, 116, 116, 18);
    [[-28, -28], [28, -28], [0, 0], [-28, 28], [28, 28]].forEach(([dx, dy]) => die.fillCircle(VIEW_WIDTH / 2 + dx, 543 + dy, 7));
    this.screen.add(die);
    addText(this, this.screen, VIEW_WIDTH / 2, 627, "The game rolls once for chest type, then once for reward size.", { size: 14, color: "#b9a9b6", originX: 0.5 });
    addButton(this, this.screen, VIEW_WIDTH / 2, 710, 300, 58, "Open the Cursed Chest", () => {
      this.commit(resolveTreasureRoom(this.state, [...this.treasureRecipients]));
      this.treasureRecipients.clear();
    }, { tone: "gold", enabled: this.treasureRecipients.size === 2, fontSize: 17 });
  }

  private renderVendorRoom(): void {
    const offers = this.state.specialRoomState?.vendorOffer ?? [];
    addText(this, this.screen, 62, 226, "1. CHOOSE ONE OFFER", { size: 12, color: "#d9ad5b", style: "bold" });
    offers.forEach((card, index) => {
      const x = 170 + index * 250;
      const selected = this.vendorOfferId === card.instanceId;
      addPanel(this, this.screen, x, 342, 230, 190, { fill: selected ? 0x3c3155 : COLORS.panel, stroke: selected ? COLORS.arcaneBright : COLORS.line, radius: 14 });
      addText(this, this.screen, x, 280, fitText(card.name, 24), { size: 17, family: FONTS.display, style: "bold", width: 200, align: "center", originX: 0.5 });
      addText(this, this.screen, x, 322, fitText(card.rawText, 58), { size: 10, color: "#cbbbd0", width: 196, align: "center", originX: 0.5 });
      addButton(this, this.screen, x, 406, 186, 38, selected ? "Selected" : "Choose", () => {
        this.vendorOfferId = card.instanceId;
        this.render();
      }, { tone: selected ? "arcane" : "dark", fontSize: 11 });
    });

    addText(this, this.screen, 62, 474, "2. PAY TWO PARTY ITEMS", { size: 12, color: "#d9ad5b", style: "bold" });
    const owned = this.state.players.flatMap((player) => player.inventory.map((card) => ({ player, card })));
    owned.slice(0, 8).forEach(({ player, card }, index) => {
      const selected = this.vendorPayments.has(card.instanceId);
      addButton(this, this.screen, 165 + (index % 4) * 246, 530 + Math.floor(index / 4) * 52, 224, 40, `${player.position}: ${fitText(card.name, 20)}`, () => {
        if (selected) this.vendorPayments.delete(card.instanceId);
        else if (this.vendorPayments.size < 2) this.vendorPayments.set(card.instanceId, { playerId: player.id, lootInstanceId: card.instanceId });
        this.render();
      }, { tone: selected ? "danger" : "dark", fontSize: 11 });
    });
    if (owned.length === 0) addText(this, this.screen, 62, 519, "The party has no loot to trade.", { size: 14, color: "#786b76" });

    addText(this, this.screen, 62, 642, "3. CHOOSE RECIPIENT", { size: 12, color: "#d9ad5b", style: "bold" });
    this.state.players.forEach((player, index) => {
      addButton(this, this.screen, 165 + index * 246, 694, 224, 42, `${player.position} · ${fitText(player.name, 19)}`, () => {
        this.vendorRecipientId = player.id;
        this.render();
      }, { tone: this.vendorRecipientId === player.id ? "success" : "dark", fontSize: 11 });
    });
    const ready = Boolean(this.vendorOfferId && this.vendorRecipientId && this.vendorPayments.size === 2);
    addButton(this, this.screen, 1130, 690, 260, 54, "Complete 2-for-1 Trade", () => {
      if (!this.vendorOfferId || !this.vendorRecipientId) return;
      const next = resolveVendorTrade(this.state, this.vendorOfferId, this.vendorRecipientId, [...this.vendorPayments.values()]);
      this.vendorOfferId = null;
      this.vendorRecipientId = null;
      this.vendorPayments.clear();
      this.commit(next);
    }, { tone: "arcane", enabled: ready, fontSize: 15 });
    addButton(this, this.screen, 1130, 758, 260, 48, "Leave Without Trading", () => {
      this.vendorPayments.clear();
      this.commit(leaveVendor(this.state));
    }, { tone: "dark", fontSize: 13 });
  }

  private renderWitchRoom(): void {
    addPanel(this, this.screen, VIEW_WIDTH / 2, 500, 900, 470, { fill: 0x2a1d35, stroke: COLORS.arcaneBright, radius: 26 });
    const orb = this.add.graphics();
    orb.fillStyle(0x6c55a6, 0.9);
    orb.fillCircle(VIEW_WIDTH / 2, 430, 86);
    orb.lineStyle(4, COLORS.arcaneBright, 0.85);
    orb.strokeCircle(VIEW_WIDTH / 2, 430, 86);
    orb.fillStyle(0xe6d8ff, 0.7);
    orb.fillCircle(VIEW_WIDTH / 2 - 25, 401, 18);
    this.screen.add(orb);
    addText(this, this.screen, VIEW_WIDTH / 2, 294, "Choose one hero to pay 4 HP and draw until a potion appears.", { size: 20, color: "#d7c7ff", originX: 0.5 });
    this.state.players.forEach((player, index) => {
      const eligible = !player.isDead && player.hp > 0 && player.inventory.length < 3;
      addButton(this, this.screen, 435 + index * 190, 590, 172, 58, `${player.position} · ${player.hp} HP`, () => {
        this.commit(resolveWitchRoom(this.state, player.id));
      }, { tone: "arcane", enabled: eligible, fontSize: 14 });
    });
    addText(this, this.screen, VIEW_WIDTH / 2, 665, "At 4 HP or less, accepting the bargain will be fatal.", { size: 13, color: "#9c8e9a", originX: 0.5 });
  }

  private renderEndState(): void {
    const victory = this.state.phase === "VICTORY";
    const accent = victory ? COLORS.goldBright : COLORS.bloodBright;
    const fill = victory ? 0x332b1d : 0x321c24;
    addPanel(this, this.screen, VIEW_WIDTH / 2, 450, 980, 700, { fill, stroke: accent, radius: 32 });
    addPill(this, this.screen, VIEW_WIDTH / 2, 150, victory ? "DUNGEON CONQUERED" : "PARTY DEFEATED", victory ? "gold" : "danger", 224);
    addText(this, this.screen, VIEW_WIDTH / 2, 205, victory ? "The Spider Queen Falls" : "The Dungeon Claims Its Due", {
      size: 48,
      family: FONTS.display,
      style: "bold",
      color: victory ? "#fff0bd" : "#ffd2ce",
      width: 850,
      align: "center",
      originX: 0.5
    });
    addText(this, this.screen, VIEW_WIDTH / 2, 282, victory
      ? "Six rooms stand behind the party. Every choice, roll, wound, and treasure led here."
      : "Every hero has fallen in combat. The run ends, but another formation may yet prevail.", {
      size: 18,
      color: "#cbbdc7",
      width: 760,
      align: "center",
      originX: 0.5
    });
    this.state.players.forEach((player, index) => {
      const x = 405 + index * 210;
      addPanel(this, this.screen, x, 445, 190, 210, { fill: player.isDead ? 0x1a171b : 0x243329, stroke: player.isDead ? COLORS.bloodBright : COLORS.mossBright, radius: 14 });
      addPill(this, this.screen, x, 371, player.position ?? "?", player.isDead ? "danger" : "success", 44);
      addText(this, this.screen, x, 404, fitText(player.name, 20), { size: 16, family: FONTS.display, style: "bold", width: 165, align: "center", originX: 0.5 });
      addText(this, this.screen, x, 452, `${Math.max(0, player.hp)}/${player.maxHp} HP\n${player.inventory.length} loot\n${player.abilityTokens} tokens`, {
        size: 13,
        color: "#cbbdc7",
        width: 160,
        align: "center",
        originX: 0.5,
        lineSpacing: 7
      });
    });
    addPill(this, this.screen, VIEW_WIDTH / 2 - 135, 590, `${this.state.completedRoomIds.length} rooms cleared`, victory ? "gold" : "neutral", 190);
    addPill(this, this.screen, VIEW_WIDTH / 2 + 135, 590, `${this.state.turn?.actionsResolved ?? 0} tracked actions`, "arcane", 190);
    addButton(this, this.screen, VIEW_WIDTH / 2, 680, 330, 60, "Begin Another Run", () => {
      clearSavedGame();
      this.commit(startNewGame(createTitleState(dungeonCrawlContent), `run-${Date.now().toString(36)}`));
    }, { tone: "gold", fontSize: 19 });
    addButton(this, this.screen, VIEW_WIDTH / 2, 755, 330, 48, "Review Rules", () => {
      this.rulesOpen = true;
      this.render();
    }, { tone: "dark", fontSize: 14 });
  }

  private renderUtilityButtons(): void {
    addButton(this, this.screen, 1296, 50, 108, 38, "New Run", () => {
      clearSavedGame();
      this.commit(startNewGame(createTitleState(dungeonCrawlContent), `run-${Date.now().toString(36)}`));
    }, { tone: "dark", fontSize: 12 });
    addButton(this, this.screen, 1380, 50, 58, 38, "?", () => {
      this.rulesOpen = true;
      this.render();
    }, { tone: "arcane", fontSize: 16 });
  }

  private renderRulesOverlay(): void {
    const veil = this.add.rectangle(VIEW_WIDTH / 2, VIEW_HEIGHT / 2, VIEW_WIDTH, VIEW_HEIGHT, 0x07060a, 0.9).setInteractive();
    this.screen.add(veil);
    addPanel(this, this.screen, VIEW_WIDTH / 2, VIEW_HEIGHT / 2, 1080, 760, { fill: 0x1b1522, stroke: COLORS.goldBright, radius: 28 });
    addPill(this, this.screen, VIEW_WIDTH / 2, 102, "QUICK RULES", "gold", 150);
    addText(this, this.screen, VIEW_WIDTH / 2, 145, "How Dungeon Crawl Resolves the Table", {
      size: 36,
      family: FONTS.display,
      style: "bold",
      originX: 0.5
    });
    addRule(this, this.screen, 260, 202, 1180, COLORS.line, 0.7);

    const rules = [
      ["THE RUN", "Choose four heroes and assign A-D. The dungeon contains two A rooms, one special room, two B rooms, then Valeria."],
      ["PLAYER ATTACK", "Roll d6 + ACC against enemy DEF. Natural 1 always misses; natural 6 always hits; ties hit."],
      ["ENEMY ATTACK", "Each target rolls d6 + DEF against enemy ACC. Natural 1 fails; natural 6 blocks; ties block."],
      ["TURNS", "Follow the room's indexed turn ribbon. Dead actors are skipped. Repeated enemy actions remain separate slots."],
      ["DEATH", "Enemies fall at 0 HP. Heroes drop all loot and skip the room. Fallen heroes return at half HP after victory."],
      ["LOOT", "Each hero carries up to three cards. Equipment changes stats; consumables and readied items can be used from combat."],
      ["SPECIAL ROOMS", "The spring heals, treasure rolls rewards, the merchant trades two-for-one, and the Witch offers a dangerous potion bargain."],
      ["AUTOSAVE", "Stable decisions save in this browser. Continue restores the exact room, HP, turn, loot, modifiers, RNG, and log."]
    ] as const;
    rules.forEach(([title, body], index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const x = 285 + column * 520;
      const y = 232 + row * 126;
      addText(this, this.screen, x, y, title, { size: 13, color: "#d9ad5b", style: "bold" });
      addText(this, this.screen, x, y + 27, body, { size: 14, color: "#d9cbd5", width: 450, lineSpacing: 4 });
    });
    addText(this, this.screen, VIEW_WIDTH / 2, 744, "Ability tokens are tracked but not spendable in this MVP. Seeded loot is the placeholder 32-card deck.", {
      size: 13,
      color: "#9c8e9a",
      originX: 0.5
    });
    addButton(this, this.screen, VIEW_WIDTH / 2, 808, 250, 52, "Close Rules", () => {
      this.rulesOpen = false;
      this.render();
    }, { tone: "gold", fontSize: 16, shortcut: "ESC" });
  }

  private renderHpBar(x: number, y: number, width: number, hp: number, maxHp: number, color: number): void {
    const ratio = maxHp > 0 ? Phaser.Math.Clamp(hp / maxHp, 0, 1) : 0;
    const background = this.add.rectangle(x, y, width, 10, 0x0b090d, 0.9).setOrigin(0, 0.5).setStrokeStyle(1, COLORS.line, 0.65);
    const fill = this.add.rectangle(x + 1, y, Math.max(0, (width - 2) * ratio), 8, color, 1).setOrigin(0, 0.5);
    this.screen.add([background, fill]);
  }

  private enemyActionLabel(enemyId: string, actionId: string): string {
    const room = this.state.currentRoom;
    const enemy = room?.type === "combat" ? room.enemies.find((candidate) => candidate.id === enemyId) : null;
    const action = enemy?.actions.find((candidate) => candidate.id === actionId);
    return `${fitText(enemy?.name ?? "Enemy", 9)} · ${fitText(action?.name ?? actionId, 9)}`;
  }

  private enemyInitials(name: string): string {
    return name.split(/[ ,]+/).filter((word) => word.length > 2).slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "E";
  }

  private updateAccessibleStatus(): void {
    const root = document.querySelector<HTMLElement>("#ui-root");
    if (!root) return;
    const latest = this.state.log.at(-1)?.message;
    root.textContent = `${this.state.phase.replaceAll("_", " ")}. ${latest ?? "Dungeon Crawl is ready."}`;
  }
}
