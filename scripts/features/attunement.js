import { LABELS, MODULE_ID, OPPOSITE, OPTION, STATES, SUFFIX } from "../constants.js";
import { featureHooks } from "../feature-hooks.js";
import { getRule, getState } from "../state.js";
import { playAttack } from "./attacks.js";
import { applyBorders, reconcileScene } from "./borders.js";
import { syncWorldContent } from "./world-content.js";

/**
 * Attunement state, the cycle, token art, the Token HUD button and the public API.
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

/** Strip a trailing -1/-2 from the default art to find the base path. */
function baseArt(actor) {
  const src = actor.prototypeToken?.texture?.src ?? actor.img;
  const m = src.match(/^(.*?)(?:-[12])?(\.[a-z0-9]+)$/i);
  return m ? { stem: m[1], ext: m[2] } : null;
}

function artFor(actor, state) {
  const custom = actor.getFlag(MODULE_ID, "images")?.[state];
  if (custom) return custom;
  const base = baseArt(actor);
  return base ? `${base.stem}${SUFFIX[state]}${base.ext}` : null;
}

async function applyArt(actor, state) {
  const src = artFor(actor, state);
  if (!src) return;

  // Unlinked (synthetic) token actor: only its own token changes.
  if (actor.isToken) {
    if (actor.token._source.texture.src !== src) await actor.token.update({ "texture.src": src });
    return;
  }

  const allScenes = game.settings.get(MODULE_ID, "allScenes");
  const scenes = allScenes ? game.scenes : [canvas.scene].filter(Boolean);
  for (const scene of scenes) {
    const updates = scene.tokens
      .filter((t) => t.actorLink && t.actorId === actor.id && t._source.texture.src !== src && t.canUserModify(game.user, "update"))
      .map((t) => ({ _id: t.id, "texture.src": src }));
    if (!updates.length) continue;
    try {
      await scene.updateEmbeddedDocuments("Token", updates);
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not update tokens in scene "${scene.name}"`, err);
    }
  }

  // Prototype last: the system may propagate it to canvas tokens on its own.
  if (actor.prototypeToken.texture.src !== src && actor.isOwner) {
    await actor.update({ "prototypeToken.texture.src": src });
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

  await applyArt(actor, state);
  await applyBorders(actor, state);
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
  const rows = STATES.map((s) => `
    <div class="form-group">
      <label>${LABELS[s]}</label>
      <div class="form-fields">
        <input type="text" name="${s}" value="${imgs[s] ?? ""}" placeholder="${artFor(actor, s) ?? ""}">
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
  const cleaned = Object.fromEntries(Object.entries(result).filter(([, v]) => v));
  if (Object.keys(cleaned).length) await actor.setFlag(MODULE_ID, "images", cleaned);
  else await actor.unsetFlag(MODULE_ID, "images");
  const state = getState(actor);
  if (state) await applyArt(actor, state);
}

/** `game.modules.get(id).api`: the entry points macros and other modules call. */
function installApi() {
  game.modules.get(MODULE_ID).api = { cycle, setAttunement, configure, getState: (a) => getState(resolveActor(a)), artFor, reconcileScene, playAttack, syncWorldContent };
}

export const attunement = {
  id: "attunement",
  settings: {
    allScenes: {
      name: "Update tokens in all scenes",
      hint: "Swap art on linked tokens in every scene, not just the active one.",
      scope: "world", config: true, type: Boolean, default: true,
    },
    tokenHud: {
      name: "Token HUD button",
      hint: "Show a Stellar Attunement cycle button on the Token HUD for Solarians.",
      scope: "client", config: true, type: Boolean, default: true,
    },
    notify: {
      name: "Show notification",
      hint: "Pop a notification when attunement changes via the macro or HUD.",
      scope: "client", config: true, type: Boolean, default: false,
    },
  },
  init() {
    hooks.clear();

    // Attunement changed some other way (sheet, pf2e-hud, etc.): sync art, reset swap tracking.
    hooks.on("updateItem", async (item, changes, _opts, userId) => {
      if (userId !== game.user.id || !changes.system?.rules) return;
      const actor = item.actor;
      if (!actor || getRule(actor)?.item?.id !== item.id) return;
      if (pending.has(actor.uuid)) return; // our own change; setAttunement handles it
      const state = getState(actor);
      if (!state) return;
      if (actor.getFlag(MODULE_ID, "swappedTo")) await actor.unsetFlag(MODULE_ID, "swappedTo");
      await applyArt(actor, state);
      await applyBorders(actor, state);
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
