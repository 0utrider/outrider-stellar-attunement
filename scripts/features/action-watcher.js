import { LABELS, MODULE_ID, OPPOSITE } from "../constants.js";
import { featureHooks } from "../feature-hooks.js";
import { getState } from "../state.js";
import { systemFlags } from "../system.js";
import { setAttunement } from "./attunement.js";

/**
 * Actions that change the attunement on their own. A Solarian action is posted to chat as an
 * item card; the system writes the item's roll options on it (`origin:item:trait:cycle`). The
 * watcher reads that card and changes the state through setAttunement, the same path as the
 * macro and the Token HUD, so art, borders and ring follow.
 *
 * - cycle: Graviton and Photon swap. Unattuned has no opposite, so nothing happens.
 * - disharmony: Unattuned.
 * - Attune (the action): asks which aspect.
 * - attuned, used while Unattuned: a warning only. The rules do not allow it.
 * - an action whose requirement names the other attunement (REQUIRES): a warning only.
 * - Stellar Shield Collapse: offers Black Hole (Graviton) or Supernova (Photon), when the
 *   actor has that feat.
 * - a critical hit inside a cycle action, with a Cycling Crystal on the weapon that hit: asks
 *   whether to halt the cycle (the crystal's Halt Cycle).
 * - rolling initiative while Unattuned: asks which aspect, as Attune does.
 *
 * The rules change the state "once you complete the action". Most of these actions contain a
 * Strike, which is rolled as its own card after the action card. Changing at once would roll
 * that Strike, and play its animation, in the new state. So for the actions in STRIKES the
 * change waits for that actor's Strikes, the end of the turn, or a time limit.
 *
 * Only item cards count. Rolls made from the card (inline damage, saves) carry the same origin
 * and a `context`, and are skipped. The client of the user who posted the card makes the change,
 * so it runs once however many users are connected.
 */

const hooks = featureHooks("actionWatcher");

/** Trait to the state it leads to from `state`, or null for no change. Disharmony is read first. */
const TRAITS = {
  disharmony: () => "unattuned",
  cycle: (state) => OPPOSITE[state] ?? null,
};

/**
 * Actions whose Strikes come after the card, by slug: how many Strikes to wait for, and whether a
 * miss on the first ends the action. Unstable Flare strikes every enemy in an area, so it waits
 * until the Strikes stop. Other cycle and disharmony actions change the state at once.
 */
const STRIKES = {
  "clinging-flare": { count: 1 },
  "eclipse-strike": { count: 1 },
  "hampering-flare": { count: 1 },
  "shattering-impact": { count: 1 },
  "flicker-strike": { count: 2, endOnMiss: true },
  "solar-barrage": { count: 3 },
  "unstable-flare": { count: Infinity },
};

/**
 * Actions that need one attunement, by slug. The requirement is only in the description text,
 * which a translation changes, so the slugs are listed here (sf2e 1.6.1 feats). An action used
 * in the other attunement gives a warning and changes nothing.
 */
const REQUIRES = {
  "black-hole": "graviton",
  singularity: "graviton",
  supernova: "photon",
  "big-bang": "photon",
};

/** Stellar Shield Collapse: the feat it lets the Solarian use, by attunement. */
const COLLAPSE = { slug: "stellar-shield-collapse", graviton: "black-hole", photon: "supernova" };

/** The Cycling Crystal, and the Strikes its Halt Cycle can follow (the crystal's own choice narrows it). */
const CRYSTAL = "cycling-crystal";
const SOLAR_STRIKES = ["solar-flare", "solar-weapon", "twin-solar-weapon"];

/** After a Strike of an action that has more to come, how long to wait for the next one. */
const SETTLE_MS = 20_000;
/** An action whose Strike never comes changes the state after this long. */
const LIMIT_MS = 120_000;

/** Changes waiting for Strikes, by actor uuid: { actor, from, to, trait, left, endOnMiss, timer, asking, due }. */
const pending = new Map();

/** Actors with an "attune to which aspect" window open on this client, by uuid. */
const asking = new Set();
/** Combat and actor pairs already asked on initiative in this session: "<combat id>:<actor uuid>". */
const askedOnInitiative = new Set();

