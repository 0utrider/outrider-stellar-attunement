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

/** True when Sequencer and one of the JB2A modules are installed and active. */
export function animationsInstalled() {
  return !!game.modules.get("sequencer")?.active
    && JB2A_IDS.some((id) => game.modules.get(id)?.active)
    && typeof Sequencer !== "undefined";
}
