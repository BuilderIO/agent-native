import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  requireCurrentWorkspace,
  workspaceAccess,
} from "../server/lib/workspace-access.js";
import { deleteCollection } from "../server/model/collections-store.js";

export default defineAction({
  mcpTool: true,
  needsApproval: true,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  description:
    "Permanently delete a collection. The projects filed in it are not deleted.",
  schema: z.object({ collectionId: z.string().min(1) }).strict(),
  outputSchema: z.object({ collectionId: z.string() }),
  run: async ({ collectionId }) => {
    const current = await requireCurrentWorkspace();
    const scope = { ownerEmail: current.ownerEmail, orgId: current.orgId };
    await workspaceAccess.assertPermission(["create-project"], scope);
    await deleteCollection(scope, collectionId);
    return { collectionId };
  },
});
