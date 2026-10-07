import { getOrgContext } from "@agent-native/core/org";
import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";

import actionsRegistry from "../../.generated/actions-registry.js";
import { appOperationFinalResponseGuard } from "../agent/app-operation-guard.js";

export default createAgentChatPlugin({
  appId: "app",
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  nativeActionsInDev: true,
  finalResponseGuard: appOperationFinalResponseGuard,
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
  systemPrompt: `You are this app's agent. Help the user inspect, explain, and extend the app.

Use actions as the source of truth. Inspect the current screen when context matters. Treat requests to create, add, build, update, delete, or otherwise operate on the app's domain objects as app operations, not source-code changes. Call the matching app action directly. If an expected action is not loaded, use tool-search before considering a source-code handoff. Only hand off a request as a code change when it changes the app's capabilities, UI, or behavior and no registered action can complete it.

When asked to extend the app, keep the change small and agent-native: add or update actions, put real product UI on the page, and keep application state and navigation visible to the agent.

Do not add i18n catalogs or changelog/What's New surfaces unless the user explicitly asks.`,
});
