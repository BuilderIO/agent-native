import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  agentNavigationSchema,
  agentOpenIntentSchema,
  showAgentProject,
} from "../server/agent-navigation.js";
import {
  ANALYTICS_CONTROL_IDS,
  requireCapability,
} from "../server/lib/analytics-capabilities.js";
import {
  notebookChangeResource,
  projectDocumentResultSchema,
  refreshedProjectDocument,
  requireOwnedProject,
} from "../server/lib/project-action-access.js";
import { duplicateProject } from "../server/model/projects-store.js";
import { workspaceIdSchema } from "../shared/notebook-snapshot-contract.js";

export default defineAction({
  mcpTool: true,
  description: "Create a copy of a project in the current workspace.",
  schema: z
    .object({ projectId: z.string().min(1), intent: agentOpenIntentSchema })
    .strict(),
  changeResource: (_input, output) =>
    notebookChangeResource({ projectId: output.project.id }),
  outputSchema: projectDocumentResultSchema.extend({
    navigation: agentNavigationSchema.optional(),
  }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async ({ projectId, intent }, context) => {
    const { scope } = await requireOwnedProject(projectId);
    await requireCapability(ANALYTICS_CONTROL_IDS.createProject, {
      kind: "workspace",
      workspaceId: workspaceIdSchema.parse(scope.orgId),
    });
    const copy = await duplicateProject(scope, projectId);
    const document = await refreshedProjectDocument(scope, copy.id);
    return {
      project: document,
      ...(await showAgentProject(context, copy.id, intent)),
    };
  },
});
