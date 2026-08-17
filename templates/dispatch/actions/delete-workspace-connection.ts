import { defineAction } from "@agent-native/core";
import {
  deleteWorkspaceConnection,
  getWorkspaceConnection,
} from "@agent-native/core/workspace-connections";
import { z } from "zod";

import { assertWorkspaceConnectionDeleteManager } from "./connection-permissions.js";

export default defineAction({
  description: "Delete a shared workspace integration connection.",
  schema: z.object({
    id: z.string().describe("Workspace connection ID to delete."),
  }),
  run: async ({ id }, ctx) => {
    const connection = await getWorkspaceConnection(id);
    if (!connection) {
      throw new Error(`Workspace connection "${id}" was not found.`);
    }
    await assertWorkspaceConnectionDeleteManager(ctx, connection);
    const deleted = await deleteWorkspaceConnection(id);
    if (!deleted) {
      throw new Error(`Workspace connection "${id}" was not found.`);
    }
    return { id, deleted };
  },
});
