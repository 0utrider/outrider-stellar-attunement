import { MODULE_ID } from "./constants.js";

/**
 * Feature-scoped settings helper, same call shape as the rest of the Outrider family:
 * `featureSettings(feature.id).register(key, data)`.
 *
 * Settings are registered hidden (config: false) and edited in the module's settings menu
 * (scripts/apps/settings-menu.js), which builds its form from each feature's `settings`.
 *
 * One thing differs from the family default, because of worlds already on 1.0.x: keys are not
 * prefixed with the feature id. Worlds store them bare ("borders",
 * "attack.solar-flare.photon"), and a renamed key reads as its default. `fullKey` is where a
 * prefix would go if the keys are ever migrated.
 *
 * A declaration can carry keys that are for the menu alone and are not part of the
 * registration: `label` (a shorter name for the form), `picker` (which animation picker a
 * path field opens), `previewWith` (the fields a preview reads its scale and layer from) and
 * `color` (a color field).
 */
export function featureSettings(featureId) {
  const fullKey = (key) => key;
  return {
    featureId,
    fullKey,
    register(key, { label, picker, previewWith, color, ...data }) {
      game.settings.register(MODULE_ID, fullKey(key), {
        scope: "world",
        config: false,
        type: Boolean,
        ...data,
      });
    },
    get: (key) => game.settings.get(MODULE_ID, fullKey(key)),
    set: (key, value) => game.settings.set(MODULE_ID, fullKey(key), value),
  };
}
