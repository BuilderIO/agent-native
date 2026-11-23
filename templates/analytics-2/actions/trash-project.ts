import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { requireOwnedProject } from "../server/lib/project-action-access.js";
import { updateProject } from "../server/model/projects-store.js";

export default defineAction({
  mcpTool: true,
  description:
    "Move an owned project to the workspace trash without permanently deleting its contents.",
  schema: z.object({ projectId: z.string().min(1) }).strict(),
  outputSchema: z.object({ id: z.string(), trashedAt: z.string() }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async ({ projectId }) => {
    const { scope } = await requireOwnedProject(projectId);
    const project = await updateProject({ ...scope, projectId, trashed: true });
    if (!project.trashedAt)
      throw new Error("The project was not moved to trash.");
    return { id: project.id, trashedAt: project.trashedAt };
  },
});
