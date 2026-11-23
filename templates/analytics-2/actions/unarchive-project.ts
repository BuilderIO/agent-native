import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  projectDocumentResultSchema,
  refreshedProjectDocument,
  requireOwnedProject,
} from "../server/lib/project-action-access.js";
import { updateProject } from "../server/model/projects-store.js";

/**
 * Puts an archived project back among the active projects. The source's Archive
 * view reaches this as "Unarchive", with no confirmation step.
 */
export default defineAction({
  mcpTool: true,
  description: "Return an archived project to the active projects list.",
  schema: z.object({ projectId: z.string().min(1) }).strict(),
  outputSchema: projectDocumentResultSchema,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async ({ projectId }) => {
    const { scope } = await requireOwnedProject(projectId);
    await updateProject({ ...scope, projectId, archived: false });
    return { project: await refreshedProjectDocument(scope, projectId) };
  },
});
