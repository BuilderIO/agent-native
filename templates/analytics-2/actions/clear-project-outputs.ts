import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  projectDocumentResultSchema,
  refreshedProjectDocument,
  requireOwnedProject,
} from "../server/lib/project-action-access.js";
import { clearProjectOutputs } from "../server/model/runs-store.js";

export default defineAction({
  description:
    "Clear every saved cell output in a project, leaving the cells and their sources unchanged.",
  schema: z.object({ projectId: z.string().min(1) }).strict(),
  outputSchema: projectDocumentResultSchema,
  http: { method: "POST" },
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async ({ projectId }) => {
    const { scope, project } = await requireOwnedProject(projectId);
    await clearProjectOutputs(scope, project.id);
    return { project: await refreshedProjectDocument(scope, project.id) };
  },
});
