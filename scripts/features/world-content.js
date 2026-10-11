import { MACRO_FOLDER_ID, MACRO_PACK, MODULE_ID } from "../constants.js";
import { BRAND_COLOR, getOrCreateSharedRoot, packsNeedPlacement, supported, syncModulePacks } from "../lib/outrider-mods.js";

/** Branding sync (Outrider module convention): pack placement and the world copies of the macros. */

/**
 * Flag marking that this module has applied its default (Observer) ownership to a world
 * macro. Applied once per macro; after that the GM's ownership choice is kept on later syncs.
 */
const OWNERSHIP_FLAG = "defaultOwnershipApplied";
const OBSERVER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;

/** This module's own "Stellar Attunement" Macro folder, nested under the shared root (an
 * intentional exception to the flat Outrider's Mods layout: these macros are meant to be found
 * as a set, not mixed loose into the shared root with every other module's). */
async function getOrCreateMacroFolder() {
  if (game.folders.get(MACRO_FOLDER_ID)) return MACRO_FOLDER_ID;
  const parent = await getOrCreateSharedRoot("Macro");
  try {
    await Folder.implementation.create(
      { _id: MACRO_FOLDER_ID, name: "Stellar Attunement", type: "Macro", color: BRAND_COLOR, folder: parent, sorting: "a" },
      { keepId: true },
    );
  } catch (err) {
    if (!game.folders.get(MACRO_FOLDER_ID)) throw err; // another client won the race
  }
  return MACRO_FOLDER_ID;
}

/** True if the compendium has a macro not yet copied into the world (self-heal trigger). */
function macrosMissing() {
  const pack = game.packs.get(MACRO_PACK);
  return !!pack?.index.some((entry) => !game.macros.get(entry._id));
}

/** Copy the macro compendium into the world, in this module's own folder, Observer by default. */
async function syncMacros() {
  const pack = game.packs.get(MACRO_PACK);
  if (!pack) return;
  await pack.getIndex();
  const folder = await getOrCreateMacroFolder();
  const flags = { [MODULE_ID]: { [OWNERSHIP_FLAG]: true } };
  for (const entry of pack.index) {
    const source = await pack.getDocument(entry._id);
    const existing = game.macros.get(entry._id);
    const { name, type, command, img } = source;
    if (existing) {
      const update = { name, type, command, img };
      if (!existing.getFlag(MODULE_ID, OWNERSHIP_FLAG)) {
        update["ownership.default"] = OBSERVER;
        update.flags = flags;
      }
      await existing.update(update);
    } else {
      // Build the data directly: importFromCompendium ignores ownership in its update data.
      const data = game.macros.fromCompendium(source, { keepId: true });
      Object.assign(data, { folder, ownership: { default: OBSERVER }, flags });
      await Macro.implementation.create(data, { keepId: true });
    }
  }
}

/**
 * Compendium Packs tab: pack goes directly in "Outrider's Mods" (shared helper, scripts/lib/outrider-mods.js).
 * Macros tab: copied into the world, in "Outrider's Mods > Stellar Attunement".
 */
export async function syncWorldContent() {
  await syncModulePacks(MODULE_ID, { folderNames: ["Stellar Attunement", "Outrider's Stellar Attunement"] });
  await syncMacros();
}

export const worldContent = {
  id: "worldContent",
  /** No hooks of its own: all of the work is the sync on ready. */
  init() {},
  /** Version-gated, plus self-heal if a pack or macro has lost its place. Active GM only. */
  async ready() {
    if (!supported()) return;
    if (!game.users.activeGM?.isSelf) return;
    const version = game.modules.get(MODULE_ID).version;
    const updated = game.settings.get(MODULE_ID, "syncedVersion") !== version;
    if (!updated && !packsNeedPlacement(MODULE_ID) && !macrosMissing()) return;
    try {
      await syncWorldContent();
      await game.settings.set(MODULE_ID, "syncedVersion", version);
    } catch (err) {
      console.warn(`${MODULE_ID} | World content sync failed`, err);
    }
  },
};
