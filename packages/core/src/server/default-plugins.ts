import { getAppConfig } from "../app-config/index.js";
import type { DefaultPluginSlot } from "../app-config/plugins.js";

/**
 * Which default plugin slots this deployment refuses, from `plugins.disabled`.
 *
 * Read on every call rather than captured once: `getAppConfig()` already caches
 * the parse and drops that cache when the environment layer changes, and the
 * auto-mount decision runs before some apps have called `defineAppConfig()`, so
 * a module-level snapshot would freeze an empty list for the process.
 */
export function getDisabledDefaultPlugins(): readonly DefaultPluginSlot[] {
  return getAppConfig().plugins.disabled;
}

/**
 * Whether the framework should withhold its default implementation of `slot`.
 *
 * Only the framework's own defaults are gated. An app that ships
 * `server/plugins/<slot>.ts` mounted its plugin deliberately, and this switch
 * does not reach in and unmount it.
 */
export function isDefaultPluginDisabled(slot: string): boolean {
  return (getDisabledDefaultPlugins() as readonly string[]).includes(slot);
}
