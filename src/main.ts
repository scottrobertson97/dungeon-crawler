import "./styles.css";
import { dungeonCrawlContent } from "./data/content";
import { createGame } from "./phaser/createGame";
import { createDungeonApp, loadInitialState } from "./ui/app";

const gameRoot = document.querySelector<HTMLElement>("#game");
const uiRoot = document.querySelector<HTMLElement>("#ui-root");

if (!gameRoot || !uiRoot) {
  throw new Error("Dungeon Crawl mount points are missing.");
}

const initialState = loadInitialState(dungeonCrawlContent);
(window as Window & { __DUNGEON_CRAWL_STATE__?: typeof initialState }).__DUNGEON_CRAWL_STATE__ = initialState;

createGame("game");
createDungeonApp(uiRoot, dungeonCrawlContent, initialState);
