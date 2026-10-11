import { MODULE_ID } from "./constants.js";

/**
 * Hook ids by feature, all in one place.
 *
 * The list is kept on globalThis, not in this file's scope, so a second evaluation of the
 * module in the same page (a dev reload) can find and turn off what the first one registered.
 * On a normal load every feature's init runs once and `clear()` has nothing to do.
 */
const KEY = Symbol.for(`${MODULE_ID}.hooks`);

/** Map of feature id to [hook name, hook id] pairs. */
export const hookRegistry = () => (globalThis[KEY] ??= new Map());

/** A feature's own view of the registry. Call `clear()` first in `init`, then register. */
export function featureHooks(featureId) {
  const ids = () => {
    const registry = hookRegistry();
    if (!registry.has(featureId)) registry.set(featureId, []);
    return registry.get(featureId);
  };
  return {
    on(hook, fn) {
      const id = Hooks.on(hook, fn);
      ids().push([hook, id]);
      return id;
    },
    once(hook, fn) {
      const id = Hooks.once(hook, fn);
      ids().push([hook, id]);
      return id;
    },
    /** Turns off every hook this feature registered, in this evaluation or an earlier one. */
    clear() {
      for (const [hook, id] of ids().splice(0)) Hooks.off(hook, id);
    },
  };
}
