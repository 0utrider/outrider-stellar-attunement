import { MODULE_ID } from "../constants.js";
import { featureHooks } from "../feature-hooks.js";
import { getState } from "../state.js";
import { setAttunement } from "./attunement.js";
import { reconcileSoon } from "./borders.js";

/** "End Encounter" deletes the combat: drop its Solarians to Unattuned (one client does it). */

const hooks = featureHooks("combatEnd");

export const combatEnd = {
  id: "combatEnd",
  label: "Encounter end",
  hint: "What happens to attuned Solarians when the GM ends an encounter.",
  settings: {
    unattuneOnCombatEnd: {
      name: "Unattune when the encounter ends",
      hint: "When the GM ends an encounter, every attuned Solarian in it drops to Unattuned.",
      scope: "world", type: Boolean, default: true,
    },
  },
  init() {
    hooks.clear();

    hooks.on("deleteCombat", async (combat) => {
      if (!game.users.activeGM?.isSelf) return;
      if (game.settings.get(MODULE_ID, "unattuneOnCombatEnd")) {
        const seen = new Set();
        for (const c of combat.combatants) {
          const actor = c.actor;
          if (!actor || seen.has(actor.uuid)) continue;
          seen.add(actor.uuid);
          const state = getState(actor);
          if (state && state !== "unattuned") {
            await setAttunement(actor, "unattuned").catch((err) => console.warn(`${MODULE_ID} | Unattune failed for ${actor.name}`, err));
          }
        }
      }
      reconcileSoon(); // shrink any border that was expanded around the turn marker
    });
  },
};
