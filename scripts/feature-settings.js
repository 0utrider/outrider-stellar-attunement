import { MODULE_ID } from "./constants.js";

/**
 * Feature-scoped settings helper, same call shape as the rest of the Outrider family:
 * `featureSettings(feature.id).register(key, data)`.
 *
 * Two things differ from the family default, both because of worlds already on 1.0.x:
 *
 * - Keys are not prefixed with the feature id. Worlds store them bare ("borders",
 *   "attack.solar-flare.photon"), and a renamed key reads as its default. `fullKey` is where
 *   a prefix would go if the keys are ever migrated.
 * - Settings show in Foundry's own settings window (config: true), with the name and hint
 *   given inline by the feature. There is no lang file and no settings menu yet, so `i18nKey`
 *   is accepted and not used.
 */
export function featureSettings(featureId, i18nKey) {
  const fullKey = (key) => key;
  return {
    featureId,
    i18nKey,
    fullKey,
    register(key, data) {
      game.settings.register(MODULE_ID, fullKey(key), {
        scope: "world",
        config: true,
        type: Boolean,
        ...data,
      });
    },
    get: (key) => game.settings.get(MODULE_ID, fullKey(key)),
    set: (key, value) => game.settings.set(MODULE_ID, fullKey(key), value),
  };
}
