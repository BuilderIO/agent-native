import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  projectDocumentResultSchema,
  refreshedProjectDocument,
  requireOwnedProject,
} from "../server/lib/project-action-access.js";
import { updateProject } from "../server/model/projects-store.js";

/**
 * Adds a project to, or removes it from, the caller's favorites. The source's
 * project list reaches this as "Add to favorites" / "Remove from favorites".
 */
export default defineAction({
  mcpTool: true,
  description: "Add a project to the caller's favorites, or remove it.",
  schema: z
    .object({ projectId: z.string().min(1), favorited: z.boolean() })
    .strict(),
  outputSchema: projectDocumentResultSchema,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async ({ projectId, favorited }) => {
    const { scope } = await requireOwnedProject(projectId);
    await updateProject({ ...scope, projectId, favorited });
    return { project: await refreshedProjectDocument(scope, projectId) };
  },
});
