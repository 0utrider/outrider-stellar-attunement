import { LABELS, MODULE_ID, OPPOSITE, OPTION, STATES, SUFFIX } from "../constants.js";
import { featureHooks } from "../feature-hooks.js";
import { getRule, getState } from "../state.js";
import { playAttack } from "./attacks.js";
import { applyBorders, reconcileScene } from "./borders.js";
import { offerRing, ringChanges } from "./ring.js";
import { syncWorldContent } from "./world-content.js";

/**
 * Attunement state, the cycle, token art, the Token HUD button and the public API.
 * Ring colors (features/ring.js) ride along with the art: one token update carries both.
 *
 * Cycle:  unattuned -> graviton
 *         graviton/photon (1st click) -> the opposite attunement
 *         graviton/photon (2nd click) -> unattuned
 */

const hooks = featureHooks("attunement");

/** Target selection the module itself is currently applying, keyed by actor uuid. */
const pending = new Map();

function nextState(actor, current) {
  if (current === "unattuned") return "graviton";
  const swappedTo = actor.getFlag(MODULE_ID, "swappedTo");
  return swappedTo === current ? "unattuned" : OPPOSITE[current];
}

// Token art

const ART_FILE = /^(.*?)(?:-[12])?(\.[a-z0-9]+)$/i;

/** An art path without a trailing -1 or -2 before the extension. */
function unsuffixed(src) {
  const m = src?.match(ART_FILE);
  return m ? `${m[1]}${m[2]}` : null;
}

/**
 * The actor's own art as it was before this module's first swap, or null when that can no
 * longer be told.
 *
 * Each state's art is written to the prototype token, so the prototype stops being a record
 * of the original the moment an override lands on it. `flags.<id>.art` keeps the record:
 * `base` is the original, `last` is what the module wrote most recently. A prototype image
 * that is not `last` was put there by someone else and is the new original.
 *
 * Null is the legacy of 1.0.x, which kept no record: the prototype holds an attuned override
 * and nothing says what was there before. That is recorded too, as `base: null`, so a later
 * change to the overrides cannot pass the override off as the original. Setting the prototype
 * token image by hand (or an Unattuned override) ends it.
 */
function knownBase(actor) {
  const src = actor.prototypeToken?.texture?.src;
  const art = actor.getFlag(MODULE_ID, "art");
  if (art && art.last === src) return art.base ?? null;
  const images = actor.getFlag(MODULE_ID, "images") ?? {};
  if (!art && src && [images.graviton, images.photon].includes(src)) return null;
  return unsuffixed(src);
}

/** The base path the -1/-2 convention builds on. */
function baseArt(actor) {
  return knownBase(actor) ?? unsuffixed(actor.prototypeToken?.texture?.src ?? actor.img);
}

function artFor(actor, state) {
  const custom = actor.getFlag(MODULE_ID, "images")?.[state];
  if (custom) return custom;
  const base = baseArt(actor);
  return base ? base.replace(ART_FILE, `$1${SUFFIX[state]}$2`) : null;
}

