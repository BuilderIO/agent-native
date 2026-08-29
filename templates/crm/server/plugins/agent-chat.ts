import { getOrgContext } from "@agent-native/core/org";
import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
  getRequestOrgId,
  getRequestUserEmail,
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

const CRM_DASHBOARD_EDIT_TOOLS = new Set([
  "install-crm-pipeline-dashboard",
  "restore-crm-dashboard-revision",
  "save-crm-dashboard",
]);

function hasCrmDashboardEdit(run: { events: readonly unknown[] }): boolean {
  return run.events.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const event = (entry as { event?: unknown }).event;
    if (!event || typeof event !== "object") return false;
    const record = event as Record<string, unknown>;
    return (
      record.type === "tool_done" &&
      record.completedSideEffect === true &&
      record.isError !== true &&
      typeof record.tool === "string" &&
      CRM_DASHBOARD_EDIT_TOOLS.has(record.tool)
    );
  });
}

async function autosaveCrmDashboardAfterAgentTurn(
  scope: { type: string; id: string },
  run: { events: readonly unknown[] },
): Promise<void> {
  if (scope.type !== "crm-dashboard" || !hasCrmDashboardEdit(run)) return;
  const userEmail = getRequestUserEmail();
  if (!userEmail) return;
  const { crmDashboardStore } = await import("../server/db/index.js");
  await crmDashboardStore.createRevisionSnapshot(scope.id, {
    userEmail,
    orgId: getRequestOrgId() || undefined,
  });
}

export default createAgentChatPlugin({
  appId: "crm",
  onAgentTurnComplete: autosaveCrmDashboardAfterAgentTurn,
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
