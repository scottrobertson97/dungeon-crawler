import Phaser from "phaser";

export const VIEW_WIDTH = 1440;
export const VIEW_HEIGHT = 900;

export const COLORS = {
  ink: 0x0d0b14,
  void: 0x15101e,
  panel: 0x21182a,
  panelRaised: 0x2c2035,
  panelSoft: 0x35273d,
  line: 0x66536d,
  gold: 0xd9ad5b,
  goldBright: 0xf3cf7a,
  parchment: 0xf7eed6,
  muted: 0xb9a9b6,
  blood: 0x9f3c4c,
  bloodBright: 0xe26369,
  moss: 0x49755c,
  mossBright: 0x75b58c,
  arcane: 0x6c55a6,
  arcaneBright: 0xa98be5,
  blue: 0x45718a,
  blueBright: 0x74bad4,
  shadow: 0x08060b
} as const;

export const FONTS = {
  display: "Georgia, Times New Roman, serif",
  body: "Inter, Segoe UI, system-ui, sans-serif",
  mono: "Cascadia Mono, Consolas, monospace"
} as const;

export type ButtonTone = "gold" | "dark" | "danger" | "success" | "arcane";

export type UiButton = Phaser.GameObjects.Container & {
  setEnabled: (enabled: boolean) => UiButton;
};

export function addButton(
  scene: Phaser.Scene,
  parent: Phaser.GameObjects.Container,
  x: number,
  y: number,
  width: number,
  height: number,
  text: string,
  onClick: () => void,
  options: {
    tone?: ButtonTone;
    enabled?: boolean;
    fontSize?: number;
    shortcut?: string;
  } = {}
): UiButton {
  const tone = options.tone ?? "dark";
  const palette = buttonPalette(tone);
  const fontSize = options.fontSize ?? 17;
  const wordWrapWidth = width - 26;
  const container = scene.add.container(x, y) as UiButton;
  const shadow = scene.add.rectangle(4, 5, width, height, COLORS.shadow, 0.58).setOrigin(0.5);
  const surface = scene.add
    .rectangle(0, 0, width, height, palette.fill, 1)
    .setOrigin(0.5)
    .setStrokeStyle(2, palette.stroke, 1);
  const label = scene.add
    .text(options.shortcut ? -width / 2 + 16 : 0, 0, text, {
      color: palette.text,
      fontFamily: FONTS.body,
      fontSize: `${fontSize}px`,
      fontStyle: "700",
      align: options.shortcut ? "left" : "center",
      wordWrap: wordWrapWidth >= fontSize
        ? { width: wordWrapWidth, useAdvancedWrap: true }
        : undefined
    })
    .setOrigin(options.shortcut ? 0 : 0.5, 0.5);
  const shortcut = options.shortcut
    ? scene.add
        .text(width / 2 - 16, 0, options.shortcut, {
          color: "#d2c4ce",
          fontFamily: FONTS.mono,
          fontSize: "13px",
          fontStyle: "700"
        })
        .setOrigin(1, 0.5)
    : null;

  container.add([shadow, surface, label]);
  if (shortcut) container.add(shortcut);
  container.setSize(width, height).setInteractive({ useHandCursor: true });

  let enabled = options.enabled ?? true;
  const applyEnabled = () => {
    container.setAlpha(enabled ? 1 : 0.42);
    if (container.input) container.input.cursor = enabled ? "pointer" : "default";
  };

  container.on("pointerover", () => {
    if (!enabled) return;
    surface.setFillStyle(palette.hover);
    container.setScale(1.015);
  });
  container.on("pointerout", () => {
    surface.setFillStyle(palette.fill);
    container.setScale(1);
  });
  container.on("pointerdown", () => {
    if (!enabled) return;
    surface.setFillStyle(palette.down);
    container.setScale(0.99);
  });
  container.on("pointerup", () => {
    if (!enabled) return;
    surface.setFillStyle(palette.hover);
    container.setScale(1.015);
    onClick();
  });

  container.setEnabled = (nextEnabled: boolean) => {
    enabled = nextEnabled;
    applyEnabled();
    return container;
  };
  applyEnabled();
  parent.add(container);
  return container;
}

export function addPanel(
  scene: Phaser.Scene,
  parent: Phaser.GameObjects.Container,
  x: number,
  y: number,
  width: number,
  height: number,
  options: { fill?: number; alpha?: number; stroke?: number; radius?: number } = {}
): Phaser.GameObjects.Graphics {
  const graphics = scene.add.graphics();
  const radius = options.radius ?? 16;
  graphics.fillStyle(COLORS.shadow, 0.45);
  graphics.fillRoundedRect(x - width / 2 + 5, y - height / 2 + 7, width, height, radius);
  graphics.fillStyle(options.fill ?? COLORS.panel, options.alpha ?? 0.97);
  graphics.fillRoundedRect(x - width / 2, y - height / 2, width, height, radius);
  graphics.lineStyle(2, options.stroke ?? COLORS.line, 0.9);
  graphics.strokeRoundedRect(x - width / 2, y - height / 2, width, height, radius);
  parent.add(graphics);
  return graphics;
}