const enabled = () => game.settings.get(MODULE_ID, "actionWatcher");
const option = (key) => game.settings.get(MODULE_ID, key);
const esc = (text) => foundry.utils.escapeHTML(String(text ?? ""));

/** Runs a waiting change now, unless the state was changed some other way in the meantime. */
async function settle(uuid) {
  const change = pending.get(uuid);
  if (!change) return;
  // Halt Cycle is being asked: the answer decides.
  if (change.asking) {
    change.due = true;
    return;
  }
  pending.delete(uuid);
  clearTimeout(change.timer);
  if (getState(change.actor) !== change.from) return;
  await setAttunement(change.actor, change.to);
}

function wait(change, uuid, ms) {
  clearTimeout(change.timer);
  change.timer = setTimeout(() => settle(uuid).catch((err) => console.warn(`${MODULE_ID} | Attunement change failed`, err)), ms);
}

/** Item card facts from the roll options the system writes: slug and traits. */
function cardFacts(origin) {
  const facts = { slug: null, traits: new Set() };
  for (const option of origin?.rollOptions ?? []) {
    if (option.startsWith("origin:item:slug:")) facts.slug = option.slice(17);
    else if (option.startsWith("origin:item:trait:")) facts.traits.add(option.slice(18));
  }
  return facts;
}

async function askAttune(actor, state, why = "") {
  // One window per actor: an Attune card posted with the initiative roll does not ask twice.
  if (asking.has(actor.uuid)) return;
  asking.add(actor.uuid);
  try {
    await attuneDialog(actor, state, why);
  } finally {
    asking.delete(actor.uuid);
  }
}

async function attuneDialog(actor, state, why) {
  const { DialogV2 } = foundry.applications.api;
  const choice = await DialogV2.wait({
    window: { title: `Attune: ${actor.name}` },
    content: `${why ? `<p>${why}</p>` : ""}<p>Attune ${esc(actor.name)} to which aspect?</p>`,
    buttons: ["graviton", "photon"].map((aspect) => ({
      action: aspect,
      label: LABELS[aspect],
      icon: aspect === "photon" ? "fa-solid fa-sun" : "fa-solid fa-circle-dot",
      default: aspect === (OPPOSITE[state] ?? "graviton"),
    })),
    rejectClose: false,
  });
  if ((choice === "graviton" || choice === "photon") && getState(actor) !== choice) await setAttunement(actor, choice);
}

/** Yes or no in a small window. Closing it is no. */
async function confirm(title, html, yes, no) {
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title },
    content: html,
    buttons: [
      { action: "yes", label: yes, icon: "fa-solid fa-check", default: true },
      { action: "no", label: no, icon: "fa-solid fa-xmark" },
    ],
    rejectClose: false,
  });
  return choice === "yes";
}

/** The Strike's slug, from the attack card's roll options. */
function strikeSlug(context) {
  const option = context.options?.find((o) => o.startsWith("item:slug:"));
  return option ? option.slice(10) : null;
}

/** The actor's Cycling Crystal, if it is set on the weapon this Strike used. */
function crystalFor(actor, slug) {
  if (!SOLAR_STRIKES.includes(slug)) return null;
  const crystal = actor.items.find((item) => item.slug === CRYSTAL);
  if (!crystal) return null;
  const chosen = crystal.system.rules?.find((rule) => rule.key === "ChoiceSet")?.selection;
  return !chosen || chosen === slug ? crystal : null;
}

/**
 * A critical hit inside a cycle action, with a Cycling Crystal on the weapon that hit: Halt
 * Cycle lets the Solarian keep the current attunement. Returns true when the cycle was halted.
 */
