/**
 * Outrider's Stellar Attunement
 * Cycles a Solarian's Stellar Attunement and keeps token art in sync with it.
 *
 * Entry point only. Constants are in constants.js, settings in settings.js, and each area of
 * behavior is a feature under features/ (see features/index.js for the list and its order).
 */

import { MODULE_ID } from "./constants.js";
import { registerSettings } from "./settings.js";
import { activeFeatures } from "./features/index.js";

Hooks.once("init", () => {
  registerSettings();
  for (const feature of activeFeatures()) {
    try {
      feature.init?.();
    } catch (err) {
      console.error(`${MODULE_ID} | ${feature.id} init failed`, err);
    }
  }
});

Hooks.once("ready", async () => {
  for (const feature of activeFeatures()) {
    try {
      await feature.ready?.();
    } catch (err) {
      console.error(`${MODULE_ID} | ${feature.id} ready failed`, err);
    }
  }
});
