import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { requireLinkableProject } from "../server/lib/collection-link-access.js";
import { addProjectToCollection } from "../server/model/collections-store.js";

export default defineAction({
  mcpTool: true,
  description: "File a project into a collection of the same workspace.",
  schema: z
    .object({
      projectId: z.string().min(1),
      collectionId: z.string().min(1),
    })
    .strict(),
  outputSchema: z.object({ projectId: z.string(), collectionId: z.string() }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async ({ projectId, collectionId }) => {
    const { scope, project } = await requireLinkableProject(projectId);
    await addProjectToCollection({
      ...scope,
      projectId: project.id,
      collectionId,
    });
    return { projectId, collectionId };
  },
});
