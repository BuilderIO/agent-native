import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { collectionSchema } from "../app/lib/model/contracts.js";
import {
  requireCurrentWorkspace,
  workspaceAccess,
} from "../server/lib/workspace-access.js";
import { updateCollection } from "../server/model/collections-store.js";

/**
 * Stars, or unstars, a collection for the signed-in member. The source's
 * collections list reaches this with the star checkbox on each collection card.
 */
export default defineAction({
  description: "Add a collection to the caller's favorites, or remove it.",
  schema: z
    .object({ collectionId: z.string().min(1), favorited: z.boolean() })
    .strict(),
  outputSchema: z.object({ collection: collectionSchema }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async ({ collectionId, favorited }) => {
    const current = await requireCurrentWorkspace();
    const scope = { ownerEmail: current.ownerEmail, orgId: current.orgId };
    await workspaceAccess.assertPermission(["create-project"], scope);
    const collection = await updateCollection({
      ...scope,
      collectionId,
      favorited,
    });
    return { collection };
  },
});
