/**
 * Outrider's Stellar Attunement
 * Cycles a Solarian's Stellar Attunement and keeps token art in sync with it.
 *
 * Cycle:  unattuned → graviton
 *         graviton/photon (1st click) → the opposite attunement
 *         graviton/photon (2nd click) → unattuned
 *
 * State lives on the SF2e "Stellar Attunement" feat as a toggleable RollOption
 * (option "stellar-attunement", suboptions graviton|photon|unattuned).
 *
 * Optional: with Sequencer + JB2A active, a persistent JB2A token border marks the attunement.
 */

const MOD = "outrider-stellar-attunement";
const BRAND_COLOR = "#7000d6"; // Outrider brand (Electric Violet Deep)
const MACRO_PACK = `${MOD}.outrider-stellar-attunement-macros`;
// Shared "Outrider's Mods" root folders: same literal ids in every Outrider module (Foundry ids are exactly 16 chars).
const SHARED_MODS_FOLDER_IDS = {
  Compendium: "outridersModsCmp",
  Macro: "outridersModsMac",
  JournalEntry: "outridersModsJrn",
  Actor: "outridersModsAct",
  Item: "outridersModsItm",
  Scene: "outridersModsScn",
};
const OPTION = "stellar-attunement";
const STATES = ["unattuned", "graviton", "photon"];
const LABELS = { unattuned: "Unattuned", graviton: "Graviton-Attuned", photon: "Photon-Attuned" };
const SUFFIX = { unattuned: "", graviton: "-1", photon: "-2" };
const OPPOSITE = { graviton: "photon", photon: "graviton" };

/** Target selection the module itself is currently applying, keyed by actor uuid. */
const pending = new Map();

// ─── State helpers ────────────────────────────────────────────────────────────

function getRule(actor) {
  return actor?.rules?.find((r) => r.key === "RollOption" && r.option === OPTION) ?? null;
}

function getState(actor) {
  const sel = getRule(actor)?.selection;
  return STATES.includes(sel) ? sel : null;
}

function nextState(actor, current) {
  if (current === "unattuned") return "graviton";
  const swappedTo = actor.getFlag(MOD, "swappedTo");
  return swappedTo === current ? "unattuned" : OPPOSITE[current];
}

// ─── Token art ────────────────────────────────────────────────────────────────

/** Strip a trailing -1/-2 from the default art to find the base path. */
function baseArt(actor) {
  const src = actor.prototypeToken?.texture?.src ?? actor.img;
  const m = src.match(/^(.*?)(?:-[12])?(\.[a-z0-9]+)$/i);
  return m ? { stem: m[1], ext: m[2] } : null;
}

function artFor(actor, state) {
  const custom = actor.getFlag(MOD, "images")?.[state];
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

  const allScenes = game.settings.get(MOD, "allScenes");
  const scenes = allScenes ? game.scenes : [canvas.scene].filter(Boolean);
  for (const scene of scenes) {
    const updates = scene.tokens
      .filter((t) => t.actorLink && t.actorId === actor.id && t._source.texture.src !== src && t.canUserModify(game.user, "update"))
      .map((t) => ({ _id: t.id, "texture.src": src }));
    if (!updates.length) continue;
    try {
      await scene.updateEmbeddedDocuments("Token", updates);
    } catch (err) {
      console.warn(`${MOD} | Could not update tokens in scene "${scene.name}"`, err);
    }
  }

  // Prototype last: the system may propagate it to canvas tokens on its own.
  if (actor.prototypeToken.texture.src !== src && actor.isOwner) {
    await actor.update({ "prototypeToken.texture.src": src });
  }
}

// ─── JB2A token borders (Sequencer) ─────────────────────────────────────────

const BORDER_NAME = `${MOD}.border`;
const BORDER_FILE = /token_border|Token_Border/;
const JB2A_IDS = ["jb2a_patreon", "JB2A_DnD5e"];

function bordersAvailable() {
  return game.settings.get(MOD, "borders")
    && game.modules.get("sequencer")?.active
    && JB2A_IDS.some((id) => game.modules.get(id)?.active)
    && typeof Sequencer !== "undefined";
}

