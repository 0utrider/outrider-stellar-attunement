import { MODULE_ID } from "./constants.js";

/**
 * Per-player effect choices.
 *
 * With the world setting "playerEffects" on, a player can pick their own border, ring colors
 * and attack animations, and everyone sees them. The choices are flags on the player's own
 * User document (`flags.<id>.effects`), which a player may write and every client can read.
 * A client setting could not do this: the active GM's client draws the borders, and it cannot
 * read another browser's storage.
 *
 * The GM's settings stay the default. A choice a player has not made, has left blank, or that
 * cannot be used (a path that is not in the Sequencer database, a color that does not parse)
 * reads as the world setting. With the switch off the stored choices are ignored, not deleted.
 *
 * Blank means "the GM's", so it cannot also mean "nothing". A player who wants no border, no
 * attack animation or the token's own ring color where the GM set one stores the word in NONE,
 * and the setting then reads as blank for them.
 *
 * Every feature asks through `effectValue(key, user)`, so there is one place that decides.
 */

/** The key under the module's flags on a User document. */
export const CHOICES_FLAG = "effects";

/** What a player stores in a text choice to say "nothing here", whatever the GM set. */
export const NONE = "none";

/**
 * A setting key as it is spelled inside the flag. Setting keys have dots
 * ("border.graviton", "border.graviton.scale") and Foundry expands a dotted flag key into
 * nested objects, where the first of those two could not hold both a path and a scale.
 */
export const choiceKey = (key) => key.replaceAll(".", "_");

/** True when players may make their own choices. */
export function playerEffectsOn() {
  return game.settings.get(MODULE_ID, "playerEffects") === true;
}

/** What a user has stored for a setting key, or undefined. Read whatever the switch says. */
export function storedChoice(user, key) {
  return user?.flags?.[MODULE_ID]?.[CHOICES_FLAG]?.[choiceKey(key)];
}

/** The players who have at least one choice stored, whatever the switch says. */
export function playersWithChoices() {
  return game.users.filter((user) => {
    const stored = user.flags?.[MODULE_ID]?.[CHOICES_FLAG];
    return !user.isGM && !!stored && Object.values(stored).some((value) => value !== null && value !== undefined && value !== "");
  });
}

/** Removes every stored choice of these players. For the GM: a player may only write their own. */
export async function clearChoices(users = playersWithChoices()) {
  for (const user of users) await user.unsetFlag(MODULE_ID, CHOICES_FLAG);
}

/**
 * The player whose choices a token of this actor shows, or null for the GM's settings.
 *
 * Borders, rings and attack animations follow the token's player: the one player who has
 * the actor as their assigned character, else the only player who owns it. An actor only the
 * GM owns, or one that several players own with none of them assigned, has no single player to
 * follow and uses the GM's settings. An unlinked token goes by the actor it was made from.
 */
export function playerFor(actor) {
  if (!actor || !playerEffectsOn()) return null;
  const base = actor.isToken ? actor.token?.baseActor ?? actor : actor;
  const players = game.users.filter((user) => !user.isGM);
  const assigned = players.filter((user) => user.character?.id === base.id);
  if (assigned.length) return assigned.length === 1 ? assigned[0] : null;
  const owners = players.filter((user) => base.testUserPermission(user, "OWNER"));
  return owners.length === 1 ? owners[0] : null;
}

/**
 * The value of a setting for one user: the world setting, unless the switch is on and that
 * player has stored a usable choice of their own.
 *
 * @param {string} key        The setting key ("border.photon", "ring.graviton.color", ...).
 * @param {User|null} user    The player to resolve for (`playerFor(actor)`, or for an attack
 *                            with no single player, the message's author). Null or a GM: the
 *                            world setting.
 * @param {Function} [valid]  For a text setting, says whether a player's value can be used.
 */
export function effectValue(key, user, valid) {
  const world = game.settings.get(MODULE_ID, key);
  if (!user || user.isGM || !playerEffectsOn()) return world;
  const own = storedChoice(user, key);
  if (typeof world === "number") {
    if (own === null || own === undefined || own === "") return world;
    const number = Number(own);
    if (!Number.isFinite(number)) return world;
    // A flag is not checked against the setting's range the way a setting is.
    const range = game.settings.settings.get(`${MODULE_ID}.${key}`)?.range;
    return range ? Math.min(range.max, Math.max(range.min, number)) : number;
  }
  const text = typeof own === "string" ? own.trim() : "";
  if (!text) return world;
  if (text.toLowerCase() === NONE) return "";
  if (valid && !valid(text)) return world;
  return text;
}
