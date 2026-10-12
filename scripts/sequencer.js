/**
 * Sequencer readiness, shared by every feature that draws or reads Sequencer effects
 * (token borders, attack animations, the reconcile after an encounter ends, the animation
 * picker in the settings menu).
 *
 * The flag goes up 500 ms after Sequencer's own "sequencerReady" hook, which gives JB2A time
 * to register its database. The borders feature registers that hook, because the same handler
 * ends in a scene reconcile; everything else only reads the flag.
 */
let ready = false;

const JB2A_IDS = ["jb2a_patreon", "JB2A_DnD5e"];

/** True once Sequencer and its database can be used. */
export const sequencerReady = () => ready;

/** Called once by the borders feature. */
export function markSequencerReady() {
  ready = true;
}

/** True when the Sequencer module is active in this world. */
export const sequencerActive = () => !!game.modules.get("sequencer")?.active;

/** True when one of the JB2A modules (free or Patreon) is active in this world. */
export const jb2aActive = () => JB2A_IDS.some((id) => game.modules.get(id)?.active);

/**
 * True when the free JB2A pack is the only JB2A active. Its database is a part of the Patreon
 * pack's, so a default that names an entry only the Patreon pack has needs another one here.
 */
export const jb2aFreeOnly = () => !!game.modules.get("JB2A_DnD5e")?.active && !game.modules.get("jb2a_patreon")?.active;

/**
 * A setting default that depends on the JB2A pack: `free` with the free pack alone, `full`
 * otherwise. It returns a function, which a declaration's `default` may be: the registration
 * calls it once, in `init`, when the module list is known.
 */
export const byPack = (full, free) => () => (jb2aFreeOnly() ? free : full);

/**
 * True when both are active, going by the module list alone. This can be asked in `init`,
 * before Sequencer has put its API in place: setting defaults and the settings window use it.
 */
export const animationModulesActive = () => sequencerActive() && jb2aActive();

/** True when Sequencer and one of the JB2A modules are active and Sequencer's API is there. */
export function animationsInstalled() {
  return animationModulesActive() && typeof Sequencer !== "undefined";
}
