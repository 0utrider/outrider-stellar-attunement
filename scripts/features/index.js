import { attunement } from "./attunement.js";
import { actionWatcher } from "./action-watcher.js";
import { borders } from "./borders.js";
import { ring } from "./ring.js";
import { attacks } from "./attacks.js";
import { playerEffects } from "./player-effects.js";
import { combatEnd } from "./combat-end.js";
import { worldContent } from "./world-content.js";

/**
 * Feature registry. Order here is hook order, `ready` order and the order of the settings menu.
 *
 * A feature is { id, label?, hint?, requires?, groups?, settings?, init, ready? }.
 *
 * - `settings` maps a setting key to its game.settings.register data. scripts/settings.js
 *   registers them, and the settings menu (scripts/apps/settings-menu.js) draws one fieldset
 *   per feature from them, headed by `label` and `hint`, in this order.
 * - `groups` maps a group id to { label, keys }: those settings sit in a named box inside the
 *   feature's fieldset.
 * - `requires: "animations"` marks a feature that does nothing without Sequencer and JB2A. The
 *   settings menu leaves its fieldset out while they are not active, and says so.
 * - `init` runs once, in the init hook, and registers the feature's hooks through
 *   featureHooks (scripts/feature-hooks.js). It starts with `hooks.clear()`, so running it a
 *   second time in the same page does not register anything twice.
 * - `ready` runs in the ready hook, in this order, each awaited before the next.
 *   `attunement` is first because its `ready` puts the public API in place.
 */
export const FEATURES = [attunement, actionWatcher, borders, ring, attacks, playerEffects, combatEnd, worldContent];

/** The features that run in this world, in registry order. Read at init or later, not at import. */
export const activeFeatures = () => FEATURES;
