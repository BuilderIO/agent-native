import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { revokeResourceGrant } from "../server/lib/workspace-resources-store.js";

export default defineAction({
  description: "Revoke an app's access to a workspace resource. Admin only.",
  schema: z.object({
    grantId: z.string().describe("Grant ID to revoke"),
  }),
  run: async (args) => revokeResourceGrant(args.grantId),
});
