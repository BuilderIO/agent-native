import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { deleteWorkspaceResource } from "../server/lib/workspace-resources-store.js";

export default defineAction({
  description:
    "Delete a workspace resource and revoke all its grants. Admin only.",
  schema: z.object({
    id: z.string().describe("Resource ID to delete"),
  }),
  run: async (args) => deleteWorkspaceResource(args.id),
});
