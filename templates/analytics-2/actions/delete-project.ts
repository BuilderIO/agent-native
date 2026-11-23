import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { requireOwnedProject } from "../server/lib/project-action-access.js";
import { deleteProjectPermanently } from "../server/model/projects-store.js";

/**
 * Permanently deletes a project that is already in the trash ("Permanently
 * delete" in the source's Trash view, behind its confirmation dialog).
 */
export default defineAction({
  mcpTool: true,
  needsApproval: true,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  description:
    "Permanently delete a project that is in the trash. This cannot be undone.",
  schema: z.object({ projectId: z.string().min(1) }).strict(),
  outputSchema: z.object({ id: z.string(), deleted: z.literal(true) }),
  run: async ({ projectId }) => {
    const { scope } = await requireOwnedProject(projectId);
    await deleteProjectPermanently(scope, projectId);
    return { id: projectId, deleted: true as const };
  },
});
