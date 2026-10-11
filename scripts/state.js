import { OPTION, STATES } from "./constants.js";

/**
 * Reading an actor's attunement. Shared by every feature, so no feature has to import
 * another one just to ask what state an actor is in.
 */

/** The Stellar Attunement RollOption rule on the actor, or null if it has none. */
export function getRule(actor) {
  return actor?.rules?.find((r) => r.key === "RollOption" && r.option === OPTION) ?? null;
}

/** "unattuned" | "graviton" | "photon", or null for an actor with no Stellar Attunement. */
export function getState(actor) {
  const sel = getRule(actor)?.selection;
  return STATES.includes(sel) ? sel : null;
}
