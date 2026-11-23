import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  projectDocumentResultSchema,
  refreshedProjectDocument,
  requireOwnedProject,
} from "../server/lib/project-action-access.js";
import { updateProject } from "../server/model/projects-store.js";

/**
 * Puts a trashed project back in the workspace. The source's Trash view reaches
 * this as "Restore", with no confirmation step.
 */
export default defineAction({
  mcpTool: true,
  description: "Restore a trashed project to the workspace.",
  schema: z.object({ projectId: z.string().min(1) }).strict(),
  outputSchema: projectDocumentResultSchema,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async ({ projectId }) => {
    const { scope } = await requireOwnedProject(projectId);
    await updateProject({ ...scope, projectId, trashed: false });
    return { project: await refreshedProjectDocument(scope, projectId) };
  },
});