function borderPathFor(state) {
  if (state === "unattuned") return null;
  const path = game.settings.get(MOD, `border.${state}`)?.trim();
  if (!path) return null;
  if (!Sequencer.Database.entryExists(path)) {
    console.warn(`${MOD} | JB2A entry not found: ${path} (free JB2A lacks some variants)`);
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
  const clearOthers = game.settings.get(MOD, "clearOtherBorders");
  return Sequencer.EffectManager.getEffects({ object: token })
    .filter((e) => e.data.name === BORDER_NAME || (clearOthers && BORDER_FILE.test(String(e.data.file))));
}

/** Everything that shapes the effect; if it changes, the border is replayed. */
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
  const base = game.settings.get(MOD, `border.${state}.scale`);
  const below = game.settings.get(MOD, "borderBelow");
  const mode = hasTurnMarker(token) ? game.settings.get(MOD, "borderTurnMarker") : "none";
  if (mode === "expand") {
    // The marker mesh is sized relative to the token (1.5× by default); match it.
    const ratio = token.turnMarker?.mesh?.width && token.w ? token.turnMarker.mesh.width / token.w : 1.5;
    return { scale: Math.round(base * ratio * 100) / 100, below, above: false };
  }
  if (mode === "above") return { scale: base, below: false, above: true };
  return { scale: base, below, above: false };
}

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

  const effect = new Sequence({ moduleName: MOD })
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

