import { getOrgContext } from "@agent-native/core/org";
import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";

import actionsRegistry from "../../.generated/actions-registry.js";

// The everyday grid, list, and record surface is what a CRM turn almost always
// touches, so those schemas are paid for up front. Dashboards, signal authoring,
// and the staged-dataset reducers are occasional and stay behind tool-search.
const INITIAL_TOOL_NAMES = [
  "get-crm-workspace",
  "get-crm-overview",
  "navigate",
  "view-screen",
  "configure-native-crm",
  "configure-crm-connection",
  "list-workspace-connections",
  "sync-crm",
  "list-crm-attributes",
  "list-crm-records",
  "list-crm-record-values",
  "get-crm-record",
  "get-crm-record-page",
  "create-crm-record",
  "update-crm-record",
  "list-crm-lists",
  "list-crm-list-entries",
  "add-crm-record-to-list",
  "update-crm-list-entry",
  "list-crm-saved-views",
  "save-crm-saved-view",
  "find-crm-duplicates",
  "estimate-crm-enrichment",
  "run-crm-attribute-fill",
  "list-crm-tasks",
  "manage-crm-task",
  "list-crm-proposals",
  "apply-crm-proposals",
  "attach-call-evidence",
  "get-crm-automation-recipe",
  "list-crm-signal-trackers",
  "run-crm-signal-trackers",
  "list-crm-signal-hits",
  "review-crm-signal",
  "provider-api-catalog",
  "provider-api-request",
];

export default createAgentChatPlugin({
  appId: "crm",
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  initialToolNames: INITIAL_TOOL_NAMES,
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
  codeExecution: { production: "sandboxed" },
  // AGENTS.md is already injected as a prompt resource and the `crm` skill holds
  // the depth, so restating either here would only pay for the same tokens
  // twice — and drift from them on the next edit.
  systemPrompt: `You are the CRM for this workspace. Your operating rules live in AGENTS.md and the \`crm\` skill — follow them; this prompt deliberately does not restate them.

Start from the smallest read that answers the request: \`get-crm-workspace\` for "what should I work on", \`view-screen\` when the request names what is on screen, otherwise the focused CRM action. Show a result by navigating to it rather than describing it.

Never fabricate, and never flatten a failure into a normal-looking value. Read a value back before reporting it done.`,
});
