import { MODULE_ID } from "../constants.js";
import { featureHooks } from "../feature-hooks.js";
import { markSequencerReady, sequencerReady } from "../sequencer.js";
import { getState } from "../state.js";

/**
 * JB2A token borders (Sequencer). With Sequencer + JB2A active, a persistent JB2A token border
 * marks the attunement. Also keeps the border clear of core's combat turn marker.
 */

const BORDER_NAME = `${MODULE_ID}.border`;
const BORDER_FILE = /token_border|Token_Border/;
const JB2A_IDS = ["jb2a_patreon", "JB2A_DnD5e"];

const hooks = featureHooks("borders");

export function bordersAvailable() {
  return game.settings.get(MODULE_ID, "borders")
    && game.modules.get("sequencer")?.active
    && JB2A_IDS.some((id) => game.modules.get(id)?.active)
    && typeof Sequencer !== "undefined";
}

function borderPathFor(state) {
  if (state === "unattuned") return null;
  const path = game.settings.get(MODULE_ID, `border.${state}`)?.trim();
  if (!path) return null;
  if (!Sequencer.Database.entryExists(path)) {
    console.warn(`${MODULE_ID} | JB2A entry not found: ${path} (free JB2A lacks some variants)`);
    return null;
  }
  return path;
}

/** Canvas token placeables for this actor on the viewed scene. */
function canvasTokensFor(actor) {
  if (!canvas.ready) return [];
  if (actor.isToken) return [actor.token.object].filter(Boolean);
  return canvas.tokens.placeables.filter((t) => t.document.actorLink && t.document.actorId === actor.id);
}

/** Border effects to clear: ours, plus (optionally) any other JB2A token border on the token. */
function bordersOn(token) {
  const clearOthers = game.settings.get(MODULE_ID, "clearOtherBorders");
  return Sequencer.EffectManager.getEffects({ object: token })
    .filter((e) => e.data.name === BORDER_NAME || (clearOthers && BORDER_FILE.test(String(e.data.file))));
}

/**
 * Core's combat turn marker lives on the interface layer, above all token art, so a
 * behind-the-token border can't sit between it and the portrait. While it's this
 * token's turn we either grow the border to wrap outside the marker, or lift it above.
 */
function hasTurnMarker(token) {
  const combat = game.combat;
  if (!combat?.started || combat.combatant?.tokenId !== token.id) return false;
  return game.settings.get("core", "combatTrackerConfig")?.turnMarker?.enabled !== false;
}

function borderLayout(token, state) {
  const base = game.settings.get(MODULE_ID, `border.${state}.scale`);
  const below = game.settings.get(MODULE_ID, "borderBelow");
  const mode = hasTurnMarker(token) ? game.settings.get(MODULE_ID, "borderTurnMarker") : "none";
  if (mode === "expand") {
    // The marker mesh is sized relative to the token (1.5× by default); match it.
    const ratio = token.turnMarker?.mesh?.width && token.w ? token.turnMarker.mesh.width / token.w : 1.5;
    return { scale: Math.round(base * ratio * 100) / 100, below, above: false };
  }
  if (mode === "above") return { scale: base, below: false, above: true };
  return { scale: base, below, above: false };
}

/** Everything that shapes the effect; if it changes, the border is replayed. */
function borderSignature(path, layout) {
  return `${path}|${layout.scale}|${layout.below}|${layout.above}`;
}

async function syncBorder(token, state) {
  const path = borderPathFor(state);
  const layout = path && borderLayout(token, state);
  const sig = path && borderSignature(path, layout);
  const current = bordersOn(token);
  if (path && current.length === 1 && current[0].data.name === BORDER_NAME && current[0].data.origin === sig) return;

  for (const e of current) await Sequencer.EffectManager.endEffects({ effects: e });
  if (!path) return;

  const effect = new Sequence({ moduleName: MODULE_ID })
    .effect()
      .name(BORDER_NAME)
      .origin(sig)
      .file(path)
      .attachTo(token, { bindVisibility: true, bindAlpha: false })
      .scaleToObject(layout.scale)
      .belowTokens(layout.below)
      .persist()
      .fadeIn(300)
      .fadeOut(300);
  if (layout.above) effect.aboveInterface();
  await effect.play();
}

/** Draw, replace or clear the border on every canvas token of this actor. */
export async function applyBorders(actor, state) {
  if (!bordersAvailable()) return;
  for (const token of canvasTokensFor(actor)) {
    try {
      await syncBorder(token, state);
    } catch (err) {
      console.warn(`${MODULE_ID} | Border update failed for ${token.name}`, err);
    }
  }
}

/** One client reconciles persisted borders: the active GM, else the owning player. */
function isResponsible(actor) {
  const gm = game.users.activeGM;
  return gm ? gm.isSelf : actor.isOwner;
}

