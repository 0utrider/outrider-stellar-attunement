import { playerEffectsOn } from "../effect-choices.js";
import { MODULE_ID } from "../constants.js";
import { featureHooks } from "../feature-hooks.js";
import { reconcileSoon } from "./borders.js";
import { refreshRingsSoon } from "./ring.js";

/**
 * The switch that lets players make their own effect choices, and the redraw when a choice
 * (or who a token follows) changes. What a choice is and how it is resolved is in
 * scripts/effect-choices.js; the form a player fills in is the lower part of the settings
 * window (scripts/apps/settings-menu.js).
 */

const hooks = featureHooks("playerEffects");

/**
 * Borders and rings on the viewed scene, checked again. Both passes are debounced and both
 * pick the one client that draws (the active GM, else an owner), so every client may ask.
 */
function redraw() {
  reconcileSoon();
  refreshRingsSoon();
}

export const playerEffects = {
  id: "playerEffects",
  label: "Player choices",
  hint: "The settings above are the GM's and apply to everyone. This lets each player replace some of them for their own character.",
  settings: {
    playerEffects: {
      name: "Allow Players to Customize Effects",
      hint: "On: a player can pick their own border animation and scale, ring colors and attack animations in this window, and everyone sees them. Whatever a player leaves blank uses the settings above, and a player can also pick none. Off: only the settings above apply; choices a player saved earlier are kept and ignored.",
      scope: "world", type: Boolean, default: false, onChange: redraw,
    },
  },
  init() {
    hooks.clear();

    // A player saved their choices, the GM cleared them, or a player was assigned another
    // character. The choices are all this module keeps on a User, so any change under its
    // flags counts (a removed key can arrive as "-=<key>").
    hooks.on("updateUser", (_user, changes) => {
      if (!playerEffectsOn()) return;
      const flags = Object.keys(changes.flags ?? {}).some((key) => key === MODULE_ID || key === `-=${MODULE_ID}`);
      if (flags || "character" in changes) redraw();
    });

    // Ownership decides which player an unassigned actor's tokens follow.
    hooks.on("updateActor", (_actor, changes) => {
      if (playerEffectsOn() && "ownership" in changes) redraw();
    });
  },
};