async function offerHalt(change, uuid, context) {
  if (change.trait !== "cycle" || context.outcome !== "criticalSuccess" || !option("actionWatcher.haltCycle")) return false;
  const crystal = crystalFor(change.actor, strikeSlug(context));
  if (!crystal) return false;
  clearTimeout(change.timer);
  change.asking = true;
  let halt = false;
  try {
    halt = await confirm(
      `Halt Cycle: ${change.actor.name}`,
      `<p>Critical hit. ${esc(crystal.name)}: halt the cycle and stay ${LABELS[change.from]}, or change to ${LABELS[change.to]} as the action says?</p>`
        + "<p class=\"hint\">Halt Cycle is a free action, once per 10 minutes. The module does not track the frequency.</p>",
      `Stay ${LABELS[change.from]}`,
      `Change to ${LABELS[change.to]}`,
    );
  } finally {
    change.asking = false;
  }
  if (pending.get(uuid) !== change) return true;
  if (halt) {
    pending.delete(uuid);
    return true;
  }
  if (change.due) {
    await settle(uuid);
    return true;
  }
  return false;
}

/** Stellar Shield Collapse: offer the feat for the current attunement, when the actor has it. */
async function offerCollapse(actor, state) {
  if (!option("actionWatcher.shieldCollapse")) return;
  const slug = COLLAPSE[state];
  if (!slug) return;
  const feat = actor.items.find((item) => item.slug === slug);
  if (!feat) return ui.notifications.info(`${actor.name} is ${LABELS[state]} but has no ${state === "graviton" ? "Black Hole" : "Supernova"} feat.`);
  const use = await confirm(
    `Stellar Shield Collapse: ${actor.name}`,
    `<p>${esc(actor.name)} is ${LABELS[state]}: use ${esc(feat.name)} now, as a free action?</p>`
      + "<p class=\"hint\">Only if Black Hole or Supernova has not been used within the last 10 minutes. The module does not track that.</p>",
    `Use ${feat.name}`,
    "Not now",
  );
  if (use) await feat.toMessage();
}

/** The user who is asked about an actor's initiative: the roller, or the actor's player when the GM rolled. */
function askerFor(actor, roller) {
  if (!roller?.isGM) return roller;
  const players = game.users.filter((user) => !user.isGM && user.active);
  const assigned = players.filter((user) => user.character?.id === actor.id);
  if (assigned.length === 1) return assigned[0];
  const owners = players.filter((user) => actor.testUserPermission(user, "OWNER"));
  return owners.length === 1 && !assigned.length ? owners[0] : roller;
}

/** Initiative set on a combatant: an Unattuned Solarian is asked to attune, once per combat. */
function onInitiative(combatant, userId) {
  const actor = combatant.actor;
  if (getState(actor) !== "unattuned" || !combatant.combat) return;
  const base = actor.isToken ? actor.token?.baseActor ?? actor : actor;
  if (askerFor(base, game.users.get(userId))?.id !== game.user.id) return;
  const key = `${combatant.combat.id}:${actor.uuid}`;
  if (askedOnInitiative.has(key)) return;
  askedOnInitiative.add(key);
  return askAttune(actor, "unattuned", `${esc(actor.name)} rolled initiative while Unattuned.`);
}

/** A Strike card from an actor with a change waiting: count it down. */
async function onStrike(message, context) {
  const actor = message.actor;
  const uuid = actor?.uuid;
  const change = uuid && pending.get(uuid);
  if (!change || change.asking) return;
  change.left -= 1;
  if (await offerHalt(change, uuid, context)) return;
  const missed = ["failure", "criticalFailure"].includes(context.outcome);
  if (change.left <= 0 || (change.endOnMiss && missed)) return settle(uuid);
  wait(change, uuid, SETTLE_MS);
}

