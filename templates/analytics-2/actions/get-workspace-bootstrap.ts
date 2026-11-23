import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { evaluateWorkspaceCapabilities } from "../server/lib/analytics-capabilities.js";
import {
  currentWorkspaceCapabilities,
  isWorkspaceAdministrator,
  requireCurrentWorkspace,
} from "../server/lib/workspace-access.js";
import {
  ANALYTICS_CONTROL_IDS,
  capabilityAllowed,
} from "../shared/analytics-control-ids.js";
import { capabilityDecisionSchema } from "../shared/capabilities.js";

export default defineAction({
  description:
    "Read the authenticated workspace identity and navigation permissions.",
  schema: z.object({}).strict(),
  http: { method: "GET" },
  agentTool: false,
  persistInBrowser: false,
  readOnly: true,
  outputSchema: z.object({
    workspace: z.object({ id: z.string(), name: z.string() }),
    user: z.object({ id: z.string(), name: z.string(), email: z.string() }),
    capabilities: z.array(capabilityDecisionSchema),
    features: z.object({
      contextStudio: z.boolean(),
      isManagerOrAbove: z.boolean(),
      isAdmin: z.boolean(),
      canExplore: z.boolean(),
      threads: z.boolean(),
      tasks: z.boolean(),
      folders: z.boolean(),
      developerTools: z.boolean(),
      canCreateProject: z.boolean(),
      canCreateThread: z.boolean(),
    }),
  }),
  run: async () => {
    const current = await requireCurrentWorkspace();
    const [authorization, capabilities] = await Promise.all([
      currentWorkspaceCapabilities(current),
      evaluateWorkspaceCapabilities(current),
    ]);
    return {
      workspace: { id: current.orgId, name: current.membership.name },
      user: {
        id: current.request.authUserId || current.ownerEmail,
        name: current.request.userName || current.ownerEmail,
        email: current.ownerEmail,
      },
      capabilities,
      features: {
        contextStudio: authorization.allows("context-studio"),
        isManagerOrAbove: authorization.isManagerOrAbove,
        isAdmin: isWorkspaceAdministrator(current),
        canExplore: authorization.allows("context-studio"),
        threads: true,
        tasks: true,
        folders: false,
        developerTools: false,
        canCreateProject: capabilityAllowed(
          capabilities,
          ANALYTICS_CONTROL_IDS.createProject,
        ),
        canCreateThread: authorization.allows("create-thread"),
      },
    };
  },
});
