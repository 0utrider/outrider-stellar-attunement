import { LABELS, MODULE_ID } from "../constants.js";
import { effectValue, playerFor } from "../effect-choices.js";
import { featureHooks } from "../feature-hooks.js";
import { animationModulesActive } from "../sequencer.js";
import { getState } from "../state.js";

/**
 * Dynamic Token Ring colors (core Foundry). With the option on, a token whose
 * ring is enabled takes the attunement's ring and background colors, and goes back to its own
 * on Unattuned.
 *
 * "Its own" is what the actor's prototype token says. The module never writes ring colors to
 * the prototype, so there is nothing to remember and nothing to lose: turn the option off and
 * every token goes back to the prototype's colors. A token dropped while its actor is attuned
 * gets the colors as it is created.
 *
 * Only a ring that is already on is colored. Turning a ring on changes how the token art is
 * framed, which is the GM's call, token by token.
 *
 * The colors come through effectValue (scripts/effect-choices.js): the world settings, or the
 * choices of the token's player when players may make their own.
 */

const hooks = featureHooks("ring");

/** Setting key suffix to the field under TokenDocument.ring.colors. */
const FIELDS = { color: "ring", background: "background" };

const enabled = () => game.settings.get(MODULE_ID, "ring");

/** A color as "#rrggbb", or null for none or one that cannot be read. */
function css(value) {
  if (value === null || value === undefined || value === "") return null;
  const color = foundry.utils.Color.from(value);
  return color.valid ? color.css : null;
}

/** The ring colors a token of this actor should show in this state, by document field. */
function colorsFor(actor, state) {
  const own = actor.prototypeToken?._source?.ring?.colors ?? {};
  const user = state === "unattuned" ? null : playerFor(actor);
  const colors = {};
  for (const [suffix, field] of Object.entries(FIELDS)) {
    const chosen = state === "unattuned" ? null : css(String(effectValue(`ring.${state}.${suffix}`, user, (value) => css(value) !== null) ?? "").trim());
    colors[field] = chosen ?? css(own[field]); // blank setting: the token's own color
  }
  return colors;
}

/**
 * The changes that bring one token document's ring to the state's colors: an object for
 * `token.update`, empty when there is nothing to do. `reset` asks for the prototype's colors
 * whatever the state, and works with the option off (it is how turning it off cleans up).
 */
export function ringChanges(token, actor, state, { reset = false } = {}) {
  if (!actor || (!reset && !enabled())) return {};
  const ring = token._source?.ring;
  if (!ring?.enabled) return {};
  const want = colorsFor(actor, reset ? "unattuned" : state);
  const changes = {};
  for (const field of Object.values(FIELDS)) {
    if (css(ring.colors?.[field]) !== want[field]) changes[`ring.colors.${field}`] = want[field];
  }
  return changes;
}

/** Tokens already offered a ring in this session (by uuid): one offer each until the page reloads. */
const offered = new Set();

/**
 * Only a ring that is already on is colored, so with the option on and the ring off nothing
 * shows. When the attunement changes to Graviton or Photon on this client, offer to turn the
 * ring on: once per token per session, never for an actor whose owner said not to ask again
 * (`flags.<id>.ringOffer` false on the actor). Not awaited by the caller; the state change is done.
 */
export function offerRing(actor, state) {
  return askRing(actor, state).catch((err) => console.warn(`${MODULE_ID} | Ring offer`, err));
}

async function askRing(actor, state) {
  if (!actor || !enabled() || !["graviton", "photon"].includes(state) || !canvas.scene) return;
  const base = actor.isToken ? actor.token.baseActor : actor;
  if (base?.getFlag(MODULE_ID, "ringOffer") === false) return;
  const tokens = (actor.isToken ? [actor.token] : canvas.scene.tokens.filter((t) => t.actorLink && t.actorId === actor.id))
    .filter((t) => t.parent === canvas.scene && !t._source.ring?.enabled && !offered.has(t.uuid));
  if (!tokens.length) return;
  for (const token of tokens) offered.add(token.uuid);

  const editable = tokens.filter((t) => t.canUserModify(game.user, "update"));
  if (!editable.length) {
    ui.notifications.info(`${actor.name}: the token ring is off, so the ${LABELS[state]} ring colors do not show. The GM can turn it on in the token's Appearance tab.`);
    return;
  }
  const esc = foundry.utils.escapeHTML;
  const prototype = !actor.isToken && base.canUserModify(game.user, "update") && !base.prototypeToken.ring?.enabled;
  const these = editable.length === 1 ? "this token" : `these ${editable.length} tokens`;
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: `Token ring: ${actor.name}`, icon: "fa-solid fa-ring" },
    classes: ["osa-ring-offer"],
    position: { width: 520 },
    content: `<p>${esc(actor.name)} is now ${LABELS[state]}, but the token ring is off, so the ring colors do not show.</p>`
      + "<p>Turning the ring on draws Foundry's dynamic token ring and frames the token art inside it: art made for a square token can be cropped. It can be turned off again in the token's Appearance tab.</p>",
    buttons: [
      { action: "token", label: `Turn on for ${these}`, icon: "fa-solid fa-circle-check", default: true },
      ...(prototype ? [{ action: "prototype", label: `${editable.length === 1 ? "This token" : "These tokens"} and new ones`, icon: "fa-solid fa-user-gear" }] : []),
      { action: "later", label: "Not now", icon: "fa-solid fa-clock" },
      { action: "never", label: `Do not ask for ${actor.name}`, icon: "fa-solid fa-ban" },
    ],
    rejectClose: false,
  });

  if (choice === "never") return base.setFlag(MODULE_ID, "ringOffer", false);
  if (choice !== "token" && choice !== "prototype") return;
  // The colors go in with the switch, worked out for the state the actor is in now.
  const now = getState(actor) ?? state;
  for (const token of editable) {
    const on = { _source: { ring: { ...token._source.ring, enabled: true } } };
    await token.update({ "ring.enabled": true, ...ringChanges(on, actor, now) });
  }
  if (choice === "prototype") await base.update({ "prototypeToken.ring.enabled": true });
}

