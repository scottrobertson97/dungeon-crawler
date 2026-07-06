import type { AbilityDefinition, DungeonContent, GameState, PlayerRuntime } from "../game/types";
import {
  assignLoot,
  assignPosition,
  chooseVendorRecipient,
  chooseVendorTake,
  cloneState,
  completeVendorTrade,
  confirmParty,
  confirmPositions,
  continueAfterLoot,
  createTitleState,
  discardPlayerLoot,
  enterRevealedRoom,
  getCurrentRoomName,
  getCurrentTurn,
  getEnemyEffectiveStats,
  getPlayerEffectiveStats,
  isEnemyTargetable,
  resolveEnemyTurn,
  resolveHealingSpring,
  resolveTreasureRoom,
  resolveWitchTrade,
  skipVendorTrade,
  startNewGame,
  toggleCharacterSelection,
  toggleVendorPayment,
  transferPlayerLoot,
  useLootCard,
  usePlayerAbility
} from "../game/engine";
import { clearSaveGame as clearStoredSave, hasSaveGame, loadGame, saveGame } from "../game/save";

const STATE_EVENT = "dungeon-state-changed";

export class DungeonApp {
  private state: GameState;
  private showRules = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly content: DungeonContent,
    initialState: GameState
  ) {
    this.state = initialState;
    this.root.addEventListener("click", (event) => this.handleClick(event));
    this.root.addEventListener("change", (event) => this.handleChange(event));
    this.render();
    this.publish();
  }

  private setState(state: GameState): void {
    this.state = state;
    saveGame(state);
    this.render();
    this.publish();
  }

  private publish(): void {
    (window as Window & { __DUNGEON_CRAWL_STATE__?: GameState }).__DUNGEON_CRAWL_STATE__ = this.state;
    window.dispatchEvent(new CustomEvent(STATE_EVENT, { detail: this.state }));
  }

  private handleClick(event: Event): void {
    const target = event.target as HTMLElement;
    const button = target.closest<HTMLButtonElement>("button[data-action]");
    if (!button) {
      return;
    }
    const action = button.dataset.action;
    if (!action) {
      return;
    }

    if (action === "new-game") {
      clearStoredSave();
      this.setState(startNewGame(this.content));
      return;
    }
    if (action === "continue-game") {
      const save = loadGame();
      if (save) {
        this.setState(save);
      }
      return;
    }
    if (action === "restart") {
      clearStoredSave();
      this.setState(startNewGame(this.content));
      return;
    }
    if (action === "clear-save") {
      clearStoredSave();
      this.setState({ ...this.state, phase: "TITLE" });
      return;
    }
    if (action === "rules") {
      this.showRules = !this.showRules;
      this.render();
      return;
    }
    if (action === "select-character") {
      this.setState(toggleCharacterSelection(this.state, requiredDataset(button, "characterId")));
      return;
    }
    if (action === "confirm-party") {
      this.setState(confirmParty(this.state, this.content));
      return;
    }
    if (action === "confirm-positions") {
      this.setState(confirmPositions(this.state, this.content));
      return;
    }
    if (action === "enter-room") {
      this.setState(enterRevealedRoom(this.state, this.content));
      return;
    }
    if (action === "use-ability") {
      this.setState(
        usePlayerAbility(
          this.state,
          this.content,
          requiredDataset(button, "playerId"),
          requiredDataset(button, "abilityId"),
          parseCsv(button.dataset.targets)
        )
      );
      return;
    }
    if (action === "use-ability-allocated") {
      const allocation = this.readAllocation(requiredDataset(button, "abilityId"));
      this.setState(
        usePlayerAbility(
          this.state,
          this.content,
          requiredDataset(button, "playerId"),
          requiredDataset(button, "abilityId"),
          Object.keys(allocation),
          allocation
        )
      );
      return;
    }
    if (action === "resolve-enemy") {
      this.setState(resolveEnemyTurn(this.state, this.content));
      return;
    }
    if (action === "assign-loot") {
      this.setState(assignLoot(this.state, this.content, requiredDataset(button, "lootId"), button.dataset.playerId ?? null));
      return;
    }
    if (action === "continue-loot") {
      this.setState(continueAfterLoot(this.state, this.content));
      return;
    }
    if (action === "discard-player-loot") {
      this.setState(
        discardPlayerLoot(
          this.state,
          this.content,
          requiredDataset(button, "playerId"),
          requiredDataset(button, "lootId")
        )
      );
      return;
    }
    if (action === "transfer-loot") {
      this.setState(
        transferPlayerLoot(
          this.state,
          this.content,
          requiredDataset(button, "fromPlayerId"),
          requiredDataset(button, "toPlayerId"),
          requiredDataset(button, "lootId")
        )
      );
      return;
    }
    if (action === "use-loot") {
      this.setState(useLootCard(this.state, this.content, requiredDataset(button, "playerId"), requiredDataset(button, "lootId")));
      return;
    }
    if (action === "spring") {
      this.setState(resolveHealingSpring(this.state, this.content));
      return;
    }
    if (action === "witch") {
      this.setState(resolveWitchTrade(this.state, this.content, requiredDataset(button, "playerId")));
      return;
    }
    if (action === "treasure") {
      this.setState(resolveTreasureRoom(this.state, this.content));
      return;
    }
    if (action === "vendor-pay") {
      this.setState(toggleVendorPayment(this.state, requiredDataset(button, "lootId")));
      return;
    }
    if (action === "vendor-take") {
      this.setState(chooseVendorTake(this.state, requiredDataset(button, "lootId")));
      return;
    }
    if (action === "vendor-recipient") {
      this.setState(chooseVendorRecipient(this.state, requiredDataset(button, "playerId")));
      return;
    }
    if (action === "vendor-complete") {
      this.setState(completeVendorTrade(this.state, this.content));
      return;
    }
    if (action === "vendor-skip") {
      this.setState(skipVendorTrade(this.state, this.content));
    }
  }

  private handleChange(event: Event): void {
    const target = event.target as HTMLSelectElement;
    if (target.dataset.action !== "assign-position") {
      return;
    }
    const next = assignPosition(this.state, requiredDataset(target, "playerId"), target.value as "A" | "B" | "C" | "D");
    this.setState(next);
  }

  private render(): void {
    if (["TITLE", "PARTY_SELECT", "POSITION_ASSIGNMENT"].includes(this.state.phase)) {
      this.root.innerHTML = this.renderSetupScreen();
      return;
    }

    this.root.innerHTML = `
      <section class="app-shell">
        <div class="stack">${this.renderPartyPanel()}${this.renderInventoryPanel()}</div>
        <div class="stack center-stack">${this.renderMainPanel()}</div>
        <div class="stack">${this.renderRoomPanel()}${this.renderLog()}</div>
      </section>
      ${this.showRules ? this.renderRulesModal() : ""}
    `;
  }

  private renderSetupScreen(): string {
    if (this.state.phase === "TITLE") {
      return `
        <section class="overlay-full">
          <div class="modal">
            <div class="panel">
              <h1>Dungeon Crawl</h1>
              <p class="muted">A local hot-seat tabletop dungeon run with automated dice, turns, room flow, loot, and seeded encounters.</p>
              <div class="title-actions">
                <button class="primary" data-action="new-game">New Game</button>
                <button data-action="continue-game" ${hasSaveGame() ? "" : "disabled"}>Continue Game</button>
                <button data-action="rules">Rules Summary</button>
              </div>
            </div>
            ${this.showRules ? this.renderRulesBody() : ""}
          </div>
        </section>
      `;
    }

    if (this.state.phase === "PARTY_SELECT") {
      return `
        <section class="overlay-full">
          <div class="modal">
            <div class="row">
              <h2>Choose 4 Heroes</h2>
              <span class="badge warn">${this.state.selectedCharacterIds.length}/4 selected</span>
            </div>
            <div class="grid two">
              ${this.content.characters.map((character) => this.renderCharacterCard(character.id)).join("")}
            </div>
            <div class="title-actions">
              <button class="primary" data-action="confirm-party" ${this.state.selectedCharacterIds.length === 4 ? "" : "disabled"}>Confirm Party</button>
              <button data-action="rules">Rules Summary</button>
            </div>
            ${this.showRules ? this.renderRulesBody() : ""}
          </div>
        </section>
      `;
    }

    return `
      <section class="overlay-full">
        <div class="modal">
          <h2>Assign Turn Positions</h2>
          <p class="muted">Each combat room uses A, B, C, and D in its turn ribbon.</p>
          <div class="grid four">
            ${this.state.selectedPlayers.map((player) => this.renderPositionCard(player)).join("")}
          </div>
          <div class="title-actions">
            <button class="primary" data-action="confirm-positions" ${this.positionsComplete() ? "" : "disabled"}>Build Dungeon</button>
          </div>
        </div>
      </section>
    `;
  }

  private renderCharacterCard(characterId: string): string {
    const character = this.content.characters.find((candidate) => candidate.id === characterId);
    if (!character) {
      return "";
    }
    const selected = this.state.selectedCharacterIds.includes(character.id);
    const disabled = !selected && this.state.selectedCharacterIds.length >= 4;
    return `
      <article class="card ${selected ? "selected" : ""}">
        <h3>${escapeHtml(character.name)}</h3>
        <p class="muted small">${escapeHtml(character.role ?? "adventurer")}</p>
        <div class="stat-line">
          <span class="badge">HP ${character.stats.maxHp}</span>
          <span class="badge">ACC ${character.stats.acc}</span>
          <span class="badge">DEF ${character.stats.def}</span>
        </div>
        <div class="ability-list">
          ${character.abilities.map((ability) => `<p class="small"><strong>${escapeHtml(ability.name)}</strong>: ${escapeHtml(ability.rawText)}</p>`).join("")}
        </div>
        <button data-action="select-character" data-character-id="${escapeAttr(character.id)}" ${disabled ? "disabled" : ""}>${selected ? "Remove" : "Select"}</button>
      </article>
    `;
  }

  private renderPositionCard(player: PlayerRuntime): string {
    return `
      <article class="card">
        <h3>${escapeHtml(player.name)}</h3>
        <label class="small muted" for="pos-${escapeAttr(player.id)}">Position</label>
        <select id="pos-${escapeAttr(player.id)}" data-action="assign-position" data-player-id="${escapeAttr(player.id)}">
          <option value="">Choose</option>
          ${["A", "B", "C", "D"].map((position) => `<option value="${position}" ${player.position === position ? "selected" : ""}>${position}</option>`).join("")}
        </select>
      </article>
    `;
  }

  private renderPartyPanel(): string {
    return `
      <section class="panel">
        <div class="row">
          <h2>Party</h2>
          <span class="badge">Room ${Math.min(this.state.roomNumber + 1, 6)} / 6</span>
        </div>
        <div class="grid">
          ${orderedPlayers(this.state.selectedPlayers).map((player) => this.renderPlayerCard(player)).join("")}
        </div>
      </section>
    `;
  }

  private renderPlayerCard(player: PlayerRuntime): string {
    const stats = getPlayerEffectiveStats(this.state, this.content, player);
    const hpPct = stats.maxHp > 0 ? Math.max(0, Math.min(100, (player.hp / stats.maxHp) * 100)) : 0;
    const mods = this.state.modifiers.filter((modifier) => modifier.targetKind === "player" && modifier.targetId === player.id);
    return `
      <article class="card ${player.dead ? "dead" : ""}">
        <div class="row">
          <h3>${escapeHtml(player.position ?? "?")}: ${escapeHtml(player.name)}</h3>
          ${player.dead ? `<span class="badge danger">down</span>` : ""}
        </div>
        <div class="hp-bar"><div class="hp-fill" style="width:${hpPct}%"></div></div>
        <div class="stat-line">
          <span class="badge">HP ${player.hp}/${stats.maxHp}</span>
          <span class="badge">ACC ${stats.acc}</span>
          <span class="badge">DEF ${stats.def}</span>
          <span class="badge">DMG +${stats.dmg}</span>
          <span class="badge warn">Tokens ${player.abilityTokens}</span>
        </div>
        <div class="badge-line">
          ${mods.map((modifier) => `<span class="badge ${modifier.amount < 0 ? "danger" : "good"}">${escapeHtml(modifier.label)} ${modifier.amount > 0 ? "+" : ""}${modifier.amount} ${modifier.stat.toUpperCase()}</span>`).join("")}
          ${this.state.pendingPlayerReroll?.playerId === player.id ? `<span class="badge good">reroll ready</span>` : ""}
        </div>
      </article>
    `;
  }

  private renderInventoryPanel(): string {
    if (this.state.selectedPlayers.length === 0) {
      return "";
    }
    return `
      <section class="panel">
        <h2>Loot</h2>
        <div class="grid">
          ${orderedPlayers(this.state.selectedPlayers).map((player) => this.renderPlayerLoot(player)).join("")}
        </div>
      </section>
    `;
  }

  private renderPlayerLoot(player: PlayerRuntime): string {
    if (player.lootIds.length === 0) {
      return `<div class="small muted">${escapeHtml(player.position ?? "?")}: no loot</div>`;
    }
    return `
      <div class="card">
        <h3>${escapeHtml(player.position ?? "?")}: ${escapeHtml(player.name)}</h3>
        ${player.lootIds.map((lootId) => {
          const loot = this.loot(lootId);
          const roomUsed = (player.usedLootThisRoom ?? []).includes(loot.id);
          const canUse = loot.kind !== "equipment" && !roomUsed && !player.dead;
          return `
            <div class="row small">
              <span>${escapeHtml(loot.name)}</span>
              ${loot.kind !== "equipment" ? `<button data-action="use-loot" data-player-id="${escapeAttr(player.id)}" data-loot-id="${escapeAttr(loot.id)}" ${canUse ? "" : "disabled"}>${roomUsed ? "Used" : "Use"}</button>` : ""}
              ${orderedPlayers(this.state.selectedPlayers)
                .filter((target) => target.id !== player.id)
                .map((target) => `<button class="ghost" data-action="transfer-loot" data-from-player-id="${escapeAttr(player.id)}" data-to-player-id="${escapeAttr(target.id)}" data-loot-id="${escapeAttr(loot.id)}" ${target.lootIds.length >= 3 ? "disabled" : ""}>Move ${escapeHtml(target.position ?? "?")}</button>`)
                .join("")}
              <button class="ghost" data-action="discard-player-loot" data-player-id="${escapeAttr(player.id)}" data-loot-id="${escapeAttr(loot.id)}">Discard</button>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  private renderMainPanel(): string {
    if (this.state.phase === "ROOM_REVEAL") {
      return `
        <section class="panel">
          <h2>${escapeHtml(getCurrentRoomName(this.state, this.content))}</h2>
          <p class="muted">${this.state.currentRoom ? "Combat room" : this.special(this.state.currentSpecialId)?.rawText ?? ""}</p>
          <button class="primary" data-action="enter-room">Enter</button>
        </section>
      `;
    }
    if (this.state.phase === "COMBAT") {
      return this.renderCombatActions();
    }
    if (this.state.phase === "LOOT_REWARD") {
      return this.renderLootReward();
    }
    if (this.state.phase === "SPECIAL_ROOM") {
      return this.renderSpecialRoom();
    }
    if (this.state.phase === "VICTORY" || this.state.phase === "DEFEAT") {
      return `
        <section class="panel">
          <h2>${this.state.phase === "VICTORY" ? "Victory" : "Defeat"}</h2>
          <p class="muted">${this.state.phase === "VICTORY" ? "The party survived the dungeon." : "The dungeon claims the party."}</p>
          <button class="primary" data-action="restart">New Run</button>
        </section>
      `;
    }
    return "";
  }

  private renderCombatActions(): string {
    const turn = getCurrentTurn(this.state);
    if (!turn) {
      return `<section class="panel"><h2>Combat</h2><p class="muted">No current turn.</p></section>`;
    }
    return `
      <section class="panel">
        <div class="row">
          <h2>Current Turn</h2>
          <span class="badge warn">${escapeHtml(turn.label)}</span>
        </div>
        ${this.renderTurnRibbon()}
        ${turn.kind === "enemy" ? this.renderEnemyAction(turn.label) : this.renderPlayerAction(turn.player)}
      </section>
    `;
  }

  private renderTurnRibbon(): string {
    const room = this.state.currentRoom;
    if (!room || !this.state.turn) {
      return "";
    }
    return `
      <div class="turn-ribbon">
        ${room.turnOrder.map((slot, index) => `<span class="turn-chip ${index === this.state.turn?.index ? "active" : ""}">${escapeHtml(this.turnSlotLabel(slot))}</span>`).join("")}
      </div>
    `;
  }

  private renderEnemyAction(label: string): string {
    return `
      <div class="card">
        <h3>${escapeHtml(label)}</h3>
        <p class="muted small">Enemy actions roll blocks, apply damage, modifiers, counters, and passives automatically.</p>
        <button class="primary" data-action="resolve-enemy">Resolve Enemy Action</button>
      </div>
    `;
  }

  private renderPlayerAction(player: PlayerRuntime | null): string {
    if (!player) {
      return `<p class="muted">No hero assigned to this position.</p>`;
    }
    const character = this.content.characters.find((candidate) => candidate.id === player.characterId);
    if (!character) {
      return "";
    }
    return `
      <div class="grid">
        ${character.abilities.map((ability) => this.renderAbility(player, ability)).join("")}
      </div>
    `;
  }

  private renderAbility(player: PlayerRuntime, ability: AbilityDefinition): string {
    const effectTypes = ability.effects.map((effect) => effect.type);
    if (effectTypes.includes("passiveRevive")) {
      return `
        <article class="card">
          <h3>${escapeHtml(ability.name)}</h3>
          <p class="small muted">${escapeHtml(ability.rawText)}</p>
          <span class="badge good">passive</span>
        </article>
      `;
    }
    if (effectTypes.includes("splitDamage")) {
      return this.renderAllocatedAbility(player, ability, "enemy");
    }
    if (effectTypes.includes("splitHeal")) {
      return this.renderAllocatedAbility(player, ability, "player");
    }

    const buttons = this.renderAbilityButtons(player, ability);
    return `
      <article class="card">
        <h3>${escapeHtml(ability.name)}</h3>
        <p class="small muted">${escapeHtml(ability.rawText)}</p>
        <div class="row">${buttons}</div>
      </article>
    `;
  }

  private renderAbilityButtons(player: PlayerRuntime, ability: AbilityDefinition): string {
    const primary = ability.effects[0];
    if (!primary) {
      return "";
    }
    if (primary.type === "attackEnemies" && primary.target === "allEnemies") {
      return `<button data-action="use-ability" data-player-id="${escapeAttr(player.id)}" data-ability-id="${escapeAttr(ability.id)}" data-targets="${escapeAttr(this.targetableEnemyIds().join(","))}">Use on all enemies</button>`;
    }
    if (primary.type === "attackEnemy" || primary.type === "attackEnemies") {
      const count = typeof primary.targetCount === "number" ? primary.targetCount : 1;
      if (count > 1) {
        return `<button data-action="use-ability" data-player-id="${escapeAttr(player.id)}" data-ability-id="${escapeAttr(ability.id)}" data-targets="${escapeAttr(this.targetableEnemyIds().slice(0, count).join(","))}">Target up to ${count}</button>`;
      }
      return this.targetableEnemyIds()
        .map((enemyId) => `<button data-action="use-ability" data-player-id="${escapeAttr(player.id)}" data-ability-id="${escapeAttr(ability.id)}" data-targets="${escapeAttr(enemyId)}">${escapeHtml(this.enemyName(enemyId))}</button>`)
        .join("");
    }
    if (primary.type === "healAllAllies" || primary.type === "increaseAbilityDamage") {
      return `<button data-action="use-ability" data-player-id="${escapeAttr(player.id)}" data-ability-id="${escapeAttr(ability.id)}">Use</button>`;
    }
    if (primary.type === "healAlly" || (primary.type === "applyModifier" && primary.target === "ally")) {
      return this.state.selectedPlayers
        .filter((target) => !target.dead)
        .map((target) => `<button data-action="use-ability" data-player-id="${escapeAttr(player.id)}" data-ability-id="${escapeAttr(ability.id)}" data-targets="${escapeAttr(target.id)}">${escapeHtml(target.position ?? "?")}</button>`)
        .join("");
    }
    if (primary.type === "applyModifier" && primary.target === "selfAndAlly") {
      return this.state.selectedPlayers
        .filter((target) => target.id !== player.id && !target.dead)
        .map((target) => `<button data-action="use-ability" data-player-id="${escapeAttr(player.id)}" data-ability-id="${escapeAttr(ability.id)}" data-targets="${escapeAttr(target.id)}">Self + ${escapeHtml(target.position ?? "?")}</button>`)
        .join("");
    }
    if (primary.type === "applyModifier" && primary.target === "enemy") {
      return this.targetableEnemyIds()
        .map((enemyId) => `<button data-action="use-ability" data-player-id="${escapeAttr(player.id)}" data-ability-id="${escapeAttr(ability.id)}" data-targets="${escapeAttr(enemyId)}">${escapeHtml(this.enemyName(enemyId))}</button>`)
        .join("");
    }
    return `<button data-action="use-ability" data-player-id="${escapeAttr(player.id)}" data-ability-id="${escapeAttr(ability.id)}">Use</button>`;
  }

  private renderAllocatedAbility(player: PlayerRuntime, ability: AbilityDefinition, targetKind: "enemy" | "player"): string {
    const targets =
      targetKind === "enemy"
        ? this.targetableEnemyIds().map((enemyId) => ({ id: enemyId, label: this.enemyName(enemyId) }))
        : this.state.selectedPlayers.filter((target) => !target.dead).map((target) => ({ id: target.id, label: `${target.position}: ${target.name}` }));
    const effect = ability.effects.find((candidate) => candidate.type === "splitDamage" || candidate.type === "splitHeal");
    const total = typeof effect?.totalDamage === "number" ? effect.totalDamage : typeof effect?.totalHealing === "number" ? effect.totalHealing : 0;
    return `
      <article class="card">
        <h3>${escapeHtml(ability.name)}</h3>
        <p class="small muted">${escapeHtml(ability.rawText)} Allocate exactly ${total}.</p>
        <div class="split-control">
          ${targets.map((target) => `
            <label>
              <span>${escapeHtml(target.label)}</span>
              <input type="number" min="0" max="${total}" value="0" data-allocation-ability="${escapeAttr(ability.id)}" data-allocation-for="${escapeAttr(target.id)}" />
            </label>
          `).join("")}
        </div>
        <button data-action="use-ability-allocated" data-player-id="${escapeAttr(player.id)}" data-ability-id="${escapeAttr(ability.id)}">Resolve Allocation</button>
      </article>
    `;
  }

  private renderLootReward(): string {
    return `
      <section class="panel">
        <h2>Loot Reward</h2>
        <p class="muted">Assign each card to a hero with fewer than three loot cards, or discard it.</p>
        <div class="grid">
          ${this.state.pendingLootReward.map((lootId) => this.renderPendingLoot(lootId)).join("") || `<p class="muted">No pending loot.</p>`}
        </div>
        <button class="primary" data-action="continue-loot" ${this.state.pendingLootReward.length === 0 ? "" : "disabled"}>Continue</button>
      </section>
    `;
  }

  private renderPendingLoot(lootId: string): string {
    const loot = this.loot(lootId);
    return `
      <article class="card">
        <h3>${escapeHtml(loot.name)}</h3>
        <p class="small muted">${escapeHtml(loot.rawText)}</p>
        <div class="row">
          ${orderedPlayers(this.state.selectedPlayers).map((player) => `<button data-action="assign-loot" data-loot-id="${escapeAttr(loot.id)}" data-player-id="${escapeAttr(player.id)}" ${player.lootIds.length >= 3 ? "disabled" : ""}>${escapeHtml(player.position ?? "?")}</button>`).join("")}
          <button class="danger" data-action="assign-loot" data-loot-id="${escapeAttr(loot.id)}">Discard</button>
        </div>
      </article>
    `;
  }

  private renderSpecialRoom(): string {
    const special = this.special(this.state.currentSpecialId);
    if (!special) {
      return `<section class="panel"><h2>Special Room</h2></section>`;
    }
    if (special.id === "healing-spring") {
      return `
        <section class="panel">
          <h2>${escapeHtml(special.name)}</h2>
          <p class="muted">${escapeHtml(special.rawText)}</p>
          <button class="primary" data-action="spring">Restore Party</button>
        </section>
      `;
    }
    if (special.id === "witch") {
      return `
        <section class="panel">
          <h2>${escapeHtml(special.name)}</h2>
          <p class="muted">${escapeHtml(special.rawText)}</p>
          <div class="row">
            ${orderedPlayers(this.state.selectedPlayers).map((player) => `<button data-action="witch" data-player-id="${escapeAttr(player.id)}" ${player.dead ? "disabled" : ""}>${escapeHtml(player.position ?? "?")} takes 4</button>`).join("")}
          </div>
        </section>
      `;
    }
    if (special.id === "treasure-room") {
      return `
        <section class="panel">
          <h2>${escapeHtml(special.name)}</h2>
          <p class="muted">${escapeHtml(special.rawText)}</p>
          <button class="primary" data-action="treasure">Roll Treasure</button>
        </section>
      `;
    }
    if (special.id === "vendor") {
      return this.renderVendor(special.name, special.rawText);
    }
    return `<section class="panel"><h2>${escapeHtml(special.name)}</h2><p class="muted">${escapeHtml(special.rawText)}</p></section>`;
  }

  private renderVendor(name: string, rawText: string): string {
    const vendor = this.state.vendor;
    if (!vendor) {
      return "";
    }
    const ownedLoot = this.state.selectedPlayers.flatMap((player) =>
      player.lootIds.map((lootId) => ({ lootId, label: `${player.position}: ${this.loot(lootId).name}` }))
    );
    return `
      <section class="panel">
        <h2>${escapeHtml(name)}</h2>
        <p class="muted">${escapeHtml(rawText)}</p>
        <h3>Pay Two</h3>
        <div class="row">
          ${ownedLoot.map((item) => `<button class="${vendor.selectedPaymentIds.includes(item.lootId) ? "selected" : ""}" data-action="vendor-pay" data-loot-id="${escapeAttr(item.lootId)}">${escapeHtml(item.label)}</button>`).join("") || `<span class="muted small">No loot to trade.</span>`}
        </div>
        <h3>Take One</h3>
        <div class="row">
          ${vendor.drawIds.map((lootId) => `<button class="${vendor.selectedTakeId === lootId ? "selected" : ""}" data-action="vendor-take" data-loot-id="${escapeAttr(lootId)}">${escapeHtml(this.loot(lootId).name)}</button>`).join("")}
        </div>
        <h3>Recipient</h3>
        <div class="row">
          ${orderedPlayers(this.state.selectedPlayers).map((player) => `<button class="${vendor.selectedRecipientId === player.id ? "selected" : ""}" data-action="vendor-recipient" data-player-id="${escapeAttr(player.id)}">${escapeHtml(player.position ?? "?")}</button>`).join("")}
        </div>
        <div class="row">
          <button class="primary" data-action="vendor-complete">Complete Trade</button>
          <button data-action="vendor-skip">Skip Trade</button>
        </div>
      </section>
    `;
  }

  private renderRoomPanel(): string {
    const room = this.state.currentRoom;
    return `
      <section class="panel">
        <div class="row">
          <h2>${escapeHtml(getCurrentRoomName(this.state, this.content))}</h2>
          <button class="ghost" data-action="rules">Rules</button>
          <button class="ghost" data-action="restart">Restart</button>
        </div>
        ${room ? this.renderEnemyCards() : `<p class="muted">${escapeHtml(this.special(this.state.currentSpecialId)?.rawText ?? "Resolve the current screen.")}</p>`}
      </section>
      ${this.showRules ? this.renderRulesModal() : ""}
    `;
  }

  private renderEnemyCards(): string {
    const room = this.state.currentRoom;
    if (!room) {
      return "";
    }
    return `
      <div class="grid">
        ${room.enemies.map((enemy) => {
          const stats = getEnemyEffectiveStats(this.state, enemy);
          const hpPct = enemy.maxHp > 0 ? Math.max(0, Math.min(100, (enemy.hp / enemy.maxHp) * 100)) : 0;
          return `
            <article class="card ${enemy.dead ? "dead" : ""}">
              <h3>${escapeHtml(enemy.name)}</h3>
              <div class="hp-bar"><div class="hp-fill" style="width:${hpPct}%"></div></div>
              <div class="stat-line">
                <span class="badge">HP ${enemy.hp}/${enemy.maxHp}</span>
                <span class="badge">ACC ${stats.acc}</span>
                <span class="badge">DEF ${stats.def}</span>
              </div>
              <div class="badge-line">
                ${Object.entries(enemy.counters).map(([key, value]) => `<span class="badge warn">${escapeHtml(key)} ${value}</span>`).join("")}
                ${enemy.dots.map((dot) => `<span class="badge danger">DOT ${dot.damage}</span>`).join("")}
                ${enemy.passives.map((passive) => `<span class="badge">${escapeHtml(passive.type)}</span>`).join("")}
              </div>
            </article>
          `;
        }).join("")}
      </div>
    `;
  }

  private renderLog(): string {
    return `
      <section class="panel">
        <h2>Run Log</h2>
        <div class="log">
          ${[...this.state.log].reverse().map((entry) => `<div class="log-entry ${entry.tone}">${escapeHtml(entry.text)}</div>`).join("")}
        </div>
      </section>
    `;
  }

  private renderRulesModal(): string {
    return `<section class="overlay-full"><div class="modal">${this.renderRulesBody()}<button data-action="rules">Close</button></div></section>`;
  }

  private renderRulesBody(): string {
    return `
      <section class="panel">
        <h2>Rules Summary</h2>
        <div class="grid two">
          <p><strong>Run:</strong> Pick 4 heroes, assign A-D, play 2 A rooms, 1 special room, 2 B rooms, then the boss.</p>
          <p><strong>Attack:</strong> d6 + ACC vs enemy DEF. Natural 1 misses, natural 6 hits, ties hit.</p>
          <p><strong>Block:</strong> d6 + DEF vs enemy ACC. Natural 1 fails, natural 6 blocks, ties block.</p>
          <p><strong>Loot:</strong> A hero can carry 3 cards. Placeholder loot is used until the full deck exists.</p>
        </div>
      </section>
    `;
  }

  private readAllocation(abilityId: string): Record<string, number> {
    const allocation: Record<string, number> = {};
    this.root
      .querySelectorAll<HTMLInputElement>(`input[data-allocation-ability="${cssEscape(abilityId)}"]`)
      .forEach((input) => {
        const id = input.dataset.allocationFor;
        if (id) {
          allocation[id] = Number(input.value) || 0;
        }
      });
    return allocation;
  }

  private positionsComplete(): boolean {
    return new Set(this.state.selectedPlayers.map((player) => player.position).filter(Boolean)).size === 4;
  }

  private targetableEnemyIds(): string[] {
    const room = this.state.currentRoom;
    if (!room) {
      return [];
    }
    return room.enemies.filter((enemy) => isEnemyTargetable(room, enemy)).map((enemy) => enemy.id);
  }

  private enemyName(enemyId: string): string {
    return this.state.currentRoom?.enemies.find((enemy) => enemy.id === enemyId)?.name ?? enemyId;
  }

  private turnSlotLabel(slot: string): string {
    if (slot.startsWith("player:")) {
      return slot.replace("player:", "");
    }
    const [, enemyId, actionId] = slot.split(":");
    const enemy = this.state.currentRoom?.enemies.find((candidate) => candidate.id === enemyId);
    const action = enemy?.actions.find((candidate) => candidate.id === actionId);
    return `${enemy?.name ?? enemyId}: ${action?.name ?? actionId}`;
  }

  private loot(lootId: string) {
    const loot = this.content.starterLoot.find((candidate) => candidate.id === lootId);
    if (!loot) {
      throw new Error(`Unknown loot ${lootId}`);
    }
    return loot;
  }

  private special(roomId: string | null) {
    return this.content.specialRooms.find((candidate) => candidate.id === roomId);
  }
}

export function createDungeonApp(root: HTMLElement, content: DungeonContent, initialState: GameState): DungeonApp {
  return new DungeonApp(root, content, initialState);
}

export function loadInitialState(content: DungeonContent): GameState {
  return cloneState(createTitleState(content));
}

function orderedPlayers(players: PlayerRuntime[]): PlayerRuntime[] {
  return [...players].sort((a, b) => (a.position ?? "Z").localeCompare(b.position ?? "Z"));
}

function parseCsv(value?: string): string[] {
  return value ? value.split(",").filter(Boolean) : [];
}

function requiredDataset(element: HTMLElement, key: string): string {
  const value = element.dataset[key];
  if (!value) {
    throw new Error(`Missing data-${key}`);
  }
  return value;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}

function cssEscape(value: string): string {
  if ("CSS" in window && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
}
