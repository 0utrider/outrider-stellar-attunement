/**
 * Sequencer readiness, shared by every feature that draws or reads Sequencer effects
 * (token borders, attack animations, the reconcile after an encounter ends).
 *
 * The flag goes up 500 ms after Sequencer's own "sequencerReady" hook, which gives JB2A time
 * to register its database. The borders feature registers that hook, because the same handler
 * ends in a scene reconcile; everything else only reads the flag.
 */
let ready = false;

/** True once Sequencer and its database can be used. */
export const sequencerReady = () => ready;

/** Called once by the borders feature. */
export function markSequencerReady() {
  ready = true;
}