/**
 * Every Solarian token brought in line with the settings and the players' choices, after one
 * of them changes. The active GM's client does it. With no GM online a player's client does
 * it for the tokens that player may update, so a choice saved then still shows.
 * Turning the option off resets tokens in every scene.
 */
async function refreshRings() {
  const gm = game.users.activeGM;
  if (gm && !gm.isSelf) return;
  const reset = !enabled();
  const scenes = reset || game.settings.get(MODULE_ID, "allScenes") ? game.scenes : [canvas.scene].filter(Boolean);
  for (const scene of scenes) {
    const updates = [];
    for (const token of scene.tokens) {
      const state = getState(token.actor);
      if (!state || !token.canUserModify(game.user, "update")) continue;
      const changes = ringChanges(token, token.actor, state, { reset });
      if (!foundry.utils.isEmpty(changes)) updates.push({ _id: token.id, ...changes });
    }
    if (!updates.length) continue;
    try {
      await scene.updateEmbeddedDocuments("Token", updates);
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not update token rings in scene "${scene.name}"`, err);
    }
  }
}

// Saving the settings menu can change several ring settings in a row: one pass for all of them.
let timer = null;
export function refreshRingsSoon() {
  clearTimeout(timer);
  timer = setTimeout(refreshRings, 100);
}
const refresh = () => refreshRingsSoon();

const COLOR_HINT = "The ring itself.";
const BACKGROUND_HINT = "The area behind the token art, inside the ring. Blank: keep the token's own.";

export const ring = {
  id: "ring",
  label: "Dynamic Token Ring",
  hint: "Foundry's own token ring. Colors a ring that is already turned on in the token's Appearance tab. Tokens without one are left alone.",
  groups: {
    graviton: { label: "Graviton", keys: ["ring.graviton.color", "ring.graviton.background"] },
    photon: { label: "Photon", keys: ["ring.photon.color", "ring.photon.background"] },
  },
  settings: {
    ring: {
      name: "Color the token ring",
      hint: "When attunement changes, set the ring colors below on the Solarian's tokens. Unattuned puts back the colors of the actor's prototype token. On by default unless Sequencer and JB2A are active, where the token border marks the attunement.",
      scope: "world", type: Boolean, default: () => !animationModulesActive(), onChange: refresh,
    },
    "ring.flash": {
      name: "Flash the ring on a change",
      hint: "When a Solarian token's ring color changes, the ring flashes in the new color, for everyone viewing the scene. Does nothing while the option above is off.",
      scope: "world", type: Boolean, default: false,
    },
    "ring.graviton.color": {
      name: "Ring color", hint: COLOR_HINT, color: true,
      player: true, scope: "world", type: String, default: "#8a5cff", onChange: refresh,
    },
    "ring.graviton.background": {
      name: "Background color", hint: BACKGROUND_HINT, color: true,
      player: true, scope: "world", type: String, default: "", onChange: refresh,
    },
    "ring.photon.color": {
      name: "Ring color", hint: COLOR_HINT, color: true,
      player: true, scope: "world", type: String, default: "#ff9d00", onChange: refresh,
    },
    "ring.photon.background": {
      name: "Background color", hint: BACKGROUND_HINT, color: true,
      player: true, scope: "world", type: String, default: "", onChange: refresh,
    },
  },
  init() {
    hooks.clear();

    // A token placed while its actor is attuned starts with the state's colors.
    hooks.on("preCreateToken", (doc) => {
      if (!enabled()) return;
      const actor = doc.actor ?? game.actors.get(doc.actorId);
      const state = getState(actor);
      if (!state || state === "unattuned") return;
      const changes = ringChanges(doc, actor, state);
      if (!foundry.utils.isEmpty(changes)) doc.updateSource(changes);
    });

    // The flash is drawn by each client for itself, so every client watches for the change.
    hooks.on("updateToken", (doc, changes) => {
      const color = changes.ring?.colors?.ring;
      if (color === undefined || !enabled() || !game.settings.get(MODULE_ID, "ring.flash")) return;
      const token = doc.object;
      if (!token?.ring || !doc.ring?.enabled || !getState(doc.actor)) return;
      // Back to a ring with no color of its own: flash white.
      const flash = foundry.utils.Color.from(color ?? 0xffffff);
      if (flash.valid) Promise.resolve(token.ring.flashColor(flash)).catch(() => {});
    });
  },
};
