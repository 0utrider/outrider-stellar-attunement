/**
 * What depends on the game system. sf2e is built from the pf2e code base, so the classes and
 * the data model are shared. The flags a system writes on its own documents are not: they sit
 * under the system's id (`flags.sf2e` here, `flags.pf2e` on pf2e).
 */

/** The system's own flags on a document: a chat message's context, origin and so on. */
export const systemFlags = (document) => document?.flags?.[game.system.id];
