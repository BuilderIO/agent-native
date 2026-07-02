import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { deleteWorkspaceResource } from "../server/lib/workspace-resources-store.js";

export default defineAction({
  description:
    "Delete a workspace resource and revoke all its grants. When Dispatch approval policy is enabled, deleting an All-app resource queues an approval request before taking effect.",
  schema: z.object({
    id: z.string().describe("Resource ID to delete"),
  }),
  run: async (args) => deleteWorkspaceResource(args.id),
});
