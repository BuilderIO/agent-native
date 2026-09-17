import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { authorizeDispatchAdmin } from "../server/lib/app-roles.js";
import {
  requireWorkspaceResourceCtx,
  revokeResourceGrant,
} from "../server/lib/workspace-resources-store.js";

export default defineAction({
  description: "Revoke an app's access to a workspace resource. Admin only.",
  authorize: authorizeDispatchAdmin,
  schema: z.object({
    grantId: z.string().describe("Grant ID to revoke"),
  }),
  run: async (args) =>
    revokeResourceGrant(args.grantId, requireWorkspaceResourceCtx()),
});