export function addText(
  scene: Phaser.Scene,
  parent: Phaser.GameObjects.Container,
  x: number,
  y: number,
  text: string,
  options: {
    size?: number;
    color?: string;
    family?: string;
    style?: "normal" | "bold" | "italic" | "bold italic";
    width?: number;
    align?: "left" | "center" | "right" | "justify";
    originX?: number;
    originY?: number;
    lineSpacing?: number;
  } = {}
): Phaser.GameObjects.Text {
  const object = scene.add
    .text(x, y, text, {
      color: options.color ?? "#f7eed6",
      fontFamily: options.family ?? FONTS.body,
      fontSize: `${options.size ?? 18}px`,
      fontStyle: options.style ?? "normal",
      align: options.align ?? "left",
      lineSpacing: options.lineSpacing ?? 3,
      wordWrap: options.width ? { width: options.width, useAdvancedWrap: true } : undefined
    })
    .setOrigin(options.originX ?? 0, options.originY ?? 0);
  parent.add(object);
  return object;
}

export function addRule(
  scene: Phaser.Scene,
  parent: Phaser.GameObjects.Container,
  x1: number,
  y: number,
  x2: number,
  color = COLORS.line,
  alpha = 0.65
): Phaser.GameObjects.Graphics {
  const graphics = scene.add.graphics();
  graphics.lineStyle(1, color, alpha);
  graphics.lineBetween(x1, y, x2, y);
  parent.add(graphics);
  return graphics;
}

export function addPill(
  scene: Phaser.Scene,
  parent: Phaser.GameObjects.Container,
  x: number,
  y: number,
  text: string,
  tone: "neutral" | "gold" | "danger" | "success" | "arcane" = "neutral",
  width?: number
): Phaser.GameObjects.Container {
  const palettes = {
    neutral: { fill: COLORS.panelSoft, stroke: COLORS.line, text: "#d8cbd5" },
    gold: { fill: 0x594324, stroke: COLORS.gold, text: "#f6d98d" },
    danger: { fill: 0x562833, stroke: COLORS.bloodBright, text: "#ffb1ae" },
    success: { fill: 0x274637, stroke: COLORS.mossBright, text: "#b9edc9" },
    arcane: { fill: 0x3d315f, stroke: COLORS.arcaneBright, text: "#d7c7ff" }
  };
  const palette = palettes[tone];
  const measuredWidth = width ?? Math.max(54, 18 + text.length * 8.1);
  const container = scene.add.container(x, y);
  const bg = scene.add.rectangle(0, 0, measuredWidth, 28, palette.fill).setStrokeStyle(1, palette.stroke).setOrigin(0.5);
  const label = scene.add
    .text(0, 0, text, { color: palette.text, fontFamily: FONTS.body, fontSize: "13px", fontStyle: "700" })
    .setOrigin(0.5);
  container.add([bg, label]);
  parent.add(container);
  return container;
}

export function addDungeonBackdrop(scene: Phaser.Scene, parent: Phaser.GameObjects.Container): void {
  const graphics = scene.add.graphics();
  graphics.fillGradientStyle(0x17101f, 0x17101f, 0x08070d, 0x08070d, 1);
  graphics.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);

  graphics.lineStyle(1, 0x6b5873, 0.08);
  for (let x = -120; x < VIEW_WIDTH + 120; x += 120) {
    graphics.lineBetween(x, 0, x + 280, VIEW_HEIGHT);
  }
  for (let y = 80; y < VIEW_HEIGHT; y += 80) {
    graphics.lineBetween(0, y, VIEW_WIDTH, y);
  }

  graphics.fillStyle(COLORS.gold, 0.08);
  graphics.fillCircle(90, 100, 250);
  graphics.fillStyle(COLORS.arcane, 0.08);
  graphics.fillCircle(VIEW_WIDTH - 80, VIEW_HEIGHT - 40, 320);
  parent.add(graphics);
}

export function fitText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function buttonPalette(tone: ButtonTone) {
  switch (tone) {
    case "gold":
      return { fill: 0x765425, hover: 0x936b2f, down: 0x5d401d, stroke: COLORS.goldBright, text: "#fff0bd" };
    case "danger":
      return { fill: 0x622c38, hover: 0x813b48, down: 0x4d222c, stroke: COLORS.bloodBright, text: "#ffd2ce" };
    case "success":
      return { fill: 0x315844, hover: 0x3d7054, down: 0x274536, stroke: COLORS.mossBright, text: "#d5f6dd" };
    case "arcane":
      return { fill: 0x46366c, hover: 0x5b4789, down: 0x352851, stroke: COLORS.arcaneBright, text: "#eee7ff" };
    default:
      return { fill: COLORS.panelRaised, hover: COLORS.panelSoft, down: 0x1d1625, stroke: COLORS.line, text: "#f7eed6" };
  }
}