/** Token art and, with the option on, token ring colors for this state. One update per token. */
async function applyLook(actor, state) {
  const base = knownBase(actor);
  const src = artFor(actor, state);
  const changesFor = (token) => {
    const changes = ringChanges(token, actor, state);
    if (src && token._source.texture.src !== src) changes["texture.src"] = src;
    return changes;
  };

  // Unlinked (synthetic) token actor: only its own token changes.
  if (actor.isToken) {
    const changes = changesFor(actor.token);
    if (!foundry.utils.isEmpty(changes)) await actor.token.update(changes);
    return;
  }

  const allScenes = game.settings.get(MODULE_ID, "allScenes");
  const scenes = allScenes ? game.scenes : [canvas.scene].filter(Boolean);
  for (const scene of scenes) {
    const updates = scene.tokens
      .filter((t) => t.actorLink && t.actorId === actor.id && t.canUserModify(game.user, "update"))
      .map((t) => ({ _id: t.id, ...changesFor(t) }))
      .filter((update) => Object.keys(update).length > 1);
    if (!updates.length) continue;
    try {
      await scene.updateEmbeddedDocuments("Token", updates);
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not update tokens in scene "${scene.name}"`, err);
    }
  }

  // Prototype last: the system may propagate it to canvas tokens on its own. The record of
  // the original art goes in with the same write.
  if (src && actor.prototypeToken.texture.src !== src && actor.isOwner) {
    await actor.update({ "prototypeToken.texture.src": src, [`flags.${MODULE_ID}.art`]: { base, last: src } });
  }
}

// Public API

function resolveActor(actor) {
  if (typeof actor === "string") actor = fromUuidSync(actor) ?? game.actors.get(actor) ?? game.actors.getName(actor);
  return actor ?? canvas.tokens?.controlled[0]?.actor ?? game.user.character ?? null;
}

/** Set a specific attunement: "unattuned" | "graviton" | "photon". */
export async function setAttunement(actorLike, state, { fromCycle = false } = {}) {
  const actor = resolveActor(actorLike);
  const rule = getRule(actor);
  if (!rule) return ui.notifications.warn(`${actor?.name ?? "No actor"} has no Stellar Attunement.`);
  if (!STATES.includes(state)) throw new Error(`${MODULE_ID} | Unknown attunement "${state}"`);

  const prev = getState(actor);
  pending.set(actor.uuid, state);
  try {
    await actor.toggleRollOption("all", OPTION, rule.item.id, true, state);
  } finally {
    pending.delete(actor.uuid);
  }

  // Track the swap so the next click drops to unattuned.
  const swapped = fromCycle && prev && prev !== "unattuned" && state === OPPOSITE[prev];
  if (swapped) await actor.setFlag(MODULE_ID, "swappedTo", state);
  else if (actor.getFlag(MODULE_ID, "swappedTo")) await actor.unsetFlag(MODULE_ID, "swappedTo");

  await applyLook(actor, state);
  await applyBorders(actor, state);
  offerRing(actor, state);
  if (game.settings.get(MODULE_ID, "notify")) ui.notifications.info(`${actor.name}: ${LABELS[state]}`);
  return state;
}

/** Advance the cycle. Returns the new state. */
export async function cycle(actorLike) {
  const actor = resolveActor(actorLike);
  if (!actor) return ui.notifications.warn("Select a token or assign a character first.");
  const current = getState(actor);
  if (!current) return ui.notifications.warn(`${actor.name} has no Stellar Attunement.`);
  return setAttunement(actor, nextState(actor, current), { fromCycle: true });
}

/** Per-actor image overrides (for art that doesn't follow the -1/-2 convention). */
export async function configure(actorLike) {
  const actor = resolveActor(actorLike);
  if (!actor) return ui.notifications.warn("Select a token or assign a character first.");
  const imgs = actor.getFlag(MODULE_ID, "images") ?? {};
  // Paths come from actor flags and file names: escaped before they go into markup.
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const rows = STATES.map((s) => `
    <div class="form-group">
      <label>${LABELS[s]}</label>
      <div class="form-fields">
        <input type="text" name="${s}" value="${esc(imgs[s])}" placeholder="${esc(artFor(actor, s))}">
        <button type="button" class="osa-browse" data-target="${s}"><i class="fa-solid fa-file-import"></i></button>
      </div>
    </div>`).join("");

  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: `Stellar Attunement Art - ${actor.name}` },
    content: `<p class="hint">Leave blank to use the default: base art, <code>-1</code> for Graviton, <code>-2</code> for Photon.</p>${rows}`,
    ok: { label: "Save", callback: (_e, button) => Object.fromEntries(STATES.map((s) => [s, button.form.elements[s].value.trim()])) },
    render: (_e, dialog) => {
      dialog.element.querySelectorAll(".osa-browse").forEach((btn) =>
        btn.addEventListener("click", () => {
          const input = dialog.element.querySelector(`input[name="${btn.dataset.target}"]`);
          new foundry.applications.apps.FilePicker.implementation({
            type: "image",
            current: input.value || input.placeholder,
            callback: (path) => (input.value = path),
          }).render(true);
        }));
    },
    rejectClose: false,
  });
  if (!result) return;
  // setFlag merges into the stored object, so a blanked field would keep its old value.
  // Clear the whole flag first, then write what is left.
  const cleaned = Object.fromEntries(Object.entries(result).filter(([, v]) => v));
  if (actor.getFlag(MODULE_ID, "images")) await actor.unsetFlag(MODULE_ID, "images");
  if (Object.keys(cleaned).length) await actor.setFlag(MODULE_ID, "images", cleaned);
  const state = getState(actor);
  if (state) await applyLook(actor, state);
}

/** `game.modules.get(id).api`: the entry points macros and other modules call. */
function installApi() {
  game.modules.get(MODULE_ID).api = { cycle, setAttunement, configure, getState: (a) => getState(resolveActor(a)), artFor, reconcileScene, playAttack, syncWorldContent };
}

export const attunement = {
  id: "attunement",
  label: "Attunement",
  hint: "Cycling the attunement, the token art that follows it, and the Token HUD button.",
  settings: {
    allScenes: {
      name: "Update tokens in all scenes",
      hint: "Swap art (and ring colors, when that option is on) on linked tokens in every scene, not just the one in view.",
      scope: "world", type: Boolean, default: true,
    },
    tokenHud: {
      name: "Token HUD button",
      hint: "Show a Stellar Attunement cycle button on the Token HUD for Solarians.",
      scope: "client", type: Boolean, default: true,
    },
    notify: {
      name: "Show notification",
      hint: "Pop a notification when attunement changes via the macro or HUD.",
      scope: "client", type: Boolean, default: false,
    },
  },
  init() {
    hooks.clear();

    // Attunement changed some other way (sheet, pf2e-hud, etc.): sync art and ring, reset swap tracking.
    hooks.on("updateItem", async (item, changes, _opts, userId) => {
      if (userId !== game.user.id || !changes.system?.rules) return;
      const actor = item.actor;
      if (!actor || getRule(actor)?.item?.id !== item.id) return;
      if (pending.has(actor.uuid)) return; // our own change; setAttunement handles it
      const state = getState(actor);
      if (!state) return;
      if (actor.getFlag(MODULE_ID, "swappedTo")) await actor.unsetFlag(MODULE_ID, "swappedTo");
      await applyLook(actor, state);
      await applyBorders(actor, state);
      offerRing(actor, state);
    });

    hooks.on("renderTokenHUD", (hud, html) => {
      if (!game.settings.get(MODULE_ID, "tokenHud")) return;
      const actor = hud.document?.actor;
      const state = getState(actor);
      if (!state || !actor.isOwner) return;
      const root = html instanceof HTMLElement ? html : html[0];
      const col = root.querySelector(".col.right");
      if (!col) return;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.classList.add("control-icon", "osa-hud", `osa-${state}`);
      btn.dataset.tooltip = `Stellar Attunement: ${LABELS[state]}<br><em>Click: cycle · Right-click: configure art</em>`;
      btn.innerHTML = `<i class="fa-solid ${state === "photon" ? "fa-sun" : state === "graviton" ? "fa-circle-dot" : "fa-circle"}"></i>`;
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        // v14 closes the HUD when the texture swap finishes animating. Reopen it for rapid clicks.
        const token = hud.object;
        const id = Hooks.once("closeTokenHUD", () => setTimeout(() => {
          if (token && !token.destroyed && token.scene === canvas.scene) canvas.hud.token.bind(token);
        }, 0));
        setTimeout(() => Hooks.off("closeTokenHUD", id), 3000);
        await cycle(actor);
      });
      btn.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        configure(actor);
      });
      col.append(btn);
    });

    // An init that runs in a page that is already up (a dev reload) has missed ready: point
    // the API at this evaluation's functions now. Never true on a normal load.
    if (game.ready) installApi();
  },
  /** The API appears on ready, first thing, as it always has. */
  ready() {
    installApi();
  },
};
