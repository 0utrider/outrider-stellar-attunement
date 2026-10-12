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

/** After a Strike of an action that has more to come, how long to wait for the next one. */
const SETTLE_MS = 20_000;
/** An action whose Strike never comes changes the state after this long. */
const LIMIT_MS = 120_000;

/** Changes waiting for Strikes, by actor uuid: { actor, from, to, left, endOnMiss, timer }. */
const pending = new Map();

const enabled = () => game.settings.get(MODULE_ID, "actionWatcher");

/** Runs a waiting change now, unless the state was changed some other way in the meantime. */
async function settle(uuid) {
  const change = pending.get(uuid);
  if (!change) return;
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

async function askAttune(actor, state) {
  const { DialogV2 } = foundry.applications.api;
  const choice = await DialogV2.wait({
    window: { title: `Attune: ${actor.name}` },
    content: `<p>Attune ${foundry.utils.escapeHTML(actor.name)} to which aspect?</p>`,
    buttons: ["graviton", "photon"].map((aspect) => ({
      action: aspect,
      label: LABELS[aspect],
      icon: aspect === "photon" ? "fa-solid fa-sun" : "fa-solid fa-circle-dot",
      default: aspect === (OPPOSITE[state] ?? "graviton"),
    })),
    rejectClose: false,
  });
  if (choice === "graviton" || choice === "photon") await setAttunement(actor, choice);
}

/** A Strike card from an actor with a change waiting: count it down. */
async function onStrike(message, context) {
  const actor = message.actor;
  const uuid = actor?.uuid;
  const change = uuid && pending.get(uuid);
  if (!change) return;
  change.left -= 1;
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
  if (slug === "attune") return askAttune(actor, state);

  const trait = Object.keys(TRAITS).find((name) => traits.has(name));
  const to = trait ? TRAITS[trait](state) : null;
  if (!to || to === state) return;

  const strikes = STRIKES[slug];
  if (!strikes) return setAttunement(actor, to);
  const change = { actor, from: state, to, left: strikes.count, endOnMiss: !!strikes.endOnMiss, timer: null };
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
      hint: "When a Solarian uses an action with the cycle trait, Graviton and Photon swap; with the disharmony trait, the Solarian becomes Unattuned. An action that includes a Strike changes the state after its Strikes. Attune asks which aspect. An attuned action used while Unattuned gives a warning. Works from the action's chat card (the sheet's action icon or Use button).",
      scope: "world", type: Boolean, default: true,
    },
  },
  init() {
    hooks.clear();
    for (const change of pending.values()) clearTimeout(change.timer);
    pending.clear();

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

    // The turn ends: whatever was waiting is complete.
    hooks.on("updateCombat", (_combat, changes) => {
      if (!pending.size || !("turn" in changes || "round" in changes)) return;
      for (const uuid of [...pending.keys()]) settle(uuid).catch((err) => console.warn(`${MODULE_ID} | Attunement change failed`, err));
    });
  },
};
