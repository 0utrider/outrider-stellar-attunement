import { MODULE_ID } from "../constants.js";
import { effectValue, playerFor } from "../effect-choices.js";
import { featureHooks } from "../feature-hooks.js";
import { animationModulesActive, animationsInstalled, markSequencerReady, sequencerReady } from "../sequencer.js";
import { getState } from "../state.js";

/**
 * JB2A token borders (Sequencer). With Sequencer + JB2A active, a persistent JB2A token border
 * marks the attunement. Also keeps the border clear of core's combat turn marker.
 *
 * Which animation and what scale come through effectValue (scripts/effect-choices.js): the
 * world settings, or the choices of the token's player when players may make their own.
 */

const BORDER_NAME = `${MODULE_ID}.border`;
const BORDER_FILE = /token_border|Token_Border/;

const hooks = featureHooks("borders");

export function bordersAvailable() {
  return game.settings.get(MODULE_ID, "borders") && animationsInstalled();
}

function borderPathFor(state, user) {
  if (state === "unattuned") return null;
  // A player's path that is not in the database is passed over for the GM's.
  const path = String(effectValue(`border.${state}`, user, (value) => Sequencer.Database.entryExists(value)) ?? "").trim();
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

function borderLayout(token, state, user) {
  const base = effectValue(`border.${state}.scale`, user);
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

async function drawBorder(token, state) {
  const user = playerFor(token.actor);
  const path = borderPathFor(state, user);
  const layout = path && borderLayout(token, state, user);
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

/**
 * One border change at a time per token. Two changes that overlap would both read the same
 * old border, end it and each draw a new one, leaving two on the token. Queued, the second
 * one sees what the first drew.
 */
const queues = new WeakMap();
function syncBorder(token, state) {
  const run = (queues.get(token) ?? Promise.resolve()).then(() => drawBorder(token, state));
  queues.set(token, run.catch(() => {}));
  return run;
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

/** Borders on the viewed scene as the settings say they should be: redrawn, or all cleared. */
const refreshScene = () => (game.settings.get(MODULE_ID, "borders") ? reconcileScene() : clearSceneBorders());

/**
 * Check the viewed scene's borders shortly, once, however many callers ask in the meantime.
 * A turn change fires three hooks at once, and saving the settings menu changes several
 * border settings in a row: each asks, one pass runs. The wait also lets core redraw the
 * turn marker before a border is sized around it.
 */
let timer = null;
export function reconcileSoon(delay = 150) {
  if (!sequencerReady()) return;
  clearTimeout(timer);
  timer = setTimeout(refreshScene, delay);
}

// Any border setting change replays borders on the viewed scene.
const refresh = () => reconcileSoon();
const PATH_HINT = "Sequencer database path. Blank: no border for this state.";
const SCALE_HINT = "Size relative to the token (Sequencer scaleToObject). The default tucks the JB2A dark ring just behind a standard token frame.";

export const borders = {
  id: "borders",
  label: "Token borders",
  hint: "Needs Sequencer and JB2A. A JB2A border on the token marks its attunement.",
  requires: "animations",
  groups: {
    graviton: { label: "Graviton", keys: ["border.graviton", "border.graviton.scale"] },
    photon: { label: "Photon", keys: ["border.photon", "border.photon.scale"] },
  },
  settings: {
    borders: {
      name: "JB2A token borders",
      hint: "Adds a persistent token border matching the attunement. Unattuned clears it. On by default when Sequencer and JB2A are active.",
      scope: "world", type: Boolean, default: animationModulesActive, onChange: refresh,
    },
    borderBelow: {
      name: "Draw borders behind the token",
      hint: "On: only the part outside the token art shows. Off: the animation draws over the portrait.",
      scope: "world", type: Boolean, default: true, onChange: refresh,
    },
    "border.graviton": {
      name: "Graviton border", label: "Border", hint: PATH_HINT, picker: "border", previewWith: { scale: "border.graviton.scale", below: "borderBelow" },
      player: true, scope: "world", type: String, default: "jb2a.token_border.circle.static.purple.006", onChange: refresh,
    },
    "border.graviton.scale": {
      name: "Graviton border scale", label: "Scale", hint: SCALE_HINT,
      player: true, scope: "world", type: Number, default: 2.05,
      range: { min: 0.5, max: 4, step: 0.05 }, onChange: refresh,
    },
    "border.photon": {
      name: "Photon border", label: "Border", hint: PATH_HINT, picker: "border", previewWith: { scale: "border.photon.scale", below: "borderBelow" },
      player: true, scope: "world", type: String, default: "jb2a.token_border.circle.static.orange.008", onChange: refresh,
    },
    "border.photon.scale": {
      name: "Photon border scale", label: "Scale", hint: SCALE_HINT,
      player: true, scope: "world", type: Number, default: 2.05,
      range: { min: 0.5, max: 4, step: 0.05 }, onChange: refresh,
    },
    borderTurnMarker: {
      name: "Border during the token's turn",
      hint: "Foundry draws the combat turn marker above all token art, so it hides a behind-the-token border. Above: draw the border over the marker (and the portrait). Expand: grow the border to wrap outside the marker. Off: leave it as is.",
      scope: "world", type: String, default: "above",
      choices: { expand: "Expand around the turn marker", above: "Draw above the turn marker", none: "Off" },
      onChange: refresh,
    },
    clearOtherBorders: {
      name: "Clear other JB2A token borders",
      hint: "When switching, also remove token borders this module did not place (from Automated Animations, for example).",
      scope: "world", type: Boolean, default: true, onChange: refresh,
    },
  },
  init() {
    hooks.clear();

    // Borders are per-token Sequencer effects: reconcile when a scene loads or a token is placed.
    hooks.once("sequencerReady", () => setTimeout(() => {
      markSequencerReady();
      reconcileScene();
    }, 500)); // let JB2A register its database first
    // A scene draw: Sequencer first drops every effect it holds and then replays the persisted
    // ones from the token flags, a moment after canvasReady. A border drawn before that is
    // dropped with the rest and comes back only if its flag was written in time. So wait for
    // Sequencer to say it is done; the longer wait on canvasReady covers a Sequencer version
    // without that hook.
    hooks.on("canvasReady", () => reconcileSoon(1000));
    hooks.on("sequencerEffectManagerReady", () => reconcileSoon());

    hooks.on("combatStart", () => reconcileSoon());
    hooks.on("combatTurnChange", () => reconcileSoon());
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
