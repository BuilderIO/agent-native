import {
  registerPackageActions,
  type NitroPluginDef,
} from "@agent-native/core/server";
import type { DispatchConfig } from "../config.js";
import { dispatchActions } from "../actions/index.js";

/**
 * Register dispatch's package-contributed actions on import. The framework's
 * `autoDiscoverActions` merges these in after the consumer's local `actions/`
 * directory, so consumers can still override any single action by dropping
 * a same-named file in their own `actions/`.
 *
 * Side-effect import — placing it at module top means `import "@agent-native/
 * dispatch/server"` is enough to wire up actions, even before `setupDispatch`
 * is called.
 */
registerPackageActions(dispatchActions);

/**
 * Internal config singleton — actions and plugins read from this so the
 * consumer's `setupDispatch(config)` call configures the whole package.
 *
 * Stored as a frozen snapshot to avoid accidental mid-request mutation.
 */
let activeConfig: DispatchConfig = {};

export function getDispatchConfig(): DispatchConfig {
  return activeConfig;
}

/**
 * Wire dispatch into a Nitro server. Returns a Nitro plugin that registers
 * dispatch's auth/integrations/db plugins and stamps the active config.
 *
 * Usage:
 * ```ts
 * // server/plugins/dispatch.ts
 * import { setupDispatch } from "@agent-native/dispatch/server";
 *
 * export default setupDispatch({
 *   auth: { googleOnly: true },
 *   hiddenAgentIds: ["calls", "issues"],
 * });
 * ```
 *
 * IMPLEMENTATION NOTE: this currently only stamps config + registers
 * actions. The auth/integrations/db plugins land in subsequent lift
 * passes — see TODOs.
 */
export function setupDispatch(config: DispatchConfig = {}): NitroPluginDef {
  activeConfig = Object.freeze({ ...config });
  return (nitroApp) => {
    // TODO: register dispatch's plugins (auth, integrations, db) here
    // once the server-lib lift lands. For now the consumer keeps mounting
    // them via their own server/plugins/ files.
    void nitroApp;
  };
}

export type { DispatchConfig } from "../config.js";
