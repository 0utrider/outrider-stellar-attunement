export const MODULE_ID = "outrider-stellar-attunement";

export const MACRO_PACK = `${MODULE_ID}.outrider-stellar-attunement-macros`;
/** Fixed id, exactly 16 chars: this module's own Macro subfolder, nested under the shared root. */
export const MACRO_FOLDER_ID = "osaModsMacroFldr";

/**
 * State lives on the SF2e "Stellar Attunement" feat as a toggleable RollOption
 * (option "stellar-attunement", suboptions graviton|photon|unattuned).
 */
export const OPTION = "stellar-attunement";
export const STATES = ["unattuned", "graviton", "photon"];
export const LABELS = { unattuned: "Unattuned", graviton: "Graviton-Attuned", photon: "Photon-Attuned" };
/** Token art file suffix per state (see the art convention in the README). */
export const SUFFIX = { unattuned: "", graviton: "-1", photon: "-2" };
export const OPPOSITE = { graviton: "photon", photon: "graviton" };
