import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { requireLinkableProject } from "../server/lib/collection-link-access.js";
import { removeProjectFromCollection } from "../server/model/collections-store.js";

export default defineAction({
  mcpTool: true,
  description: "Remove a project from a collection without deleting either.",
  schema: z
    .object({
      projectId: z.string().min(1),
      collectionId: z.string().min(1),
    })
    .strict(),
  outputSchema: z.object({ projectId: z.string(), collectionId: z.string() }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async ({ projectId, collectionId }) => {
    const { scope, project } = await requireLinkableProject(projectId);
    await removeProjectFromCollection({
      ...scope,
      projectId: project.id,
      collectionId,
    });
    return { projectId: project.id, collectionId };
  },
});