/** Remove this module's borders from the viewed scene (e.g. when the feature is turned off). */
async function clearSceneBorders() {
  if (!canvas.ready || typeof Sequencer === "undefined") return;
  for (const token of canvas.tokens.placeables) {
    if (!token.actor || !isResponsible(token.actor)) continue;
    await Sequencer.EffectManager.endEffects({ object: token, name: BORDER_NAME });
  }
}

export async function reconcileScene() {
  if (!bordersAvailable()) return;
  for (const token of canvas.tokens.placeables) {
    const actor = token.actor;
    const state = getState(actor);
    if (!state || !isResponsible(actor)) continue;
    try {
      await syncBorder(token, state);
    } catch (err) {
      console.warn(`${MODULE_ID} | Border reconcile failed for ${token.name}`, err);
    }
  }
}

/** Turn changes move the turn marker: resize/relayer borders once core has redrawn it. */
export const reconcileSoon = () => sequencerReady() && setTimeout(reconcileScene, 150);

// Any border setting change replays borders on the viewed scene.
const refresh = () => sequencerReady() && (game.settings.get(MODULE_ID, "borders") ? reconcileScene() : clearSceneBorders());
const PATH_HINT = "Sequencer database path. Browse with Sequencer's Database Viewer (right-click an entry → copy path). Blank = no border for this state.";
const SCALE_HINT = "Size relative to the token (Sequencer scaleToObject). Default tucks the JB2A dark ring just behind a standard token frame.";

export const borders = {
  id: "borders",
  settings: {
    borders: {
      name: "JB2A token borders",
      hint: "Requires Sequencer + JB2A. Adds a persistent token border matching the attunement; Unattuned clears it.",
      scope: "world", config: true, type: Boolean, default: true, onChange: refresh,
    },
    borderBelow: {
      name: "Draw borders behind the token",
      hint: "On: only the part outside the token art shows. Off: the animation draws over the portrait.",
      scope: "world", config: true, type: Boolean, default: true, onChange: refresh,
    },
    "border.graviton": {
      name: "Graviton border", hint: PATH_HINT,
      scope: "world", config: true, type: String, default: "jb2a.token_border.circle.static.purple.006", onChange: refresh,
    },
    "border.graviton.scale": {
      name: "Graviton border scale", hint: SCALE_HINT,
      scope: "world", config: true, type: Number, default: 2.05,
      range: { min: 0.5, max: 4, step: 0.05 }, onChange: refresh,
    },
    "border.photon": {
      name: "Photon border", hint: PATH_HINT,
      scope: "world", config: true, type: String, default: "jb2a.token_border.circle.static.orange.008", onChange: refresh,
    },
    "border.photon.scale": {
      name: "Photon border scale", hint: SCALE_HINT,
      scope: "world", config: true, type: Number, default: 2.05,
      range: { min: 0.5, max: 4, step: 0.05 }, onChange: refresh,
    },
    borderTurnMarker: {
      name: "Border during the token's turn",
      hint: "Foundry draws the combat turn marker above all token art, so it hides a behind-the-token border. Expand: grow the border to wrap outside the marker. Above: draw the border over the marker (and the portrait). Off: leave it as is.",
      scope: "world", config: true, type: String, default: "expand",
      choices: { expand: "Expand around the turn marker", above: "Draw above the turn marker", none: "Off" },
      onChange: refresh,
    },
    clearOtherBorders: {
      name: "Clear other JB2A token borders",
      hint: "When switching, also remove token borders not placed by this module (e.g. from Automated Animations).",
      scope: "world", config: true, type: Boolean, default: true, onChange: refresh,
    },
  },
  init() {
    hooks.clear();

    // Borders are per-token Sequencer effects: reconcile when a scene loads or a token is placed.
    hooks.once("sequencerReady", () => setTimeout(() => {
      markSequencerReady();
      reconcileScene();
    }, 500)); // let JB2A register its database first
    hooks.on("canvasReady", () => sequencerReady() && reconcileScene());

    hooks.on("combatStart", reconcileSoon);
    hooks.on("combatTurnChange", reconcileSoon);
    hooks.on("updateCombat", (_combat, changes) => {
      if ("turn" in changes || "round" in changes || "started" in changes) reconcileSoon();
    });

    hooks.on("createToken", (doc) => {
      if (!sequencerReady() || doc.parent !== canvas.scene || !bordersAvailable()) return;
      setTimeout(async () => {
        const state = getState(doc.actor);
        if (doc.object && state && isResponsible(doc.actor)) await syncBorder(doc.object, state).catch(console.warn);
      }, 250);
    });

    // An init that runs in a page that is already up (a dev reload) has missed Sequencer's
    // ready hook for good. Never true on a normal load: init comes before ready.
    if (game.ready && typeof Sequencer !== "undefined") {
      markSequencerReady();
      reconcileScene();
    }
  },
};