async function applyBorders(actor, state) {
  if (!bordersAvailable()) return;
  for (const token of canvasTokensFor(actor)) {
    try {
      await syncBorder(token, state);
    } catch (err) {
      console.warn(`${MOD} | Border update failed for ${token.name}`, err);
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

async function reconcileScene() {
  if (!bordersAvailable()) return;
  for (const token of canvas.tokens.placeables) {
    const actor = token.actor;
    const state = getState(actor);
    if (!state || !isResponsible(actor)) continue;
    try {
      await syncBorder(token, state);
    } catch (err) {
      console.warn(`${MOD} | Border reconcile failed for ${token.name}`, err);
    }
  }
}

// ─── Attack animations ──────────────────────────────────────────────────────
// Solarian strikes are synthetic weapons (from Strike rule elements), so Automated
// Animations can't attach to them. Instead we watch attack-roll chat cards.

const ATTACKS = {
  "solar-weapon": {
    label: "Solar Weapon",
    graviton: "jb2a.energy_strands.range.multiple.dark_purple.01",
    photon: "jb2a.scorching_ray.02.orange",
  },
  "solar-flare": {
    label: "Solar Flare",
    graviton: "jb2a.fireball.beam.dark_purple",
    photon: "jb2a.fireball.beam.orange",
  },
};

function attackFromMessage(message) {
  const ctx = message.flags?.sf2e?.context ?? message.flags?.pf2e?.context;
  if (ctx?.type !== "attack-roll") return null;
  const opts = new Set(ctx.options ?? []);
  const slug = Object.keys(ATTACKS).find((k) => opts.has(`item:slug:${k}`));
  if (!slug) return null;
  // Attunement as of the roll; fall back to the live state.
  const state = STATES.find((s) => opts.has(`${OPTION}:${s}`)) ?? getState(message.actor);
  return { slug, state, ctx };
}

function sourceTokenFor(message) {
  const id = message.speaker?.token;
  return (id && canvas.tokens.get(id)) || message.actor?.getActiveTokens?.(true)[0] || null;
}

function targetTokenFor(message, ctx) {
  const uuid = ctx.target?.token;
  const doc = uuid ? fromUuidSync(uuid) : null;
  if (doc?.parent === canvas.scene && doc.object) return doc.object;
  return message.author?.targets?.first() ?? null;
}

async function playAttack(message) {
  if (!game.settings.get(MOD, "attacks") || typeof Sequencer === "undefined") return;
  const hit = attackFromMessage(message);
  if (!hit || hit.state === "unattuned") return;
  const path = game.settings.get(MOD, `attack.${hit.slug}.${hit.state}`)?.trim();
  if (!path) return;
  if (!Sequencer.Database.entryExists(path)) return console.warn(`${MOD} | JB2A entry not found: ${path}`);

  const source = sourceTokenFor(message);
  const target = targetTokenFor(message, hit.ctx);
  if (!source || !target || source === target) return;

  const missed = ["failure", "criticalFailure"].includes(hit.ctx.outcome);
  await new Sequence({ moduleName: MOD })
    .effect()
      .file(path)
      .atLocation(source)
      .stretchTo(target)
      .missed(missed)
    .play();
}


function resolveActor(actor) {
  if (typeof actor === "string") actor = fromUuidSync(actor) ?? game.actors.get(actor) ?? game.actors.getName(actor);
  return actor ?? canvas.tokens?.controlled[0]?.actor ?? game.user.character ?? null;
}

/** Set a specific attunement: "unattuned" | "graviton" | "photon". */
async function setAttunement(actorLike, state, { fromCycle = false } = {}) {
  const actor = resolveActor(actorLike);
  const rule = getRule(actor);
  if (!rule) return ui.notifications.warn(`${actor?.name ?? "No actor"} has no Stellar Attunement.`);
  if (!STATES.includes(state)) throw new Error(`${MOD} | Unknown attunement "${state}"`);

  const prev = getState(actor);
  pending.set(actor.uuid, state);
  try {
    await actor.toggleRollOption("all", OPTION, rule.item.id, true, state);
  } finally {
    pending.delete(actor.uuid);
  }

  // Track the swap so the next click drops to unattuned.
  const swapped = fromCycle && prev && prev !== "unattuned" && state === OPPOSITE[prev];
  if (swapped) await actor.setFlag(MOD, "swappedTo", state);
  else if (actor.getFlag(MOD, "swappedTo")) await actor.unsetFlag(MOD, "swappedTo");

  await applyArt(actor, state);
  await applyBorders(actor, state);
  if (game.settings.get(MOD, "notify")) ui.notifications.info(`${actor.name}: ${LABELS[state]}`);
  return state;
}

/** Advance the cycle. Returns the new state. */
async function cycle(actorLike) {
  const actor = resolveActor(actorLike);
  if (!actor) return ui.notifications.warn("Select a token or assign a character first.");
  const current = getState(actor);
  if (!current) return ui.notifications.warn(`${actor.name} has no Stellar Attunement.`);
  return setAttunement(actor, nextState(actor, current), { fromCycle: true });
}

/** Per-actor image overrides (for art that doesn't follow the -1/-2 convention). */
async function configure(actorLike) {
  const actor = resolveActor(actorLike);
  if (!actor) return ui.notifications.warn("Select a token or assign a character first.");
  const imgs = actor.getFlag(MOD, "images") ?? {};
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
  if (Object.keys(cleaned).length) await actor.setFlag(MOD, "images", cleaned);
  else await actor.unsetFlag(MOD, "images");
  const state = getState(actor);
  if (state) await applyArt(actor, state);
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

Hooks.once("init", () => {
  game.settings.register(MOD, "syncedVersion", {
    scope: "world", config: false, type: String, default: "",
  });
  game.settings.register(MOD, "allScenes", {
    name: "Update tokens in all scenes",
    hint: "Swap art on linked tokens in every scene, not just the active one.",
    scope: "world", config: true, type: Boolean, default: true,
  });
  game.settings.register(MOD, "tokenHud", {
    name: "Token HUD button",
    hint: "Show a Stellar Attunement cycle button on the Token HUD for Solarians.",
    scope: "client", config: true, type: Boolean, default: true,
  });
  game.settings.register(MOD, "notify", {
    name: "Show notification",
    hint: "Pop a notification when attunement changes via the macro or HUD.",
    scope: "client", config: true, type: Boolean, default: false,
  });
  // Any border setting change replays borders on the viewed scene.
  const refresh = () => sequencerReady && (game.settings.get(MOD, "borders") ? reconcileScene() : clearSceneBorders());
  const PATH_HINT = "Sequencer database path. Browse with Sequencer's Database Viewer (right-click an entry → copy path). Blank = no border for this state.";
  const SCALE_HINT = "Size relative to the token (Sequencer scaleToObject). Default tucks the JB2A dark ring just behind a standard token frame.";

  game.settings.register(MOD, "borders", {
    name: "JB2A token borders",
    hint: "Requires Sequencer + JB2A. Adds a persistent token border matching the attunement; Unattuned clears it.",
    scope: "world", config: true, type: Boolean, default: true, onChange: refresh,
  });
  game.settings.register(MOD, "borderBelow", {
    name: "Draw borders behind the token",
    hint: "On: only the part outside the token art shows. Off: the animation draws over the portrait.",
    scope: "world", config: true, type: Boolean, default: true, onChange: refresh,
  });
  game.settings.register(MOD, "border.graviton", {
    name: "Graviton border", hint: PATH_HINT,
    scope: "world", config: true, type: String, default: "jb2a.token_border.circle.static.purple.006", onChange: refresh,
  });
  game.settings.register(MOD, "border.graviton.scale", {
    name: "Graviton border scale", hint: SCALE_HINT,
    scope: "world", config: true, type: Number, default: 2.05,
    range: { min: 0.5, max: 4, step: 0.05 }, onChange: refresh,
  });
  game.settings.register(MOD, "border.photon", {
    name: "Photon border", hint: PATH_HINT,
    scope: "world", config: true, type: String, default: "jb2a.token_border.circle.static.orange.008", onChange: refresh,
  });
  game.settings.register(MOD, "border.photon.scale", {
    name: "Photon border scale", hint: SCALE_HINT,
    scope: "world", config: true, type: Number, default: 2.05,
    range: { min: 0.5, max: 4, step: 0.05 }, onChange: refresh,
  });
  game.settings.register(MOD, "borderTurnMarker", {
    name: "Border during the token's turn",
    hint: "Foundry draws the combat turn marker above all token art, so it hides a behind-the-token border. Expand: grow the border to wrap outside the marker. Above: draw the border over the marker (and the portrait). Off: leave it as is.",
    scope: "world", config: true, type: String, default: "expand",
    choices: { expand: "Expand around the turn marker", above: "Draw above the turn marker", none: "Off" },
    onChange: refresh,
  });
  game.settings.register(MOD, "unattuneOnCombatEnd", {
    name: "Unattune when the encounter ends",
    hint: "When the GM ends an encounter, every attuned Solarian in it drops to Unattuned.",
    scope: "world", config: true, type: Boolean, default: true,
  });
  game.settings.register(MOD, "clearOtherBorders", {
    name: "Clear other JB2A token borders",
    hint: "When switching, also remove token borders not placed by this module (e.g. from Automated Animations).",
    scope: "world", config: true, type: Boolean, default: true, onChange: refresh,
  });
  game.settings.register(MOD, "attacks", {
    name: "JB2A attack animations",
    hint: "Play a ranged animation from the Solarian to the target when Solar Weapon or Solar Flare is rolled while attuned. Misses animate as misses.",
    scope: "world", config: true, type: Boolean, default: true,
  });
  for (const [slug, cfg] of Object.entries(ATTACKS)) {
    for (const state of ["graviton", "photon"]) {
      game.settings.register(MOD, `attack.${slug}.${state}`, {
        name: `${cfg.label} - ${LABELS[state]}`,
        hint: "Sequencer database path for a ranged effect. Blank = no animation.",
        scope: "world", config: true, type: String, default: cfg[state],
      });
    }
  }
});

// ─── Branding sync (Outrider module convention) ─────────────────────────────

/** Find or create the shared "Outrider's Mods" folder for a sidebar type (any Outrider module may own it). */
async function getOrCreateSharedRoot(type) {
  const id = SHARED_MODS_FOLDER_IDS[type];
  let root = game.folders.get(id);
  if (root) return root;
  try {
    root = await Folder.implementation.create(
      { _id: id, name: "Outrider's Mods", type, color: BRAND_COLOR, sorting: "a" },
      { keepId: true },
    );
  } catch (err) {
    root = game.folders.get(id); // another Outrider module won the race
    if (!root) throw err;
  }
  return root ?? game.folders.get(id);
}

/**
 * Brand this module's pack folder and nest it under "Outrider's Mods".
 * packFolders color only applies when Foundry first creates the folder, so color it here if uncolored.
 * Only touches the folder if it is still ours (name from packFolders) and only nests it if top-level:
 * a folder the GM moved or recolored is left alone.
 */
async function brandPackFolder(pack) {
  const folder = pack?.folder;
  if (!folder) return;
  const own = Array.from(game.modules.get(MOD).packFolders ?? []).some((f) => f.name === folder.name);
  if (!own) return;
  const patch = {};
  if (!folder.color) patch.color = BRAND_COLOR;
  if (!folder.folder) patch.folder = (await getOrCreateSharedRoot("Compendium")).id;
  if (Object.keys(patch).length) await folder.update(patch);
}

async function syncWorldContent() {
  await brandPackFolder(game.packs.get(MACRO_PACK));
}

Hooks.once("ready", async () => {
  game.modules.get(MOD).api = { cycle, setAttunement, configure, getState: (a) => getState(resolveActor(a)), artFor, reconcileScene, playAttack, syncWorldContent };

  // Version-gated: runs on install and on each update, never on plain reloads. Active GM only.
  if (!game.users.activeGM?.isSelf) return;
  const version = game.modules.get(MOD).version;
  if (game.settings.get(MOD, "syncedVersion") === version) return;
  try {
    await syncWorldContent();
    await game.settings.set(MOD, "syncedVersion", version);
  } catch (err) {
    console.warn(`${MOD} | World content sync failed`, err);
  }
});

// Attunement changed some other way (sheet, pf2e-hud, etc.) → sync art, reset swap tracking.
Hooks.on("updateItem", async (item, changes, _opts, userId) => {
  if (userId !== game.user.id || !changes.system?.rules) return;
  const actor = item.actor;
  if (!actor || getRule(actor)?.item?.id !== item.id) return;
  if (pending.has(actor.uuid)) return; // our own change; setAttunement handles it
  const state = getState(actor);
  if (!state) return;
  if (actor.getFlag(MOD, "swappedTo")) await actor.unsetFlag(MOD, "swappedTo");
  await applyArt(actor, state);
  await applyBorders(actor, state);
});

// Borders are per-token Sequencer effects: reconcile when a scene loads or a token is placed.
let sequencerReady = false;
Hooks.once("sequencerReady", () => setTimeout(() => {
  sequencerReady = true;
  reconcileScene();
}, 500)); // let JB2A register its database first
Hooks.on("canvasReady", () => sequencerReady && reconcileScene());

// Turn changes move the turn marker: resize/relayer borders once core has redrawn it.
const reconcileSoon = () => sequencerReady && setTimeout(reconcileScene, 150);
Hooks.on("combatStart", reconcileSoon);
Hooks.on("combatTurnChange", reconcileSoon);
Hooks.on("updateCombat", (_combat, changes) => {
  if ("turn" in changes || "round" in changes || "started" in changes) reconcileSoon();
});

// "End Encounter" deletes the combat: drop its Solarians to Unattuned (one client does it).
Hooks.on("deleteCombat", async (combat) => {
  if (!game.users.activeGM?.isSelf) return;
  if (game.settings.get(MOD, "unattuneOnCombatEnd")) {
    const seen = new Set();
    for (const c of combat.combatants) {
      const actor = c.actor;
      if (!actor || seen.has(actor.uuid)) continue;
      seen.add(actor.uuid);
      const state = getState(actor);
      if (state && state !== "unattuned") {
        await setAttunement(actor, "unattuned").catch((err) => console.warn(`${MOD} | Unattune failed for ${actor.name}`, err));
      }
    }
  }
  reconcileSoon(); // shrink any border that was expanded around the turn marker
});

// Attack animations: only the rolling client plays (Sequencer broadcasts to everyone).
Hooks.on("createChatMessage", (message) => {
  if (!sequencerReady || message.author?.id !== game.user.id || !attackFromMessage(message)) return;
  // Let Dice So Nice finish its 3D roll so the animation lands with the result.
  const dice = game.modules.get("dice-so-nice")?.active && game.dice3d
    ? game.dice3d.waitFor3DAnimationByMessageID(message.id).catch(() => {})
    : Promise.resolve();
  dice.then(() => playAttack(message)).catch((err) => console.warn(`${MOD} | Attack animation failed`, err));
});
Hooks.on("createToken", (doc) => {
  if (!sequencerReady || doc.parent !== canvas.scene || !bordersAvailable()) return;
  setTimeout(async () => {
    const state = getState(doc.actor);
    if (doc.object && state && isResponsible(doc.actor)) await syncBorder(doc.object, state).catch(console.warn);
  }, 250);
});

Hooks.on("renderTokenHUD", (hud, html) => {
  if (!game.settings.get(MOD, "tokenHud")) return;
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
