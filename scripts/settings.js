import { MODULE_ID } from "./constants.js";
import { activeFeatures } from "./features/index.js";
import { featureSettings } from "./feature-settings.js";
import { StellarAttunementSettings } from "./apps/settings-menu.js";

export function registerSettings() {
  game.settings.register(MODULE_ID, "syncedVersion", {
    scope: "world",
    config: false,
    type: String,
    default: "",
  });

  // Each feature declares its own settings as `settings: { key: data }`, and is one fieldset
  // in the menu. Registry order is the order of the fieldsets.
  for (const feature of activeFeatures()) {
    const settings = featureSettings(feature.id);
    for (const [key, data] of Object.entries(feature.settings ?? {})) settings.register(key, data);
  }

  // Open to players as well: two of the settings are per client, and the menu shows a player
  // only those.
  game.settings.registerMenu(MODULE_ID, "menu", {
    name: "Outrider's Stellar Attunement",
    label: "Configure Settings",
    hint: "Token art, token borders, the token ring, attack animations and what happens when an encounter ends.",
    icon: "fa-solid fa-sun",
    type: StellarAttunementSettings,
    restricted: false,
  });
}
