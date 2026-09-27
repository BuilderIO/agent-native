import { defineAppRoles } from "@agent-native/core/org";
import {
  registerPackageActions,
  type NitroPluginDef,
} from "@agent-native/core/server";

import { dispatchActions } from "../actions/index.js";
import type { DispatchConfig } from "../config.js";
import { dispatchAccessDescriptor } from "../shared/app-roles.js";

defineAppRoles(dispatchAccessDescriptor);

registerPackageActions(dispatchActions);

let activeConfig: DispatchConfig = {};

export function getDispatchConfig(): DispatchConfig {
  return activeConfig;
}

export function setupDispatch(config: DispatchConfig = {}): NitroPluginDef {
  activeConfig = Object.freeze({ ...config });
  return (nitroApp) => {
    void nitroApp;
  };
}

export { default as dispatchAuthPlugin } from "./plugins/auth.js";
export { default as dispatchIntegrationsPlugin } from "./plugins/integrations.js";
export { default as dispatchAgentChatPlugin } from "./plugins/agent-chat.js";
export {
  default as dispatchDbPlugin,
  runDispatchMigrations,
} from "./plugins/db.js";
export { default as dispatchCoreRoutesPlugin } from "./plugins/core-routes.js";

export type { DispatchConfig } from "../config.js";
