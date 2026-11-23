import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  projectDocumentResultSchema,
  refreshedProjectDocument,
  requireOwnedProject,
} from "../server/lib/project-action-access.js";
import { updateProject } from "../server/model/projects-store.js";

/**
 * Moves a project into the archive. The source reaches this as "Archive" from
 * the projects list, behind a confirmation dialog; the project keeps its work
 * and leaves the active listing.
 */
export default defineAction({
  mcpTool: true,
  description: "Move a project to the workspace archive.",
  schema: z.object({ projectId: z.string().min(1) }).strict(),
  outputSchema: projectDocumentResultSchema,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async ({ projectId }) => {
    const { scope } = await requireOwnedProject(projectId);
    await updateProject({ ...scope, projectId, archived: true });
    return { project: await refreshedProjectDocument(scope, projectId) };
  },
});
