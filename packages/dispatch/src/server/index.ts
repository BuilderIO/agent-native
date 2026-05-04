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
 * Wire dispatch into a Nitro server. Returns a Nitro plugin that stamps the
 * active config so the named-export plugins below pick it up at request time.
 *
 * Typical consumer wiring (one config-stamp plugin + four re-exported
 * plugins, each in its own `server/plugins/<name>.ts` file so Nitro
 * auto-loads them):
 *
 * ```ts
 * // server/plugins/setup-dispatch.ts
 * import { setupDispatch } from "@agent-native/dispatch/server";
 * export default setupDispatch({ auth: { googleOnly: true } });
 *
 * // server/plugins/auth.ts
 * export { dispatchAuthPlugin as default } from "@agent-native/dispatch/server";
 *
 * // server/plugins/integrations.ts
 * export { dispatchIntegrationsPlugin as default } from "@agent-native/dispatch/server";
 *
 * // server/plugins/agent-chat.ts
 * export { dispatchAgentChatPlugin as default } from "@agent-native/dispatch/server";
 *
 * // server/plugins/db.ts
 * export { dispatchDbPlugin as default } from "@agent-native/dispatch/server";
 *
 * // server/plugins/core-routes.ts
 * export { dispatchCoreRoutesPlugin as default } from "@agent-native/dispatch/server";
 * ```
 *
 * The plugins read from the same `getDispatchConfig()` singleton this
 * function stamps, so plugin module-load order does not matter — they
 * resolve config when their plugin function runs, not at import time.
 */
export function setupDispatch(config: DispatchConfig = {}): NitroPluginDef {
  activeConfig = Object.freeze({ ...config });
  return (nitroApp) => {
    void nitroApp;
  };
}

export { default as dispatchAuthPlugin } from "./plugins/auth.js";
export { default as dispatchIntegrationsPlugin } from "./plugins/integrations.js";
export { default as dispatchAgentChatPlugin } from "./plugins/agent-chat.js";
export { default as dispatchDbPlugin } from "./plugins/db.js";
export { default as dispatchCoreRoutesPlugin } from "./plugins/core-routes.js";

export type { DispatchConfig } from "../config.js";
