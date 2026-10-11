import { MODULE_ID } from "./constants.js";
import { activeFeatures } from "./features/index.js";
import { featureSettings } from "./feature-settings.js";

/**
 * Row order of the settings window, as it was in 1.0.3. Foundry lists settings in the order
 * they are registered, and one combat-end setting sits between two border settings, so plain
 * feature order would move it. A key not listed here is registered after these, in feature
 * order. Delete this list once the settings menu replaces the flat window.
 */
const ORDER = [
  "allScenes",
  "tokenHud",
  "notify",
  "borders",
  "borderBelow",
  "border.graviton",
  "border.graviton.scale",
  "border.photon",
  "border.photon.scale",
  "borderTurnMarker",
  "unattuneOnCombatEnd",
  "clearOtherBorders",
  "attacks",
  "attack.solar-weapon.graviton",
  "attack.solar-weapon.photon",
  "attack.solar-flare.graviton",
  "attack.solar-flare.photon",
];

export function registerSettings() {
  game.settings.register(MODULE_ID, "syncedVersion", {
    scope: "world",
    config: false,
    type: String,
    default: "",
  });

  // Each feature declares its own settings as `settings: { key: data }`.
  const declared = [];
  for (const feature of activeFeatures()) {
    const settings = featureSettings(feature.id, feature.i18nKey);
    for (const [key, data] of Object.entries(feature.settings ?? {})) declared.push({ key, data, settings });
  }
  const rank = (key) => {
    const index = ORDER.indexOf(key);
    return index < 0 ? ORDER.length : index;
  };
  declared.sort((a, b) => rank(a.key) - rank(b.key)); // stable: unlisted keys keep feature order
  for (const { key, data, settings } of declared) settings.register(key, data);
}
