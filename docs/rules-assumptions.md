# Dungeon Crawl MVP Rules Assumptions

The structured seed is authoritative wherever it defines an effect. These rulings cover gaps called out by the handoff so behavior remains deterministic and visible rather than silently improvised.

- **Loot deck:** the available 8 placeholder definitions are copied four times to form the temporary 32-card deck. Runtime instance IDs keep copies distinct.
- **Loot rewards:** every non-boss combat room awards the seeded placeholder value of 2 cards. Heroes carry at most 3 cards; reusable non-consumables auto-equip when space is available.
- **Fire Ball:** its 2-damage DOT triggers at the affected enemy's turn start until that enemy dies or the room ends.
- **Sten's Bonfire:** Sten skips his next scheduled player slot, then revives at half max HP. A pending Bonfire revive prevents immediate party defeat.
- **Treasure Room:** a basic chest rewards 2 chosen living heroes. An intermediate chest rewards every living hero. The first d6 selects the chest and the second d6 sets the per-hero reward amount; loot cards may only be assigned to those eligible recipients (or discarded if inventories fill).
- **Ability tokens:** tokens are tracked, saved, and displayed but cannot be spent until upgrade rules are supplied.
- **Throw Goblin:** if the Goblin Saboteur is already dead, the attack against position A still resolves and the 2 self-damage portion has no effect.
- **Bone Rattle:** all enemies whose ID or name contains `skeleton` count as Skeletons, compensating for incomplete tags in the seed.
- **Automatic damage:** structured unblockable/direct-damage effects skip block rolls; ordinary enemy attacks use the player block rule.
- **Room preparation:** party selection initially fills A-D in selection order. Every combat room reveals its complete authored timeline and enemy action details before combat; heroes may swap occupied positions by drag or two-card tap. Beginning combat locks the formation until the next combat-room reveal, while special rooms preserve it unchanged.
- **Valeria:** Valeria, the Spider Queen is the sixth-room boss for this MVP, as directed by the handoff.
- **Max HP:** equipment can raise a hero's max HP, but never above 24.
