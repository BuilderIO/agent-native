import { defineAction } from "@agent-native/core";
import { deleteWorkspaceConnection } from "@agent-native/core/workspace-connections";
import { z } from "zod";

export default defineAction({
  description: "Delete a shared workspace integration connection.",
  schema: z.object({
    id: z.string().describe("Workspace connection ID to delete."),
  }),
  run: async ({ id }) => {
    const deleted = await deleteWorkspaceConnection(id);
    if (!deleted) {
      throw new Error(`Workspace connection "${id}" was not found.`);
    }
    return { id, deleted };
  },
});