/** An item card posted by this user. */
async function onCard(message, origin) {
  const actor = message.actor ?? (origin.actor ? fromUuidSync(origin.actor) : null);
  if (!getState(actor)) return;
  const { slug, traits } = cardFacts(origin);

  // A new action ends the one before it.
  if (pending.has(actor.uuid)) await settle(actor.uuid);
  const state = getState(actor);

  if (traits.has("attuned") && state === "unattuned") {
    ui.notifications.warn(`${actor.name} is Unattuned: ${message.item?.name ?? "this action"} needs an attunement.`);
    return;
  }
  const needs = REQUIRES[slug];
  if (needs && state !== needs) {
    ui.notifications.warn(`${actor.name} is ${LABELS[state]}: ${message.item?.name ?? "this action"} needs ${LABELS[needs]}.`);
    return;
  }
  if (slug === "attune") return askAttune(actor, state);
  if (slug === COLLAPSE.slug) return offerCollapse(actor, state);

  const trait = Object.keys(TRAITS).find((name) => traits.has(name));
  const to = trait ? TRAITS[trait](state) : null;
  if (!to || to === state) return;

  const strikes = STRIKES[slug];
  if (!strikes) return setAttunement(actor, to);
  const change = { actor, from: state, to, trait, left: strikes.count, endOnMiss: !!strikes.endOnMiss, timer: null };
  pending.set(actor.uuid, change);
  wait(change, actor.uuid, LIMIT_MS);
}

export const actionWatcher = {
  id: "actionWatcher",
  label: "Actions",
  hint: "Solarian actions posted to chat change the attunement as the rules say.",
  settings: {
    actionWatcher: {
      name: "Follow cycle and disharmony actions",
      hint: "When a Solarian uses an action with the cycle trait, Graviton and Photon swap; with the disharmony trait, the Solarian becomes Unattuned. An action that includes a Strike changes the state after its Strikes. Attune asks which aspect. An attuned action used while Unattuned, or one that needs the other attunement (Black Hole, Singularity, Supernova, Big Bang), gives a warning and changes nothing. Works from the action's chat card (the sheet's action icon or Use button).",
      scope: "world", type: Boolean, default: true,
    },
    "actionWatcher.haltCycle": {
      name: "Offer Halt Cycle",
      hint: "A critical hit inside a cycle action, with the solar weapon or solar flare that carries a Cycling Crystal, asks whether to stay in the current attunement. Does nothing while the option above is off.",
      scope: "world", type: Boolean, default: true,
    },
    "actionWatcher.shieldCollapse": {
      name: "Offer Black Hole or Supernova on Stellar Shield Collapse",
      hint: "Posting Stellar Shield Collapse asks whether to use Black Hole (Graviton) or Supernova (Photon), when the Solarian has that feat. Yes posts its card. Does nothing while the option above is off.",
      scope: "world", type: Boolean, default: true,
    },
    "actionWatcher.initiative": {
      name: "Ask to attune on initiative",
      hint: "When an Unattuned Solarian rolls initiative, ask which aspect to attune to, once per encounter. Asks the user who rolled, or the Solarian's player when the GM rolled for them and that player is online.",
      scope: "world", type: Boolean, default: true,
    },
  },
  init() {
    hooks.clear();
    for (const change of pending.values()) clearTimeout(change.timer);
    pending.clear();
    asking.clear();

    hooks.on("createChatMessage", (message, _options, userId) => {
      if (!enabled()) return;
      const flags = systemFlags(message);
      const run = (promise) => promise?.catch?.((err) => console.warn(`${MODULE_ID} | Action watcher`, err));
      // Strikes count down a waiting change on the client that holds it, whoever rolled them.
      if (flags?.context) {
        if (flags.context.type === "attack-roll" && pending.size) run(onStrike(message, flags.context));
        return;
      }
      if (userId !== game.user.id || !flags?.origin) return;
      run(onCard(message, flags.origin));
    });

    // Initiative rolled (token, tracker or roll all): the system reads any number written to a
    // combatant's initiative as an initiative roll, on the writer's client. Every client sees the
    // update and only the one that should ask does.
    hooks.on("updateCombatant", (combatant, changes, _options, userId) => {
      if (typeof changes.initiative !== "number" || !option("actionWatcher.initiative")) return;
      onInitiative(combatant, userId)?.catch?.((err) => console.warn(`${MODULE_ID} | Attune on initiative`, err));
    });

    // The turn ends: whatever was waiting is complete.
    hooks.on("updateCombat", (_combat, changes) => {
      if (!pending.size || !("turn" in changes || "round" in changes)) return;
      for (const uuid of [...pending.keys()]) settle(uuid).catch((err) => console.warn(`${MODULE_ID} | Attunement change failed`, err));
    });
  },
};
