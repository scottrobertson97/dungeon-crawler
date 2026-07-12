import Phaser from "phaser";

import "./styles.css";
import { DungeonScene } from "./phaser/scenes/DungeonScene";
import { VIEW_HEIGHT, VIEW_WIDTH } from "./phaser/ui";

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game",
  width: VIEW_WIDTH,
  height: VIEW_HEIGHT,
  backgroundColor: "#0d0b14",
  scene: [DungeonScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: VIEW_WIDTH,
    height: VIEW_HEIGHT
  },
  render: {
    antialias: true,
    pixelArt: false,
    roundPixels: false
  }
};

const game = new Phaser.Game(config);

window.addEventListener("beforeunload", () => {
  game.destroy(true);
});
