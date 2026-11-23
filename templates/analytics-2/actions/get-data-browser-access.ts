import { defineAction } from "@agent-native/core/action";
import { getOrgSetting } from "@agent-native/core/settings";
import { z } from "zod";

import { evaluateWorkspaceCapabilities } from "../server/lib/analytics-capabilities.js";
import {
  currentWorkspaceCapabilities,
  isWorkspaceAdministrator,
  requireCurrentWorkspace,
} from "../server/lib/workspace-access.js";
import {
  ANALYTICS_CONTROL_IDS as controls,
  capabilityAllowed,
} from "../shared/analytics-control-ids.js";
import { capabilityDecisionSchema } from "../shared/capabilities.js";

export default defineAction({
  description:
    "Resolve the current member's Data browser permissions and workspace presentation flags.",
  schema: z.object({}).strict(),
  outputSchema: z.object({
    capabilities: z.array(capabilityDecisionSchema),
    canBrowseData: z.boolean(),
    canManageMetadata: z.boolean(),
    isAdministrator: z.boolean(),
    canAddConnection: z.boolean(),
    canCreateStatus: z.boolean(),
    canCreateCategory: z.boolean(),
    aiEnabled: z.boolean(),
  }),
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: async () => {
    const current = await requireCurrentWorkspace();
    const [workspaceRole, capabilities, settings] = await Promise.all([
      currentWorkspaceCapabilities(current),
      evaluateWorkspaceCapabilities(current, [
        controls.dataBrowse,
        controls.bigQueryConnectionCreate,
        controls.unsupportedConnector,
        controls.writeback,
        controls.dbtSemanticLayer,
      ]),
      getOrgSetting(current.orgId, "analytics.data.browser"),
    ]);
    const isAdministrator = isWorkspaceAdministrator(current);
    return {
      capabilities,
      canBrowseData: capabilityAllowed(capabilities, controls.dataBrowse),
      canManageMetadata: workspaceRole.isManagerOrAbove,
      isAdministrator,
      canAddConnection: capabilityAllowed(
        capabilities,
        controls.bigQueryConnectionCreate,
      ),
      canCreateStatus: isAdministrator,
      canCreateCategory: isAdministrator,
      aiEnabled: settings?.aiEnabled !== false,
    };
  },
});
