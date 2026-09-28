import {
  createCoreRoutesPlugin,
  getH3App,
  type NitroPluginDef,
} from "@agent-native/core/server";

import { WORKSPACE_APP_CHAT_PROXY_PREFIX } from "../../shared/workspace-app-chat.js";
import { envKeys } from "../lib/env-config.js";
import { registerDispatchOnboardingSteps } from "../lib/onboarding-steps.js";
import { createWorkspaceAppChatProxyHandler } from "../lib/workspace-app-chat-proxy.js";

// Register before the core plugin so "create your first app" (order 5) appears
// above the auto-generated Slack/Telegram steps (order 60). Idempotent.
registerDispatchOnboardingSteps();

const corePlugin = createCoreRoutesPlugin({
  googleOAuthManagedConnection: "required",
  envKeys,
});

const dispatchCoreRoutesPlugin: NitroPluginDef = (nitroApp) => {
  const coreInit = corePlugin(nitroApp);
  getH3App(nitroApp).use(
    WORKSPACE_APP_CHAT_PROXY_PREFIX,
    createWorkspaceAppChatProxyHandler(),
  );
  return coreInit;
};

export default dispatchCoreRoutesPlugin;
