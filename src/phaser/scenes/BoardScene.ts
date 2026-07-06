import Phaser from "phaser";
import type { GameState, PlayerRuntime, RuntimeRoom } from "../../game/types";

const STATE_EVENT = "dungeon-state-changed";

export class BoardScene extends Phaser.Scene {
  private layer?: Phaser.GameObjects.Container;
  private unsubscribe?: () => void;
  private currentState: GameState | null = null;

  constructor() {
    super("BoardScene");
  }

  create(): void {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<GameState>;
      this.currentState = custom.detail;
      this.draw(custom.detail);
    };
    window.addEventListener(STATE_EVENT, handler);
    this.unsubscribe = () => window.removeEventListener(STATE_EVENT, handler);
    this.scale.on("resize", () => {
      if (this.currentState) {
        this.draw(this.currentState);
      }
    });

    const bootState = (window as Window & { __DUNGEON_CRAWL_STATE__?: GameState }).__DUNGEON_CRAWL_STATE__;
    if (bootState) {
      this.currentState = bootState;
      this.draw(bootState);
    }
  }

  shutdown(): void {
    this.unsubscribe?.();
  }

  private draw(state: GameState): void {
    this.layer?.destroy(true);
    this.layer = this.add.container(0, 0);

    const width = this.scale.width;
    const height = this.scale.height;
    this.drawBackdrop(width, height);

    if (state.phase === "TITLE" || state.phase === "PARTY_SELECT" || state.phase === "POSITION_ASSIGNMENT") {
      this.drawDungeonTable(width, height, state);
      return;
    }

    if (state.currentRoom) {
      this.drawCombatRoom(width, height, state, state.currentRoom);
      return;
    }

    this.drawSpecialRoom(width, height, state);
  }

  private drawBackdrop(width: number, height: number): void {
    const graphics = this.add.graphics();
    graphics.fillGradientStyle(0x101114, 0x171719, 0x24211c, 0x121317, 1);
    graphics.fillRect(0, 0, width, height);
    graphics.lineStyle(1, 0xe8dec9, 0.08);
    for (let x = -80; x < width + 80; x += 80) {
      graphics.lineBetween(x, 0, x + 220, height);
    }
    for (let y = 80; y < height; y += 90) {
      graphics.lineBetween(0, y, width, y - 120);
    }
    this.layer?.add(graphics);
  }

  private drawDungeonTable(width: number, height: number, state: GameState): void {
    const cx = width * 0.52;
    const cy = height * 0.45;
    this.addToLayer(this.addCircle(cx, cy, Math.min(width, height) * 0.24, 0x2f2a22, 0.74));
    this.addToLayer(this.addText(cx, cy - 42, "Dungeon Crawl", 44, "#f4efe4", 0.5));
    const subtitle =
      state.phase === "PARTY_SELECT"
        ? "Choose four heroes"
        : state.phase === "POSITION_ASSIGNMENT"
          ? "Assign A / B / C / D"
          : "Local hot-seat dungeon run";
    this.addToLayer(this.addText(cx, cy + 14, subtitle, 18, "#d4a743", 0.5));

    const deckX = width * 0.68;
    for (let index = 0; index < 6; index += 1) {
      this.addToLayer(this.addCard(deckX + index * 8, cy + 115 - index * 4, 92, 126, 0x3a2e26, "ROOM", "#d4a743"));
    }
  }

  private drawCombatRoom(width: number, height: number, state: GameState, room: RuntimeRoom): void {
    const centerX = width * 0.5;
    this.addToLayer(this.addText(centerX, 34, `${room.name}  |  Round ${state.turn?.round ?? 1}`, 22, "#f4efe4", 0.5));

    const enemyY = height * 0.28;
    const enemyGap = Math.min(190, width / Math.max(3, room.enemies.length + 1));
    const enemyStart = centerX - ((room.enemies.length - 1) * enemyGap) / 2;
    room.enemies.forEach((enemy, index) => {
      const x = enemyStart + index * enemyGap;
      const tone = enemy.dead ? 0x4b4a4a : enemy.passives.length ? 0x7b4b62 : 0x604633;
      this.addToLayer(this.addCard(x, enemyY, 138, 96, tone, enemy.name, enemy.dead ? "#9f9a8d" : "#f4efe4"));
      this.addToLayer(this.addHpBar(x - 55, enemyY + 24, 110, enemy.hp, enemy.maxHp, enemy.dead));
      this.addToLayer(this.addText(x, enemyY + 46, `${enemy.hp}/${enemy.maxHp} HP`, 12, "#c6bdad", 0.5));
    });

    const players = orderedPlayers(state.selectedPlayers);
    const playerY = height * 0.69;
    const playerGap = Math.min(176, width / 5);
    const playerStart = centerX - ((players.length - 1) * playerGap) / 2;
    players.forEach((player, index) => {
      const x = playerStart + index * playerGap;
      this.drawPlayerToken(x, playerY, player);
    });

    this.drawProgressPips(width, height, state);
  }

  private drawSpecialRoom(width: number, height: number, state: GameState): void {
    const centerX = width * 0.52;
    const centerY = height * 0.44;
    this.addToLayer(this.addCircle(centerX, centerY, Math.min(width, height) * 0.18, 0x263344, 0.7));
    const label =
      state.phase === "LOOT_REWARD"
        ? "Loot Reward"
        : state.phase === "VICTORY"
          ? "Victory"
          : state.phase === "DEFEAT"
            ? "Defeat"
            : "Special Room";
    this.addToLayer(this.addText(centerX, centerY - 14, label, 34, "#f4efe4", 0.5));
    this.addToLayer(this.addText(centerX, centerY + 28, "Resolve the table action in the overlay", 15, "#d4a743", 0.5));
    this.drawProgressPips(width, height, state);
  }

  private drawPlayerToken(x: number, y: number, player: PlayerRuntime): void {
    const color = player.dead ? 0x454545 : 0x2f4e47;
    this.addToLayer(this.addCard(x, y, 132, 88, color, `${player.position ?? "?"}: ${player.name.split(",")[0]}`, player.dead ? "#9f9a8d" : "#f4efe4"));
    this.addToLayer(this.addHpBar(x - 51, y + 22, 102, player.hp, player.maxHp, player.dead));
    this.addToLayer(this.addText(x, y + 44, `${player.hp}/${player.maxHp} HP`, 12, "#c6bdad", 0.5));
  }

  private drawProgressPips(width: number, height: number, state: GameState): void {
    const total = state.completedRooms.length + state.playDeck.length + (state.currentRoom || state.currentSpecialId ? 1 : 0);
    const completed = state.completedRooms.length;
    const y = height - 34;
    const startX = width * 0.5 - ((Math.max(total, 6) - 1) * 22) / 2;
    for (let index = 0; index < Math.max(total, 6); index += 1) {
      const graphics = this.add.graphics();
      graphics.fillStyle(index < completed ? 0xd4a743 : index === completed ? 0x7da0b7 : 0x5d564b, 0.95);
      graphics.fillCircle(startX + index * 22, y, 7);
      this.addToLayer(graphics);
    }
  }

  private addCard(
    x: number,
    y: number,
    width: number,
    height: number,
    fill: number,
    label: string,
    color: string
  ): Phaser.GameObjects.Container {
    const container = this.add.container(x, y);
    const graphics = this.add.graphics();
    graphics.fillStyle(fill, 0.92);
    graphics.lineStyle(1, 0xe8dec9, 0.22);
    graphics.fillRoundedRect(-width / 2, -height / 2, width, height, 8);
    graphics.strokeRoundedRect(-width / 2, -height / 2, width, height, 8);
    container.add(graphics);
    container.add(this.addText(0, -height * 0.18, label, 13, color, 0.5, width - 16));
    return container;
  }

  private addCircle(x: number, y: number, radius: number, color: number, alpha: number): Phaser.GameObjects.Graphics {
    const graphics = this.add.graphics();
    graphics.fillStyle(color, alpha);
    graphics.lineStyle(2, 0xd4a743, 0.28);
    graphics.fillCircle(x, y, radius);
    graphics.strokeCircle(x, y, radius);
    return graphics;
  }

  private addHpBar(
    x: number,
    y: number,
    width: number,
    hp: number,
    maxHp: number,
    dead: boolean
  ): Phaser.GameObjects.Graphics {
    const graphics = this.add.graphics();
    const pct = maxHp > 0 ? Phaser.Math.Clamp(hp / maxHp, 0, 1) : 0;
    graphics.fillStyle(0x111114, 0.86);
    graphics.fillRoundedRect(x, y, width, 7, 4);
    graphics.fillStyle(dead ? 0x777777 : pct < 0.33 ? 0xe0645f : pct < 0.66 ? 0xd4a743 : 0x83a866, 0.94);
    graphics.fillRoundedRect(x, y, width * pct, 7, 4);
    return graphics;
  }

  private addText(
    x: number,
    y: number,
    text: string,
    size: number,
    color: string,
    origin = 0,
    wrapWidth?: number
  ): Phaser.GameObjects.Text {
    const object = this.add.text(x, y, text, {
      color,
      fontFamily: "Inter, Arial, sans-serif",
      fontSize: `${size}px`,
      align: "center",
      wordWrap: wrapWidth ? { width: wrapWidth } : undefined
    });
    object.setOrigin(origin, 0.5);
    return object;
  }

  private addToLayer(object: Phaser.GameObjects.GameObject): void {
    this.layer?.add(object);
  }
}

function orderedPlayers(players: PlayerRuntime[]): PlayerRuntime[] {
  return [...players].sort((a, b) => {
    const aPosition = a.position ?? "D";
    const bPosition = b.position ?? "D";
    return aPosition.localeCompare(bPosition);
  });
}
