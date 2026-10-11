import { attunement } from "./attunement.js";
import { borders } from "./borders.js";
import { attacks } from "./attacks.js";
import { combatEnd } from "./combat-end.js";
import { worldContent } from "./world-content.js";

/**
 * Feature registry. Order here is hook order and `ready` order.
 *
 * A feature is { id, settings?, init, ready? }.
 *
 * - `settings` maps a setting key to its game.settings.register data. scripts/settings.js
 *   registers them (and pins the order of the rows in the settings window).
 * - `init` runs once, in the init hook, and registers the feature's hooks through
 *   featureHooks (scripts/feature-hooks.js). It starts with `hooks.clear()`, so running it a
 *   second time in the same page does not register anything twice.
 * - `ready` runs in the ready hook, in this order, each awaited before the next.
 *   `attunement` is first because its `ready` puts the public API in place.
 */
export const FEATURES = [attunement, borders, attacks, combatEnd, worldContent];

/** The features that run in this world, in registry order. Read at init or later, not at import. */
export const activeFeatures = () => FEATURES;
