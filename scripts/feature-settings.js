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
 * path field opens), `previewWith` (the fields a preview reads its scale and layer from),
 * `color` (a color field) and `player` (a player may make their own choice for it, see
 * scripts/effect-choices.js).
 *
 * `default` may be a function. It is called once, at registration, for a default that depends
 * on the world (which modules are active), and what it returns is registered.
 */
export function featureSettings(featureId) {
  const fullKey = (key) => key;
  return {
    featureId,
    fullKey,
    register(key, { label, picker, previewWith, color, player, ...data }) {
      game.settings.register(MODULE_ID, fullKey(key), {
        scope: "world",
        config: false,
        type: Boolean,
        ...data,
        default: typeof data.default === "function" ? data.default() : data.default,
      });
    },
    /** The registered default: what a declaration's `default` came to in this world. */
    default: (key) => game.settings.settings.get(`${MODULE_ID}.${fullKey(key)}`)?.default,
    get: (key) => game.settings.get(MODULE_ID, fullKey(key)),
    set: (key, value) => game.settings.set(MODULE_ID, fullKey(key), value),
  };
}
